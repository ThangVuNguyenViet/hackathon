import type {
  AgentMode,
  ConversationProfile,
  DashboardEvent,
  ConversationTurn,
  MonitorSessionIntelligence,
} from "../domain/types.js";
import {
  parseMonitorSessionIntelligencePayload,
  preserveMonitorContext,
} from "../monitor/sessionIntelligence.js";
import type {
  AgentRun,
  AgentRunTurn,
  PendingCustomerTurn,
  SessionAgentState,
} from "../domain/types.js";
import type {
  AgentRunPatch,
  AppendConversationTurnInput,
  ConversationStore,
  CreateAgentRunInput,
  HistorySearchResult,
  IrreversibleOperationInput,
  IrreversibleOperationCompletion,
  IrreversibleOperationReservation,
  ImportedConversationTurn,
  ImportedConversationTurnResult,
  PendingCustomerTurnInput,
  ReserveWebhookDeliveryInput,
  ReserveWebhookDeliveryResult,
  SessionControl,
  SessionResetHook,
  SessionAgentStateInput,
  StoredEvent,
  UpsertPendingCustomerTurnResult,
  WebhookDelivery,
  WebhookDeliveryChannel,
  AppendCustomerRunEventInput,
  CustomerRunPatch,
} from "./memoryStore.js";
import { confirmationPauseFromEvent, type ConfirmationPauseRecord } from "./memoryStore.js";
import {
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
  type CustomerRun,
  type CustomerRunEvent,
} from "../customerRuns/contracts.js";
import { D1StoreAgentOperations } from './d1StoreAgentOperations.js';
export { D1DatabaseLike, DashboardSessionSummary } from './d1StoreSupport.js';

export class D1Store extends D1StoreAgentOperations implements ConversationStore {}
