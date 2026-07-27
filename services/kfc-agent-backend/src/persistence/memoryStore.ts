import type {
  AgentMode,
  AgentRun,
  AgentRunTurn,
  ConversationProfile,
  ConversationTurn,
  DashboardEvent,
  PendingCustomerTurn,
  SessionAgentModelBinding,
  SessionAgentState,
} from '../domain/types.js';
import type {
  CustomerRun,
  CustomerRunEvent,
} from '../customerRuns/contracts.js';
import {
  type CatalogPinProjection,
  type SandboxProofSession,
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
  type BindSessionAgentModelInput,
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
  type IrreversibleOperationFinalization,
  type AppendConversationTurnInput,
  type IsRunCommitFenceCurrentInput,
  type CommitAssistantTurnIfRunCurrentInput,
  type CommitAssistantTurnIfRunCurrentResult,
  type CommitAssistantTurnInput,
  type CommitAssistantTurnResult,
  type CommitPausedCustomerRunIntakeInput,
  type CommitPausedCustomerRunIntakeResult,
  type ConversationStore,
  type ConversationSummary,
  type CompareAndSwapConversationSummaryInput,
  type CompareAndSwapConversationSummaryResult,
} from './contracts.js';
import type { PackRef, PackStateEnvelope } from '../runtime/businessPack.js';
import type { RecommendationEvent } from '../recommendations/domain/contracts.js';
import {
  instantSchema,
  sha256Schema,
} from '../recommendations/domain/schemas.js';
import type {
  AppendRecommendationEventInput,
  AppendRecommendationEventResult,
  CommitRecommendationDecisionInput,
  CommitRecommendationDecisionResult,
  ListRecommendationEventsInput,
  RecommendationDecisionRecord,
  RecommendationDemoCustomerHistoryRecord,
  RecommendationPersistence,
  ReserveRecommendationDecisionInput,
  ReserveRecommendationDecisionResult,
} from '../recommendations/persistence/repository.js';
import {
  assertDecisionEventsCorrelate,
  assertCompletedRecommendationReservationReplay,
  assertRecommendationPackState,
  compareRecommendationDecisionsLatestFirst,
  compareRecommendationEventsChronologically,
  currentRecommendationPackStateRevision,
  sameRecommendationDecisionRecord,
  sameRecommendationEventReplaySemantics,
  sameRecommendationImpressionBinding,
} from '../recommendations/persistence/repository.js';
import {
  parseRecommendationDecisionRecord,
  parseRecommendationDemoCustomerHistoryRecord,
  parsePersistedRecommendationEvent,
  serializeRecommendationDecisionStoragePayload,
} from '../recommendations/persistence/types.js';
import { digestCommerceAction } from '../ordering/commerceDigest.js';
import {
  completeMemoryIrreversibleOperation,
  failMemoryIrreversibleOperation,
  finalizeMemoryIrreversibleOperation,
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
  commitMemoryAssistantTurn,
  commitMemoryAssistantTurnIfRunCurrent,
  memoryRunCommitFenceIsCurrent,
  memoryVerifiedRefFenceIsCurrent,
} from './memoryStoreRunCommit.js';
import { commitMemoryPausedCustomerRunIntake } from './memoryStorePausedCustomerRunIntake.js';
import {
  advanceMemorySessionAgentGeneration,
  claimMemorySessionAgentRunOwnership,
  getMemorySessionAgentState,
  bindMemorySessionAgentModel,
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

function memoryPackStateKey(sessionId: string, packRef: PackRef): string {
  return `${sessionId}\u0000${packRef.packId}\u0000${packRef.version}`;
}

interface MemoryRecommendationReservation {
  sessionId: string;
  idempotencyKey: string;
  requestId: string;
  requestFingerprint: string;
  ownerToken: string;
  createdAt: string;
  status: 'pending' | 'completed';
  recommendationId?: string;
  responseJson?: string;
  technicalJson?: string;
}

interface MemoryRecommendationEventRecord {
  eventFingerprint: string;
  event: RecommendationEvent;
}

function memoryRecommendationReservationKey(
  sessionId: string,
  idempotencyKey: string,
): string {
  return `${sessionId}\u0000${idempotencyKey}`;
}

function seedMemoryRecommendationDemoCustomerHistory(): Map<
  string,
  RecommendationDemoCustomerHistoryRecord
> {
  const records = [
    {
      verifiedCustomerRef: 'demo-returning-linked',
      fixtureLabel: 'Mock/synthetic POC returning customer',
      linked: true,
      completedOrders: [
        {
          orderId: 'synthetic-poc-order-001',
          completedAt: '2026-07-20T09:00:00Z',
          lines: [
            {
              sellableItemId: '20751',
              categoryId: '20000',
              quantity: 1,
            },
          ],
        },
      ],
      favoriteSellableItemIds: ['20751'],
      updatedAt: '2026-07-27T00:00:00Z',
    },
    {
      verifiedCustomerRef: 'demo-linked-zero-history',
      fixtureLabel: 'Mock/synthetic POC linked customer with zero history',
      linked: true,
      completedOrders: [],
      favoriteSellableItemIds: [],
      updatedAt: '2026-07-27T00:00:00Z',
    },
    {
      verifiedCustomerRef: 'demo-anonymous-unlinked',
      fixtureLabel: 'Mock/synthetic POC anonymous unlinked journey',
      linked: false,
      completedOrders: [],
      favoriteSellableItemIds: [],
      updatedAt: '2026-07-27T00:00:00Z',
    },
  ].map(parseRecommendationDemoCustomerHistoryRecord);
  return new Map(records.map((record) => [record.verifiedCustomerRef, record]));
}

export class MemoryStore
  extends MemoryStoreNonAgentTextDeliveryOperations
  implements ConversationStore, RecommendationPersistence
{
  private readonly customerRuns = new Map<string, CustomerRun>();
  private readonly customerRunRequestIndex = new Map<string, string>();
  private readonly customerRunEvents: CustomerRunEvent[] = [];
  private readonly turns: ConversationTurn[] = [];
  private readonly conversationSummaries = new Map<
    string,
    ConversationSummary
  >();
  private readonly packStates = new Map<string, PackStateEnvelope>();
  private readonly recommendationReservations = new Map<
    string,
    MemoryRecommendationReservation
  >();
  private readonly recommendationReservationRequestIndex = new Map<
    string,
    string
  >();
  private readonly recommendationDecisions = new Map<
    string,
    RecommendationDecisionRecord
  >();
  private readonly recommendationDecisionRequestIndex = new Map<
    string,
    string
  >();
  private readonly recommendationEvents = new Map<
    string,
    MemoryRecommendationEventRecord
  >();
  private readonly recommendationDemoCustomerHistory =
    seedMemoryRecommendationDemoCustomerHistory();
  private readonly catalogPins = new Map<string, CatalogPinProjection>();
  private readonly sandboxProofSessions = new Map<
    string,
    SandboxProofSession
  >();
  private readonly dashboardEvents: DashboardEvent[] = [];
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
        conversationSummaries: this.conversationSummaries,
        packStates: this.packStates,
        catalogPins: this.catalogPins,
        sandboxProofSessions: this.sandboxProofSessions,
        dashboardEvents: this.dashboardEvents,
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

  async finalizeIrreversibleOperation(
    input: IrreversibleOperationInput,
    owner: IrreversibleOperationOwner,
    result: Record<string, unknown>,
  ): Promise<IrreversibleOperationFinalization> {
    return this.withStoreLock(async () =>
      finalizeMemoryIrreversibleOperation({
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
      ordinal:
        this.turns
          .filter((entry) => entry.sessionId === input.sessionId)
          .reduce((maximum, entry) => Math.max(maximum, entry.ordinal), 0) + 1,
    };
    this.turns.push(turn);
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
  async bindSessionAgentModel(
    input: BindSessionAgentModelInput,
  ): Promise<SessionAgentModelBinding> {
    return this.withStoreLock(async () =>
      bindMemorySessionAgentModel(input, this.sessionAgentStates),
    );
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
    return this.turns
      .filter((turn) => turn.sessionId === sessionId)
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((turn) => structuredClone(turn));
  }

  async getConversationSummary(
    sessionId: string,
  ): Promise<ConversationSummary | undefined> {
    const summary = this.conversationSummaries.get(sessionId);
    return summary ? structuredClone(summary) : undefined;
  }

  async compareAndSwapConversationSummary(
    input: CompareAndSwapConversationSummaryInput,
  ): Promise<CompareAndSwapConversationSummaryResult> {
    return this.withStoreLock(async () => {
      const existing = this.conversationSummaries.get(input.sessionId);
      if (
        existing &&
        existing.text === input.text &&
        existing.throughOrdinal === input.throughOrdinal
      ) {
        return { status: 'unchanged', summary: structuredClone(existing) };
      }
      if (
        (existing?.revision ?? null) !== input.expectedRevision ||
        (existing?.throughOrdinal ?? 0) !== input.expectedThroughOrdinal ||
        input.throughOrdinal <= input.expectedThroughOrdinal
      ) {
        return {
          status: 'stale',
          ...(existing ? { summary: structuredClone(existing) } : {}),
        };
      }
      const summary: ConversationSummary = {
        schemaVersion: 1,
        text: input.text,
        throughOrdinal: input.throughOrdinal,
        revision: (existing?.revision ?? 0) + 1,
        updatedAt: input.updatedAt,
      };
      this.conversationSummaries.set(input.sessionId, summary);
      return { status: 'committed', summary: structuredClone(summary) };
    });
  }

  async getPackState(
    sessionId: string,
    packRef: PackRef,
  ): Promise<PackStateEnvelope | undefined> {
    const envelope = this.packStates.get(
      memoryPackStateKey(sessionId, packRef),
    );
    return envelope ? structuredClone(envelope) : undefined;
  }

  async putPackState(
    sessionId: string,
    envelope: PackStateEnvelope,
  ): Promise<void> {
    await this.withStoreLock(async () =>
      this.packStates.set(
        memoryPackStateKey(sessionId, envelope.packRef),
        structuredClone(envelope),
      ),
    );
  }

  async reserveRecommendationDecision(
    input: ReserveRecommendationDecisionInput,
  ): Promise<ReserveRecommendationDecisionResult> {
    const parsed = {
      sessionId: nonBlank(input.sessionId, 'session_id_invalid'),
      idempotencyKey: nonBlank(input.idempotencyKey, 'idempotency_key_invalid'),
      requestId: nonBlank(input.requestId, 'request_id_invalid'),
      requestFingerprint: sha256Schema.parse(input.requestFingerprint),
      ownerToken: nonBlank(input.ownerToken, 'owner_token_invalid'),
      createdAt: instantSchema.parse(input.createdAt),
    };
    return this.withStoreLock(async () => {
      const key = memoryRecommendationReservationKey(
        parsed.sessionId,
        parsed.idempotencyKey,
      );
      const existing = this.recommendationReservations.get(key);
      if (existing) {
        if (
          existing.requestId !== parsed.requestId ||
          existing.requestFingerprint !== parsed.requestFingerprint
        ) {
          return { status: 'conflict' };
        }
        if (existing.status === 'completed') {
          if (!existing.recommendationId) {
            throw new Error('recommendation_completed_reservation_invalid');
          }
          const record = this.recommendationDecisions.get(
            existing.recommendationId,
          );
          if (!record) throw new Error('recommendation_replay_record_missing');
          assertCompletedRecommendationReservationReplay({
            requested: parsed,
            stored: {
              sessionId: existing.sessionId,
              idempotencyKey: existing.idempotencyKey,
              requestId: existing.requestId,
              requestFingerprint: existing.requestFingerprint,
              recommendationId: existing.recommendationId,
              responseJson: existing.responseJson,
              technicalJson: existing.technicalJson,
            },
            record,
          });
          return {
            status: 'replay',
            record: cloneRecommendationDecisionRecord(record),
          };
        }
        return { status: 'pending' };
      }
      if (
        this.recommendationReservationRequestIndex.has(parsed.requestId) ||
        this.recommendationDecisionRequestIndex.has(parsed.requestId)
      ) {
        return { status: 'conflict' };
      }
      this.recommendationReservations.set(key, {
        ...parsed,
        status: 'pending',
      });
      this.recommendationReservationRequestIndex.set(parsed.requestId, key);
      return { status: 'reserved' };
    });
  }

  async commitRecommendationDecision(
    input: CommitRecommendationDecisionInput,
  ): Promise<CommitRecommendationDecisionResult> {
    const ownerToken = nonBlank(input.ownerToken, 'owner_token_invalid');
    const expectedPackStateDigest =
      input.expectedPackStateDigest === null
        ? null
        : sha256Schema.parse(input.expectedPackStateDigest);
    const record = parseRecommendationDecisionRecord(
      structuredClone(input.record),
    );
    const events = input.events.map((event) =>
      parsePersistedRecommendationEvent(structuredClone(event)),
    );
    assertDecisionEventsCorrelate(record, events);
    await assertRecommendationPackState(
      input.nextPackState,
      record.request.orderFlowId,
      record.stateRevisionAfter,
    );
    const eventRecords = await Promise.all(
      events.map(async (event) => ({
        eventFingerprint: await digestCommerceAction(event),
        event,
      })),
    );

    return this.withStoreLock(async () => {
      const existingByRecommendation = this.recommendationDecisions.get(
        record.response.recommendationId,
      );
      const existingRecommendationId =
        this.recommendationDecisionRequestIndex.get(record.request.requestId);
      const existingByRequest = existingRecommendationId
        ? this.recommendationDecisions.get(existingRecommendationId)
        : undefined;
      const existing = existingByRecommendation ?? existingByRequest;
      if (existing) {
        return sameRecommendationDecisionRecord(existing, record)
          ? {
              status: 'replay',
              record: cloneRecommendationDecisionRecord(existing),
            }
          : { status: 'stale' };
      }

      const reservationKey = memoryRecommendationReservationKey(
        record.request.sessionId,
        record.request.idempotencyKey,
      );
      const reservation = this.recommendationReservations.get(reservationKey);
      if (
        !reservation ||
        reservation.status !== 'pending' ||
        reservation.ownerToken !== ownerToken ||
        reservation.requestId !== record.request.requestId ||
        reservation.requestFingerprint !== record.requestFingerprint
      ) {
        return { status: 'stale' };
      }

      const packStateKey = memoryPackStateKey(
        record.request.sessionId,
        input.nextPackState.packRef,
      );
      const currentPackState = this.packStates.get(packStateKey);
      if (
        (expectedPackStateDigest === null && currentPackState !== undefined) ||
        (expectedPackStateDigest !== null &&
          currentPackState?.integrity.digest !== expectedPackStateDigest)
      ) {
        return { status: 'stale' };
      }
      const currentRevision =
        currentPackState === undefined
          ? 0
          : await currentRecommendationPackStateRevision(
              currentPackState,
              record.request.orderFlowId,
            );
      if (
        currentRevision !== record.stateRevisionBefore ||
        eventRecords.some(({ event }) =>
          this.recommendationEvents.has(event.eventId),
        )
      ) {
        return { status: 'stale' };
      }

      this.packStates.set(packStateKey, structuredClone(input.nextPackState));
      this.recommendationDecisions.set(
        record.response.recommendationId,
        cloneRecommendationDecisionRecord(record),
      );
      this.recommendationDecisionRequestIndex.set(
        record.request.requestId,
        record.response.recommendationId,
      );
      for (const eventRecord of eventRecords) {
        this.recommendationEvents.set(eventRecord.event.eventId, {
          eventFingerprint: eventRecord.eventFingerprint,
          event: structuredClone(eventRecord.event),
        });
      }
      this.recommendationReservations.set(reservationKey, {
        ...reservation,
        status: 'completed',
        recommendationId: record.response.recommendationId,
        ...serializeRecommendationDecisionStoragePayload(record),
      });
      return {
        status: 'committed',
        record: cloneRecommendationDecisionRecord(record),
      };
    });
  }

  async appendRecommendationEvent(
    input: AppendRecommendationEventInput,
  ): Promise<AppendRecommendationEventResult> {
    const eventFingerprint = sha256Schema.parse(input.eventFingerprint);
    const expectedPackStateDigest = sha256Schema.parse(
      input.expectedPackStateDigest,
    );
    const event = parsePersistedRecommendationEvent(
      structuredClone(input.event),
    );
    await assertRecommendationPackState(input.nextPackState, event.orderFlowId);
    return this.withStoreLock(async () => {
      const existing = this.recommendationEvents.get(event.eventId);
      if (existing) {
        const storedEvent = parsePersistedRecommendationEvent(
          structuredClone(existing.event),
        );
        return existing.eventFingerprint === eventFingerprint &&
          sameRecommendationEventReplaySemantics(storedEvent, event)
          ? { status: 'replay', event: structuredClone(storedEvent) }
          : { status: 'conflict' };
      }
      const key = memoryPackStateKey(
        event.sessionId,
        input.nextPackState.packRef,
      );
      const current = this.packStates.get(key);
      if (current?.integrity.digest !== expectedPackStateDigest) {
        return { status: 'stale' };
      }
      const currentRevision = await assertRecommendationPackState(
        current,
        event.orderFlowId,
      );
      const nextRevision = await assertRecommendationPackState(
        input.nextPackState,
        event.orderFlowId,
      );
      const unchangedRepeatImpression =
        nextRevision === currentRevision &&
        input.nextPackState.integrity.digest === expectedPackStateDigest &&
        event.eventType === 'impression_rendered' &&
        event.recommendationId !== null &&
        [...this.recommendationEvents.values()].some(({ event: candidate }) =>
          sameRecommendationImpressionBinding(
            parsePersistedRecommendationEvent(structuredClone(candidate)),
            event,
          ),
        );
      if (
        nextRevision < currentRevision ||
        (nextRevision === currentRevision && !unchangedRepeatImpression)
      ) {
        return { status: 'stale' };
      }
      if (!unchangedRepeatImpression) {
        this.packStates.set(key, structuredClone(input.nextPackState));
      }
      this.recommendationEvents.set(event.eventId, {
        eventFingerprint,
        event: structuredClone(event),
      });
      return { status: 'recorded', event: structuredClone(event) };
    });
  }

  async getRecommendationDecision(
    recommendationId: string,
  ): Promise<RecommendationDecisionRecord | undefined> {
    const record = this.recommendationDecisions.get(recommendationId);
    if (!record) return undefined;
    if (record.response.recommendationId !== recommendationId) {
      throw new Error('recommendation_decision_storage_identity_mismatch');
    }
    const parsed = cloneRecommendationDecisionRecord(record);
    if (parsed.response.recommendationId !== recommendationId) {
      throw new Error('recommendation_decision_storage_identity_mismatch');
    }
    return parsed;
  }

  async getRecommendationDecisionByRequest(
    requestId: string,
  ): Promise<RecommendationDecisionRecord | undefined> {
    const recommendationId =
      this.recommendationDecisionRequestIndex.get(requestId);
    if (!recommendationId) return undefined;
    const record = await this.getRecommendationDecision(recommendationId);
    if (record?.request.requestId !== requestId) {
      throw new Error('recommendation_decision_storage_identity_mismatch');
    }
    return record;
  }

  async listRecommendationEvents(
    input: ListRecommendationEventsInput,
  ): Promise<RecommendationEvent[]> {
    return [...this.recommendationEvents.entries()]
      .map(([eventId, { event }]) => {
        const parsed = parsePersistedRecommendationEvent(
          structuredClone(event),
        );
        if (parsed.eventId !== eventId) {
          throw new Error('recommendation_event_storage_identity_mismatch');
        }
        return parsed;
      })
      .filter(
        (event) =>
          (input.orderFlowId === undefined ||
            event.orderFlowId === input.orderFlowId) &&
          (input.recommendationId === undefined ||
            event.recommendationId === input.recommendationId) &&
          (input.sessionId === undefined ||
            event.sessionId === input.sessionId),
      )
      .sort(compareRecommendationEventsChronologically)
      .map((event) => structuredClone(event));
  }

  async latestRecommendationDecisionForOrderFlow(
    orderFlowId: string,
  ): Promise<RecommendationDecisionRecord | undefined> {
    const record = [...this.recommendationDecisions.entries()]
      .map(([recommendationId, candidate]) => {
        const parsed = cloneRecommendationDecisionRecord(candidate);
        if (parsed.response.recommendationId !== recommendationId) {
          throw new Error('recommendation_decision_storage_identity_mismatch');
        }
        return parsed;
      })
      .filter((candidate) => candidate.request.orderFlowId === orderFlowId)
      .sort(compareRecommendationDecisionsLatestFirst)[0];
    return record ? cloneRecommendationDecisionRecord(record) : undefined;
  }

  async getRecommendationDemoCustomerHistory(
    verifiedCustomerRef: string,
  ): Promise<RecommendationDemoCustomerHistoryRecord | undefined> {
    const record =
      this.recommendationDemoCustomerHistory.get(verifiedCustomerRef);
    if (!record) return undefined;
    const parsed = parseRecommendationDemoCustomerHistoryRecord(
      structuredClone(record),
    );
    if (parsed.verifiedCustomerRef !== verifiedCustomerRef) {
      throw new Error('recommendation_history_storage_identity_mismatch');
    }
    return parsed;
  }

  async getCatalogPin(
    sessionId: string,
  ): Promise<CatalogPinProjection | undefined> {
    const projection = this.catalogPins.get(sessionId);
    return projection ? structuredClone(projection) : undefined;
  }
  async putCatalogPin(projection: CatalogPinProjection): Promise<void> {
    this.catalogPins.set(projection.sessionId, structuredClone(projection));
  }
  async getSandboxProofSession(
    sessionId: string,
  ): Promise<SandboxProofSession | undefined> {
    const record = this.sandboxProofSessions.get(sessionId);
    return record ? structuredClone(record) : undefined;
  }
  async putSandboxProofSession(record: SandboxProofSession): Promise<void> {
    this.sandboxProofSessions.set(record.sessionId, structuredClone(record));
  }
  async appendDashboardEvent(event: DashboardEvent): Promise<void> {
    if (!this.dashboardEvents.some(({ id }) => id === event.id)) {
      this.dashboardEvents.push(structuredClone(event));
    }
  }
  async listDashboardEvents(
    sessionId?: string,
    limit = 200,
  ): Promise<DashboardEvent[]> {
    const events = sessionId
      ? this.dashboardEvents.filter((event) => event.sessionId === sessionId)
      : this.dashboardEvents;
    return structuredClone(events.slice(-limit));
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
        packStates: this.packStates,
      }),
    );
  }
  async commitAssistantTurn(
    input: CommitAssistantTurnInput,
  ): Promise<CommitAssistantTurnResult> {
    return this.withStoreLock(async () =>
      commitMemoryAssistantTurn({
        operation: input,
        sessionGenerations: this.sessionGenerations,
        verifiedRefs: this.verifiedRefs,
        turns: this.turns,
        packStates: this.packStates,
      }),
    );
  }
  async searchHistory(
    sessionId: string,
    query: string,
  ): Promise<HistorySearchResult[]> {
    const lower = query.toLowerCase();
    const scored = this.turns
      .filter((turn) => turn.sessionId === sessionId)
      .map((turn) => {
        const text = turn.text.toLowerCase();
        const directHit = text.includes(lower);
        return { ...structuredClone(turn), confidence: directHit ? 0.7 : 0 };
      })
      .filter((event) => event.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
    return scored;
  }
}

function nonBlank(value: string, error: string): string {
  if (!value.trim()) throw new Error(error);
  return value;
}

function cloneRecommendationDecisionRecord(
  record: RecommendationDecisionRecord,
): RecommendationDecisionRecord {
  return parseRecommendationDecisionRecord(structuredClone(record));
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
