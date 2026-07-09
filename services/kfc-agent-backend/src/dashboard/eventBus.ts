import type { DashboardEvent } from '../domain/types.js';

type DashboardEventListener = (event: DashboardEvent) => void;

export interface DashboardEventBusOptions {
  initialEvents?: DashboardEvent[];
  persistEvent?: (event: DashboardEvent) => Promise<void> | void;
}

export interface DashboardSessionSummaryOptions {
  updatedSince?: string;
}

export class DashboardEventBus {
  private readonly events: DashboardEvent[];
  private readonly listeners = new Set<DashboardEventListener>();

  constructor(private readonly options: DashboardEventBusOptions = {}) {
    this.events = [...(options.initialEvents ?? [])];
  }

  emitEvent(event: DashboardEvent): void {
    this.events.push(event);
    try {
      const persisted = this.options.persistEvent?.(event);
      if (persisted) void Promise.resolve(persisted).catch(() => undefined);
    } catch {
      // Live SSE delivery should not fail because durable event persistence failed.
    }
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  getEvents(sessionId: string): DashboardEvent[] {
    return this.events.filter((event) => event.sessionId === sessionId);
  }

  listSessionSummaries(
    options: DashboardSessionSummaryOptions = {},
  ): Array<{ sessionId: string; latestEventType: DashboardEvent['type']; updatedAt: string }> {
    const latestBySession = new Map<string, DashboardEvent>();
    for (const event of this.events) {
      latestBySession.set(event.sessionId, event);
    }
    const updatedSinceMs = options.updatedSince === undefined ? undefined : Date.parse(options.updatedSince);
    return [...latestBySession.values()]
      .filter((event) => updatedSinceMs === undefined || Date.parse(event.createdAt) >= updatedSinceMs)
      .map((event) => ({
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
