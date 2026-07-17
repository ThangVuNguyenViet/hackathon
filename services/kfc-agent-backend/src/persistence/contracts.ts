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

export interface ConfirmationPauseRecord {
  requestId: string;
  sessionId: string;
  customerId: string;
  channel: ConversationTurn['channel'];
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

export interface CheckpointIdentifier {
  checkpointNamespace: string;
  checkpointId: string;
  parentCheckpointId: string | null;
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
  | { status: 'reserved'; attempt: number; leaseToken: string; reconciliation: boolean }
  | { status: 'pending' }
  | { status: 'unknown'; lastError: string | null }
  | { status: 'completed'; result: Record<string, unknown> };

export type IrreversibleOperationCompletion =
  | { status: 'completed'; result: Record<string, unknown> }
  | { status: 'lost' };

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
  upsertPendingCustomerTurn(input: PendingCustomerTurnInput): Promise<UpsertPendingCustomerTurnResult>;
  listPendingCustomerTurns(sessionId: string): Promise<PendingCustomerTurn[]>;
  markPendingCustomerTurnClaimed(turnId: string, runId: string): Promise<PendingCustomerTurn>;
  createAgentRun(input: CreateAgentRunInput): Promise<AgentRun>;
  claimAgentRun(input: CreateAgentRunInput): Promise<ClaimAgentRunResult>;
  updateAgentRun(runId: string, patch: AgentRunPatch): Promise<AgentRun>;
  getAgentRun(runId: string): Promise<AgentRun | undefined>;
  listAgentRuns(sessionId: string): Promise<AgentRun[]>;
  linkAgentRunTurn(input: AgentRunTurn): Promise<AgentRunTurn>;
  listAgentRunTurns(runId: string): Promise<AgentRunTurn[]>;
  listCheckpointIdentifiers(sessionId: string): Promise<CheckpointIdentifier[]>;
  getSessionAgentState(sessionId: string): Promise<SessionAgentState>;
  setSessionAgentState(input: SessionAgentStateInput): Promise<SessionAgentState>;
  listDueSessionAgentStates(now: string, limit: number): Promise<SessionAgentState[]>;
  listTurns(sessionId: string): Promise<ConversationTurn[]>;
  appendEvent(sessionId: string, sourceType: string, payload: Record<string, unknown>): Promise<StoredEvent>;
  listEvents(sessionId: string): Promise<StoredEvent[]>;
  findConfirmationPause(requestId: string): Promise<ConfirmationPauseRecord | undefined>;
  searchHistory(sessionId: string, query: string): Promise<HistorySearchResult[]>;
  reserveIrreversibleOperation?(input: IrreversibleOperationInput): Promise<IrreversibleOperationReservation>;
  getIrreversibleOperation?(input: IrreversibleOperationInput): Promise<IrreversibleOperationReservation | undefined>;
  completeIrreversibleOperation?(
    input: IrreversibleOperationInput,
    owner: { attempt: number; leaseToken: string },
    result: Record<string, unknown>,
  ): Promise<IrreversibleOperationCompletion>;
  failIrreversibleOperation?(
    input: IrreversibleOperationInput,
    owner: { attempt: number; leaseToken: string },
    error: string,
  ): Promise<void>;
}
