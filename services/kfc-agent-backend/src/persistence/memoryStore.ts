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

export interface ImportedConversationTurn extends Omit<ConversationTurn, 'id'> {
  id?: string;
}

export interface ImportedConversationTurnResult {
  turn: ConversationTurn;
  inserted: boolean;
}

export type WebhookDeliveryChannel = 'messenger' | 'zalo';
export type WebhookDeliveryStatus = 'received' | 'processed' | 'failed';

export interface WebhookDelivery {
  channel: WebhookDeliveryChannel;
  externalEventId: string;
  externalThreadId: string;
  externalUserId: string;
  sessionId: string;
  status: WebhookDeliveryStatus;
  payload: Record<string, unknown>;
  receivedAt: string;
  processedAt: string | null;
  failedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReserveWebhookDeliveryInput {
  channel: WebhookDeliveryChannel;
  externalEventId: string;
  externalThreadId: string;
  externalUserId: string;
  sessionId: string;
  receivedAt: string;
  payload: Record<string, unknown>;
}

export interface ReserveWebhookDeliveryResult {
  delivery: WebhookDelivery;
  reserved: boolean;
}

export interface ConversationStore {
  appendTurn(input: Omit<ConversationTurn, 'id' | 'createdAt'>): Promise<ConversationTurn>;
  upsertImportedTurn(input: ImportedConversationTurn): Promise<ImportedConversationTurnResult>;
  findTurnByExternalMessage(sessionId: string, externalMessageId: string): Promise<ConversationTurn | undefined>;
  reserveWebhookDelivery(input: ReserveWebhookDeliveryInput): Promise<ReserveWebhookDeliveryResult>;
  markWebhookDeliveryProcessed(channel: WebhookDeliveryChannel, externalEventId: string): Promise<WebhookDelivery>;
  markWebhookDeliveryFailed(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
    lastError: string,
  ): Promise<WebhookDelivery>;
  getWebhookDelivery(channel: WebhookDeliveryChannel, externalEventId: string): Promise<WebhookDelivery | undefined>;
  updateTurnDeliveryStatus(
    turnId: string,
    deliveryStatus: ConversationTurn['deliveryStatus'],
    externalMessageId: string | null,
  ): Promise<ConversationTurn>;
  listTurns(sessionId: string): Promise<ConversationTurn[]>;
  appendEvent(sessionId: string, sourceType: string, payload: Record<string, unknown>): Promise<StoredEvent>;
  listEvents(sessionId: string): Promise<StoredEvent[]>;
  searchHistory(sessionId: string, query: string): Promise<HistorySearchResult[]>;
}

export class MemoryStore implements ConversationStore {
  private readonly events: StoredEvent[] = [];
  private readonly turns: ConversationTurn[] = [];
  private readonly webhookDeliveries = new Map<string, WebhookDelivery>();

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

  async upsertImportedTurn(input: ImportedConversationTurn): Promise<ImportedConversationTurnResult> {
    const existingIndex =
      input.externalMessageId === null
        ? -1
        : this.turns.findIndex(
            (turn) => turn.sessionId === input.sessionId && turn.externalMessageId === input.externalMessageId,
          );
    if (existingIndex !== -1) {
      const existing = this.turns[existingIndex];
      const updated: ConversationTurn = {
        ...existing,
        channel: input.channel,
        role: input.role,
        text: input.text,
        externalUserId: input.externalUserId,
        deliveryStatus: input.deliveryStatus,
        createdAt: input.createdAt,
      };
      this.turns[existingIndex] = updated;
      return { turn: updated, inserted: false };
    }

    const turn: ConversationTurn = {
      ...input,
      id: input.id ?? `turn_${this.turns.length + 1}`,
    };
    this.turns.push(turn);
    await this.appendEvent(input.sessionId, `conversation_turn:${input.role}`, {
      text: input.text,
      channel: input.channel,
      deliveryStatus: input.deliveryStatus,
      externalMessageId: input.externalMessageId,
      externalUserId: input.externalUserId,
    });
    return { turn, inserted: true };
  }

  async findTurnByExternalMessage(sessionId: string, externalMessageId: string): Promise<ConversationTurn | undefined> {
    return this.turns.find((turn) => turn.sessionId === sessionId && turn.externalMessageId === externalMessageId);
  }

  async reserveWebhookDelivery(input: ReserveWebhookDeliveryInput): Promise<ReserveWebhookDeliveryResult> {
    const key = webhookDeliveryKey(input.channel, input.externalEventId);
    const existing = this.webhookDeliveries.get(key);
    if (existing) return { delivery: existing, reserved: false };

    const now = new Date('2026-07-07T00:00:00.000Z').toISOString();
    const delivery: WebhookDelivery = {
      ...input,
      status: 'received',
      processedAt: null,
      failedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.webhookDeliveries.set(key, delivery);
    return { delivery, reserved: true };
  }

  async markWebhookDeliveryProcessed(channel: WebhookDeliveryChannel, externalEventId: string): Promise<WebhookDelivery> {
    return this.updateWebhookDelivery(channel, externalEventId, {
      status: 'processed',
      processedAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
      failedAt: null,
      lastError: null,
    });
  }

  async markWebhookDeliveryFailed(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
    lastError: string,
  ): Promise<WebhookDelivery> {
    return this.updateWebhookDelivery(channel, externalEventId, {
      status: 'failed',
      failedAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
      lastError,
    });
  }

  async getWebhookDelivery(channel: WebhookDeliveryChannel, externalEventId: string): Promise<WebhookDelivery | undefined> {
    return this.webhookDeliveries.get(webhookDeliveryKey(channel, externalEventId));
  }

  private updateWebhookDelivery(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
    patch: Pick<WebhookDelivery, 'status'> & Partial<WebhookDelivery>,
  ): WebhookDelivery {
    const key = webhookDeliveryKey(channel, externalEventId);
    const existing = this.webhookDeliveries.get(key);
    if (!existing) throw new Error(`Webhook delivery not found: ${channel}:${externalEventId}`);
    const updated: WebhookDelivery = {
      ...existing,
      ...patch,
      updatedAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
    };
    this.webhookDeliveries.set(key, updated);
    return updated;
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

function webhookDeliveryKey(channel: WebhookDeliveryChannel, externalEventId: string): string {
  return `${channel}:${externalEventId}`;
}
