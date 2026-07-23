import type { IsRunCommitFenceCurrentInput } from './contracts.js';
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
