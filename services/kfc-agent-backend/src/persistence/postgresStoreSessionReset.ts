import {
  SessionResetConflictError,
  type SessionControl,
  type SessionResetHook,
} from './contracts.js';
import {
  sessionControlFromRow,
  type Queryable,
  type SessionControlRow,
} from './postgresStoreSupport.js';
import { lockPostgresSessionAuthority } from './postgresStoreSessionAuthority.js';
import { isConnectablePostgres } from './postgresStoreRunOwner.js';
import { nonAgentTextDeliverySessionBindingDigest } from './nonAgentTextDelivery.js';

export async function resetPostgresSession(input: {
  db: Queryable;
  sessionId: string;
  sessionResetHook?: SessionResetHook;
}): Promise<SessionControl> {
  if (!isConnectablePostgres(input.db)) {
    throw new Error('postgres_atomic_session_reset_unavailable');
  }
  const client = await input.db.connect();
  let resetControl: SessionControl | undefined;
  try {
    await client.query('BEGIN');
    await lockPostgresSessionAuthority(client, input.sessionId);
    const currentControl = await client.query<SessionControlRow>(
      `SELECT *
       FROM session_controls
       WHERE session_id = $1
       FOR UPDATE`,
      [input.sessionId],
    );
    const nextAuthorityGeneration =
      Number(currentControl.rows[0]?.session_authority_generation ?? 0) + 1;
    const resetAt = new Date().toISOString();
    const sessionBindingDigest = await nonAgentTextDeliverySessionBindingDigest(
      input.sessionId,
    );
    await client.query(
      `INSERT INTO session_generations (session_id, generation)
       VALUES ($1, 0)
       ON CONFLICT (session_id) DO NOTHING`,
      [input.sessionId],
    );
    await client.query(
      `SELECT generation
       FROM session_generations
       WHERE session_id = $1
       FOR UPDATE`,
      [input.sessionId],
    );
    await client.query(
      `UPDATE non_agent_text_deliveries
       SET status = 'outcome_unknown',
           sending_lease_expires_at = NULL,
           provider_message_id = NULL,
           outcome_code =
             'non_agent_delivery_reset_sending_lease_expired',
           updated_at = $2
       WHERE session_binding_digest = $1
         AND status = 'sending'
         AND sending_lease_expires_at <= $2::timestamptz`,
      [sessionBindingDigest, resetAt],
    );
    await client.query(
      `UPDATE non_agent_text_deliveries
       SET status = 'confirmed_not_sent',
           outcome_code = 'non_agent_delivery_abandoned_by_reset',
           updated_at = $2
       WHERE session_binding_digest = $1
         AND status = 'pending'`,
      [sessionBindingDigest, resetAt],
    );
    const unresolved = await client.query<{ unresolved: boolean }>(
      `SELECT EXISTS (
           SELECT 1
           FROM non_agent_text_deliveries
           WHERE session_binding_digest = $1
             AND status = 'sending'
         ) AS unresolved`,
      [sessionBindingDigest],
    );
    if (unresolved.rows[0]?.unresolved !== false) {
      throw new SessionResetConflictError();
    }
    await client.query(
      `UPDATE session_generations
       SET generation = generation + 1
       WHERE session_id = $1`,
      [input.sessionId],
    );
    await client.query(
      `WITH session_customer_runs AS (
         SELECT id FROM customer_runs WHERE session_id = $1
       ), session_agent_runs AS (
         SELECT id FROM agent_runs WHERE session_id = $1
       ), deleted_customer_events AS (
         DELETE FROM customer_run_events
         WHERE run_id IN (SELECT id FROM session_customer_runs)
       ), deleted_agent_links AS (
         DELETE FROM agent_run_turns
         WHERE run_id IN (SELECT id FROM session_agent_runs)
       ), deleted_customer_runs AS (
         DELETE FROM customer_runs WHERE session_id = $1
       ), deleted_pending_turns AS (
         DELETE FROM pending_customer_turns WHERE session_id = $1
       ), deleted_agent_runs AS (
         DELETE FROM agent_runs WHERE session_id = $1
       ), deleted_agent_state AS (
         DELETE FROM session_agent_state WHERE session_id = $1
      ), deleted_verified_refs AS (
         DELETE FROM verified_refs WHERE session_id = $1
       ), deleted_deliveries AS (
         DELETE FROM webhook_deliveries
         WHERE session_id = $1
       ), deleted_turns AS (
         DELETE FROM conversation_turns WHERE session_id = $1
       ), deleted_events AS (
         DELETE FROM conversation_events WHERE session_id = $1
       ), deleted_irreversible_operations AS (
         DELETE FROM irreversible_operations
         WHERE session_id = $1
       )
       DELETE FROM dashboard_events WHERE session_id = $1`,
      [input.sessionId],
    );
    const control = await client.query<SessionControlRow>(
      `INSERT INTO session_controls (
         session_id, agent_mode, assigned_agent_id,
         session_authority_generation, updated_at
       ) VALUES ($1, 'ai_active', NULL, $2, $3)
       ON CONFLICT (session_id) DO UPDATE SET
         agent_mode = EXCLUDED.agent_mode,
         assigned_agent_id = EXCLUDED.assigned_agent_id,
         session_authority_generation =
           EXCLUDED.session_authority_generation,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [input.sessionId, nextAuthorityGeneration, resetAt],
    );
    if (!control.rows[0]) {
      throw new Error('postgres_session_reset_authority_missing');
    }
    resetControl = sessionControlFromRow(control.rows[0]);
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure. A broken rollback remains fail-closed.
    }
    throw error;
  } finally {
    client.release();
  }

  await input.sessionResetHook?.(input.sessionId);
  if (!resetControl) {
    throw new Error('postgres_session_reset_authority_missing');
  }
  return resetControl;
}
