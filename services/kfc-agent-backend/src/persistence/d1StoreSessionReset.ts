import {
  SessionResetConflictError,
  type SessionResetHook,
} from './contracts.js';
import type {
  D1DatabaseLike,
} from './d1StoreSupport.js';
import {
  nonAgentTextDeliverySessionBindingDigest,
} from './nonAgentTextDelivery.js';

export async function resetD1Session(input: {
  db: D1DatabaseLike;
  sessionId: string;
  resetHook?: SessionResetHook;
}): Promise<void> {
  if (!input.db.batch) {
    throw new Error('d1_atomic_session_reset_unavailable');
  }
  const generationRow = await input.db.prepare(
    `INSERT INTO confirmation_pause_sessions (session_id, generation)
     VALUES (?, 0)
     ON CONFLICT(session_id) DO UPDATE SET
       generation = confirmation_pause_sessions.generation
     RETURNING generation`,
  ).bind(input.sessionId).first<{ generation: number }>();
  if (!generationRow) {
    throw new Error('confirmation_pause_generation_missing');
  }
  const expectedGeneration = generationRow.generation;
  const nextGeneration = expectedGeneration + 1;
  const resetAt = new Date().toISOString();
  const sessionBindingDigest =
    await nonAgentTextDeliverySessionBindingDigest(input.sessionId);
  const resetFenceSql = `EXISTS (
    SELECT 1 FROM confirmation_pause_sessions
    WHERE session_id = ? AND generation = ?
  )`;
  const statements = [
    input.db
      .prepare(
        `UPDATE confirmation_pause_sessions
         SET generation = generation + 1
         WHERE session_id = ?
           AND generation = ?
           AND NOT EXISTS (
             SELECT 1
             FROM irreversible_operations
             WHERE session_id = ?
               AND operation = 'confirmation_resume'
               AND NOT (
                 status = 'completed'
                 AND result_json IS NOT NULL
                 AND completed_at IS NOT NULL
               )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM non_agent_text_deliveries
             WHERE session_binding_digest = ?
               AND status = 'sending'
               AND julianday(sending_lease_expires_at) > julianday(?)
           )`,
      )
      .bind(
        input.sessionId,
        expectedGeneration,
        input.sessionId,
        sessionBindingDigest,
        resetAt,
      ),
    input.db
      .prepare(
        `UPDATE non_agent_text_deliveries
         SET status = 'confirmed_not_sent',
             outcome_code = 'non_agent_delivery_abandoned_by_reset',
             updated_at = ?
         WHERE session_binding_digest = ?
           AND status = 'pending'
           AND ${resetFenceSql}`,
      )
      .bind(
        resetAt,
        sessionBindingDigest,
        input.sessionId,
        nextGeneration,
      ),
    input.db
      .prepare(
        `UPDATE non_agent_text_deliveries
         SET status = 'outcome_unknown',
             sending_lease_expires_at = NULL,
             outcome_code =
               'non_agent_delivery_reset_sending_lease_expired',
             updated_at = ?
         WHERE session_binding_digest = ?
           AND status = 'sending'
           AND julianday(sending_lease_expires_at) <= julianday(?)
           AND ${resetFenceSql}`,
      )
      .bind(
        resetAt,
        sessionBindingDigest,
        resetAt,
        input.sessionId,
        nextGeneration,
      ),
    input.db.prepare(
      `DELETE FROM verified_refs
       WHERE session_id = ? AND ${resetFenceSql}`,
    ).bind(input.sessionId, input.sessionId, nextGeneration),
    input.db.prepare(
      `DELETE FROM customer_run_events
       WHERE run_id IN (
         SELECT id FROM customer_runs WHERE session_id = ?
       ) AND ${resetFenceSql}`,
    ).bind(input.sessionId, input.sessionId, nextGeneration),
    input.db.prepare(
      `DELETE FROM agent_run_turns
       WHERE run_id IN (
         SELECT id FROM agent_runs WHERE session_id = ?
       ) AND ${resetFenceSql}`,
    ).bind(input.sessionId, input.sessionId, nextGeneration),
    input.db.prepare(
      `DELETE FROM customer_runs
       WHERE session_id = ? AND ${resetFenceSql}`,
    ).bind(input.sessionId, input.sessionId, nextGeneration),
    input.db.prepare(
      `DELETE FROM pending_customer_turns
       WHERE session_id = ? AND ${resetFenceSql}`,
    ).bind(input.sessionId, input.sessionId, nextGeneration),
    input.db.prepare(
      `DELETE FROM agent_runs
       WHERE session_id = ? AND ${resetFenceSql}`,
    ).bind(input.sessionId, input.sessionId, nextGeneration),
    input.db.prepare(
      `DELETE FROM session_agent_state
       WHERE session_id = ? AND ${resetFenceSql}`,
    ).bind(input.sessionId, input.sessionId, nextGeneration),
    input.db.prepare(
      `DELETE FROM webhook_deliveries
       WHERE session_id = ? AND ${resetFenceSql}`,
    ).bind(input.sessionId, input.sessionId, nextGeneration),
    input.db.prepare(
      `DELETE FROM irreversible_operations
       WHERE session_id = ?
         AND operation <> 'confirmation_resume'
         AND ${resetFenceSql}`,
    ).bind(input.sessionId, input.sessionId, nextGeneration),
    input.db.prepare(
      `DELETE FROM conversation_turns
       WHERE session_id = ? AND ${resetFenceSql}`,
    ).bind(input.sessionId, input.sessionId, nextGeneration),
    input.db.prepare(
      `DELETE FROM conversation_events
       WHERE session_id = ? AND ${resetFenceSql}`,
    ).bind(input.sessionId, input.sessionId, nextGeneration),
    input.db.prepare(
      `DELETE FROM dashboard_events
       WHERE session_id = ? AND ${resetFenceSql}`,
    ).bind(input.sessionId, input.sessionId, nextGeneration),
    input.db.prepare(
      `INSERT INTO session_controls (
         session_id, agent_mode, assigned_agent_id,
         session_authority_generation, updated_at
       )
       SELECT ?, 'ai_active', NULL,
              COALESCE((
                SELECT session_authority_generation
                FROM session_controls
                WHERE session_id = ?
              ), 0) + 1,
              ?
       WHERE ${resetFenceSql}
       ON CONFLICT(session_id) DO UPDATE SET
         agent_mode = excluded.agent_mode,
         assigned_agent_id = excluded.assigned_agent_id,
         session_authority_generation =
           session_controls.session_authority_generation + 1,
         updated_at = excluded.updated_at
       WHERE ${resetFenceSql}`,
    ).bind(
      input.sessionId,
      input.sessionId,
      resetAt,
      input.sessionId,
      nextGeneration,
      input.sessionId,
      nextGeneration,
    ),
  ];
  const results = await input.db.batch(statements);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
    throw new SessionResetConflictError();
  }
  await input.resetHook?.(input.sessionId);
}
