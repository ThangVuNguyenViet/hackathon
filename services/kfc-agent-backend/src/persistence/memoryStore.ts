import type {
  AgentMode,
  AgentRun,
  AgentRunTurn,
  ConversationProfile,
  ConversationTurn,
  PendingCustomerTurn,
  SessionAgentState,
} from '../domain/types.js';
import {
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
  type CustomerRun,
  type CustomerRunEvent,
} from '../customerRuns/contracts.js';

export interface StoredEvent {
  id: string;
  sessionId: string;
  sourceType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type AppendCustomerRunEventInput = Omit<CustomerRunEvent, 'sequence'> & {
  expectedSequence: number;
};

export type CustomerRunPatch = Partial<
  Pick<CustomerRun, 'status' | 'phase' | 'startedAt' | 'terminalAt' | 'updatedAt'>
>;

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

export interface SessionControl {
  sessionId: string;
  agentMode: AgentMode;
  assignedAgentId: string | null;
  updatedAt: string;
}

export type PendingCustomerTurnInput = Omit<PendingCustomerTurn, 'updatedAt'> & { updatedAt?: string };

export interface UpsertPendingCustomerTurnResult {
  turn: PendingCustomerTurn;
  inserted: boolean;
}

export type CreateAgentRunInput = Omit<
  AgentRun,
  | 'supersededByRunId'
  | 'irreversibleSideEffectAt'
  | 'irreversibleToolName'
  | 'assistantTurnId'
  | 'deliveryExternalMessageId'
  | 'errorCode'
  | 'errorMessage'
  | 'startedAt'
  | 'completedAt'
  | 'updatedAt'
> &
  Partial<
    Pick<
      AgentRun,
      | 'supersededByRunId'
      | 'irreversibleSideEffectAt'
      | 'irreversibleToolName'
      | 'assistantTurnId'
      | 'deliveryExternalMessageId'
      | 'errorCode'
      | 'errorMessage'
      | 'startedAt'
      | 'completedAt'
      | 'updatedAt'
    >
  >;

export type AgentRunPatch = Partial<
  Pick<
    AgentRun,
    | 'status'
    | 'supersededByRunId'
    | 'irreversibleSideEffectAt'
    | 'irreversibleToolName'
    | 'assistantTurnId'
    | 'deliveryStatus'
    | 'deliveryExternalMessageId'
    | 'errorCode'
    | 'errorMessage'
    | 'startedAt'
    | 'completedAt'
  >
>;

export type SessionAgentStateInput = Omit<SessionAgentState, 'updatedAt'> & { updatedAt?: string };

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

export interface IrreversibleOperationInput {
  requestId: string;
  sessionId: string;
  operation: string;
  bindingFingerprint: string;
}

export type SessionResetHook = (sessionId: string) => Promise<void>;

export type IrreversibleOperationReservation =
  | { status: 'reserved'; attempt: number; reconciliation: boolean }
  | { status: 'pending' }
  | { status: 'unknown'; lastError: string | null }
  | { status: 'completed'; result: Record<string, unknown> };

function assertSameIrreversibleOperation(
  existing: IrreversibleOperationInput,
  input: IrreversibleOperationInput,
): void {
  if (
    existing.sessionId !== input.sessionId ||
    existing.operation !== input.operation ||
    existing.bindingFingerprint !== input.bindingFingerprint
  ) {
    throw new Error(`Irreversible operation binding conflict: ${input.requestId}`);
  }
}

export type AppendConversationTurnInput = Omit<ConversationTurn, 'id' | 'createdAt'> & {
  createdAt?: string;
};

export interface ConversationStore {
  resetSession(sessionId: string): Promise<SessionControl>;
  createCustomerRun(input: CustomerRun): Promise<CustomerRun>;
  createCustomerRunWithEvent?(
    input: CustomerRun,
    event: AppendCustomerRunEventInput,
  ): Promise<{
    run: CustomerRun;
    event?: CustomerRunEvent;
    created: boolean;
  }>;
  getCustomerRun(runId: string): Promise<CustomerRun | undefined>;
  findCustomerRunByRequest(sessionId: string, clientMessageId: string): Promise<CustomerRun | undefined>;
  updateCustomerRun(runId: string, patch: CustomerRunPatch): Promise<CustomerRun>;
  appendCustomerRunEvent(input: AppendCustomerRunEventInput): Promise<CustomerRunEvent>;
  appendCustomerRunEvents(inputs: AppendCustomerRunEventInput[]): Promise<CustomerRunEvent[]>;
  listCustomerRunEvents(runId: string, afterSequence?: number): Promise<CustomerRunEvent[]>;
  appendTurn(input: AppendConversationTurnInput): Promise<ConversationTurn>;
  upsertImportedTurn(input: ImportedConversationTurn): Promise<ImportedConversationTurnResult>;
  upsertProfile(input: ConversationProfile): Promise<ConversationProfile>;
  getProfile(
    channel: ConversationProfile['channel'],
    externalUserId: string,
  ): Promise<ConversationProfile | undefined>;
  findTurnByExternalMessage(sessionId: string, externalMessageId: string): Promise<ConversationTurn | undefined>;
  reserveWebhookDelivery(input: ReserveWebhookDeliveryInput): Promise<ReserveWebhookDeliveryResult>;
  markWebhookDeliveryProcessed(channel: WebhookDeliveryChannel, externalEventId: string): Promise<WebhookDelivery>;
  markWebhookDeliveryFailed(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
    lastError: string,
  ): Promise<WebhookDelivery>;
  getWebhookDelivery(channel: WebhookDeliveryChannel, externalEventId: string): Promise<WebhookDelivery | undefined>;
  listStaleWebhookDeliveries(
    channel: WebhookDeliveryChannel,
    receivedBefore: string,
    limit: number,
  ): Promise<WebhookDelivery[]>;
  updateTurnDeliveryStatus(
    turnId: string,
    deliveryStatus: ConversationTurn['deliveryStatus'],
    externalMessageId: string | null,
  ): Promise<ConversationTurn>;
  getSessionControl(sessionId: string): Promise<SessionControl>;
  setSessionControl(
    sessionId: string,
    patch: { agentMode: AgentMode; assignedAgentId?: string | null },
  ): Promise<SessionControl>;
  upsertPendingCustomerTurn(input: PendingCustomerTurnInput): Promise<UpsertPendingCustomerTurnResult>;
  listPendingCustomerTurns(sessionId: string): Promise<PendingCustomerTurn[]>;
  markPendingCustomerTurnClaimed(turnId: string, runId: string): Promise<PendingCustomerTurn>;
  createAgentRun(input: CreateAgentRunInput): Promise<AgentRun>;
  updateAgentRun(runId: string, patch: AgentRunPatch): Promise<AgentRun>;
  getAgentRun(runId: string): Promise<AgentRun | undefined>;
  listAgentRuns(sessionId: string): Promise<AgentRun[]>;
  linkAgentRunTurn(input: AgentRunTurn): Promise<AgentRunTurn>;
  listAgentRunTurns(runId: string): Promise<AgentRunTurn[]>;
  getSessionAgentState(sessionId: string): Promise<SessionAgentState>;
  setSessionAgentState(input: SessionAgentStateInput): Promise<SessionAgentState>;
  listDueSessionAgentStates(now: string, limit: number): Promise<SessionAgentState[]>;
  listTurns(sessionId: string): Promise<ConversationTurn[]>;
  appendEvent(sessionId: string, sourceType: string, payload: Record<string, unknown>): Promise<StoredEvent>;
  listEvents(sessionId: string): Promise<StoredEvent[]>;
  searchHistory(sessionId: string, query: string): Promise<HistorySearchResult[]>;
  reserveIrreversibleOperation?(input: IrreversibleOperationInput): Promise<IrreversibleOperationReservation>;
  getIrreversibleOperation?(input: IrreversibleOperationInput): Promise<IrreversibleOperationReservation | undefined>;
  completeIrreversibleOperation?(input: IrreversibleOperationInput, result: Record<string, unknown>): Promise<void>;
  failIrreversibleOperation?(input: IrreversibleOperationInput, error: string): Promise<void>;
}

export class MemoryStore implements ConversationStore {
  private readonly customerRuns = new Map<string, CustomerRun>();
  private readonly customerRunRequestIndex = new Map<string, string>();
  private readonly customerRunEvents: CustomerRunEvent[] = [];
  private readonly events: StoredEvent[] = [];
  private readonly turns: ConversationTurn[] = [];
  private readonly profiles = new Map<string, ConversationProfile>();
  private readonly webhookDeliveries = new Map<string, WebhookDelivery>();
  private readonly sessionControls = new Map<string, SessionControl>();
  private readonly pendingCustomerTurns: PendingCustomerTurn[] = [];
  private readonly agentRuns = new Map<string, AgentRun>();
  private readonly agentRunTurns: AgentRunTurn[] = [];
  private readonly sessionAgentStates = new Map<string, SessionAgentState>();
  private readonly irreversibleOperations = new Map<string, {
    input: IrreversibleOperationInput;
    status: 'attempting' | 'unknown' | 'completed';
    attempt: number;
    leaseExpiresAt: number;
    lastError?: string;
    result?: Record<string, unknown>;
  }>();

  constructor(private readonly sessionResetHook?: SessionResetHook) {}

  async resetSession(sessionId: string): Promise<SessionControl> {
    const customerRunIds = new Set(
      [...this.customerRuns.values()].filter((run) => run.sessionId === sessionId).map((run) => run.id),
    );
    const agentRunIds = new Set(
      [...this.agentRuns.values()].filter((run) => run.sessionId === sessionId).map((run) => run.id),
    );

    removeWhere(this.customerRunEvents, (event) => customerRunIds.has(event.runId));
    removeWhere(this.agentRunTurns, (link) => agentRunIds.has(link.runId));
    removeWhere(this.pendingCustomerTurns, (turn) => turn.sessionId === sessionId);
    removeWhere(this.turns, (turn) => turn.sessionId === sessionId);
    removeWhere(this.events, (event) => event.sessionId === sessionId);
    for (const runId of customerRunIds) this.customerRuns.delete(runId);
    for (const [key, runId] of this.customerRunRequestIndex) {
      if (customerRunIds.has(runId)) this.customerRunRequestIndex.delete(key);
    }
    for (const runId of agentRunIds) this.agentRuns.delete(runId);
    for (const [key, delivery] of this.webhookDeliveries) {
      if (delivery.sessionId === sessionId) this.webhookDeliveries.delete(key);
    }
    for (const [requestId, reservation] of this.irreversibleOperations) {
      if (reservation.input.sessionId === sessionId) this.irreversibleOperations.delete(requestId);
    }
    this.sessionControls.delete(sessionId);
    this.sessionAgentStates.delete(sessionId);
    await this.sessionResetHook?.(sessionId);
    return defaultSessionControl(sessionId);
  }

  async reserveIrreversibleOperation(input: IrreversibleOperationInput): Promise<IrreversibleOperationReservation> {
    const existing = this.irreversibleOperations.get(input.requestId);
    if (existing) {
      assertSameIrreversibleOperation(existing.input, input);
      if (existing.status === 'completed') {
        return { status: 'completed', result: structuredClone(existing.result!) };
      }
      if (existing.status === 'unknown' || existing.leaseExpiresAt <= Date.now()) {
        existing.status = 'attempting';
        existing.attempt += 1;
        existing.leaseExpiresAt = Date.now() + 30_000;
        return { status: 'reserved', attempt: existing.attempt, reconciliation: true };
      }
      return { status: 'pending' };
    }
    this.irreversibleOperations.set(input.requestId, {
      input: structuredClone(input),
      status: 'attempting',
      attempt: 1,
      leaseExpiresAt: Date.now() + 30_000,
    });
    return { status: 'reserved', attempt: 1, reconciliation: false };
  }

  async getIrreversibleOperation(input: IrreversibleOperationInput): Promise<IrreversibleOperationReservation | undefined> {
    const existing = this.irreversibleOperations.get(input.requestId);
    if (!existing) return undefined;
    assertSameIrreversibleOperation(existing.input, input);
    if (existing.status === 'completed') {
      return { status: 'completed', result: structuredClone(existing.result!) };
    }
    return existing.status === 'unknown'
      ? { status: 'unknown', lastError: existing.lastError ?? null }
      : { status: 'pending' };
  }

  async completeIrreversibleOperation(
    input: IrreversibleOperationInput,
    result: Record<string, unknown>,
  ): Promise<void> {
    const existing = this.irreversibleOperations.get(input.requestId);
    if (!existing) throw new Error(`Irreversible operation reservation not found: ${input.requestId}`);
    assertSameIrreversibleOperation(existing.input, input);
    if (existing.status === 'completed') return;
    existing.result = structuredClone(result);
    existing.status = 'completed';
    existing.leaseExpiresAt = 0;
  }

  async failIrreversibleOperation(input: IrreversibleOperationInput, error: string): Promise<void> {
    const existing = this.irreversibleOperations.get(input.requestId);
    if (!existing) throw new Error(`Irreversible operation reservation not found: ${input.requestId}`);
    assertSameIrreversibleOperation(existing.input, input);
    if (existing.status === 'completed') return;
    existing.status = 'unknown';
    existing.lastError = error;
    existing.leaseExpiresAt = 0;
  }

  async createCustomerRun(input: CustomerRun): Promise<CustomerRun> {
    const requestKey = customerRequestKey(input.sessionId, input.clientMessageId);
    const existingRunId = this.customerRunRequestIndex.get(requestKey);
    if (existingRunId) {
      const existing = this.customerRuns.get(existingRunId);
      if (!existing) throw new Error(`Customer run index is corrupt: ${existingRunId}`);
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new CustomerRunIdempotencyConflictError(input.sessionId, input.clientMessageId);
      }
      return existing;
    }
    this.customerRuns.set(input.id, input);
    this.customerRunRequestIndex.set(requestKey, input.id);
    return input;
  }

  async getCustomerRun(runId: string): Promise<CustomerRun | undefined> {
    return this.customerRuns.get(runId);
  }

  async findCustomerRunByRequest(
    sessionId: string,
    clientMessageId: string,
  ): Promise<CustomerRun | undefined> {
    const runId = this.customerRunRequestIndex.get(customerRequestKey(sessionId, clientMessageId));
    return runId ? this.customerRuns.get(runId) : undefined;
  }

  async updateCustomerRun(runId: string, patch: CustomerRunPatch): Promise<CustomerRun> {
    const existing = this.customerRuns.get(runId);
    if (!existing) throw new Error(`Customer run not found: ${runId}`);
    const updated = { ...existing, ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() };
    this.customerRuns.set(runId, updated);
    return updated;
  }

  async appendCustomerRunEvent(input: AppendCustomerRunEventInput): Promise<CustomerRunEvent> {
    const run = this.customerRuns.get(input.runId);
    if (!run) throw new Error(`Customer run not found: ${input.runId}`);
    if (input.expectedSequence !== run.nextEventSequence) {
      throw new CustomerRunSequenceConflictError(
        input.runId,
        input.expectedSequence,
        run.nextEventSequence,
      );
    }
    const { expectedSequence, ...eventInput } = input;
    const event = customerRunEventSchema.parse({
      ...eventInput,
      sequence: expectedSequence,
    });
    this.customerRunEvents.push(event);
    this.customerRuns.set(run.id, {
      ...run,
      nextEventSequence: run.nextEventSequence + 1,
      updatedAt: event.occurredAt,
    });
    return event;
  }

  async appendCustomerRunEvents(
    inputs: AppendCustomerRunEventInput[],
  ): Promise<CustomerRunEvent[]> {
    if (inputs.length === 0) return [];
    const run = this.customerRuns.get(inputs[0]!.runId);
    if (!run) throw new Error(`Customer run not found: ${inputs[0]!.runId}`);
    for (const [index, input] of inputs.entries()) {
      const expectedSequence = run.nextEventSequence + index;
      if (
        input.runId !== run.id ||
        input.expectedSequence !== expectedSequence
      ) {
        throw new CustomerRunSequenceConflictError(
          input.runId,
          input.expectedSequence,
          expectedSequence,
        );
      }
    }
    const events = inputs.map(({ expectedSequence, ...eventInput }) =>
      customerRunEventSchema.parse({
        ...eventInput,
        sequence: expectedSequence,
      }),
    );
    this.customerRunEvents.push(...events);
    this.customerRuns.set(run.id, {
      ...run,
      nextEventSequence: run.nextEventSequence + events.length,
      updatedAt: events.at(-1)!.occurredAt,
    });
    return events;
  }

  async listCustomerRunEvents(runId: string, afterSequence = 0): Promise<CustomerRunEvent[]> {
    return this.customerRunEvents
      .filter((event) => event.runId === runId && event.sequence > afterSequence)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async upsertProfile(input: ConversationProfile): Promise<ConversationProfile> {
    this.profiles.set(profileKey(input.channel, input.externalUserId), input);
    return input;
  }

  async getProfile(
    channel: ConversationProfile['channel'],
    externalUserId: string,
  ): Promise<ConversationProfile | undefined> {
    return this.profiles.get(profileKey(channel, externalUserId));
  }

  async appendTurn(input: AppendConversationTurnInput): Promise<ConversationTurn> {
    const turn: ConversationTurn = {
      ...input,
      metadata: input.metadata ?? null,
      id: `turn_${this.turns.length + 1}`,
      createdAt: input.createdAt ?? new Date('2026-07-07T00:00:00.000Z').toISOString(),
    };
    this.turns.push(turn);
    await this.appendEvent(input.sessionId, `conversation_turn:${input.role}`, {
      text: input.text,
      channel: input.channel,
      deliveryStatus: input.deliveryStatus,
      externalMessageId: input.externalMessageId,
      externalUserId: input.externalUserId,
      metadata: input.metadata,
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
        metadata: input.metadata ?? null,
        createdAt: input.createdAt,
      };
      this.turns[existingIndex] = updated;
      return { turn: updated, inserted: false };
    }

    const turn: ConversationTurn = {
      ...input,
      metadata: input.metadata ?? null,
      id: input.id ?? `turn_${this.turns.length + 1}`,
    };
    this.turns.push(turn);
    await this.appendEvent(input.sessionId, `conversation_turn:${input.role}`, {
      text: input.text,
      channel: input.channel,
      deliveryStatus: input.deliveryStatus,
      externalMessageId: input.externalMessageId,
      externalUserId: input.externalUserId,
      metadata: input.metadata,
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

  async listStaleWebhookDeliveries(
    channel: WebhookDeliveryChannel,
    receivedBefore: string,
    limit: number,
  ): Promise<WebhookDelivery[]> {
    return [...this.webhookDeliveries.values()]
      .filter(
        (delivery) =>
          delivery.channel === channel &&
          delivery.status === 'received' &&
          delivery.receivedAt < receivedBefore,
      )
      .sort((a, b) => {
        const received = a.receivedAt.localeCompare(b.receivedAt);
        return received === 0 ? a.externalEventId.localeCompare(b.externalEventId) : received;
      })
      .slice(0, Math.max(0, limit));
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

  async getSessionControl(sessionId: string): Promise<SessionControl> {
    return this.sessionControls.get(sessionId) ?? defaultSessionControl(sessionId);
  }

  async setSessionControl(
    sessionId: string,
    patch: { agentMode: AgentMode; assignedAgentId?: string | null },
  ): Promise<SessionControl> {
    const current = await this.getSessionControl(sessionId);
    const updated: SessionControl = {
      sessionId,
      agentMode: patch.agentMode,
      assignedAgentId: patch.assignedAgentId === undefined ? current.assignedAgentId : patch.assignedAgentId,
      updatedAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
    };
    this.sessionControls.set(sessionId, updated);
    return updated;
  }

  async upsertPendingCustomerTurn(input: PendingCustomerTurnInput): Promise<UpsertPendingCustomerTurnResult> {
    const existing = this.pendingCustomerTurns.find(
      (turn) => turn.sessionId === input.sessionId && turn.externalMessageId === input.externalMessageId,
    );
    if (existing) return { turn: existing, inserted: false };

    const now = new Date('2026-07-07T00:00:00.000Z').toISOString();
    const turn: PendingCustomerTurn = {
      ...input,
      updatedAt: input.updatedAt ?? now,
    };
    this.pendingCustomerTurns.push(turn);
    return { turn, inserted: true };
  }

  async listPendingCustomerTurns(sessionId: string): Promise<PendingCustomerTurn[]> {
    return this.pendingCustomerTurns
      .filter((turn) => turn.sessionId === sessionId)
      .sort((a, b) => {
        const received = a.receivedAt.localeCompare(b.receivedAt);
        return received === 0 ? a.turnId.localeCompare(b.turnId) : received;
      });
  }

  async markPendingCustomerTurnClaimed(turnId: string, runId: string): Promise<PendingCustomerTurn> {
    const turn = this.pendingCustomerTurns.find((candidate) => candidate.turnId === turnId);
    if (!turn) throw new Error(`Pending customer turn not found: ${turnId}`);
    turn.status = 'claimed';
    turn.claimedRunId = runId;
    turn.updatedAt = new Date('2026-07-07T00:00:00.000Z').toISOString();
    return turn;
  }

  async createAgentRun(input: CreateAgentRunInput): Promise<AgentRun> {
    const now = new Date('2026-07-07T00:00:00.000Z').toISOString();
    const run: AgentRun = {
      ...input,
      supersededByRunId: input.supersededByRunId ?? null,
      irreversibleSideEffectAt: input.irreversibleSideEffectAt ?? null,
      irreversibleToolName: input.irreversibleToolName ?? null,
      assistantTurnId: input.assistantTurnId ?? null,
      deliveryExternalMessageId: input.deliveryExternalMessageId ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      updatedAt: input.updatedAt ?? now,
    };
    this.agentRuns.set(run.id, run);
    return run;
  }

  async updateAgentRun(runId: string, patch: AgentRunPatch): Promise<AgentRun> {
    const existing = this.agentRuns.get(runId);
    if (!existing) throw new Error(`Agent run not found: ${runId}`);
    const updated: AgentRun = {
      ...existing,
      ...patch,
      updatedAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
    };
    this.agentRuns.set(runId, updated);
    return updated;
  }

  async getAgentRun(runId: string): Promise<AgentRun | undefined> {
    return this.agentRuns.get(runId);
  }

  async listAgentRuns(sessionId: string): Promise<AgentRun[]> {
    return [...this.agentRuns.values()]
      .filter((run) => run.sessionId === sessionId)
      .sort((a, b) => {
        const generation = a.generation - b.generation;
        return generation === 0 ? a.id.localeCompare(b.id) : generation;
      });
  }

  async linkAgentRunTurn(input: AgentRunTurn): Promise<AgentRunTurn> {
    const existing = this.agentRunTurns.find((link) => link.runId === input.runId && link.turnId === input.turnId);
    if (existing) return existing;
    this.agentRunTurns.push(input);
    return input;
  }

  async listAgentRunTurns(runId: string): Promise<AgentRunTurn[]> {
    return this.agentRunTurns
      .filter((link) => link.runId === runId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async getSessionAgentState(sessionId: string): Promise<SessionAgentState> {
    const existing = this.sessionAgentStates.get(sessionId);
    if (existing) return existing;
    const now = new Date('2026-07-07T00:00:00.000Z').toISOString();
    const state: SessionAgentState = {
      sessionId,
      currentRunId: null,
      generation: 0,
      debounceDeadlineAt: null,
      updatedAt: now,
    };
    this.sessionAgentStates.set(sessionId, state);
    return state;
  }

  async setSessionAgentState(input: SessionAgentStateInput): Promise<SessionAgentState> {
    const now = new Date('2026-07-07T00:00:00.000Z').toISOString();
    const state: SessionAgentState = {
      ...input,
      updatedAt: input.updatedAt ?? now,
    };
    this.sessionAgentStates.set(input.sessionId, state);
    return state;
  }

  async listDueSessionAgentStates(now: string, limit: number): Promise<SessionAgentState[]> {
    return [...this.sessionAgentStates.values()]
      .filter((state) => state.currentRunId === null)
      .filter((state) => state.debounceDeadlineAt !== null && state.debounceDeadlineAt <= now)
      .sort((a, b) => {
        const deadlineCompare = String(a.debounceDeadlineAt).localeCompare(String(b.debounceDeadlineAt));
        return deadlineCompare === 0 ? a.sessionId.localeCompare(b.sessionId) : deadlineCompare;
      })
      .slice(0, limit);
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
    const scored = sessionEvents
      .filter((event) => typeof event.payload.text === 'string')
      .map((event) => {
        const text = String(event.payload.text).toLowerCase();
        const directHit = text.includes(lower);
        return { ...event, confidence: directHit ? 0.7 : 0 };
      })
      .filter((event) => event.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
    return scored;
  }
}

function webhookDeliveryKey(channel: WebhookDeliveryChannel, externalEventId: string): string {
  return `${channel}:${externalEventId}`;
}

function profileKey(channel: ConversationProfile['channel'], externalUserId: string): string {
  return `${channel}:${externalUserId}`;
}

function customerRequestKey(sessionId: string, clientMessageId: string): string {
  return `${sessionId}:${clientMessageId}`;
}

function removeWhere<T>(values: T[], predicate: (value: T) => boolean): void {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index]!)) values.splice(index, 1);
  }
}

function defaultSessionControl(sessionId: string): SessionControl {
  return {
    sessionId,
    agentMode: 'ai_active',
    assignedAgentId: null,
    updatedAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
  };
}
