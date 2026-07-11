import { describe, expect, it, vi } from 'vitest';
import { createRouteHandlers } from '../../src/api/routeHandlers.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('channel presentation delivery compatibility', () => {
  it('suppresses a stale agent run before its presentation is delivered', async () => {
    const store = new MemoryStore();
    const messengerFetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message_id: 'must_not_send' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const pending = await store.upsertPendingCustomerTurn({
      turnId: 'pending_stale_1',
      sessionId: 'messenger:stale_user',
      channel: 'messenger',
      externalMessageId: 'mid_stale_1',
      externalUserId: 'stale_user',
      text: 'Tin nhắn cũ',
      steerMode: 'steering',
      status: 'pending',
      claimedRunId: null,
      receivedAt: '2026-07-11T00:00:00.000Z',
    });
    await store.createAgentRun({
      id: 'run_stale_1',
      sessionId: 'messenger:stale_user',
      generation: 1,
      channel: 'messenger',
      externalUserId: 'stale_user',
      status: 'scheduled',
      coalescedInputText: 'Tin nhắn cũ',
      deliveryStatus: 'pending',
      scheduledAt: '2026-07-11T00:00:01.000Z',
    });
    await store.linkAgentRunTurn({ runId: 'run_stale_1', turnId: pending.turn.turnId, sequence: 0 });
    await store.setSessionAgentState({
      sessionId: 'messenger:stale_user',
      currentRunId: 'run_stale_1',
      generation: 1,
      debounceDeadlineAt: '2026-07-11T00:00:01.000Z',
    });

    const handlers = createRouteHandlers({
      store,
      messengerPageAccessToken: 'page_token',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
      responseComposer: {
        async composeResponse() {
          await store.setSessionAgentState({
            sessionId: 'messenger:stale_user',
            currentRunId: 'run_newer',
            generation: 2,
            debounceDeadlineAt: '2026-07-11T00:00:02.000Z',
          });
          return 'Phản hồi của lượt cũ.';
        },
      },
    });

    await expect(handlers.processMessengerAgentRun('run_stale_1')).resolves.toMatchObject({
      status: 'skipped',
      errorCode: 'stale_agent_run',
    });
    expect(messengerFetchImpl).not.toHaveBeenCalled();
    await expect(store.getAgentRun('run_stale_1')).resolves.toMatchObject({
      status: 'superseded',
      deliveryStatus: 'suppressed',
    });
    expect(
      handlers.dashboard.getEvents('messenger:stale_user').some((event) => event.type === 'agent_run_delivery_suppressed'),
    ).toBe(true);
  });
});
