import type {
  AgentRun,
  AgentRunTurn,
  PendingCustomerTurn,
} from '../domain/types.js';
import type {
  AgentRunPatch,
  ClaimAgentRunResult,
  CreateAgentRunInput,
  PendingCustomerTurnInput,
  SessionControl,
  UpsertPendingCustomerTurnResult,
} from './contracts.js';
import { createMemoryAgentRun } from './memoryStoreCreation.js';

interface MemoryAgentRunRecordState {
  pendingCustomerTurns: PendingCustomerTurn[];
  agentRuns: Map<string, AgentRun>;
  agentRunTurns: AgentRunTurn[];
  sessionControls: Map<string, SessionControl>;
}

const memoryTimestamp = '2026-07-07T00:00:00.000Z';

export function upsertMemoryPendingCustomerTurn(
  input: PendingCustomerTurnInput,
  storage: MemoryAgentRunRecordState,
): UpsertPendingCustomerTurnResult {
  const existing = storage.pendingCustomerTurns.find(
    (turn) =>
      turn.sessionId === input.sessionId &&
      turn.externalMessageId === input.externalMessageId,
  );
  if (existing) return { turn: existing, inserted: false };

  const turn: PendingCustomerTurn = {
    ...input,
    updatedAt: input.updatedAt ?? memoryTimestamp,
  };
  storage.pendingCustomerTurns.push(turn);
  return { turn, inserted: true };
}

export function listMemoryPendingCustomerTurns(
  sessionId: string,
  storage: MemoryAgentRunRecordState,
): PendingCustomerTurn[] {
  return storage.pendingCustomerTurns
    .filter((turn) => turn.sessionId === sessionId)
    .sort((left, right) => {
      const received = left.receivedAt.localeCompare(right.receivedAt);
      return received === 0
        ? left.turnId.localeCompare(right.turnId)
        : received;
    });
}

export function markMemoryPendingCustomerTurnClaimed(
  turnId: string,
  runId: string,
  storage: MemoryAgentRunRecordState,
): PendingCustomerTurn {
  return markMemoryPendingCustomerTurnTerminal(
    turnId,
    runId,
    'claimed',
    storage,
  );
}

export function markMemoryPendingCustomerTurnIgnored(
  turnId: string,
  runId: string,
  storage: MemoryAgentRunRecordState,
): PendingCustomerTurn {
  return markMemoryPendingCustomerTurnTerminal(
    turnId,
    runId,
    'ignored',
    storage,
  );
}

function markMemoryPendingCustomerTurnTerminal(
  turnId: string,
  runId: string,
  status: Extract<PendingCustomerTurn['status'], 'claimed' | 'ignored'>,
  storage: MemoryAgentRunRecordState,
): PendingCustomerTurn {
  const turn = storage.pendingCustomerTurns.find(
    (candidate) => candidate.turnId === turnId,
  );
  if (!turn) {
    throw new Error(`Pending customer turn not found: ${turnId}`);
  }
  turn.status = status;
  turn.claimedRunId = runId;
  turn.updatedAt = memoryTimestamp;
  return turn;
}

export function createMemoryAgentRunRecord(
  input: CreateAgentRunInput,
  storage: MemoryAgentRunRecordState,
): AgentRun {
  return createMemoryAgentRun({
    operation: input,
    sessionControls: storage.sessionControls,
    agentRuns: storage.agentRuns,
  });
}

export function claimMemoryAgentRunRecord(
  input: CreateAgentRunInput,
  storage: MemoryAgentRunRecordState,
): ClaimAgentRunResult {
  const existing = [...storage.agentRuns.values()].find(
    (run) =>
      run.sessionId === input.sessionId &&
      run.generation === input.generation,
  );
  if (existing) return { run: existing, claimed: false };
  return {
    run: createMemoryAgentRunRecord(input, storage),
    claimed: true,
  };
}

export function updateMemoryAgentRunRecord(
  runId: string,
  patch: AgentRunPatch,
  storage: MemoryAgentRunRecordState,
): AgentRun {
  const existing = storage.agentRuns.get(runId);
  if (!existing) throw new Error(`Agent run not found: ${runId}`);
  const updated: AgentRun = {
    ...existing,
    ...patch,
    updatedAt: memoryTimestamp,
  };
  storage.agentRuns.set(runId, updated);
  return updated;
}

export function listMemoryAgentRuns(
  sessionId: string,
  storage: MemoryAgentRunRecordState,
): AgentRun[] {
  return [...storage.agentRuns.values()]
    .filter((run) => run.sessionId === sessionId)
    .sort((left, right) => {
      const generation = left.generation - right.generation;
      return generation === 0
        ? left.id.localeCompare(right.id)
        : generation;
    });
}

export function linkMemoryAgentRunTurn(
  input: AgentRunTurn,
  storage: MemoryAgentRunRecordState,
): AgentRunTurn {
  const existing = storage.agentRunTurns.find(
    (link) => link.runId === input.runId && link.turnId === input.turnId,
  );
  if (existing) return existing;
  storage.agentRunTurns.push(input);
  return input;
}

export function listMemoryAgentRunTurns(
  runId: string,
  storage: MemoryAgentRunRecordState,
): AgentRunTurn[] {
  return storage.agentRunTurns
    .filter((link) => link.runId === runId)
    .sort((left, right) => left.sequence - right.sequence);
}
