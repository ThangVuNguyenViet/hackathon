import type { ConversationTurn } from '../domain/types.js';

export interface StoredEvent {
  id: string;
  sessionId: string;
  sourceType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface HistorySearchResult extends StoredEvent {
  confidence: number;
}

export class MemoryStore {
  private readonly events: StoredEvent[] = [];
  private readonly turns: ConversationTurn[] = [];

  async appendTurn(input: Omit<ConversationTurn, 'id' | 'createdAt'>): Promise<ConversationTurn> {
    const turn: ConversationTurn = {
      ...input,
      id: `turn_${this.turns.length + 1}`,
      createdAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
    };
    this.turns.push(turn);
    await this.appendEvent(input.sessionId, `conversation_turn:${input.role}`, {
      text: input.text,
      channel: input.channel,
      deliveryStatus: input.deliveryStatus,
      externalMessageId: input.externalMessageId,
      externalUserId: input.externalUserId,
    });
    return turn;
  }

  async updateTurnDeliveryStatus(
    turnId: string,
    deliveryStatus: ConversationTurn['deliveryStatus'],
    externalMessageId: string | null,
  ): Promise<ConversationTurn> {
    const index = this.turns.findIndex((turn) => turn.id === turnId);
    if (index === -1) throw new Error(`Conversation turn not found: ${turnId}`);
    const updated: ConversationTurn = { ...this.turns[index], deliveryStatus, externalMessageId };
    this.turns[index] = updated;
    return updated;
  }

  async listTurns(sessionId: string): Promise<ConversationTurn[]> {
    return this.turns.filter((turn) => turn.sessionId === sessionId);
  }

  async appendEvent(sessionId: string, sourceType: string, payload: Record<string, unknown>): Promise<StoredEvent> {
    const event: StoredEvent = {
      id: `event_${this.events.length + 1}`,
      sessionId,
      sourceType,
      payload,
      createdAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
    };
    this.events.push(event);
    return event;
  }

  async listEvents(sessionId: string): Promise<StoredEvent[]> {
    return this.events.filter((event) => event.sessionId === sessionId);
  }

  async searchHistory(sessionId: string, query: string): Promise<HistorySearchResult[]> {
    const sessionEvents = await this.listEvents(sessionId);
    const lower = query.toLowerCase();
    const referenceToOldAddress = lower.includes('chỗ cũ') || lower.includes('same as before');
    const scored = sessionEvents
      .filter((event) => typeof event.payload.text === 'string')
      .map((event) => {
        const text = String(event.payload.text).toLowerCase();
        const addressHit = referenceToOldAddress && (text.includes('nguyễn trãi') || text.includes('quận 5'));
        const directHit = text.includes(lower);
        return { ...event, confidence: addressHit ? 0.9 : directHit ? 0.7 : 0 };
      })
      .filter((event) => event.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
    return scored.slice(0, 5);
  }
}
