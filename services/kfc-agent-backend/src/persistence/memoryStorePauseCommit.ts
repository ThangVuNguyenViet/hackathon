import type {
  AgentRun,
  SessionAgentState,
} from '../domain/types.js';
import type { CustomerRun } from '../customerRuns/contracts.js';
import type {
  CommitConfirmationPauseIfRunCurrentInput,
  CommitConfirmationPauseIfRunCurrentResult,
  ConfirmationPauseRecord,
  CreateConfirmationPauseInput,
  CreateConfirmationPauseResult,
  SessionControl,
  StoredEvent,
} from './contracts.js';
import type {
  MemoryIrreversibleOperationRecord,
} from './memoryStoreConfirmationResumeOperations.js';
import {
  memoryRunCommitFenceIsCurrent,
} from './memoryStoreRunCommit.js';
import {
  captureActiveMemorySessionAuthority,
} from './memoryStoreSessionAuthority.js';
import {
  prepareConfirmationPauseCommit,
} from './confirmationPauseCommitPreparation.js';
import {
  confirmationPauseIdentityDigest,
  immutableConfirmationPauseMatches,
  parseConfirmationPauseRecord,
  parseCreateConfirmationPauseInput,
  parseCreateConfirmationPauseShape,
  pendingConfirmationPause,
} from './confirmationPause.js';

export async function createMemoryConfirmationPause(input: {
  value: CreateConfirmationPauseInput;
  confirmationPauseGenerations: ReadonlyMap<string, number>;
  confirmationPauses: Map<string, unknown>;
  confirmationPauseSessions: Map<string, string>;
  confirmationPauseStoredGenerations: Map<string, number>;
  confirmationPauseStoredAuthorityGenerations: Map<string, number>;
  confirmationPauseIdentityDigests: Map<string, string>;
  sessionControls: ReadonlyMap<string, SessionControl>;
  withLock<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result>;
}): Promise<CreateConfirmationPauseResult> {
  const shape = parseCreateConfirmationPauseShape(input.value);
  const capturedGeneration =
    input.confirmationPauseGenerations.get(shape.sessionId) ?? 0;
  const capturedAuthorityGeneration =
    captureActiveMemorySessionAuthority(
      input.sessionControls,
      shape.sessionId,
    );
  const pause = await parseCreateConfirmationPauseInput(shape);
  return input.withLock(async () => {
    if (
      capturedAuthorityGeneration === undefined ||
      (input.confirmationPauseGenerations.get(pause.sessionId) ?? 0) !==
        capturedGeneration ||
      captureActiveMemorySessionAuthority(
        input.sessionControls,
        pause.sessionId,
      ) !== capturedAuthorityGeneration
    ) {
      return { status: 'conflict' };
    }
    const existingValue = input.confirmationPauses.get(pause.requestId);
    if (existingValue !== undefined) {
      const existing = await parseConfirmationPauseRecord(existingValue);
      return (
        input.confirmationPauseStoredGenerations.get(pause.requestId) ===
          capturedGeneration &&
        input.confirmationPauseStoredAuthorityGenerations.get(
          pause.requestId,
        ) === capturedAuthorityGeneration &&
        immutableConfirmationPauseMatches(existing, pause)
      )
        ? { status: 'replay', record: structuredClone(existing) }
        : { status: 'conflict' };
    }
    const record = pendingConfirmationPause(pause);
    await parseConfirmationPauseRecord(record);
    input.confirmationPauses.set(pause.requestId, structuredClone(record));
    input.confirmationPauseSessions.set(pause.requestId, pause.sessionId);
    input.confirmationPauseStoredGenerations.set(
      pause.requestId,
      capturedGeneration,
    );
    input.confirmationPauseStoredAuthorityGenerations.set(
      pause.requestId,
      capturedAuthorityGeneration,
    );
    input.confirmationPauseIdentityDigests.set(
      pause.requestId,
      await confirmationPauseIdentityDigest(pause),
    );
    return { status: 'created', record: structuredClone(record) };
  });
}

export async function commitMemoryConfirmationPauseIfRunCurrent(input: {
  operation: CommitConfirmationPauseIfRunCurrentInput;
  customerRuns: ReadonlyMap<string, CustomerRun>;
  agentRuns: ReadonlyMap<string, AgentRun>;
  sessionAgentStates: ReadonlyMap<string, SessionAgentState>;
  irreversibleOperations: ReadonlyMap<
    string,
    MemoryIrreversibleOperationRecord
  >;
  sessionControls: ReadonlyMap<string, SessionControl>;
  confirmationPauseGenerations: ReadonlyMap<string, number>;
  confirmationPauses: Map<string, unknown>;
  confirmationPauseSessions: Map<string, string>;
  confirmationPauseStoredGenerations: Map<string, number>;
  confirmationPauseStoredAuthorityGenerations: Map<string, number>;
  confirmationPauseIdentityDigests: Map<string, string>;
  events: StoredEvent[];
  withLock<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result>;
  now?: () => number;
}): Promise<CommitConfirmationPauseIfRunCurrentResult> {
  const prepared = await prepareConfirmationPauseCommit(input.operation);
  return input.withLock(async () => {
    const now = input.now?.() ?? Date.now();
    const notAfter = prepared.input.notAfter;
    if (
      Date.parse(prepared.record.expiresAt) <= now ||
      (
        notAfter !== undefined &&
        (
          !Number.isFinite(Date.parse(notAfter)) ||
          Date.parse(notAfter) <= now
        )
      )
    ) {
      return { status: 'stale' };
    }
    if (!memoryRunCommitFenceIsCurrent({
      guard: {
        sessionId: prepared.stateEvent.sessionId,
        fence: prepared.input.fence,
        ...(notAfter === undefined ? {} : { notAfter }),
      },
      customerRuns: input.customerRuns,
      agentRuns: input.agentRuns,
      sessionAgentStates: input.sessionAgentStates,
      irreversibleOperations: input.irreversibleOperations,
      sessionControls: input.sessionControls,
      now,
    })) {
      return { status: 'stale' };
    }
    const generation =
      input.confirmationPauseGenerations.get(
        prepared.record.sessionId,
      ) ?? 0;
    const authorityGeneration =
      prepared.input.fence.sessionAuthorityGeneration;
    const existing = input.confirmationPauses.get(
      prepared.record.requestId,
    );
    if (existing !== undefined) {
      return pauseReplayResult(
        input,
        prepared,
        generation,
        authorityGeneration,
      );
    }
    if (
      input.events.some(
        ({ id }) =>
          id === prepared.stateEvent.id ||
          id === prepared.pauseEvent.id,
      )
    ) {
      return { status: 'conflict' };
    }
    input.confirmationPauses.set(
      prepared.record.requestId,
      structuredClone(prepared.record),
    );
    input.confirmationPauseSessions.set(
      prepared.record.requestId,
      prepared.record.sessionId,
    );
    input.confirmationPauseStoredGenerations.set(
      prepared.record.requestId,
      generation,
    );
    input.confirmationPauseStoredAuthorityGenerations.set(
      prepared.record.requestId,
      authorityGeneration,
    );
    input.confirmationPauseIdentityDigests.set(
      prepared.record.requestId,
      prepared.identityDigest,
    );
    input.events.push(prepared.stateEvent, prepared.pauseEvent);
    return {
      status: 'created',
      stateEvent: structuredClone(prepared.stateEvent),
      pauseEvent: structuredClone(prepared.pauseEvent),
      record: structuredClone(prepared.record),
    };
  });
}

function pauseReplayResult(
  input: {
    confirmationPauseSessions: ReadonlyMap<string, string>;
    confirmationPauseStoredGenerations: ReadonlyMap<string, number>;
    confirmationPauseStoredAuthorityGenerations:
      ReadonlyMap<string, number>;
    confirmationPauseIdentityDigests: ReadonlyMap<string, string>;
    events: StoredEvent[];
  },
  prepared: {
    identityDigest: string;
    record: ConfirmationPauseRecord;
    stateEvent: StoredEvent;
    pauseEvent: StoredEvent;
  },
  generation: number,
  authorityGeneration: number,
): CommitConfirmationPauseIfRunCurrentResult {
  const requestId = prepared.record.requestId;
  const stateEvent = input.events.find(
    ({ id }) => id === prepared.stateEvent.id,
  );
  const pauseEvent = input.events.find(
    ({ id }) => id === prepared.pauseEvent.id,
  );
  if (
    input.confirmationPauseSessions.get(requestId) !==
      prepared.record.sessionId ||
    input.confirmationPauseStoredGenerations.get(requestId) !== generation ||
    input.confirmationPauseStoredAuthorityGenerations.get(requestId) !==
      authorityGeneration ||
    input.confirmationPauseIdentityDigests.get(requestId) !==
      prepared.identityDigest ||
    !stateEvent ||
    !pauseEvent
  ) {
    return { status: 'conflict' };
  }
  return {
    status: 'replay',
    stateEvent: structuredClone(stateEvent),
    pauseEvent: structuredClone(pauseEvent),
    record: structuredClone(prepared.record),
  };
}
