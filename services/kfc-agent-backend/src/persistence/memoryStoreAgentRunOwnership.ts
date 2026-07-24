import type {
  AgentRun,
  SessionAgentModelBinding,
  SessionAgentState,
} from '../domain/types.js';
import type {
  AdvanceSessionAgentGenerationInput,
  AdvanceSessionAgentGenerationResult,
  BindSessionAgentModelInput,
  ClaimAgentRunExecutionInput,
  ClaimAgentRunExecutionResult,
  ClaimSessionAgentRunOwnershipInput,
  ClaimSessionAgentRunOwnershipResult,
  SessionAgentStateInput,
  SessionControl,
  UpdateAgentRunIfExecutionCurrentInput,
  UpdateAgentRunIfExecutionCurrentResult,
} from './contracts.js';
import {
  MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS,
  agentRunExecutionClaimRejection,
  agentRunExecutionReconciliationErrorCode,
  agentRunExecutionReconciliationReason,
  assertAgentRunExecutionClaim,
} from './agentRunExecutionLease.js';
import { captureActiveMemorySessionAuthority } from './memoryStoreSessionAuthority.js';

interface MemoryAgentRunState {
  agentRuns: Map<string, AgentRun>;
  sessionAgentStates: Map<string, SessionAgentState>;
  sessionControls: Map<string, SessionControl>;
}

const memoryTimestamp = '2026-07-07T00:00:00.000Z';

export function getMemorySessionAgentState(
  sessionId: string,
  sessionAgentStates: Map<string, SessionAgentState>,
): SessionAgentState {
  const state = sessionAgentStates.get(sessionId) ?? {
    sessionId,
    currentRunId: null,
    generation: 0,
    debounceDeadlineAt: null,
    agentModelBinding: null,
    updatedAt: memoryTimestamp,
  };
  sessionAgentStates.set(sessionId, state);
  return state;
}

export function bindMemorySessionAgentModel(
  input: BindSessionAgentModelInput,
  sessionAgentStates: Map<string, SessionAgentState>,
): SessionAgentModelBinding {
  const current = getMemorySessionAgentState(
    input.sessionId,
    sessionAgentStates,
  );
  if (current.agentModelBinding) {
    return structuredClone(current.agentModelBinding);
  }
  const binding = structuredClone(input.binding);
  sessionAgentStates.set(input.sessionId, {
    ...current,
    agentModelBinding: binding,
    updatedAt: input.updatedAt ?? memoryTimestamp,
  });
  return structuredClone(binding);
}

export function setMemorySessionAgentState(
  input: SessionAgentStateInput,
  sessionAgentStates: Map<string, SessionAgentState>,
): SessionAgentState {
  const state = {
    ...input,
    updatedAt: input.updatedAt ?? memoryTimestamp,
  };
  sessionAgentStates.set(input.sessionId, state);
  return state;
}

export function listDueMemorySessionAgentStates(
  now: string,
  limit: number,
  sessionAgentStates: Map<string, SessionAgentState>,
): SessionAgentState[] {
  return [...sessionAgentStates.values()]
    .filter(
      (state) =>
        state.currentRunId === null &&
        state.debounceDeadlineAt !== null &&
        state.debounceDeadlineAt <= now,
    )
    .sort(
      (left, right) =>
        String(left.debounceDeadlineAt).localeCompare(
          String(right.debounceDeadlineAt),
        ) || left.sessionId.localeCompare(right.sessionId),
    )
    .slice(0, limit);
}

export function advanceMemorySessionAgentGeneration(
  input: AdvanceSessionAgentGenerationInput,
  storage: MemoryAgentRunState,
): AdvanceSessionAgentGenerationResult {
  const current = sessionState(input.sessionId, storage);
  const state: SessionAgentState = {
    ...current,
    currentRunId: null,
    generation: current.generation + 1,
    debounceDeadlineAt: input.debounceDeadlineAt,
    updatedAt: input.updatedAt ?? memoryTimestamp,
  };
  storage.sessionAgentStates.set(input.sessionId, state);
  return {
    state: structuredClone(state),
    invalidatedRunId: current.currentRunId,
  };
}

export function claimMemorySessionAgentRunOwnership(
  input: ClaimSessionAgentRunOwnershipInput,
  storage: MemoryAgentRunState,
): ClaimSessionAgentRunOwnershipResult {
  const current = sessionState(input.sessionId, storage);
  const run = storage.agentRuns.get(input.runId);
  if (
    current.generation !== input.expectedGeneration ||
    current.currentRunId !== input.expectedCurrentRunId ||
    current.debounceDeadlineAt !== input.expectedDebounceDeadlineAt ||
    run?.sessionId !== input.sessionId ||
    run.generation !== input.expectedGeneration ||
    run.status !== 'scheduled' ||
    captureActiveMemorySessionAuthority(
      storage.sessionControls,
      input.sessionId,
    ) !== run.sessionAuthorityGeneration
  ) {
    return { status: 'stale', state: structuredClone(current) };
  }
  const state: SessionAgentState = {
    ...current,
    currentRunId: input.runId,
    debounceDeadlineAt: null,
    updatedAt: input.updatedAt ?? memoryTimestamp,
  };
  storage.sessionAgentStates.set(input.sessionId, state);
  return { status: 'claimed', state: structuredClone(state) };
}

export function claimMemoryAgentRunExecution(
  input: ClaimAgentRunExecutionInput,
  storage: MemoryAgentRunState,
  now = Date.now(),
): ClaimAgentRunExecutionResult {
  assertAgentRunExecutionClaim(input);
  const run = storage.agentRuns.get(input.runId);
  const state = sessionState(input.sessionId, storage);
  const activeAuthority = captureActiveMemorySessionAuthority(
    storage.sessionControls,
    input.sessionId,
  );
  const ownerCurrent =
    run?.sessionId === input.sessionId &&
    run.generation === input.generation &&
    run.sessionAuthorityGeneration === input.sessionAuthorityGeneration &&
    state.generation === input.generation &&
    state.currentRunId === input.runId &&
    activeAuthority === input.sessionAuthorityGeneration;
  const expiredRunning =
    run?.status === 'running' &&
    run.executionLeaseExpiresAt !== null &&
    Date.parse(run.executionLeaseExpiresAt) <= now;
  const reconciliationReason =
    ownerCurrent && expiredRunning && run
      ? agentRunExecutionReconciliationReason(run)
      : null;
  if (run && reconciliationReason) {
    const reconciled: AgentRun = {
      ...run,
      status: 'reconciliation_required',
      deliveryStatus: 'not_applicable',
      errorCode: agentRunExecutionReconciliationErrorCode(reconciliationReason),
      errorMessage:
        reconciliationReason === 'attempts_exhausted'
          ? 'Agent run execution attempts exhausted'
          : 'Irreversible provider outcome requires reconciliation',
      completedAt: input.claimedAt,
      updatedAt: input.claimedAt,
    };
    storage.agentRuns.set(run.id, reconciled);
    return {
      status: 'reconciliation_required',
      reason: reconciliationReason,
      run: structuredClone(reconciled),
    };
  }
  const scheduledClaim =
    run?.status === 'scheduled' &&
    run.executionAttempt === 0 &&
    run.executionLeaseToken === null &&
    run.executionLeaseExpiresAt === null;
  const expiredReclaim =
    run?.status === 'running' &&
    run.irreversibleSideEffectAt === null &&
    run.irreversibleToolName === null &&
    run.executionLeaseExpiresAt !== null &&
    Date.parse(run.executionLeaseExpiresAt) <= now;
  if (
    run?.sessionId !== input.sessionId ||
    run.generation !== input.generation ||
    run.sessionAuthorityGeneration !== input.sessionAuthorityGeneration ||
    run.executionAttempt >= MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS ||
    (!scheduledClaim && !expiredReclaim) ||
    Date.parse(input.executionLeaseExpiresAt) <= now ||
    state.generation !== input.generation ||
    state.currentRunId !== input.runId ||
    activeAuthority !== input.sessionAuthorityGeneration
  ) {
    const rejection = agentRunExecutionClaimRejection(run, now);
    return rejection.run
      ? { ...rejection, run: structuredClone(rejection.run) }
      : rejection;
  }
  const claimed: AgentRun = {
    ...run,
    status: 'running',
    executionAttempt: run.executionAttempt + 1,
    executionLeaseToken: input.executionLeaseToken,
    executionLeaseExpiresAt: input.executionLeaseExpiresAt,
    startedAt: run.startedAt ?? input.claimedAt,
    updatedAt: input.claimedAt,
  };
  storage.agentRuns.set(run.id, claimed);
  return { status: 'claimed', run: structuredClone(claimed) };
}

export function updateMemoryAgentRunIfExecutionCurrent(
  input: UpdateAgentRunIfExecutionCurrentInput,
  storage: MemoryAgentRunState,
  now = Date.now(),
): UpdateAgentRunIfExecutionCurrentResult {
  const run = storage.agentRuns.get(input.fence.runId);
  const state = sessionState(input.sessionId, storage);
  if (
    run?.sessionId !== input.sessionId ||
    run.generation !== input.fence.generation ||
    run.sessionAuthorityGeneration !== input.fence.sessionAuthorityGeneration ||
    run.status !== 'running' ||
    run.executionAttempt !== input.fence.executionAttempt ||
    run.executionLeaseToken !== input.fence.executionLeaseToken ||
    run.executionLeaseExpiresAt === null ||
    Date.parse(run.executionLeaseExpiresAt) <= now ||
    state.currentRunId !== input.fence.runId ||
    state.generation !== input.fence.generation ||
    captureActiveMemorySessionAuthority(
      storage.sessionControls,
      input.sessionId,
    ) !== input.fence.sessionAuthorityGeneration
  ) {
    return {
      status: 'stale',
      ...(run === undefined ? {} : { run: structuredClone(run) }),
    };
  }
  const updated: AgentRun = {
    ...run,
    ...input.patch,
    updatedAt: new Date(now).toISOString(),
  };
  storage.agentRuns.set(run.id, updated);
  return { status: 'committed', run: structuredClone(updated) };
}

function sessionState(
  sessionId: string,
  storage: MemoryAgentRunState,
): SessionAgentState {
  return getMemorySessionAgentState(sessionId, storage.sessionAgentStates);
}
