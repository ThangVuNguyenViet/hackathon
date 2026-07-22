import type {
  AgentMode,
  AgentRun,
  AgentRunTurn,
  ConversationProfile,
  ConversationTurn,
  PendingCustomerTurn,
  SessionAgentState,
} from '../domain/types.js';
import type {
  CustomerRun,
  CustomerRunEvent,
} from '../customerRuns/contracts.js';
import {
  type StoredEvent,
  type AppendCustomerRunEventInput,
  type AppendCustomerRunEventsIfRunCurrentInput,
  type AppendCustomerRunEventsIfRunCurrentResult,
  type CustomerRunPatch,
  type CreateCustomerRunInput,
  type HistorySearchResult,
  type ImportedConversationTurn,
  type ImportedConversationTurnResult,
  type WebhookDeliveryChannel,
  type WebhookDeliveryStatus,
  type WebhookDelivery,
  type SessionControl,
  type TransitionSessionAuthorityInput,
  type TransitionSessionAuthorityResult,
  type PendingCustomerTurnInput,
  type UpsertPendingCustomerTurnResult,
  type CreateAgentRunInput,
  type ClaimAgentRunResult,
  type AgentRunPatch,
  type SessionAgentStateInput,
  type AdvanceSessionAgentGenerationInput,
  type AdvanceSessionAgentGenerationResult,
  type ClaimSessionAgentRunOwnershipInput,
  type ClaimSessionAgentRunOwnershipResult,
  type UpdateAgentRunIfExecutionCurrentInput,
  type UpdateAgentRunIfExecutionCurrentResult,
  type ReserveWebhookDeliveryInput,
  type ReserveWebhookDeliveryResult,
  type IrreversibleOperationInput,
  type IrreversibleOperationOwner,
  type MarkIrreversibleOperationOutcomeUnknownIfExpiredInput,
  type MarkIrreversibleOperationOutcomeUnknownIfExpiredResult,
  type SessionResetHook,
  type IrreversibleOperationReservation,
  type IrreversibleOperationCompletion,
  type AppendConversationTurnInput,
  type AppendEventIfRunCurrentInput,
  type AppendEventIfRunCurrentResult,
  type IsRunCommitFenceCurrentInput,
  type CommitAssistantTurnIfRunCurrentInput,
  type CommitAssistantTurnIfRunCurrentResult,
  type CommitPausedCustomerRunIntakeInput,
  type CommitPausedCustomerRunIntakeResult,
  type ConversationStore,
} from './contracts.js';
import {
  completeMemoryIrreversibleOperation,
  failMemoryIrreversibleOperation,
  markMemoryIrreversibleOperationOutcomeUnknownIfExpired,
  type MemoryIrreversibleOperationRecord,
} from './memoryStoreIrreversibleOperations.js';
import {
  createMemoryCustomerRun,
  getMemoryIrreversibleOperation,
  reserveMemoryIrreversibleOperation,
} from './memoryStoreCreation.js';
import {
  appendMemoryCustomerRunEvent,
  appendMemoryCustomerRunEvents,
  appendMemoryCustomerRunEventsIfRunCurrent,
} from './memoryStoreCustomerRunEventCommit.js';
import { resetMemorySession } from './memoryStoreSessionReset.js';
import {
  captureActiveMemorySessionAuthority,
  effectiveMemorySessionControl,
  transitionMemorySessionAuthority,
} from './memoryStoreSessionAuthority.js';
import { MemoryStoreNonAgentTextDeliveryOperations } from './memoryStoreNonAgentTextDeliveryOperations.js';
import { reserveMemoryWebhookDelivery } from './memoryStoreNonAgentTextDelivery.js';
import { appendMemoryConversationTurn } from './memoryStoreTurnOperations.js';
import {
  appendMemoryEventIfRunCurrent,
  commitMemoryAssistantTurnIfRunCurrent,
  memoryRunCommitFenceIsCurrent,
  memoryVerifiedRefFenceIsCurrent,
} from './memoryStoreRunCommit.js';
import { commitMemoryPausedCustomerRunIntake } from './memoryStorePausedCustomerRunIntake.js';
import {
  advanceMemorySessionAgentGeneration,
  claimMemorySessionAgentRunOwnership,
  getMemorySessionAgentState,
  listDueMemorySessionAgentStates,
  setMemorySessionAgentState,
  updateMemoryAgentRunIfExecutionCurrent,
} from './memoryStoreAgentRunOwnership.js';
import {
  claimMemoryAgentRunRecord,
  createMemoryAgentRunRecord,
  linkMemoryAgentRunTurn,
  listMemoryAgentRuns,
  listMemoryAgentRunTurns,
  listMemoryPendingCustomerTurns,
  markMemoryPendingCustomerTurnClaimed,
  updateMemoryAgentRunRecord,
  upsertMemoryPendingCustomerTurn,
} from './memoryStoreAgentRunRecords.js';
export * from './contracts.js';
export class MemoryStore
  extends MemoryStoreNonAgentTextDeliveryOperations
  implements ConversationStore
{
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
  private readonly irreversibleOperations = new Map<
    string,
    MemoryIrreversibleOperationRecord
  >();
  constructor(private readonly sessionResetHook?: SessionResetHook) {
    super();
  }
  protected override memoryNonAgentSessionControls(): ReadonlyMap<
    string,
    SessionControl
  > {
    return this.sessionControls;
  }
  protected override memoryNonAgentTurns(): readonly ConversationTurn[] {
    return this.turns;
  }
  protected override appendMemoryNonAgentTurn(
    input: AppendConversationTurnInput,
  ): Promise<ConversationTurn> {
    return this.appendTurn(input);
  }
  protected override verifiedRefRunFenceIsCurrent(
    input: IsRunCommitFenceCurrentInput,
  ): boolean {
    return memoryVerifiedRefFenceIsCurrent(input, {
      customerRuns: this.customerRuns,
      agentRuns: this.agentRuns,
      sessionAgentStates: this.sessionAgentStates,
      irreversibleOperations: this.irreversibleOperations,
      sessionControls: this.sessionControls,
    });
  }
  async resetSession(sessionId: string): Promise<SessionControl> {
    return this.withStoreLock(async () => {
      const control = await resetMemorySession(sessionId, {
        sessionGenerations: this.sessionGenerations,
        verifiedRefs: this.verifiedRefs,
        customerRuns: this.customerRuns,
        customerRunRequestIndex: this.customerRunRequestIndex,
        customerRunEvents: this.customerRunEvents,
        agentRuns: this.agentRuns,
        agentRunTurns: this.agentRunTurns,
        pendingCustomerTurns: this.pendingCustomerTurns,
        turns: this.turns,
        events: this.events,
        webhookDeliveries: this.webhookDeliveries,
        nonAgentTextDeliveries: this.nonAgentTextDeliveries,
        irreversibleOperations: this.irreversibleOperations,
        sessionControls: this.sessionControls,
        sessionAgentStates: this.sessionAgentStates,
        sessionResetHook: this.sessionResetHook,
      });
      this.clearOrphanedAgentRunTextDeliveries();
      return control;
    });
  }

  async reserveIrreversibleOperation(
    input: IrreversibleOperationInput,
  ): Promise<IrreversibleOperationReservation> {
    return this.withStoreLock(async () =>
      reserveMemoryIrreversibleOperation(input, {
        sessionControls: this.sessionControls,
        irreversibleOperations: this.irreversibleOperations,
      }),
    );
  }

  async getIrreversibleOperation(
    input: IrreversibleOperationInput,
  ): Promise<IrreversibleOperationReservation | undefined> {
    return getMemoryIrreversibleOperation(input, {
      sessionControls: this.sessionControls,
      irreversibleOperations: this.irreversibleOperations,
    });
  }

  async markIrreversibleOperationOutcomeUnknownIfExpired(
    input: MarkIrreversibleOperationOutcomeUnknownIfExpiredInput,
  ): Promise<MarkIrreversibleOperationOutcomeUnknownIfExpiredResult> {
    return this.withStoreLock(async () =>
      markMemoryIrreversibleOperationOutcomeUnknownIfExpired({
        operation: input,
        operations: this.irreversibleOperations,
        activeAuthorityGeneration: (sessionId) =>
          captureActiveMemorySessionAuthority(this.sessionControls, sessionId),
      }),
    );
  }

  async completeIrreversibleOperation(
    input: IrreversibleOperationInput,
    owner: IrreversibleOperationOwner,
    result: Record<string, unknown>,
  ): Promise<IrreversibleOperationCompletion> {
    return this.withStoreLock(async () =>
      completeMemoryIrreversibleOperation({
        operation: input,
        owner,
        result,
        operations: this.irreversibleOperations,
        activeAuthorityGeneration: (sessionId) =>
          captureActiveMemorySessionAuthority(this.sessionControls, sessionId),
      }),
    );
  }

  async failIrreversibleOperation(
    input: IrreversibleOperationInput,
    owner: IrreversibleOperationOwner,
    error: string,
  ): Promise<void> {
    await this.withStoreLock(async () =>
      failMemoryIrreversibleOperation({
        operation: input,
        owner,
        error,
        operations: this.irreversibleOperations,
        activeAuthorityGeneration: (sessionId) =>
          captureActiveMemorySessionAuthority(this.sessionControls, sessionId),
      }),
    );
  }

  async createCustomerRun(input: CreateCustomerRunInput): Promise<CustomerRun> {
    return createMemoryCustomerRun({
      operation: input,
      sessionControls: this.sessionControls,
      customerRuns: this.customerRuns,
      requestIndex: this.customerRunRequestIndex,
    });
  }

  async getCustomerRun(runId: string): Promise<CustomerRun | undefined> {
    return this.customerRuns.get(runId);
  }

  async findCustomerRunByRequest(
    sessionId: string,
    clientMessageId: string,
  ): Promise<CustomerRun | undefined> {
    const runId = this.customerRunRequestIndex.get(
      customerRequestKey(sessionId, clientMessageId),
    );
    return runId ? this.customerRuns.get(runId) : undefined;
  }

  async updateCustomerRun(
    runId: string,
    patch: CustomerRunPatch,
  ): Promise<CustomerRun> {
    const existing = this.customerRuns.get(runId);
    if (!existing) throw new Error(`Customer run not found: ${runId}`);
    const updated = {
      ...existing,
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    };
    this.customerRuns.set(runId, updated);
    return updated;
  }

  async appendCustomerRunEvent(
    input: AppendCustomerRunEventInput,
  ): Promise<CustomerRunEvent> {
    return appendMemoryCustomerRunEvent({
      operation: input,
      customerRuns: this.customerRuns,
      customerRunEvents: this.customerRunEvents,
    });
  }

  async appendCustomerRunEvents(
    inputs: AppendCustomerRunEventInput[],
  ): Promise<CustomerRunEvent[]> {
    return appendMemoryCustomerRunEvents({
      operations: inputs,
      customerRuns: this.customerRuns,
      customerRunEvents: this.customerRunEvents,
    });
  }

  async appendCustomerRunEventsIfRunCurrent(
    input: AppendCustomerRunEventsIfRunCurrentInput,
  ): Promise<AppendCustomerRunEventsIfRunCurrentResult> {
    return this.withStoreLock(async () =>
      appendMemoryCustomerRunEventsIfRunCurrent({
        operation: input,
        customerRuns: this.customerRuns,
        customerRunEvents: this.customerRunEvents,
        sessionControls: this.sessionControls,
      }),
    );
  }

  async commitPausedCustomerRunIntake(
    input: CommitPausedCustomerRunIntakeInput,
  ): Promise<CommitPausedCustomerRunIntakeResult> {
    return this.withStoreLock(async () =>
      commitMemoryPausedCustomerRunIntake({
        operation: input,
        customerRuns: this.customerRuns,
        customerRunRequestIndex: this.customerRunRequestIndex,
        customerRunEvents: this.customerRunEvents,
        turns: this.turns,
        sessionControls: this.sessionControls,
      }),
    );
  }

  async listCustomerRunEvents(
    runId: string,
    afterSequence = 0,
  ): Promise<CustomerRunEvent[]> {
    return this.customerRunEvents
      .filter(
        (event) => event.runId === runId && event.sequence > afterSequence,
      )
      .sort((left, right) => left.sequence - right.sequence);
  }

  async upsertProfile(
    input: ConversationProfile,
  ): Promise<ConversationProfile> {
    this.profiles.set(profileKey(input.channel, input.externalUserId), input);
    return input;
  }

  async getProfile(
    channel: ConversationProfile['channel'],
    externalUserId: string,
  ): Promise<ConversationProfile | undefined> {
    return this.profiles.get(profileKey(channel, externalUserId));
  }

  async appendTurn(
    input: AppendConversationTurnInput,
  ): Promise<ConversationTurn> {
    return appendMemoryConversationTurn({
      turn: input,
      turns: this.turns,
      appendEvent: (sessionId, sourceType, payload) =>
        this.appendEvent(sessionId, sourceType, payload),
    });
  }

  async upsertImportedTurn(
    input: ImportedConversationTurn,
  ): Promise<ImportedConversationTurnResult> {
    const existingIndex =
      input.externalMessageId === null
        ? -1
        : this.turns.findIndex(
            (turn) =>
              turn.sessionId === input.sessionId &&
              turn.externalMessageId === input.externalMessageId,
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

  async findTurnByExternalMessage(
    sessionId: string,
    externalMessageId: string,
  ): Promise<ConversationTurn | undefined> {
    return this.turns.find(
      (turn) =>
        turn.sessionId === sessionId &&
        turn.externalMessageId === externalMessageId,
    );
  }

  async reserveWebhookDelivery(
    input: ReserveWebhookDeliveryInput,
  ): Promise<ReserveWebhookDeliveryResult> {
    return reserveMemoryWebhookDelivery(input, this.webhookDeliveries);
  }

  async markWebhookDeliveryProcessed(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
  ): Promise<WebhookDelivery> {
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

  async getWebhookDelivery(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
  ): Promise<WebhookDelivery | undefined> {
    return this.webhookDeliveries.get(
      webhookDeliveryKey(channel, externalEventId),
    );
  }

  async listWebhookDeliveries(sessionId: string): Promise<WebhookDelivery[]> {
    return [...this.webhookDeliveries.values()]
      .filter((delivery) => delivery.sessionId === sessionId)
      .sort(
        (a, b) =>
          a.receivedAt.localeCompare(b.receivedAt) ||
          a.externalEventId.localeCompare(b.externalEventId),
      );
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
        return received === 0
          ? a.externalEventId.localeCompare(b.externalEventId)
          : received;
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
    if (!existing)
      throw new Error(
        `Webhook delivery not found: ${channel}:${externalEventId}`,
      );
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
    const updated: ConversationTurn = {
      ...this.turns[index],
      deliveryStatus,
      externalMessageId,
    };
    this.turns[index] = updated;
    return updated;
  }

  async getSessionControl(sessionId: string): Promise<SessionControl> {
    return effectiveMemorySessionControl(this.sessionControls, sessionId);
  }

  async setSessionControl(
    sessionId: string,
    patch: { agentMode: AgentMode; assignedAgentId?: string | null },
  ): Promise<SessionControl> {
    const current = effectiveMemorySessionControl(
      this.sessionControls,
      sessionId,
    );
    const result = await this.transitionSessionAuthority({
      sessionId,
      expectedGeneration: current.sessionAuthorityGeneration,
      agentMode: patch.agentMode,
      assignedAgentId:
        patch.assignedAgentId === undefined
          ? current.assignedAgentId
          : patch.assignedAgentId,
    });
    return result.control;
  }
  async transitionSessionAuthority(
    input: TransitionSessionAuthorityInput,
  ): Promise<TransitionSessionAuthorityResult> {
    return this.withStoreLock(async () =>
      transitionMemorySessionAuthority({
        controls: this.sessionControls,
        operation: input,
      }),
    );
  }

  async upsertPendingCustomerTurn(
    input: PendingCustomerTurnInput,
  ): Promise<UpsertPendingCustomerTurnResult> {
    return upsertMemoryPendingCustomerTurn(input, this.memoryAgentRunState());
  }

  async listPendingCustomerTurns(
    sessionId: string,
  ): Promise<PendingCustomerTurn[]> {
    return listMemoryPendingCustomerTurns(
      sessionId,
      this.memoryAgentRunState(),
    );
  }

  async markPendingCustomerTurnClaimed(
    turnId: string,
    runId: string,
  ): Promise<PendingCustomerTurn> {
    return markMemoryPendingCustomerTurnClaimed(
      turnId,
      runId,
      this.memoryAgentRunState(),
    );
  }

  async createAgentRun(input: CreateAgentRunInput): Promise<AgentRun> {
    return createMemoryAgentRunRecord(input, this.memoryAgentRunState());
  }

  async claimAgentRun(
    input: CreateAgentRunInput,
  ): Promise<ClaimAgentRunResult> {
    return claimMemoryAgentRunRecord(input, this.memoryAgentRunState());
  }

  async updateAgentRun(runId: string, patch: AgentRunPatch): Promise<AgentRun> {
    return updateMemoryAgentRunRecord(runId, patch, this.memoryAgentRunState());
  }

  async getAgentRun(runId: string): Promise<AgentRun | undefined> {
    return this.agentRuns.get(runId);
  }

  async listAgentRuns(sessionId: string): Promise<AgentRun[]> {
    return listMemoryAgentRuns(sessionId, this.memoryAgentRunState());
  }

  async linkAgentRunTurn(input: AgentRunTurn): Promise<AgentRunTurn> {
    return linkMemoryAgentRunTurn(input, this.memoryAgentRunState());
  }

  async listAgentRunTurns(runId: string): Promise<AgentRunTurn[]> {
    return listMemoryAgentRunTurns(runId, this.memoryAgentRunState());
  }

  async getSessionAgentState(sessionId: string): Promise<SessionAgentState> {
    return getMemorySessionAgentState(sessionId, this.sessionAgentStates);
  }
  async setSessionAgentState(
    input: SessionAgentStateInput,
  ): Promise<SessionAgentState> {
    return setMemorySessionAgentState(input, this.sessionAgentStates);
  }
  async advanceSessionAgentGeneration(
    input: AdvanceSessionAgentGenerationInput,
  ): Promise<AdvanceSessionAgentGenerationResult> {
    return this.withStoreLock(async () =>
      advanceMemorySessionAgentGeneration(input, this.memoryAgentRunState()),
    );
  }
  async claimSessionAgentRunOwnership(
    input: ClaimSessionAgentRunOwnershipInput,
  ): Promise<ClaimSessionAgentRunOwnershipResult> {
    return this.withStoreLock(async () =>
      claimMemorySessionAgentRunOwnership(input, this.memoryAgentRunState()),
    );
  }
  async updateAgentRunIfExecutionCurrent(
    input: UpdateAgentRunIfExecutionCurrentInput,
  ): Promise<UpdateAgentRunIfExecutionCurrentResult> {
    return this.withStoreLock(async () =>
      updateMemoryAgentRunIfExecutionCurrent(input, this.memoryAgentRunState()),
    );
  }
  async listDueSessionAgentStates(
    now: string,
    limit: number,
  ): Promise<SessionAgentState[]> {
    return listDueMemorySessionAgentStates(now, limit, this.sessionAgentStates);
  }
  protected memoryAgentRunState() {
    return {
      pendingCustomerTurns: this.pendingCustomerTurns,
      agentRuns: this.agentRuns,
      agentRunTurns: this.agentRunTurns,
      sessionAgentStates: this.sessionAgentStates,
      sessionControls: this.sessionControls,
    };
  }
  protected memoryAgentRunTextDeliveryState() {
    return {
      agentRuns: this.agentRuns,
      deliveries: this.agentRunTextDeliveries,
      sessionAgentStates: this.sessionAgentStates,
      sessionControls: this.sessionControls,
      turns: this.turns,
    };
  }

  async listTurns(sessionId: string): Promise<ConversationTurn[]> {
    return this.turns.filter((turn) => turn.sessionId === sessionId);
  }

  async appendEvent(
    sessionId: string,
    sourceType: string,
    payload: Record<string, unknown>,
  ): Promise<StoredEvent> {
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
  async isRunCommitFenceCurrent(
    input: IsRunCommitFenceCurrentInput,
  ): Promise<boolean> {
    return memoryRunCommitFenceIsCurrent({
      guard: input,
      customerRuns: this.customerRuns,
      agentRuns: this.agentRuns,
      sessionAgentStates: this.sessionAgentStates,
      irreversibleOperations: this.irreversibleOperations,
      sessionControls: this.sessionControls,
      now: Date.now(),
    });
  }
  async appendEventIfRunCurrent(
    input: AppendEventIfRunCurrentInput,
  ): Promise<AppendEventIfRunCurrentResult> {
    return appendMemoryEventIfRunCurrent({
      operation: input,
      customerRuns: this.customerRuns,
      agentRuns: this.agentRuns,
      sessionAgentStates: this.sessionAgentStates,
      irreversibleOperations: this.irreversibleOperations,
      sessionControls: this.sessionControls,
      events: this.events,
    });
  }
  async commitAssistantTurnIfRunCurrent(
    input: CommitAssistantTurnIfRunCurrentInput,
  ): Promise<CommitAssistantTurnIfRunCurrentResult> {
    return this.withStoreLock(async () =>
      commitMemoryAssistantTurnIfRunCurrent({
        operation: input,
        state: {
          customerRuns: this.customerRuns,
          agentRuns: this.agentRuns,
          sessionAgentStates: this.sessionAgentStates,
          irreversibleOperations: this.irreversibleOperations,
          sessionControls: this.sessionControls,
        },
        sessionGenerations: this.sessionGenerations,
        verifiedRefs: this.verifiedRefs,
        turns: this.turns,
        events: this.events,
      }),
    );
  }
  async listEvents(sessionId: string): Promise<StoredEvent[]> {
    return this.events.filter((event) => event.sessionId === sessionId);
  }
  async searchHistory(
    sessionId: string,
    query: string,
  ): Promise<HistorySearchResult[]> {
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
function webhookDeliveryKey(
  channel: WebhookDeliveryChannel,
  externalEventId: string,
): string {
  return `${channel}:${externalEventId}`;
}
function profileKey(
  channel: ConversationProfile['channel'],
  externalUserId: string,
): string {
  return `${channel}:${externalUserId}`;
}
function customerRequestKey(
  sessionId: string,
  clientMessageId: string,
): string {
  return `${sessionId}:${clientMessageId}`;
}
