import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { DashboardEvent } from '../../src/domain/types.js';

describe('Dashboard event persistence scheduling', () => {
  it('does not invoke persistence synchronously while emitting an event', async () => {
    let persistenceStarted = false;
    const dashboard = new DashboardEventBus({
      persistEvent: async () => {
        persistenceStarted = true;
      },
    });

    dashboard.emitEvent(eventFixture());

    expect(persistenceStarted).toBe(false);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(persistenceStarted).toBe(true);
  });
});

function eventFixture(): DashboardEvent {
  return {
    id: 'dashboard-event-1',
    sessionId: 'kfc:session-1',
    type: 'session_updated',
    payload: {},
    createdAt: '2026-07-24T00:00:00.000Z',
  };
}
