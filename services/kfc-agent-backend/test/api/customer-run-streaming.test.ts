import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

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

  it('keeps direct catalog requests end-to-end when the streaming planner is unavailable', async () => {
    const store = new MemoryStore();
    const deferred: Array<() => Promise<void>> = [];
    const server = buildServer({
      store,
      defer: (task) => deferred.push(task),
      toolPlanner: {
        async plan() {
          throw new Error('OpenAI tool planning failed: Country, region, or territory not supported');
        },
      },
    });
    servers.push(server);

    const started = await server.inject({
      method: 'POST',
      url: '/chat/kfc/runs',
      payload: {
        schemaVersion: 1,
        sessionId: 'kfc:streaming_pepsi_fallback',
        customerId: 'streaming_pepsi_fallback',
        clientMessageId: 'streaming_pepsi_message',
        input: { kind: 'text', text: 'tôi muốn pepsi' },
      },
    });
    expect(started.statusCode).toBe(202);

    await deferred[0]!();

    const turns = await store.listTurns('kfc:streaming_pepsi_fallback');
    const assistant = turns.find((turn) => turn.role === 'assistant');
    expect(assistant?.text).not.toContain('cần thêm thông tin');
    expect(assistant?.metadata?.genUi?.widgetKind).toBe('smartMenuPicker');
    expect((assistant?.metadata?.genUi?.data.items as Array<{ name: string }>)[0]?.name).toContain('Pepsi');
  });
});
