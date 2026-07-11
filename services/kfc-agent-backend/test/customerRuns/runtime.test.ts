import { describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
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

  it('cancels cooperatively and refuses cancellation in protected phases', async () => {
    const store = new MemoryStore();
    const coordinator = new CustomerRunCoordinator({ store, execute: vi.fn(), paceMs: 0 });
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
