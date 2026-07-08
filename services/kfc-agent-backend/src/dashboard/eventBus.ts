import type { DashboardEvent } from '../domain/types.js';

type DashboardEventListener = (event: DashboardEvent) => void;

export class DashboardEventBus {
  private readonly events: DashboardEvent[] = [];
  private readonly listeners = new Set<DashboardEventListener>();

  emitEvent(event: DashboardEvent): void {
    this.events.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
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

  subscribe(listener: DashboardEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
