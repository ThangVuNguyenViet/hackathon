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
import type {
  AuthenticatedCommerceApprovalPrincipal,
  CommerceApprovalBinding,
  CommerceApprovalPrincipal,
  CommerceApprovalReceipt,
  ToolCallRequest,
} from '../ordering/types.js';
import type {
  IssueVerifiedRefInput,
  VerifiedRef,
  VerifiedRefRecord,
} from '../domain/verifiedRef.js';
import type {
  AgentRunTextDeliveryRecord,
  BeginAgentRunTextDeliveryAttemptInput,
  BeginAgentRunTextDeliveryAttemptResult,
  CompleteAgentRunTextDeliveryAttemptInput,
  CompleteAgentRunTextDeliveryAttemptResult,
  CreatePendingAgentRunTextDeliveryInput,
  ReconcileAgentRunTextDeliveryInput,
  ReconcileAgentRunTextDeliveryResult,
} from './agentRunTextDelivery.js';
import type {
  BeginNonAgentTextDeliveryAttemptInput,
  BeginNonAgentTextDeliveryAttemptResult,
  CompleteNonAgentTextDeliveryAttemptInput,
  CompleteNonAgentTextDeliveryAttemptResult,
  NonAgentTextDeliveryRecord,
  PrepareNonAgentTextDeliveryTurnInput,
  PrepareNonAgentTextDeliveryTurnResult,
  ReconcileNonAgentTextDeliveryInput,
  ReconcileNonAgentTextDeliveryResult,
  ReserveNonAgentTextDeliveryInput,
  ReserveNonAgentTextDeliveryResult,
} from './nonAgentTextDelivery.js';

export type {
  BeginNonAgentTextDeliveryAttemptInput,
  BeginNonAgentTextDeliveryAttemptResult,
  CompleteNonAgentTextDeliveryAttemptInput,
  CompleteNonAgentTextDeliveryAttemptResult,
  NonAgentTextDeliveryRecord,
  PrepareNonAgentTextDeliveryTurnInput,
  PrepareNonAgentTextDeliveryTurnResult,
  ReconcileNonAgentTextDeliveryInput,
  ReconcileNonAgentTextDeliveryResult,
  ReserveNonAgentTextDeliveryInput,
  ReserveNonAgentTextDeliveryResult,
} from './nonAgentTextDelivery.js';

export interface StoredEvent {
  id: string;
  sessionId: string;
  sourceType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type RunCommitFence =
  | {
      kind: 'agent_run';
      runId: string;
      generation: number;
      sessionAuthorityGeneration: number;
      executionAttempt: number;
      executionLeaseToken: string;
    }
  | {
      kind: 'customer_run';
      runId: string;
      sessionAuthorityGeneration: number;
    }
  | {
      kind: 'operation_lease';
      requestId: string;
      operation: string;
      bindingFingerprint: string;
      attempt: number;
      leaseToken: string;
      sessionAuthorityGeneration: number;
    };

export type AppendEventIfRunCurrentResult =
  | { status: 'committed'; event: StoredEvent }
  | { status: 'stale' };

export interface IsRunCommitFenceCurrentInput {
  sessionId: string;
  fence: RunCommitFence;
  /**
   * Optional server-issued authorization expiry. Stores compare it with their
   * own clock in the same query as the durable owner predicate.
   */
  notAfter?: string;
}

export interface AppendEventIfRunCurrentInput {
  sessionId: string;
  sourceType: string;
  payload: Record<string, unknown>;
  fence: RunCommitFence;
  /**
   * Optional server-issued authorization expiry. Stores compare it with their
   * own clock inside the same conditional INSERT as the run-owner predicate.
   */
  notAfter?: string;
}

export interface CommitAssistantTurnIfRunCurrentInput {
  fence: RunCommitFence;
  /**
   * Optional server-issued authorization expiry. Stores compare it with their
   * own wall clock in the same atomic operation as every durable write.
   */
  notAfter?: string;
  stateEvent: {
    sessionId: string;
    sourceType: string;
    payload: Record<string, unknown>;
  };
  assistantTurn: AppendConversationTurnInput;
  /**
   * Opaque references staged in memory while building the presentation. They
   * become visible only in the same atomic commit as the turn that publishes
   * them.
   */
  verifiedRefs?: readonly VerifiedRefRecord[];
}

export type CommitAssistantTurnIfRunCurrentResult =
  | {
      status: 'committed';
      stateEvent: StoredEvent;
      turnEvent: StoredEvent;
      turn: ConversationTurn;
      verifiedRefs: VerifiedRefRecord[];
    }
  | { status: 'stale' };

export interface CommitConfirmationPauseIfRunCurrentInput {
  fence: RunCommitFence;
  notAfter?: string;
  stateEvent: {
    sessionId: string;
    sourceType: string;
    payload: Record<string, unknown>;
  };
  pause: CreateConfirmationPauseInput;
}

export type CommitConfirmationPauseIfRunCurrentResult =
  | {
      status: 'created' | 'replay';
      stateEvent: StoredEvent;
      pauseEvent: StoredEvent;
      record: ConfirmationPauseRecord;
    }
  | { status: 'stale' | 'conflict' };

export interface ConfirmationPauseRecord {
  schemaVersion: 'kfc-confirmation-pause-v1';
  requestId: string;
  checkpointThreadId: string;
  checkpointNamespace: string;
  /** Exact immutable LangGraph checkpoint containing the interrupt. */
  checkpointId: string;
  sessionId: string;
  customerId: string;
  channel: ConversationTurn['channel'];
  action: ToolCallRequest;
  /** Digest of the exact model-authored tool call and arguments. */
  actionDigest: string;
  /**
   * Server-enriched approval authority. Its actionDigest may additionally
   * bind verified order, collection, method, and provider evidence.
   */
  approvalBinding: CommerceApprovalBinding;
  approvalBindingDigest: string;
  principal: CommerceApprovalPrincipal;
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'rejected' | 'expired';
  rejectionReceipt: CommerceApprovalReceipt | null;
  rejectedAt: string | null;
  completionStatus: 'pending' | 'completed' | 'failed';
  result: Record<string, unknown> | null;
  completionError: string | null;
  completedAt: string | null;
}

export type CreateConfirmationPauseInput = Pick<
  ConfirmationPauseRecord,
  | 'schemaVersion'
  | 'requestId'
  | 'checkpointThreadId'
  | 'checkpointNamespace'
  | 'checkpointId'
  | 'sessionId'
  | 'customerId'
  | 'channel'
  | 'action'
  | 'actionDigest'
  | 'approvalBinding'
  | 'approvalBindingDigest'
  | 'principal'
  | 'createdAt'
  | 'expiresAt'
>;

export type CreateConfirmationPauseResult =
  | { status: 'created' | 'replay'; record: ConfirmationPauseRecord }
  | { status: 'conflict' };

export type IssueVerifiedRefResult =
  | { status: 'created'; record: VerifiedRefRecord }
  | { status: 'generation_conflict' };

export interface ResolveVerifiedRefInput {
  ref: VerifiedRef;
  principal: AuthenticatedCommerceApprovalPrincipal;
  expectedVerifiedRevision: string;
  /** Canonical server lookup time; never accept this from public request JSON. */
  now: string;
}

export interface ClaimVerifiedRefInput extends ResolveVerifiedRefInput {
  /** Stable server-owned effect identifier used for one-shot replay. */
  useId: string;
  /**
   * Durable owner and optional authentication expiry checked atomically with
   * both the first claim and same-use replay.
   */
  runFence: IsRunCommitFenceCurrentInput;
}

export type ClaimVerifiedRefResult =
  | { status: 'claimed' | 'replay'; record: VerifiedRefRecord }
  | { status: 'unavailable' };

export interface ClaimConfirmationRejectionInput {
  requestId: string;
  actionDigest: string;
  approvalBindingDigest: string;
  principal: CommerceApprovalPrincipal;
  /** Receipt already authenticated by the server-owned approval boundary. */
  receipt: CommerceApprovalReceipt;
  /** Canonical server decision time; never copy a client-supplied timestamp. */
  rejectedAt: string;
}

export type ClaimConfirmationRejectionResult =
  | { status: 'claimed' | 'replay'; record: ConfirmationPauseRecord }
  | { status: 'conflict' | 'expired' | 'not_found' };

export type ConfirmationResumeCompletion =
  | { status: 'completed'; result: Record<string, unknown> }
  | { status: 'failed'; error: string };

export interface CompleteConfirmationResumeInput {
  requestId: string;
  receiptId: string;
  /** Canonical server completion time. */
  completedAt: string;
  completion: ConfirmationResumeCompletion;
}

export type CompleteConfirmationResumeResult =
  | { status: 'completed' | 'replay'; record: ConfirmationPauseRecord }
  | { status: 'conflict' | 'lost' };

export type AppendCustomerRunEventInput = Omit<CustomerRunEvent, 'sequence'> & {
  expectedSequence: number;
};

export interface AppendCustomerRunEventsIfRunCurrentInput {
  sessionId: string;
  fence: Extract<RunCommitFence, { kind: 'customer_run' }>;
  events: readonly AppendCustomerRunEventInput[];
}

export type AppendCustomerRunEventsIfRunCurrentResult =
  | { status: 'committed'; events: CustomerRunEvent[] }
  | { status: 'stale' };

export interface CommitPausedCustomerRunIntakeInput {
  expectedSessionAuthorityGeneration: number;
  run: CreateCustomerRunInput;
  userTurn: AppendConversationTurnInput;
  events: readonly AppendCustomerRunEventInput[];
}

export type CommitPausedCustomerRunIntakeResult =
  | {
      status: 'committed' | 'replayed';
      run: CustomerRun;
      turn: ConversationTurn;
      events: CustomerRunEvent[];
    }
  | { status: 'stale' };

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
export type WebhookDeliveryStatus =
  | 'received'
  | 'processed'
  | 'failed';

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

export interface CheckpointIdentifier {
  checkpointThreadId: string;
  checkpointNamespace: string;
  checkpointId: string;
  parentCheckpointId: string | null;
}

export interface SessionControl {
  sessionId: string;
  agentMode: AgentMode;
  assignedAgentId: string | null;
  sessionAuthorityGeneration: number;
  updatedAt: string;
}

export interface TransitionSessionAuthorityInput {
  sessionId: string;
  expectedGeneration: number;
  agentMode: AgentMode;
  assignedAgentId: string | null;
  updatedAt?: string;
}

export type TransitionSessionAuthorityResult = {
  status: 'transitioned' | 'unchanged' | 'stale';
  control: SessionControl;
};

export type CreateCustomerRunInput = Omit<
  CustomerRun,
  'sessionAuthorityGeneration'
>;

export type PendingCustomerTurnInput = Omit<PendingCustomerTurn, 'updatedAt'> & { updatedAt?: string };

export interface UpsertPendingCustomerTurnResult {
  turn: PendingCustomerTurn;
  inserted: boolean;
}

export type CreateAgentRunInput = Omit<
  AgentRun,
  | 'sessionAuthorityGeneration'
  | 'executionAttempt'
  | 'executionLeaseToken'
  | 'executionLeaseExpiresAt'
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

export interface ClaimAgentRunResult {
  run: AgentRun;
  claimed: boolean;
}

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

export interface AdvanceSessionAgentGenerationInput {
  sessionId: string;
  /**
   * The next debounce deadline, or null when human ownership invalidates all
   * pending agent work.
   */
  debounceDeadlineAt: string | null;
  updatedAt?: string;
}

export interface AdvanceSessionAgentGenerationResult {
  state: SessionAgentState;
  /** The exact owner cleared by the same atomic generation advance. */
  invalidatedRunId: string | null;
}

export interface ClaimSessionAgentRunOwnershipInput {
  sessionId: string;
  runId: string;
  expectedGeneration: number;
  expectedCurrentRunId: string | null;
  expectedDebounceDeadlineAt: string;
  updatedAt?: string;
}

export type ClaimSessionAgentRunOwnershipResult =
  | { status: 'claimed'; state: SessionAgentState }
  | { status: 'stale'; state: SessionAgentState };

export interface ClaimAgentRunExecutionInput {
  runId: string;
  sessionId: string;
  generation: number;
  sessionAuthorityGeneration: number;
  claimedAt: string;
  executionLeaseToken: string;
  executionLeaseExpiresAt: string;
}

export type ClaimAgentRunExecutionResult =
  | { status: 'claimed'; run: AgentRun }
  | {
      status: 'reconciliation_required';
      reason:
        | 'attempts_exhausted'
        | 'delivery_outcome_unknown'
        | 'irreversible_outcome_unknown';
      run: AgentRun;
    }
  | {
      status: 'stale';
      reason:
        | 'not_found'
        | 'not_current'
        | 'lease_active'
        | 'attempts_exhausted'
        | 'delivery_outcome_unknown'
        | 'irreversible_outcome_unknown';
      run?: AgentRun;
    };

export interface UpdateAgentRunIfExecutionCurrentInput {
  sessionId: string;
  fence: Extract<RunCommitFence, { kind: 'agent_run' }>;
  patch: AgentRunPatch;
}

export type UpdateAgentRunIfExecutionCurrentResult =
  | { status: 'committed'; run: AgentRun }
  | { status: 'stale'; run?: AgentRun };

export type CreateAgentRunTextDeliveryResult =
  | {
      status: 'created' | 'rebound' | 'replay';
      record: AgentRunTextDeliveryRecord;
    }
  | {
      status: 'stale' | 'conflict';
      record?: AgentRunTextDeliveryRecord;
    };

export interface SupersedeAgentRunExecutionIfNoLongerCurrentInput {
  sessionId: string;
  fence: Extract<RunCommitFence, { kind: 'agent_run' }>;
  supersededByRunId?: string | null;
  errorMessage: string;
  completedAt: string;
}

export type SupersedeAgentRunExecutionIfNoLongerCurrentResult =
  | { status: 'superseded'; run: AgentRun }
  | { status: 'still_current'; run: AgentRun }
  | { status: 'stale'; run?: AgentRun }
  | {
      status: 'reconciliation_required';
      reason:
        | 'irreversible_outcome_unknown'
        | 'delivery_outcome_unknown';
      run: AgentRun;
    };

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
  | {
      status: 'reserved';
      attempt: number;
      leaseToken: string;
      reconciliation: boolean;
      sessionAuthorityGeneration: number;
    }
  | { status: 'pending' }
  | { status: 'unknown'; lastError: string | null }
  | { status: 'completed'; result: Record<string, unknown> };

export type IrreversibleOperationCompletion =
  | { status: 'completed'; result: Record<string, unknown> }
  | { status: 'lost' };

export interface IrreversibleOperationOwner {
  attempt: number;
  leaseToken: string;
  sessionAuthorityGeneration: number;
}

export interface MarkIrreversibleOperationOutcomeUnknownIfExpiredInput
  extends IrreversibleOperationInput {
  /** Server-owned diagnostic persisted when the lease expires unresolved. */
  reason: string;
}

export type MarkIrreversibleOperationOutcomeUnknownIfExpiredResult =
  | { status: 'completed'; result: Record<string, unknown> }
  | { status: 'pending' }
  | {
      status: 'unknown';
      lastError: string | null;
      transitioned: boolean;
    };

export interface ReserveConfirmationResumeOperationInput
  extends IrreversibleOperationInput {
  operation: 'confirmation_resume';
  expectedPause: CreateConfirmationPauseInput;
  /**
   * Session generation observed with expectedPause. The atomic claim must
   * match this exact generation so a reset/recreate ABA cannot revive stale
   * approval authority.
   */
  expectedSessionGeneration: number;
  pauseIdentityDigest: string;
  decision: CommerceApprovalReceipt['decision'];
  receipt: CommerceApprovalReceipt;
  providerIdempotencyKey: string;
  /** Canonical server claim time; never accept this from public request JSON. */
  claimedAt: string;
  leaseTtlMs: number;
}

export type ReserveConfirmationResumeOperationResult =
  | IrreversibleOperationReservation
  | { status: 'conflict' | 'expired' | 'not_found' };

export class SessionResetConflictError extends Error {
  readonly code = 'session_reset_conflict';

  constructor() {
    super('Session reset conflicts with an unresolved irreversible operation');
    this.name = 'SessionResetConflictError';
  }
}

export function assertSameIrreversibleOperation(
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
  /**
   * Optional server-authored stable identity for an already-reserved durable
   * publication. Public callers must never choose conversation turn IDs.
   */
  id?: string;
  createdAt?: string;
};

export interface ConversationStore {
  resetSession(sessionId: string): Promise<SessionControl>;
  createCustomerRun(input: CreateCustomerRunInput): Promise<CustomerRun>;
  createCustomerRunWithEvent?(
    input: CreateCustomerRunInput,
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
  appendCustomerRunEventsIfRunCurrent(
    input: AppendCustomerRunEventsIfRunCurrentInput,
  ): Promise<AppendCustomerRunEventsIfRunCurrentResult>;
  commitPausedCustomerRunIntake(
    input: CommitPausedCustomerRunIntakeInput,
  ): Promise<CommitPausedCustomerRunIntakeResult>;
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
  reserveNonAgentTextDelivery(
    input: ReserveNonAgentTextDeliveryInput,
  ): Promise<ReserveNonAgentTextDeliveryResult>;
  getNonAgentTextDelivery(
    requestKey: string,
  ): Promise<NonAgentTextDeliveryRecord | undefined>;
  prepareNonAgentTextDeliveryTurn(
    input: PrepareNonAgentTextDeliveryTurnInput,
  ): Promise<PrepareNonAgentTextDeliveryTurnResult>;
  beginNonAgentTextDeliveryAttempt(
    input: BeginNonAgentTextDeliveryAttemptInput,
  ): Promise<BeginNonAgentTextDeliveryAttemptResult>;
  completeNonAgentTextDeliveryAttempt(
    input: CompleteNonAgentTextDeliveryAttemptInput,
  ): Promise<CompleteNonAgentTextDeliveryAttemptResult>;
  reconcileNonAgentTextDelivery(
    input: ReconcileNonAgentTextDeliveryInput,
  ): Promise<ReconcileNonAgentTextDeliveryResult>;
  markWebhookDeliveryProcessed(channel: WebhookDeliveryChannel, externalEventId: string): Promise<WebhookDelivery>;
  markWebhookDeliveryFailed(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
    lastError: string,
  ): Promise<WebhookDelivery>;
  getWebhookDelivery(channel: WebhookDeliveryChannel, externalEventId: string): Promise<WebhookDelivery | undefined>;
  listWebhookDeliveries(sessionId: string): Promise<WebhookDelivery[]>;
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
  transitionSessionAuthority(
    input: TransitionSessionAuthorityInput,
  ): Promise<TransitionSessionAuthorityResult>;
  upsertPendingCustomerTurn(input: PendingCustomerTurnInput): Promise<UpsertPendingCustomerTurnResult>;
  listPendingCustomerTurns(sessionId: string): Promise<PendingCustomerTurn[]>;
  markPendingCustomerTurnClaimed(turnId: string, runId: string): Promise<PendingCustomerTurn>;
  markPendingCustomerTurnIgnored(turnId: string, runId: string): Promise<PendingCustomerTurn>;
  createAgentRun(input: CreateAgentRunInput): Promise<AgentRun>;
  claimAgentRun(input: CreateAgentRunInput): Promise<ClaimAgentRunResult>;
  updateAgentRun(runId: string, patch: AgentRunPatch): Promise<AgentRun>;
  updateAgentRunIfExecutionCurrent(
    input: UpdateAgentRunIfExecutionCurrentInput,
  ): Promise<UpdateAgentRunIfExecutionCurrentResult>;
  getAgentRun(runId: string): Promise<AgentRun | undefined>;
  listAgentRuns(sessionId: string): Promise<AgentRun[]>;
  linkAgentRunTurn(input: AgentRunTurn): Promise<AgentRunTurn>;
  listAgentRunTurns(runId: string): Promise<AgentRunTurn[]>;
  listCheckpointIdentifiers(sessionId: string): Promise<CheckpointIdentifier[]>;
  getSessionAgentState(sessionId: string): Promise<SessionAgentState>;
  setSessionAgentState(input: SessionAgentStateInput): Promise<SessionAgentState>;
  advanceSessionAgentGeneration(
    input: AdvanceSessionAgentGenerationInput,
  ): Promise<AdvanceSessionAgentGenerationResult>;
  claimSessionAgentRunOwnership(
    input: ClaimSessionAgentRunOwnershipInput,
  ): Promise<ClaimSessionAgentRunOwnershipResult>;
  claimAgentRunExecution(
    input: ClaimAgentRunExecutionInput,
  ): Promise<ClaimAgentRunExecutionResult>;
  supersedeAgentRunExecutionIfNoLongerCurrent(
    input: SupersedeAgentRunExecutionIfNoLongerCurrentInput,
  ): Promise<SupersedeAgentRunExecutionIfNoLongerCurrentResult>;
  createAgentRunTextDelivery(
    input: CreatePendingAgentRunTextDeliveryInput,
  ): Promise<CreateAgentRunTextDeliveryResult>;
  getAgentRunTextDelivery(
    runId: string,
  ): Promise<AgentRunTextDeliveryRecord | undefined>;
  beginAgentRunTextDeliveryAttempt(
    input: BeginAgentRunTextDeliveryAttemptInput,
  ): Promise<BeginAgentRunTextDeliveryAttemptResult>;
  completeAgentRunTextDeliveryAttempt(
    input: CompleteAgentRunTextDeliveryAttemptInput,
  ): Promise<CompleteAgentRunTextDeliveryAttemptResult>;
  reconcileAgentRunTextDelivery(
    input: ReconcileAgentRunTextDeliveryInput,
  ): Promise<ReconcileAgentRunTextDeliveryResult>;
  listDueSessionAgentStates(now: string, limit: number): Promise<SessionAgentState[]>;
  listTurns(sessionId: string): Promise<ConversationTurn[]>;
  appendEvent(sessionId: string, sourceType: string, payload: Record<string, unknown>): Promise<StoredEvent>;
  /**
   * Advisory exact-owner read for boundaries that must fail before provider
   * dispatch. Every durable publication still uses one of the atomic CAS
   * methods below; callers must not treat this read as a write fence.
   */
  isRunCommitFenceCurrent(
    input: IsRunCommitFenceCurrentInput,
  ): Promise<boolean>;
  /**
   * Atomically checks the durable run owner and appends the event in the same
   * store operation. Implementations must not express this as check-then-write.
   */
  appendEventIfRunCurrent(
    input: AppendEventIfRunCurrentInput,
  ): Promise<AppendEventIfRunCurrentResult>;
  /**
   * Atomically validates the durable owner and commits the verified-state
   * snapshot, any presentation references, the assistant turn, and its audit
   * event. Implementations must not express this as check-then-write.
   */
  commitAssistantTurnIfRunCurrent(
    input: CommitAssistantTurnIfRunCurrentInput,
  ): Promise<CommitAssistantTurnIfRunCurrentResult>;
  /**
   * Atomically validates the durable owner and commits the pause's verified
   * state, canonical approval record, and bounded creation audit.
   */
  commitConfirmationPauseIfRunCurrent(
    input: CommitConfirmationPauseIfRunCurrentInput,
  ): Promise<CommitConfirmationPauseIfRunCurrentResult>;
  listEvents(sessionId: string): Promise<StoredEvent[]>;
  issueVerifiedRef(
    input: IssueVerifiedRefInput,
  ): Promise<IssueVerifiedRefResult>;
  /**
   * Resolves replayable references only. One-shot payloads are released only
   * by claimVerifiedRef's atomic consume/replay boundary.
   */
  resolveVerifiedRef(
    input: ResolveVerifiedRefInput,
  ): Promise<VerifiedRefRecord | undefined>;
  claimVerifiedRef(
    input: ClaimVerifiedRefInput,
  ): Promise<ClaimVerifiedRefResult>;
  createConfirmationPause(
    input: CreateConfirmationPauseInput,
  ): Promise<CreateConfirmationPauseResult>;
  getConfirmationPause(
    requestId: string,
  ): Promise<ConfirmationPauseRecord | undefined>;
  /**
   * Internal generation-fenced view used only by the durable resume
   * coordinator. Public callers receive getConfirmationPause's record view.
   */
  getConfirmationPauseStorageSnapshot(
    requestId: string,
  ): Promise<import('./confirmationPause.js').ConfirmationPauseStorageSnapshot | undefined>;
  claimConfirmationRejection(
    input: ClaimConfirmationRejectionInput,
  ): Promise<ClaimConfirmationRejectionResult>;
  completeConfirmationResume(
    input: CompleteConfirmationResumeInput,
  ): Promise<CompleteConfirmationResumeResult>;
  /** Compatibility name for callers; authorization is backed only by the strict pause store. */
  findConfirmationPause(requestId: string): Promise<ConfirmationPauseRecord | undefined>;
  searchHistory(sessionId: string, query: string): Promise<HistorySearchResult[]>;
  reserveIrreversibleOperation?(input: IrreversibleOperationInput): Promise<IrreversibleOperationReservation>;
  getIrreversibleOperation?(input: IrreversibleOperationInput): Promise<IrreversibleOperationReservation | undefined>;
  markIrreversibleOperationOutcomeUnknownIfExpired?(
    input: MarkIrreversibleOperationOutcomeUnknownIfExpiredInput,
  ): Promise<MarkIrreversibleOperationOutcomeUnknownIfExpiredResult>;
  reserveConfirmationResumeOperation(
    input: ReserveConfirmationResumeOperationInput,
  ): Promise<ReserveConfirmationResumeOperationResult>;
  completeIrreversibleOperation?(
    input: IrreversibleOperationInput,
    owner: IrreversibleOperationOwner,
    result: Record<string, unknown>,
  ): Promise<IrreversibleOperationCompletion>;
  failIrreversibleOperation?(
    input: IrreversibleOperationInput,
    owner: IrreversibleOperationOwner,
    error: string,
  ): Promise<void>;
}
