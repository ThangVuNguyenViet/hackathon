import type {
  AppendEventIfRunCurrentInput,
  AppendEventIfRunCurrentResult,
  IsRunCommitFenceCurrentInput,
  StoredEvent,
} from './contracts.js';
import type { D1DatabaseLike } from './d1StoreSupport.js';
import { d1RunCommitEligibility } from './d1StoreTurnCommit.js';

export async function isD1RunCommitFenceCurrent(input: {
  db: D1DatabaseLike;
  guard: IsRunCommitFenceCurrentInput;
}): Promise<boolean> {
  const { guard } = input;
  if (
    guard.notAfter !== undefined &&
    !Number.isFinite(Date.parse(guard.notAfter))
  ) {
    return false;
  }
  const eligible = d1RunCommitEligibility(guard);
  const row = await input.db
    .prepare(`SELECT 1 AS current WHERE ${eligible.sql}`)
    .bind(...eligible.bindings)
    .first<{ current: number }>();
  return row?.current === 1;
}

export async function appendD1EventIfRunCurrent(input: {
  db: D1DatabaseLike;
  operation: AppendEventIfRunCurrentInput;
}): Promise<AppendEventIfRunCurrentResult> {
  const { operation } = input;
  const event: StoredEvent = {
    id: `event_${crypto.randomUUID()}`,
    sessionId: operation.sessionId,
    sourceType: operation.sourceType,
    payload: operation.payload,
    createdAt: new Date().toISOString(),
  };
  const eligible = d1RunCommitEligibility(operation);
  const result = await input.db
    .prepare(
      `INSERT INTO conversation_events
       (id, session_id, source_type, payload, created_at)
     SELECT ?, ?, ?, ?, ?
     WHERE ${eligible.sql}`,
    )
    .bind(
      event.id,
      event.sessionId,
      event.sourceType,
      JSON.stringify(event.payload),
      event.createdAt,
      ...eligible.bindings,
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1
    ? { status: 'committed', event }
    : { status: 'stale' };
}
