import type { PoolClient } from 'pg';
import type { VerifiedRefRecord } from '../domain/verifiedRef.js';
import type {
  CommitAssistantTurnInput,
  CommitAssistantTurnResult,
  CommitAssistantTurnIfRunCurrentInput,
  CommitAssistantTurnIfRunCurrentResult,
} from './contracts.js';
import type { Queryable } from './postgresStoreSupport.js';
import {
  prepareAssistantTurnCommit,
} from './runCommitPreparation.js';
import {
  verifiedRefStorageValues,
} from './verifiedRef.js';
import {
  isConnectablePostgres,
  lockPostgresRunCommitOwner,
} from './postgresStoreRunOwner.js';
import {
  lockPostgresSessionAuthority,
} from './postgresStoreSessionAuthority.js';

export async function commitPostgresAssistantTurnIfRunCurrent(input: {
  db: Queryable;
  operation: CommitAssistantTurnIfRunCurrentInput;
}): Promise<CommitAssistantTurnIfRunCurrentResult> {
  return commitPostgresAssistantTurnOperation(input);
}

export async function commitPostgresAssistantTurn(input: {
  db: Queryable;
  operation: CommitAssistantTurnInput;
}): Promise<CommitAssistantTurnResult> {
  const result = await commitPostgresAssistantTurnOperation(input);
  if (result.status === 'stale') {
    throw new Error('postgres_unfenced_agent_turn_commit_stale');
  }
  return result;
}

async function commitPostgresAssistantTurnOperation(input: {
  db: Queryable;
  operation: CommitAssistantTurnInput | CommitAssistantTurnIfRunCurrentInput;
}): Promise<CommitAssistantTurnIfRunCurrentResult> {
  if (!isConnectablePostgres(input.db)) {
    throw new Error('postgres_atomic_agent_turn_commit_unavailable');
  }
  const prepared = prepareAssistantTurnCommit(input.operation);
  const client = await input.db.connect();
  try {
    await client.query('BEGIN');
    if ('fence' in input.operation) {
      const operation = input.operation;
      if (!await lockPostgresRunCommitOwner(client, {
        sessionId: operation.stateEvent.sessionId,
        fence: operation.fence,
        ...(operation.notAfter === undefined
          ? {}
          : { notAfter: operation.notAfter }),
      })) {
        await client.query('ROLLBACK');
        return { status: 'stale' };
      }
    } else if (prepared.sdkSessionItems.length > 0) {
      await lockPostgresSessionAuthority(
        client,
        prepared.turn.sessionId,
      );
    }
    const sessionGeneration =
      prepared.verifiedRefs.length > 0
        ? await lockVerifiedRefGeneration(
            client,
            prepared.turn.sessionId,
          )
        : undefined;
    for (const record of prepared.verifiedRefs) {
      await insertVerifiedRef(
        client,
        record,
        sessionGeneration!,
      );
    }
    await insertEvent(client, prepared.stateEvent);
    await client.query(
      `INSERT INTO conversation_turns (
         id, session_id, channel, role, text, external_message_id,
         external_user_id, delivery_status, metadata, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
       )`,
      [
        prepared.turn.id,
        prepared.turn.sessionId,
        prepared.turn.channel,
        prepared.turn.role,
        prepared.turn.text,
        prepared.turn.externalMessageId,
        prepared.turn.externalUserId,
        prepared.turn.deliveryStatus,
        prepared.turn.metadata,
        prepared.turn.createdAt,
      ],
    );
    await insertEvent(client, prepared.turnEvent);
    if (prepared.auditEvent) await insertEvent(client, prepared.auditEvent);
    if (prepared.sdkSessionItems.length > 0) {
      await client.query(
        `INSERT INTO agent_session_items (session_id, item_json)
         SELECT $1, item::jsonb
         FROM unnest($2::text[]) WITH ORDINALITY
           AS values_to_insert(item, ordinal)
         ORDER BY ordinal`,
        [
          prepared.turn.sessionId,
          prepared.sdkSessionItems.map((item) => JSON.stringify(item)),
        ],
      );
    }
    await client.query('COMMIT');
    return { status: 'committed', ...structuredClone(prepared) };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original error; an uncertain transaction is fail-closed.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function lockVerifiedRefGeneration(
  client: PoolClient,
  sessionId: string,
): Promise<number> {
  const result = await client.query<{ generation: number }>(
    `INSERT INTO confirmation_pause_sessions (session_id, generation)
     VALUES ($1, 0)
     ON CONFLICT (session_id) DO UPDATE SET
       generation = confirmation_pause_sessions.generation
     RETURNING generation`,
    [sessionId],
  );
  const generation = result.rows[0]?.generation;
  if (generation === undefined) {
    throw new Error('verified_ref_session_generation_missing');
  }
  return generation;
}

async function insertVerifiedRef(
  client: PoolClient,
  record: VerifiedRefRecord,
  sessionGeneration: number,
): Promise<void> {
  await client.query(
    `INSERT INTO verified_refs (
       schema_version, ref_id, kind, session_id, session_generation,
       customer_id, channel, authenticated_subject,
       authentication_evidence_ref, verified_revision, lifecycle,
       payload_json, created_at, expires_at, claimed_use_id, claimed_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14, $15, $16
     )`,
    [...verifiedRefStorageValues(record, sessionGeneration)],
  );
}

async function insertEvent(
  client: PoolClient,
  event: {
    id: string;
    sessionId: string;
    sourceType: string;
    payload: Record<string, unknown>;
    createdAt: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO conversation_events
       (id, session_id, source_type, payload, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      event.id,
      event.sessionId,
      event.sourceType,
      event.payload,
      event.createdAt,
    ],
  );
}
