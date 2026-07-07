import type { DashboardEvent } from '../domain/types.js';

export class DashboardEventBus {
  private readonly events: DashboardEvent[] = [];

  emitEvent(event: DashboardEvent): void {
    this.events.push(event);
  }

  getEvents(sessionId: string): DashboardEvent[] {
    return this.events.filter((event) => event.sessionId === sessionId);
  }

  listSessionSummaries(): Array<{ sessionId: string; latestEventType: DashboardEvent['type']; updatedAt: string }> {
    const latestBySession = new Map<string, DashboardEvent>();
    for (const event of this.events) {
      latestBySession.set(event.sessionId, event);
    }
    return [...latestBySession.values()].map((event) => ({
      sessionId: event.sessionId,
      latestEventType: event.type,
      updatedAt: event.createdAt,
    }));
  }
}
