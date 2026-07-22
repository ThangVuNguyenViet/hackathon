import type {
  DashboardEvent,
  MonitorSessionIntelligence,
} from '../domain/types.js';
import { parseMonitorSessionIntelligencePayload } from '../monitor/sessionIntelligence.js';

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

  listSessionSummaries(options: DashboardSessionSummaryOptions = {}): Array<{
    sessionId: string;
    latestEventType: DashboardEvent['type'];
    updatedAt: string;
    sessionIntelligence: MonitorSessionIntelligence | null;
  }> {
    const latestBySession = new Map<
      string,
      {
        latestEvent: DashboardEvent;
        latestBusinessEvent?: DashboardEvent;
        sessionIntelligence: MonitorSessionIntelligence | null;
      }
    >();
    for (const event of this.events) {
      const existing = latestBySession.get(event.sessionId);
      const next = existing ?? {
        latestEvent: event,
        latestBusinessEvent: undefined,
        sessionIntelligence: null,
      };
      next.latestEvent = event;
      if (event.type === 'session_intelligence_updated') {
        next.sessionIntelligence =
          parseMonitorSessionIntelligencePayload(event.payload) ??
          next.sessionIntelligence;
      } else {
        next.latestBusinessEvent = event;
      }
      latestBySession.set(event.sessionId, next);
    }
    const updatedSinceMs =
      options.updatedSince === undefined
        ? undefined
        : Date.parse(options.updatedSince);
    return [...latestBySession.values()]
      .filter(
        (summary) =>
          updatedSinceMs === undefined ||
          Date.parse(summary.latestEvent.createdAt) >= updatedSinceMs,
      )
      .sort(
        (a, b) =>
          Date.parse(b.latestEvent.createdAt) -
          Date.parse(a.latestEvent.createdAt),
      )
      .map((summary) => ({
        sessionId: summary.latestEvent.sessionId,
        latestEventType: (summary.latestBusinessEvent ?? summary.latestEvent)
          .type,
        updatedAt: summary.latestEvent.createdAt,
        sessionIntelligence: summary.sessionIntelligence,
      }));
  }

  subscribe(listener: DashboardEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
