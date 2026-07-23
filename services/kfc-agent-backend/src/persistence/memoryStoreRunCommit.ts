import type {
  AgentRun,
  ConversationTurn,
  SessionAgentState,
} from '../domain/types.js';
import type { CustomerRun } from '../customerRuns/contracts.js';
import type {
  CommitAssistantTurnIfRunCurrentInput,
  CommitAssistantTurnIfRunCurrentResult,
  CommitAssistantTurnInput,
  CommitAssistantTurnResult,
  IrreversibleOperationInput,
  IsRunCommitFenceCurrentInput,
  SessionControl,
} from './contracts.js';
import type { MemoryIrreversibleOperationRecord } from './memoryStoreIrreversibleOperations.js';
import {
  memoryVerifiedRefStorageSnapshot,
  type MemoryVerifiedRefStorageSnapshot,
} from './memoryStoreVerifiedRefOperations.js';
import { prepareAssistantTurnCommit } from './runCommitPreparation.js';
import type { PackStateEnvelope } from '../runtime/businessPack.js';

interface MemoryRunCommitState {
  customerRuns: ReadonlyMap<string, CustomerRun>;
  agentRuns: ReadonlyMap<string, AgentRun>;
  sessionAgentStates: ReadonlyMap<string, SessionAgentState>;
  irreversibleOperations: ReadonlyMap<
    string,
    MemoryIrreversibleOperationRecord
  >;
  sessionControls: ReadonlyMap<string, SessionControl>;
}

interface MemoryRunCommitGuardState extends MemoryRunCommitState {
  guard: IsRunCommitFenceCurrentInput;
  now: number;
}

export function commitMemoryAssistantTurnIfRunCurrent(input: {
  operation: CommitAssistantTurnIfRunCurrentInput;
  state: MemoryRunCommitState;
  sessionGenerations: ReadonlyMap<string, number>;
  verifiedRefs: Map<string, MemoryVerifiedRefStorageSnapshot>;
  turns: ConversationTurn[];
  packStates: Map<string, PackStateEnvelope>;
  now?: () => number;
}): CommitAssistantTurnIfRunCurrentResult {
  const now = input.now?.() ?? Date.now();
  const notAfter = input.operation.notAfter;
  if (
    notAfter !== undefined &&
    (!Number.isFinite(Date.parse(notAfter)) || Date.parse(notAfter) <= now)
  ) {
    return { status: 'stale' };
  }
  if (
    !memoryRunCommitFenceIsCurrent({
      guard: {
        sessionId: input.operation.assistantTurn.sessionId,
        fence: input.operation.fence,
        ...(notAfter === undefined ? {} : { notAfter }),
      },
      ...input.state,
      now,
    })
  ) {
    return { status: 'stale' };
  }
  const ordinal =
    input.turns
      .filter(
        (turn) => turn.sessionId === input.operation.assistantTurn.sessionId,
      )
      .reduce((maximum, turn) => Math.max(maximum, turn.ordinal), 0) + 1;
  const prepared = prepareAssistantTurnCommit(
    input.operation,
    new Date(now),
    ordinal,
  );
  if (
    input.operation.packState &&
    input.operation.packState.sessionId !== prepared.turn.sessionId
  ) {
    throw new Error('agent_turn_commit_pack_state_session_mismatch');
  }
  const sessionGeneration =
    input.sessionGenerations.get(prepared.turn.sessionId) ?? 0;
  for (const record of prepared.verifiedRefs) {
    if (input.verifiedRefs.has(record.ref.id)) {
      throw new Error('verified_ref_id_collision');
    }
  }
  for (const record of prepared.verifiedRefs) {
    input.verifiedRefs.set(
      record.ref.id,
      memoryVerifiedRefStorageSnapshot(record, sessionGeneration),
    );
  }
  if (input.operation.packState) {
    const { envelope } = input.operation.packState;
    input.packStates.set(
      `${prepared.turn.sessionId}\u0000${envelope.packRef.packId}\u0000${envelope.packRef.version}`,
      structuredClone(envelope),
    );
  }
  input.turns.push(prepared.turn);
  return {
    status: 'committed',
    ...structuredClone(prepared),
  };
}

export function commitMemoryAssistantTurn(input: {
  operation: CommitAssistantTurnInput;
  sessionGenerations: ReadonlyMap<string, number>;
  verifiedRefs: Map<string, MemoryVerifiedRefStorageSnapshot>;
  turns: ConversationTurn[];
  packStates: Map<string, PackStateEnvelope>;
  now?: () => number;
}): CommitAssistantTurnResult {
  const now = input.now?.() ?? Date.now();
  const ordinal =
    input.turns
      .filter(
        (turn) => turn.sessionId === input.operation.assistantTurn.sessionId,
      )
      .reduce((maximum, turn) => Math.max(maximum, turn.ordinal), 0) + 1;
  const prepared = prepareAssistantTurnCommit(
    input.operation,
    new Date(now),
    ordinal,
  );
  assertPackStateSession(input.operation, prepared.turn.sessionId);
  const sessionGeneration =
    input.sessionGenerations.get(prepared.turn.sessionId) ?? 0;
  for (const record of prepared.verifiedRefs) {
    if (input.verifiedRefs.has(record.ref.id)) {
      throw new Error('verified_ref_id_collision');
    }
  }

  for (const record of prepared.verifiedRefs) {
    input.verifiedRefs.set(
      record.ref.id,
      memoryVerifiedRefStorageSnapshot(record, sessionGeneration),
    );
  }
  writeMemoryPackState(
    input.packStates,
    prepared.turn.sessionId,
    input.operation.packState,
  );
  input.turns.push(prepared.turn);
  return { status: 'committed', ...structuredClone(prepared) };
}

function assertPackStateSession(
  operation: CommitAssistantTurnInput | CommitAssistantTurnIfRunCurrentInput,
  turnSessionId: string,
): void {
  if (operation.packState && operation.packState.sessionId !== turnSessionId) {
    throw new Error('agent_turn_commit_pack_state_session_mismatch');
  }
}

function writeMemoryPackState(
  packStates: Map<string, PackStateEnvelope>,
  sessionId: string,
  packState: CommitAssistantTurnInput['packState'],
): void {
  if (!packState) return;
  const { envelope } = packState;
  packStates.set(
    `${sessionId}\u0000${envelope.packRef.packId}\u0000${envelope.packRef.version}`,
    structuredClone(envelope),
  );
}

export function memoryRunCommitFenceIsCurrent(
  input: MemoryRunCommitGuardState,
): boolean {
  const { guard } = input;
  if (
    guard.notAfter !== undefined &&
    (!Number.isFinite(Date.parse(guard.notAfter)) ||
      Date.parse(guard.notAfter) <= input.now)
  ) {
    return false;
  }
  const control = input.sessionControls.get(guard.sessionId);
  const authorityGeneration = control?.sessionAuthorityGeneration ?? 0;
  if (
    (control?.agentMode ?? 'ai_active') !== 'ai_active' ||
    authorityGeneration !== guard.fence.sessionAuthorityGeneration
  ) {
    return false;
  }
  switch (guard.fence.kind) {
    case 'agent_run': {
      const state = input.sessionAgentStates.get(guard.sessionId);
      const run = input.agentRuns.get(guard.fence.runId);
      return Boolean(
        state &&
        state.currentRunId === guard.fence.runId &&
        state.generation === guard.fence.generation &&
        run &&
        run.sessionId === guard.sessionId &&
        run.generation === guard.fence.generation &&
        run.sessionAuthorityGeneration === authorityGeneration &&
        run.status === 'running' &&
        run.executionAttempt === guard.fence.executionAttempt &&
        run.executionLeaseToken === guard.fence.executionLeaseToken &&
        run.executionLeaseExpiresAt !== null &&
        Date.parse(run.executionLeaseExpiresAt) > input.now,
      );
    }
    case 'customer_run': {
      const run = input.customerRuns.get(guard.fence.runId);
      return Boolean(
        run &&
        run.sessionId === guard.sessionId &&
        run.sessionAuthorityGeneration === authorityGeneration &&
        (run.status === 'accepted' || run.status === 'running'),
      );
    }
    case 'operation_lease': {
      const reserved = input.irreversibleOperations.get(guard.fence.requestId);
      const expected: IrreversibleOperationInput = {
        requestId: guard.fence.requestId,
        sessionId: guard.sessionId,
        operation: guard.fence.operation,
        bindingFingerprint: guard.fence.bindingFingerprint,
      };
      return Boolean(
        reserved &&
        reserved.status === 'attempting' &&
        reserved.sessionAuthorityGeneration === authorityGeneration &&
        reserved.attempt === guard.fence.attempt &&
        reserved.leaseToken === guard.fence.leaseToken &&
        reserved.leaseExpiresAt > input.now &&
        sameOperation(reserved.input, expected),
      );
    }
  }
}

export function memoryVerifiedRefFenceIsCurrent(
  guard: IsRunCommitFenceCurrentInput,
  state: MemoryRunCommitState,
): boolean {
  return memoryRunCommitFenceIsCurrent({
    guard,
    ...state,
    now: Date.now(),
  });
}

function sameOperation(
  left: IrreversibleOperationInput,
  right: IrreversibleOperationInput,
): boolean {
  return (
    left.requestId === right.requestId &&
    left.sessionId === right.sessionId &&
    left.operation === right.operation &&
    left.bindingFingerprint === right.bindingFingerprint
  );
}
