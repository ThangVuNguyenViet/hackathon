import type {
  ClaimAgentRunExecutionInput,
  ClaimAgentRunExecutionResult,
  RunCommitFence,
} from './contracts.js';
import type { AgentRun } from '../domain/types.js';

export const AGENT_RUN_EXECUTION_LEASE_TTL_MS = 60_000;
export const MAXIMUM_AGENT_RUN_EXECUTION_LEASE_TTL_MS = 5 * 60_000;
export const MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS = 3;

export function assertAgentRunExecutionClaim(
  input: ClaimAgentRunExecutionInput,
): void {
  const claimedAt = canonicalTimestamp(
    input.claimedAt,
    'agent_run_execution_claimed_at_invalid',
  );
  const expiresAt = canonicalTimestamp(
    input.executionLeaseExpiresAt,
    'agent_run_execution_lease_expiry_invalid',
  );
  if (
    expiresAt <= claimedAt ||
    expiresAt - claimedAt > MAXIMUM_AGENT_RUN_EXECUTION_LEASE_TTL_MS
  ) {
    throw new Error('agent_run_execution_lease_window_invalid');
  }
  if (
    input.executionLeaseToken.length < 32 ||
    input.executionLeaseToken.length > 256
  ) {
    throw new Error('agent_run_execution_lease_token_invalid');
  }
}

export function agentRunExecutionFence(
  run: {
    id: string;
    generation: number;
    sessionAuthorityGeneration: number;
    executionAttempt: number;
    executionLeaseToken: string | null;
  },
): Extract<RunCommitFence, { kind: 'agent_run' }> {
  if (
    !Number.isSafeInteger(run.executionAttempt) ||
    run.executionAttempt < 1 ||
    !run.executionLeaseToken
  ) {
    throw new Error('agent_run_execution_lease_missing');
  }
  return {
    kind: 'agent_run',
    runId: run.id,
    generation: run.generation,
    sessionAuthorityGeneration: run.sessionAuthorityGeneration,
    executionAttempt: run.executionAttempt,
    executionLeaseToken: run.executionLeaseToken,
  };
}

export function agentRunExecutionClaimRejection(
  run: AgentRun | undefined,
  now = Date.now(),
): Extract<ClaimAgentRunExecutionResult, { status: 'stale' }> {
  if (!run) return { status: 'stale', reason: 'not_found' };
  const leaseExpiry = run.executionLeaseExpiresAt === null
    ? Number.NaN
    : Date.parse(run.executionLeaseExpiresAt);
  if (
    run.status === 'running' &&
    Number.isFinite(leaseExpiry) &&
    leaseExpiry > now
  ) {
    return { status: 'stale', reason: 'lease_active', run };
  }
  if (
    run.status === 'running' &&
    (
      run.irreversibleSideEffectAt !== null ||
      run.irreversibleToolName !== null
    )
  ) {
    return {
      status: 'stale',
      reason: 'irreversible_outcome_unknown',
      run,
    };
  }
  if (run.executionAttempt >= MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS) {
    return { status: 'stale', reason: 'attempts_exhausted', run };
  }
  return { status: 'stale', reason: 'not_current', run };
}

export function agentRunExecutionReconciliationReason(
  run: Pick<
    AgentRun,
    | 'executionAttempt'
    | 'irreversibleSideEffectAt'
    | 'irreversibleToolName'
  >,
): 'attempts_exhausted' | 'irreversible_outcome_unknown' | null {
  if (
    run.irreversibleSideEffectAt !== null ||
    run.irreversibleToolName !== null
  ) {
    return 'irreversible_outcome_unknown';
  }
  return run.executionAttempt >= MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS
    ? 'attempts_exhausted'
    : null;
}

export function agentRunExecutionReconciliationErrorCode(
  reason: 'attempts_exhausted' | 'irreversible_outcome_unknown',
): 'agent_run_execution_attempts_exhausted' | 'agent_run_outcome_unknown' {
  return reason === 'attempts_exhausted'
    ? 'agent_run_execution_attempts_exhausted'
    : 'agent_run_outcome_unknown';
}

function canonicalTimestamp(value: string, errorCode: string): number {
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new Error(errorCode);
  }
  return timestamp;
}
