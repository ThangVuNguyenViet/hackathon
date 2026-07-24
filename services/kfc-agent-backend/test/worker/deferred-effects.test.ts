import { describe, expect, it, vi } from 'vitest';
import type { ConversationEvent } from '../../src/channels/conversationEvent.js';
import type { DashboardEvent } from '../../src/domain/types.js';
import type { WorkerEnv, WorkerExecutionContext } from '../../src/worker.js';
import { scheduleDashboardEvent } from '../../src/workerHttp.js';
import { scheduleImmediateMessengerTyping } from '../../src/workerMessaging.js';

describe('Worker deferred effects', () => {
  it('registers dashboard persistence before starting it', async () => {
    let background: Promise<unknown> | undefined;
    let appendStarted = false;
    const context = executionContext((promise) => {
      background = promise;
    });

    scheduleDashboardEvent(
      {} as WorkerEnv,
      {
        async appendDashboardEvent() {
          appendStarted = true;
        },
      },
      dashboardEvent(),
      context,
    );

    expect(background).toBeDefined();
    expect(appendStarted).toBe(false);
    await background;
    expect(appendStarted).toBe(true);
  });

  it('registers Messenger sender actions before starting network work', async () => {
    let background: Promise<unknown> | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ recipient_id: 'customer-1' }),
    );
    const context = executionContext((promise) => {
      background = promise;
    });

    scheduleImmediateMessengerTyping(
      {
        META_PAGE_ACCESS_TOKEN: 'page-access-token',
        MESSENGER_FETCH: fetchImpl,
      } as unknown as WorkerEnv,
      conversationEvent(),
      context,
    );

    expect(background).toBeDefined();
    expect(fetchImpl).not.toHaveBeenCalled();
    await background;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

function executionContext(
  waitUntil: (promise: Promise<unknown>) => void,
): WorkerExecutionContext {
  return { waitUntil };
}

function dashboardEvent(): DashboardEvent {
  return {
    id: 'dashboard-event-1',
    sessionId: 'messenger:customer-1',
    type: 'session_updated',
    payload: {},
    createdAt: '2026-07-24T00:00:00.000Z',
  };
}

function conversationEvent(): ConversationEvent {
  return {
    channel: 'messenger',
    externalUserId: 'customer-1',
    externalThreadId: 'customer-1',
    text: 'Xin chào',
    eventType: 'message',
    rawEventId: 'message-1',
    receivedAt: '2026-07-24T00:00:00.000Z',
    shouldRunAgent: true,
  };
}
