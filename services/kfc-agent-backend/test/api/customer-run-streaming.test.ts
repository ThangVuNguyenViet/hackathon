import { fakeModel } from '@langchain/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDemoAdminServer as buildServer } from '../fixtures/demoAdminServer.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  CustomerRunCoordinator,
} from '../../src/customerRuns/runtime.js';
import type { KfcGenUiAttachment } from '../../src/genui/kfcGenUi.js';
import {
  groundedResponseModelReply,
  groundedResponseVerifierModel,
} from '../fixtures/groundedResponse.js';
import { testAgent } from '../fixtures/testAgent.js';

describe('customer run streaming routes', () => {
  const servers: Array<ReturnType<typeof buildServer>> = [];
  afterEach(async () => Promise.all(servers.splice(0).map((server) => server.close())));

  it('starts idempotently and exposes durable SSE cursor replay', async () => {
    const store = new MemoryStore();
    const deferred: Array<() => Promise<void>> = [];
    const server = buildServer({ store, defer: (task) => deferred.push(task) });
    servers.push(server);
    const body = {
      schemaVersion: 1,
      sessionId: 'kfc:customer_1',
      customerId: 'customer_1',
      clientMessageId: 'message_1',
      input: { kind: 'text', text: 'Cho mình combo gà' },
    };
    const first = await server.inject({ method: 'POST', url: '/chat/kfc/runs', payload: body });
    const retry = await server.inject({ method: 'POST', url: '/chat/kfc/runs', payload: body });
    expect(first.statusCode).toBe(202);
    expect(retry.json()).toMatchObject({ runId: first.json().runId, replayed: true });

    const runId = first.json().runId as string;
    const current = await store.getCustomerRun(runId);
    await store.updateCustomerRun(runId, { status: 'completed', terminalAt: new Date().toISOString() });
    await store.appendCustomerRunEvent({
      schemaVersion: 1,
      eventId: 'terminal_1',
      runId,
      expectedSequence: current!.nextEventSequence,
      type: 'run_completed',
      occurredAt: new Date().toISOString(),
      payload: { status: 'completed' },
    });

    const replay = await server.inject({ method: 'GET', url: `/chat/kfc/runs/${runId}/events?after=1` });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['content-type']).toContain('text/event-stream');
    expect(replay.body).toContain('id: 2');
    expect(replay.body).toContain('event: run_completed');
  });

  it('never replays a private saved address from durable GenUI events', async () => {
    const store = new MemoryStore();
    const deferred: Array<() => Promise<void>> = [];
    const privateAddressMarker =
      'private-sse-saved-address-marker-Ω';
    const savedAddressRef =
      '00000000-0000-4000-8000-000000000124';
    const genUi: KfcGenUiAttachment = {
      id: 'saved_address_sse_card',
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
          id: 'saved-address-sse-cart',
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
      paceMs: 0,
      execute: async () => ({
        responseText: 'Mình đã tìm thấy một địa chỉ đã lưu.',
        genUi,
      }),
    });
    const started = await coordinator.start({
      schemaVersion: 1,
      sessionId: 'kfc:private_saved_address_sse',
      customerId: 'private_saved_address_sse',
      clientMessageId: 'private_saved_address_sse_message',
      input: {
        kind: 'text',
        text: 'Dùng địa chỉ đã lưu',
      },
    });
    await deferred[0]!();
    const runId = started.body.runId as string;
    const stored = await store.listCustomerRunEvents(runId);
    expect(JSON.stringify(stored)).not.toContain(privateAddressMarker);

    const server = buildServer({
      store,
      defer: () => undefined,
    });
    servers.push(server);
    const stream = await server.inject({
      method: 'GET',
      url: `/chat/kfc/runs/${runId}/events?after=0`,
    });

    expect(stream.statusCode).toBe(200);
    expect(stream.body).not.toContain(privateAddressMarker);
    expect(stream.body).toContain(savedAddressRef);
    expect(stream.body).toContain('saved-address-sse-cart');
    expect(stream.body).toContain('accept_fulfillment');
  });

  it('stores human-paused text intake and exposes only a safe suppressed terminal event', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:human_paused_stream';
    await store.transitionSessionAuthority({
      sessionId,
      expectedGeneration: 0,
      agentMode: 'human_paused',
      assignedAgentId: 'agent_1',
    });
    const deferred: Array<() => Promise<void>> = [];
    const server = buildServer({
      store,
      defer: (task) => deferred.push(task),
    });
    servers.push(server);
    const text = 'Mình cần nhân viên hỗ trợ món này';

    const started = await server.inject({
      method: 'POST',
      url: '/chat/kfc/runs',
      payload: {
        schemaVersion: 1,
        sessionId,
        customerId: 'human_paused_stream',
        clientMessageId: 'human_paused_stream_message',
        input: { kind: 'text', text },
      },
    });

    expect(started.statusCode).toBe(202);
    expect(started.json()).toEqual({
      schemaVersion: 1,
      runId: expect.any(String),
      status: 'superseded',
      nextSequence: 1,
      replayed: false,
      suppressed: true,
      agentMode: 'human_paused',
    });
    expect(deferred).toEqual([]);
    const runId = started.json().runId as string;
    await expect(store.listTurns(sessionId)).resolves.toEqual([
      expect.objectContaining({
        role: 'user',
        text,
        externalMessageId: 'human_paused_stream_message',
        deliveryStatus: 'received',
      }),
    ]);
    const storedEvents = await store.listCustomerRunEvents(runId);
    expect(storedEvents).toEqual([
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
    expect(JSON.stringify(storedEvents)).not.toContain(text);

    const stream = await server.inject({
      method: 'GET',
      url: `/chat/kfc/runs/${runId}/events?after=0`,
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.body).toContain('event: run_superseded');
    expect(stream.body).toContain('"suppressed":true');
    expect(stream.body).toContain('"agentMode":"human_paused"');
    expect(stream.body).not.toContain(text);
  });

  it('returns the existing terminal cancellation result', async () => {
    const store = new MemoryStore();
    const server = buildServer({ store, defer: () => undefined });
    servers.push(server);
    const started = await server.inject({ method: 'POST', url: '/chat/kfc/runs', payload: {
      schemaVersion: 1, sessionId: 'kfc:c', customerId: 'c', clientMessageId: 'm',
      input: { kind: 'text', text: 'hello' },
    } });
    const runId = started.json().runId as string;
    await store.updateCustomerRun(runId, { status: 'completed', terminalAt: '2026-07-11T00:00:00.000Z' });
    const cancelled = await server.inject({ method: 'POST', url: `/chat/kfc/runs/${runId}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ runId, status: 'completed' });
  });

  it('forwards the configured customer-run pacing policy', async () => {
    const store = new MemoryStore();
    const deferred: Array<() => Promise<void>> = [];
    const sleeps: number[] = [];
    const server = buildServer({
      store,
      defer: (task) => deferred.push(task),
      customerRunPaceMs: 7,
      customerRunSleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      ...testAgent(
        fakeModel()
          .respond(groundedResponseModelReply({
            customerText:
              'Mình có thể gợi ý combo phù hợp với nhu cầu của bạn.',
          })),
        groundedResponseVerifierModel(),
      ),
    });
    servers.push(server);

    const started = await server.inject({
      method: 'POST',
      url: '/chat/kfc/runs',
      payload: {
        schemaVersion: 1,
        sessionId: 'kfc:worker_pacing',
        customerId: 'worker_pacing',
        clientMessageId: 'worker_pacing_message',
        input: { kind: 'text', text: 'Gợi ý combo' },
      },
    });
    expect(started.statusCode).toBe(202);

    await deferred[0]!();

    expect(sleeps.length).toBeGreaterThan(0);
    expect(new Set(sleeps)).toEqual(new Set([7]));
    const run = await store.getCustomerRun(started.json().runId as string);
    expect(run?.status).toBe('completed');
  });

  it('fails the run without synthesizing tools or presentation when the agent provider fails', async () => {
    const store = new MemoryStore();
    const deferred: Array<() => Promise<void>> = [];
    const model = fakeModel().respond(new Error('provider unavailable'));
    const server = buildServer({
      store,
      defer: (task) => deferred.push(task),
      ...testAgent(model),
    });
    servers.push(server);

    const started = await server.inject({
      method: 'POST',
      url: '/chat/kfc/runs',
      payload: {
        schemaVersion: 1,
        sessionId: 'kfc:streaming_provider_failure',
        customerId: 'streaming_provider_failure',
        clientMessageId: 'streaming_provider_failure_message',
        input: { kind: 'text', text: 'Cho mình xem menu' },
      },
    });
    expect(started.statusCode).toBe(202);

    await deferred[0]!();

    const runId = started.json().runId as string;
    expect(await store.getCustomerRun(runId)).toMatchObject({
      status: 'failed',
    });
    const events = await store.listCustomerRunEvents(runId);
    expect(events.map((event) => event.type)).toContain('run_failed');
    expect(events.map((event) => event.type)).not.toEqual(
      expect.arrayContaining([
        'genui_revision',
        'genui_snapshot',
        'text_started',
        'text_delta',
        'run_completed',
      ]),
    );
    expect(
      (await store.listTurns('kfc:streaming_provider_failure'))
        .filter((turn) => turn.role === 'assistant'),
    ).toEqual([]);
    const dashboard = await server.inject({
      method: 'GET',
      url: '/dashboard/events/kfc%3Astreaming_provider_failure',
    });
    expect(dashboard.json().events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'session_updated',
          payload: expect.objectContaining({ updateType: 'tool_called' }),
        }),
      ]),
    );
    expect(model.callCount).toBe(1);
  });

  it('persists only a non-secret approval pointer in the terminal event', async () => {
    const store = new MemoryStore();
    const deferred: Array<() => Promise<void>> = [];
    const approvalPause = {
      capability: 'placeOrder' as const,
      requestId: '00000000-0000-4000-8000-000000000123',
      expiresAt: '2026-07-20T00:10:00.000Z',
    };
    const coordinator = new CustomerRunCoordinator({
      store,
      defer: (task) => deferred.push(task),
      paceMs: 0,
      execute: async () => ({
        responseText: 'Approval is required to continue.',
        approvalPause,
      }),
    });
    const started = await coordinator.start({
      schemaVersion: 1,
      sessionId: 'kfc:streaming_approval',
      customerId: 'streaming_approval',
      clientMessageId: 'streaming_approval_message',
      input: {
        kind: 'text',
        text: 'Place the verified order',
      },
    });
    expect(started.status).toBe(202);
    await deferred[0]!();

    const runId = started.body.runId;
    if (typeof runId !== 'string') {
      throw new Error('customer run id missing');
    }
    const terminal = (
      await store.listCustomerRunEvents(runId)
    ).find(({ type }) => type === 'run_completed');
    expect(terminal?.payload).toEqual({
      status: 'completed',
      responseText: 'Approval is required to continue.',
      assistantTurnId: null,
      approvalPause,
    });
    const serialized = JSON.stringify(terminal);
    expect(serialized).not.toContain('approvalCapability');
    expect(serialized).not.toContain('checkpoint');
    expect(serialized).not.toContain('"action"');
    expect(serialized).not.toContain('authenticationEvidence');

    const server = buildServer({
      store,
      defer: () => undefined,
    });
    servers.push(server);
    const stream = await server.inject({
      method: 'GET',
      url: `/chat/kfc/runs/${runId}/events`,
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.body).toContain('"approvalPause"');
    expect(stream.body).not.toContain('approvalCapability');
    expect(stream.body).not.toContain('checkpoint');
    expect(stream.body).not.toContain('authenticationEvidence');
  });
});
