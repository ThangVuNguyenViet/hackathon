import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type {
  AgentMode,
  AgentRun,
  AgentRunTurn,
  ConversationProfile,
  DashboardEvent,
  ConversationTurn,
  PendingCustomerTurn,
  SessionAgentState,
} from '../domain/types.js';
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
} from './memoryStore.js';
import { confirmationPauseFromEvent, type ConfirmationPauseRecord } from './memoryStore.js';
import {
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
  type CustomerRun,
  type CustomerRunEvent,
} from '../customerRuns/contracts.js';
import { PostgresCheckpointSaver } from './postgresCheckpointSaver.js';
import { PostgresStoreAgentOperations } from './postgresStoreAgentOperations.js';

export class PostgresStore extends PostgresStoreAgentOperations implements ConversationStore {}

export async function createPostgresPersistence(input: { databaseUrl: string }): Promise<{
  pool: Pool;
  store: PostgresStore;
  checkpointer: PostgresCheckpointSaver;
  dashboardEvents: DashboardEvent[];
}> {
  const pool = new Pool({ connectionString: input.databaseUrl });
  const checkpointer = new PostgresCheckpointSaver(pool);
  const store = new PostgresStore(pool, (sessionId) => checkpointer.deleteThread(sessionId));
  await checkpointer.initialize();
  await store.initialize();
  return {
    pool,
    store,
    checkpointer,
    dashboardEvents: await store.listDashboardEvents(),
  };
}
