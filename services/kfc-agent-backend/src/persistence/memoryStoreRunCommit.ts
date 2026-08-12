import type {
  AgentRun,
  ConversationTurn,
  SessionAgentState,
} from '../domain/types.js';
import type { CustomerRun } from '../customerRuns/contracts.js';
import type {
  AppendEventIfRunCurrentInput,
  AppendEventIfRunCurrentResult,
  CommitAssistantTurnInput,
  CommitAssistantTurnResult,
  CommitAssistantTurnIfRunCurrentInput,
  CommitAssistantTurnIfRunCurrentResult,
  CommitConfirmationTurnIfRunCurrentInput,
  CommitConfirmationTurnIfRunCurrentResult,
  IrreversibleOperationInput,
  IsRunCommitFenceCurrentInput,
  SessionControl,
  StoredEvent,
} from './contracts.js';
import type {
  MemoryIrreversibleOperationRecord,
} from './memoryStoreConfirmationResumeOperations.js';
import {
  memoryVerifiedRefStorageSnapshot,
  type MemoryVerifiedRefStorageSnapshot,
} from './memoryStoreVerifiedRefOperations.js';
import {
  prepareAssistantTurnCommit,
} from './runCommitPreparation.js';
import { prepareConfirmationTurnCommit } from './confirmationTurnCommitPreparation.js';
import {
  immutableConfirmationPauseMatches,
  parseConfirmationPauseRecord,
} from './confirmationPause.js';

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

export function appendMemoryEventIfRunCurrent(input: {
  operation: AppendEventIfRunCurrentInput;
  customerRuns: ReadonlyMap<string, CustomerRun>;
  agentRuns: ReadonlyMap<string, AgentRun>;
  sessionAgentStates: ReadonlyMap<string, SessionAgentState>;
  irreversibleOperations: ReadonlyMap<
    string,
    MemoryIrreversibleOperationRecord
  >;
  sessionControls: ReadonlyMap<string, SessionControl>;
  events: StoredEvent[];
  now?: () => number;
}): AppendEventIfRunCurrentResult {
  const { operation } = input;
  const now = input.now?.() ?? Date.now();
  const current = memoryRunCommitFenceIsCurrent({
    guard: operation,
    customerRuns: input.customerRuns,
    agentRuns: input.agentRuns,
    sessionAgentStates: input.sessionAgentStates,
    irreversibleOperations: input.irreversibleOperations,
    sessionControls: input.sessionControls,
    now,
  });
  if (!current) return { status: 'stale' };
  // No await may be introduced between the owner check and this write.
  // MemoryStore run-state mutations are likewise synchronous until their
  // returned promises resolve, making this one event-loop transaction.
  const event: StoredEvent = {
    id: `event_${input.events.length + 1}`,
    sessionId: operation.sessionId,
    sourceType: operation.sourceType,
    payload: structuredClone(operation.payload),
    createdAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
  };
  input.events.push(event);
  return { status: 'committed', event };
}

export function commitMemoryAssistantTurnIfRunCurrent(input: {
  operation: CommitAssistantTurnIfRunCurrentInput;
  state: MemoryRunCommitState;
  confirmationPauseGenerations: ReadonlyMap<string, number>;
  verifiedRefs: Map<string, MemoryVerifiedRefStorageSnapshot>;
  turns: ConversationTurn[];
  events: StoredEvent[];
  now?: () => number;
}): CommitAssistantTurnIfRunCurrentResult {
  const now = input.now?.() ?? Date.now();
  const notAfter = input.operation.notAfter;
  if (
    notAfter !== undefined &&
    (
      !Number.isFinite(Date.parse(notAfter)) ||
      Date.parse(notAfter) <= now
    )
  ) {
    return { status: 'stale' };
  }
  if (!memoryRunCommitFenceIsCurrent({
    guard: {
      sessionId: input.operation.stateEvent.sessionId,
      fence: input.operation.fence,
      ...(notAfter === undefined ? {} : { notAfter }),
    },
    ...input.state,
    now,
  })) {
    return { status: 'stale' };
  }
  const prepared = prepareAssistantTurnCommit(
    input.operation,
    new Date(now),
  );
  const sessionGeneration =
    input.confirmationPauseGenerations.get(
      prepared.turn.sessionId,
    ) ?? 0;
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
  input.events.push(prepared.stateEvent);
  input.turns.push(prepared.turn);
  input.events.push(prepared.turnEvent);
  if (prepared.auditEvent) input.events.push(prepared.auditEvent);
  return {
    status: 'committed',
    ...structuredClone(prepared),
  };
}

export function commitMemoryAssistantTurn(input: {
  operation: CommitAssistantTurnInput;
  confirmationPauseGenerations: ReadonlyMap<string, number>;
  verifiedRefs: Map<string, MemoryVerifiedRefStorageSnapshot>;
  turns: ConversationTurn[];
  events: StoredEvent[];
  now?: () => number;
}): CommitAssistantTurnResult {
  const prepared = prepareAssistantTurnCommit(
    input.operation,
    new Date(input.now?.() ?? Date.now()),
  );
  const sessionGeneration =
    input.confirmationPauseGenerations.get(prepared.turn.sessionId) ?? 0;
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
  input.events.push(prepared.stateEvent);
  input.turns.push(prepared.turn);
  input.events.push(prepared.turnEvent);
  if (prepared.auditEvent) input.events.push(prepared.auditEvent);
  return { status: 'committed', ...structuredClone(prepared) };
}

export async function commitMemoryConfirmationTurnIfRunCurrent(input: {
  operation: CommitConfirmationTurnIfRunCurrentInput;
  state: MemoryRunCommitState;
  confirmationPauseGenerations: ReadonlyMap<string, number>;
  confirmationPauses: Map<string, unknown>;
  confirmationPauseSessions: Map<string, string>;
  confirmationPauseStoredGenerations: Map<string, number>;
  confirmationPauseStoredAuthorityGenerations: Map<string, number>;
  confirmationPauseIdentityDigests: Map<string, string>;
  verifiedRefs: Map<string, MemoryVerifiedRefStorageSnapshot>;
  turns: ConversationTurn[];
  events: StoredEvent[];
  now?: () => number;
}): Promise<CommitConfirmationTurnIfRunCurrentResult> {
  const now = input.now?.() ?? Date.now();
  const prepared = await prepareConfirmationTurnCommit(input.operation);
  if (
    Date.parse(prepared.record.expiresAt) <= now ||
    (input.operation.notAfter !== undefined &&
      Date.parse(input.operation.notAfter) <= now) ||
    !memoryRunCommitFenceIsCurrent({
      guard: {
        sessionId: prepared.record.sessionId,
        fence: input.operation.fence,
        notAfter: input.operation.notAfter ?? prepared.record.expiresAt,
      },
      ...input.state,
      now,
    })
  ) {
    return { status: 'stale' };
  }
  const generation =
    input.confirmationPauseGenerations.get(prepared.record.sessionId) ?? 0;
  const authorityGeneration = input.operation.fence.sessionAuthorityGeneration;
  const existing = input.confirmationPauses.get(prepared.record.requestId);
  if (existing !== undefined) {
    const existingRecord = await parseConfirmationPauseRecord(existing);
    const turn = input.turns.find(({ id }) => id === prepared.turn.id);
    const stateEvent = input.events.find(({ id }) => id === prepared.stateEvent.id);
    const pauseEvent = input.events.find(({ id }) => id === prepared.pauseEvent.id);
    const turnEvent = input.events.find(({ id }) => id === prepared.turnEvent.id);
    const exact =
      input.confirmationPauseSessions.get(prepared.record.requestId) === prepared.record.sessionId &&
      input.confirmationPauseStoredGenerations.get(prepared.record.requestId) === generation &&
      input.confirmationPauseStoredAuthorityGenerations.get(prepared.record.requestId) === authorityGeneration &&
      input.confirmationPauseIdentityDigests.get(prepared.record.requestId) === prepared.identityDigest &&
      immutableConfirmationPauseMatches(existingRecord, prepared.record) &&
      turn && stateEvent && pauseEvent && turnEvent &&
      JSON.stringify(turn) === JSON.stringify(prepared.turn);
    return exact
      ? {
          status: 'replay',
          stateEvent: structuredClone(stateEvent),
          pauseEvent: structuredClone(pauseEvent),
          turnEvent: structuredClone(turnEvent),
          turn: structuredClone(turn),
          record: structuredClone(prepared.record),
          verifiedRefs: structuredClone(prepared.verifiedRefs),
        }
      : { status: 'conflict' };
  }
  const ids = new Set([
    prepared.stateEvent.id,
    prepared.pauseEvent.id,
    prepared.turnEvent.id,
    prepared.turn.id,
  ]);
  if (
    input.events.some(({ id }) => ids.has(id)) ||
    input.turns.some(({ id }) => ids.has(id)) ||
    prepared.verifiedRefs.some(({ ref }) => input.verifiedRefs.has(ref.id))
  ) {
    return { status: 'conflict' };
  }
  for (const record of prepared.verifiedRefs) {
    input.verifiedRefs.set(
      record.ref.id,
      memoryVerifiedRefStorageSnapshot(record, generation),
    );
  }
  input.confirmationPauses.set(
    prepared.record.requestId,
    structuredClone(prepared.record),
  );
  input.confirmationPauseSessions.set(prepared.record.requestId, prepared.record.sessionId);
  input.confirmationPauseStoredGenerations.set(prepared.record.requestId, generation);
  input.confirmationPauseStoredAuthorityGenerations.set(prepared.record.requestId, authorityGeneration);
  input.confirmationPauseIdentityDigests.set(prepared.record.requestId, prepared.identityDigest);
  input.turns.push(prepared.turn);
  input.events.push(prepared.stateEvent, prepared.pauseEvent, prepared.turnEvent);
  if (prepared.auditEvent) input.events.push(prepared.auditEvent);
  return {
    status: 'created',
    stateEvent: structuredClone(prepared.stateEvent),
    pauseEvent: structuredClone(prepared.pauseEvent),
    turnEvent: structuredClone(prepared.turnEvent),
    turn: structuredClone(prepared.turn),
    record: structuredClone(prepared.record),
    verifiedRefs: structuredClone(prepared.verifiedRefs),
  };
}

export function memoryRunCommitFenceIsCurrent(
  input: MemoryRunCommitGuardState,
): boolean {
  const { guard } = input;
  if (
    guard.notAfter !== undefined &&
    (
      !Number.isFinite(Date.parse(guard.notAfter)) ||
      Date.parse(guard.notAfter) <= input.now
    )
  ) {
    return false;
  }
  const control = input.sessionControls.get(guard.sessionId);
  const authorityGeneration =
    control?.sessionAuthorityGeneration ?? 0;
  if (
    (control?.agentMode ?? 'ai_active') !== 'ai_active' ||
    authorityGeneration !==
      guard.fence.sessionAuthorityGeneration
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
        run.executionLeaseToken ===
          guard.fence.executionLeaseToken &&
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
      const reserved = input.irreversibleOperations.get(
        guard.fence.requestId,
      );
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
