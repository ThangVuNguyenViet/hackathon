import type { ConversationTurn } from '../domain/types.js';
import {
  CustomerRunIdempotencyConflictError,
  type CustomerRun,
  type CustomerRunEvent,
} from '../customerRuns/contracts.js';
import type {
  CommitPausedCustomerRunIntakeInput,
  CommitPausedCustomerRunIntakeResult,
  SessionControl,
} from './contracts.js';
import {
  assertExactPausedCustomerRunReplay,
  assertExactPausedCustomerUserTurn,
  validatePausedCustomerRunIntake,
} from './pausedCustomerRunIntake.js';

export function commitMemoryPausedCustomerRunIntake(input: {
  operation: CommitPausedCustomerRunIntakeInput;
  customerRuns: Map<string, CustomerRun>;
  customerRunRequestIndex: Map<string, string>;
  customerRunEvents: CustomerRunEvent[];
  turns: ConversationTurn[];
  sessionControls: ReadonlyMap<string, SessionControl>;
}): CommitPausedCustomerRunIntakeResult {
  const prepared = validatePausedCustomerRunIntake(input.operation);
  const requestKey = `${input.operation.run.sessionId}:${
    input.operation.run.clientMessageId
  }`;
  const existingRunId = input.customerRunRequestIndex.get(requestKey);
  if (existingRunId) {
    const existing = input.customerRuns.get(existingRunId);
    if (!existing) throw new Error('paused_customer_run_index_corrupt');
    if (
      existing.requestFingerprint !== input.operation.run.requestFingerprint
    ) {
      throw new CustomerRunIdempotencyConflictError(
        input.operation.run.sessionId,
        input.operation.run.clientMessageId,
      );
    }
    const turn = existingUserTurn(input.turns, input.operation);
    const events = input.customerRunEvents.filter(
      (event) => event.runId === existing.id,
    );
    if (!turn || events.length === 0) {
      throw new Error('paused_customer_run_replay_incomplete');
    }
    assertExactPausedCustomerRunReplay({
      operation: input.operation,
      run: existing,
      turn,
      events,
    });
    return {
      status: 'replayed',
      run: structuredClone(existing),
      turn: structuredClone(turn),
      events: structuredClone(events),
    };
  }

  const control = input.sessionControls.get(input.operation.run.sessionId);
  if (
    control?.agentMode !== 'human_paused' ||
    control.sessionAuthorityGeneration !==
      input.operation.expectedSessionAuthorityGeneration
  ) {
    return { status: 'stale' };
  }
  if (input.customerRuns.has(input.operation.run.id)) {
    throw new Error('paused_customer_run_id_collision');
  }

  const existingTurn = existingUserTurn(input.turns, input.operation);
  if (existingTurn) {
    assertExactPausedCustomerUserTurn(input.operation, existingTurn);
  }
  const turn = existingTurn ?? createUserTurn(input.turns, input.operation);
  const run: CustomerRun = {
    ...input.operation.run,
    sessionAuthorityGeneration:
      input.operation.expectedSessionAuthorityGeneration,
    nextEventSequence: input.operation.run.nextEventSequence + 1,
  };
  input.customerRuns.set(run.id, run);
  input.customerRunRequestIndex.set(requestKey, run.id);
  input.customerRunEvents.push(prepared.event);
  return {
    status: 'committed',
    run: structuredClone(run),
    turn: structuredClone(turn),
    events: [structuredClone(prepared.event)],
  };
}

function existingUserTurn(
  turns: readonly ConversationTurn[],
  input: CommitPausedCustomerRunIntakeInput,
): ConversationTurn | undefined {
  return turns.find(
    (turn) =>
      turn.sessionId === input.run.sessionId &&
      turn.externalMessageId === input.run.clientMessageId,
  );
}

function createUserTurn(
  turns: ConversationTurn[],
  input: CommitPausedCustomerRunIntakeInput,
): ConversationTurn {
  const turn: ConversationTurn = {
    ...input.userTurn,
    metadata: input.userTurn.metadata ?? null,
    id: `turn_${turns.length + 1}`,
    createdAt:
      input.userTurn.createdAt ??
      new Date('2026-07-07T00:00:00.000Z').toISOString(),
  };
  turns.push(turn);
  return turn;
}
