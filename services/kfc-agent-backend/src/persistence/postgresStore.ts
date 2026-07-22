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
import {
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
  type CustomerRun,
  type CustomerRunEvent,
} from '../customerRuns/contracts.js';
import { PostgresStoreAgentRunTextDeliveryOperations } from './postgresStoreAgentRunTextDeliveryOperations.js';

export class PostgresStore
  extends PostgresStoreAgentRunTextDeliveryOperations
  implements ConversationStore {}

export async function createPostgresPersistence(input: {
  databaseUrl: string;
}): Promise<{
  pool: Pool;
  store: PostgresStore;
  dashboardEvents: DashboardEvent[];
}> {
  const pool = new Pool({ connectionString: input.databaseUrl });
  const store = new PostgresStore(pool);
  await store.initialize();
  return {
    pool,
    store,
    dashboardEvents: await store.listDashboardEvents(),
  };
}
