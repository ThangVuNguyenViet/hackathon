import { describe, expect, it, vi } from 'vitest';
import {
  MemoryStore,
  type CommitPausedCustomerRunIntakeInput,
  type CommitPausedCustomerRunIntakeResult,
  type CreateCustomerRunInput,
} from '../../src/persistence/memoryStore.js';
import type { KfcGenUiAttachment } from '../../src/genui/kfcGenUi.js';
import {
  CustomerRunCoordinator,
  splitCustomerText,
} from '../../src/customerRuns/runtime.js';

const request = {
  schemaVersion: 1 as const,
  sessionId: 'kfc:customer_1',
  customerId: 'customer_1',
  clientMessageId: 'message_1',
  input: { kind: 'text' as const, text: 'Cho mình một combo gà' },
};

describe('CustomerRunCoordinator', () => {
  it('reuses the same accepted run and rejects a fingerprint conflict', async () => {
    const deferred: Array<() => Promise<void>> = [];
    const coordinator = new CustomerRunCoordinator({
      store: new MemoryStore(),
      defer: (task) => deferred.push(task),
      execute: vi.fn(),
      paceMs: 0,
    });

    const first = await coordinator.start(request);
    const retry = await coordinator.start(request);
    const conflict = await coordinator.start({
      ...request,
      input: { kind: 'text', text: 'Nội dung khác' },
    });

    expect(first.status).toBe(202);
    expect(retry.body).toMatchObject({ runId: first.body.runId, replayed: true });
    expect(conflict.status).toBe(409);
    expect(deferred).toHaveLength(1);
  });

  it('persists an ordered customer-safe stream whose chunks equal final text', async () => {
    const store = new MemoryStore();
    const deferred: Array<() => Promise<void>> = [];
    const genUi: KfcGenUiAttachment = {
      id: 'card_1', lifecycleStage: 'cart', widgetKind: 'cartBuilder', status: 'active',
      title: 'Giỏ hàng', data: { total: 100000 }, actions: [{ id: 'confirm', label: 'Xác nhận' }],
    };
    const coordinator = new CustomerRunCoordinator({
      store,
      defer: (task) => deferred.push(task),
      execute: async () => ({ responseText: 'Xin chào 👨‍👩‍👧‍👦 — đơn của bạn.', genUi }),
      paceMs: 0,
    });
    const started = await coordinator.start(request);
    await deferred[0]!();

    const runId = started.body.runId as string;
    const events = await store.listCustomerRunEvents(runId, 0);
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'run_accepted', 'run_started', 'progress_updated', 'text_started',
      'text_delta', 'genui_revision', 'genui_snapshot', 'run_completed',
    ]));
    expect(events.filter((event) => event.type === 'text_delta').map((event) => event.payload.delta).join(''))
      .toBe('Xin chào 👨‍👩‍👧‍👦 — đơn của bạn.');
    const revisions = events.filter((event) => event.type === 'genui_revision');
    expect(revisions.length).toBeGreaterThanOrEqual(2);
    expect(revisions.every((event) => (event.payload.snapshot as KfcGenUiAttachment).actions.length === 0)).toBe(true);
    expect(events.find((event) => event.type === 'genui_snapshot')?.payload.snapshot).toEqual(genUi);
    expect(JSON.stringify(events)).not.toMatch(/tool|planner|argument|trace/i);
  });

  it('persists only the privacy-safe saved-address GenUI projection', async () => {
    const store = new MemoryStore();
    const deferred: Array<() => Promise<void>> = [];
    const privateAddressMarker = 'private-stream-saved-address-Ω';
    const savedAddressRef =
      '00000000-0000-4000-8000-000000000123';
    const genUi: KfcGenUiAttachment = {
      id: 'saved_address_stream_card',
      lifecycleStage: 'fulfillment',
      widgetKind: 'addressFulfillmentCheck',
      status: 'active',
      title: 'Kiểm tra giao hàng',
      data: {
        address: {
          label: 'Nhà',
          line1: privateAddressMarker,
          district: 'Quận 7',
          city: 'Hồ Chí Minh',
        },
        addressStatus: 'candidate',
        cart: {
          id: 'saved-address-stream-cart',
          items: [{
            itemCode: '41141',
            name: 'Zinger Burger',
            quantity: 1,
            unitPriceVnd: 55_000,
          }],
          subtotalVnd: 55_000,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 55_000,
          voucherCode: null,
        },
        fulfillment: null,
      },
      actions: [{
        id: 'accept_fulfillment',
        label: 'Giao đến địa chỉ này',
        intent: 'primary',
        value: savedAddressRef,
      }],
    };
    const coordinator = new CustomerRunCoordinator({
      store,
      defer: (task) => deferred.push(task),
      execute: async () => ({
        responseText: 'Mình đã tìm thấy một địa chỉ đã lưu.',
        genUi,
      }),
      paceMs: 0,
    });

    const started = await coordinator.start(request);
    await deferred[0]!();

    const events = await store.listCustomerRunEvents(
      started.body.runId as string,
      0,
    );
    const durableGenUiEvents = events.filter(
      ({ type }) =>
        type === 'genui_revision' || type === 'genui_snapshot',
    );
    expect(durableGenUiEvents).toHaveLength(3);
    expect(JSON.stringify(durableGenUiEvents))
      .not.toContain(privateAddressMarker);
    for (const event of durableGenUiEvents) {
      const snapshot =
        event.payload.snapshot as KfcGenUiAttachment;
      expect(snapshot.data).not.toHaveProperty('address');
    }
    const fullSnapshots = durableGenUiEvents
      .map(({ payload }) => payload.snapshot as KfcGenUiAttachment)
      .filter(({ data }) => Object.keys(data).length > 0);
    expect(fullSnapshots).toHaveLength(2);
    for (const snapshot of fullSnapshots) {
      expect(snapshot.data).toMatchObject({
        addressStatus: 'candidate',
        cart: {
          id: 'saved-address-stream-cart',
          items: [expect.objectContaining({
            itemCode: '41141',
            quantity: 1,
          })],
        },
      });
    }
    const terminalSnapshot = durableGenUiEvents.find(
      ({ type }) => type === 'genui_snapshot',
    )?.payload.snapshot as KfcGenUiAttachment | undefined;
    expect(terminalSnapshot?.actions).toEqual([
      expect.objectContaining({
        id: 'accept_fulfillment',
        value: savedAddressRef,
      }),
    ]);
  });

  it('emits a stable customer-safe activity at a validated tool boundary', async () => {
    const store = new MemoryStore();
    const deferred: Array<() => Promise<void>> = [];
    const coordinator = new CustomerRunCoordinator({
      store,
      defer: (task) => deferred.push(task),
      execute: async (_request, _runId, observe) => {
        await observe({
          kind: 'tool',
          protected: false,
          irreversible: false,
          progressFamily: 'checking_menu',
        });
        await observe({ kind: 'verified_state' });
        await observe({ kind: 'response_composition' });
        return { responseText: 'Mình đã tìm thấy các món phù hợp.' };
      },
      paceMs: 0,
    });

    const started = await coordinator.start(request);
    await deferred[0]!();

    const events = await store.listCustomerRunEvents(
      started.body.runId as string,
      0,
    );
    const progress = events
      .filter((event) => event.type === 'progress_updated')
      .map((event) => event.payload);
    expect(progress).toEqual([
      {
        code: 'reviewing_request',
        label: 'Đang xem yêu cầu của bạn…',
        cancellable: true,
      },
      {
        code: 'checking_menu',
        label: 'Đang kiểm tra menu…',
        cancellable: true,
      },
      {
        code: 'preparing_response',
        label: 'Đang chuẩn bị câu trả lời…',
        cancellable: true,
      },
    ]);
    expect(JSON.stringify(progress)).not.toMatch(
      /searchMenu|tool|planner|argument|trace/i,
    );
  });

  it('terminalizes a suppressed execution without publishing model output', async () => {
    const store = new MemoryStore();
    const deferred: Array<() => Promise<void>> = [];
    const coordinator = new CustomerRunCoordinator({
      store,
      defer: (task) => deferred.push(task),
      execute: async () => ({ status: 'superseded' }),
      paceMs: 0,
    });

    const started = await coordinator.start(request);
    await deferred[0]!();

    const runId = started.body.runId as string;
    await expect(store.getCustomerRun(runId)).resolves.toMatchObject({
      status: 'superseded',
      phase: 'finalizing',
    });
    const eventTypes = (
      await store.listCustomerRunEvents(runId)
    ).map(({ type }) => type);
    expect(eventTypes).toContain('run_superseded');
    expect(eventTypes).not.toEqual(expect.arrayContaining([
      'genui_revision',
      'genui_snapshot',
      'text_started',
      'text_delta',
      'run_completed',
    ]));
  });

  it('atomically retains text intake for a human-paused session without starting AI', async () => {
    const store = new MemoryStore();
    await store.transitionSessionAuthority({
      sessionId: request.sessionId,
      expectedGeneration: 0,
      agentMode: 'human_paused',
      assignedAgentId: 'agent_1',
    });
    const deferred: Array<() => Promise<void>> = [];
    const execute = vi.fn();
    const coordinator = new CustomerRunCoordinator({
      store,
      defer: (task) => deferred.push(task),
      execute,
      paceMs: 0,
    });

    const first = await coordinator.start(request);
    const replay = await coordinator.start(request);
    const conflict = await coordinator.start({
      ...request,
      input: { kind: 'text', text: 'Nội dung khác' },
    });

    expect(first).toEqual({
      status: 202,
      body: {
        schemaVersion: 1,
        runId: expect.any(String),
        status: 'superseded',
        nextSequence: 1,
        replayed: false,
        suppressed: true,
        agentMode: 'human_paused',
      },
    });
    expect(replay).toEqual({
      status: 202,
      body: {
        schemaVersion: 1,
        runId: first.body.runId,
        status: 'superseded',
        nextSequence: 1,
        replayed: true,
        suppressed: true,
      },
    });
    expect(conflict).toEqual({
      status: 409,
      body: { errorCode: 'idempotency_conflict' },
    });
    expect(deferred).toEqual([]);
    expect(execute).not.toHaveBeenCalled();

    const runId = first.body.runId;
    if (typeof runId !== 'string') throw new Error('run id missing');
    await expect(store.getCustomerRun(runId)).resolves.toMatchObject({
      sessionAuthorityGeneration: 1,
      status: 'superseded',
      phase: 'finalizing',
      nextEventSequence: 2,
      startedAt: null,
      terminalAt: expect.any(String),
    });
    const events = await store.listCustomerRunEvents(runId);
    expect(events).toEqual([
      expect.objectContaining({
        sequence: 1,
        type: 'run_superseded',
        payload: {
          status: 'superseded',
          suppressed: true,
          agentMode: 'human_paused',
        },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(request.input.text);
    await expect(store.listTurns(request.sessionId)).resolves.toEqual([
      expect.objectContaining({
        channel: 'kfc',
        role: 'user',
        text: request.input.text,
        externalMessageId: request.clientMessageId,
        externalUserId: request.customerId,
        deliveryStatus: 'received',
        metadata: {
          rawEvent: {
            source: 'kfc_customer_run',
            intake: 'human_paused',
          },
        },
      }),
    ]);
  });

  it('rejects trusted GenUI actions while human-paused without storing a fake user turn', async () => {
    const store = new MemoryStore();
    await store.transitionSessionAuthority({
      sessionId: request.sessionId,
      expectedGeneration: 0,
      agentMode: 'human_paused',
      assignedAgentId: 'agent_1',
    });
    const execute = vi.fn();
    const coordinator = new CustomerRunCoordinator({
      store,
      execute,
      paceMs: 0,
    });

    const result = await coordinator.start({
      ...request,
      input: {
        kind: 'genui_action',
        attachmentId: 'attachment_1',
        actionId: 'confirm',
      },
    });

    expect(result).toEqual({
      status: 409,
      body: {
        errorCode:
          'trusted_genui_action_requires_ai_active_session',
        sessionId: request.sessionId,
        suppressed: true,
      },
    });
    await expect(store.listTurns(request.sessionId)).resolves.toEqual([]);
    await expect(
      store.findCustomerRunByRequest(
        request.sessionId,
        request.clientMessageId,
      ),
    ).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it('retries the AI-active path when authority resumes during paused intake', async () => {
    class ResumeBeforePausedCommitStore extends MemoryStore {
      override async commitPausedCustomerRunIntake(
        input: CommitPausedCustomerRunIntakeInput,
      ): Promise<CommitPausedCustomerRunIntakeResult> {
        await this.transitionSessionAuthority({
          sessionId: input.run.sessionId,
          expectedGeneration:
            input.expectedSessionAuthorityGeneration,
          agentMode: 'ai_active',
          assignedAgentId: null,
        });
        return super.commitPausedCustomerRunIntake(input);
      }
    }

    const store = new ResumeBeforePausedCommitStore();
    await store.transitionSessionAuthority({
      sessionId: request.sessionId,
      expectedGeneration: 0,
      agentMode: 'human_paused',
      assignedAgentId: 'agent_1',
    });
    const deferred: Array<() => Promise<void>> = [];
    const coordinator = new CustomerRunCoordinator({
      store,
      defer: (task) => deferred.push(task),
      execute: vi.fn(),
      paceMs: 0,
    });

    const result = await coordinator.start(request);

    expect(result).toEqual({
      status: 202,
      body: {
        schemaVersion: 1,
        runId: expect.any(String),
        status: 'accepted',
        nextSequence: 1,
        replayed: false,
      },
    });
    expect(deferred).toHaveLength(1);
    const runId = result.body.runId;
    if (typeof runId !== 'string') throw new Error('run id missing');
    await expect(store.getCustomerRun(runId)).resolves.toMatchObject({
      sessionAuthorityGeneration: 2,
      status: 'accepted',
    });
    await expect(store.listTurns(request.sessionId)).resolves.toEqual([]);
  });

  it('retries the human-owned path when authority pauses during AI reservation', async () => {
    class PauseBeforeActiveCreateStore extends MemoryStore {
      private paused = false;

      override async createCustomerRun(
        input: CreateCustomerRunInput,
      ) {
        if (!this.paused) {
          this.paused = true;
          const control = await this.getSessionControl(input.sessionId);
          await this.transitionSessionAuthority({
            sessionId: input.sessionId,
            expectedGeneration:
              control.sessionAuthorityGeneration,
            agentMode: 'human_paused',
            assignedAgentId: 'agent_2',
          });
        }
        return super.createCustomerRun(input);
      }
    }

    const store = new PauseBeforeActiveCreateStore();
    const deferred: Array<() => Promise<void>> = [];
    const execute = vi.fn();
    const coordinator = new CustomerRunCoordinator({
      store,
      defer: (task) => deferred.push(task),
      execute,
      paceMs: 0,
    });

    const result = await coordinator.start(request);

    expect(result).toEqual({
      status: 202,
      body: {
        schemaVersion: 1,
        runId: expect.any(String),
        status: 'superseded',
        nextSequence: 1,
        replayed: false,
        suppressed: true,
        agentMode: 'human_paused',
      },
    });
    expect(deferred).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
    await expect(store.listTurns(request.sessionId)).resolves.toEqual([
      expect.objectContaining({
        role: 'user',
        text: request.input.text,
      }),
    ]);
  });

  it('cancels cooperatively and refuses cancellation in protected phases', async () => {
    const store = new MemoryStore();
    const coordinator = new CustomerRunCoordinator({
      store,
      defer: () => undefined,
      execute: vi.fn(),
      paceMs: 0,
    });
    const started = await coordinator.start(request);
    const runId = started.body.runId as string;
    expect((await coordinator.cancel(runId)).status).toBe(202);
    await store.updateCustomerRun(runId, { status: 'running', phase: 'state_change_tool' });
    expect((await coordinator.cancel(runId)).status).toBe(409);
  });
});

describe('splitCustomerText', () => {
  it('keeps grapheme clusters intact and emits no more than 24 chunks', () => {
    const text = `${'a'.repeat(100)}👨‍👩‍👧‍👦${'b'.repeat(100)}`;
    const chunks = splitCustomerText(text);
    expect(chunks.join('')).toBe(text);
    expect(chunks).toHaveLength(24);
    expect(chunks.some((chunk) => chunk.includes('👨‍👩‍👧‍👦'))).toBe(true);
  });

  it('supports a smaller runtime event budget without changing the text', () => {
    const text = 'Một câu trả lời đủ dài để chứng minh nhiều phần văn bản.';
    const chunks = splitCustomerText(text, 3);
    expect(chunks).toHaveLength(3);
    expect(chunks.join('')).toBe(text);
  });
});
