import type {
  CommitPausedCustomerRunIntakeInput,
} from './contracts.js';
import type {
  ConversationTurn,
} from '../domain/types.js';
import type {
  CustomerRun,
  CustomerRunEvent,
} from '../customerRuns/contracts.js';
import {
  prepareCustomerRunEventBatch,
} from './customerRunEventCommit.js';

export function validatePausedCustomerRunIntake(
  input: CommitPausedCustomerRunIntakeInput,
) {
  const { run, userTurn } = input;
  if (
    !Number.isSafeInteger(input.expectedSessionAuthorityGeneration) ||
    input.expectedSessionAuthorityGeneration < 0 ||
    run.status !== 'superseded' ||
    run.phase !== 'finalizing' ||
    run.nextEventSequence !== 1 ||
    run.startedAt !== null ||
    run.terminalAt === null ||
    run.updatedAt !== run.terminalAt ||
    userTurn.sessionId !== run.sessionId ||
    userTurn.channel !== 'kfc' ||
    userTurn.role !== 'user' ||
    userTurn.externalMessageId !== run.clientMessageId ||
    userTurn.externalUserId !== run.customerId ||
    userTurn.deliveryStatus !== 'received'
  ) {
    throw new Error('paused_customer_run_intake_invalid');
  }
  const events = prepareCustomerRunEventBatch({
    runId: run.id,
    events: input.events,
  });
  const event = events[0];
  if (
    events.length !== 1 ||
    !event ||
    event.type !== 'run_superseded' ||
    event.sequence !== run.nextEventSequence ||
    event.occurredAt !== run.terminalAt ||
    !isExactSupersededPayload(event.payload)
  ) {
    throw new Error('paused_customer_run_intake_invalid');
  }
  return { event };
}

export function assertExactPausedCustomerUserTurn(
  input: CommitPausedCustomerRunIntakeInput,
  turn: ConversationTurn,
): void {
  const expected = input.userTurn;
  if (
    turn.sessionId !== expected.sessionId ||
    turn.channel !== expected.channel ||
    turn.role !== expected.role ||
    turn.text !== expected.text ||
    turn.externalMessageId !== expected.externalMessageId ||
    turn.externalUserId !== expected.externalUserId ||
    turn.deliveryStatus !== expected.deliveryStatus ||
    canonicalJson(turn.metadata ?? null) !==
      canonicalJson(expected.metadata ?? null)
  ) {
    throw new Error('paused_customer_run_intake_turn_conflict');
  }
}

export function assertExactPausedCustomerRunReplay(input: {
  operation: CommitPausedCustomerRunIntakeInput;
  run: CustomerRun;
  turn: ConversationTurn;
  events: readonly CustomerRunEvent[];
}): void {
  const { operation, run, turn, events } = input;
  const event = events[0];
  if (
    run.schemaVersion !== operation.run.schemaVersion ||
    run.sessionId !== operation.run.sessionId ||
    run.customerId !== operation.run.customerId ||
    run.clientMessageId !== operation.run.clientMessageId ||
    run.requestFingerprint !== operation.run.requestFingerprint ||
    run.generation !== operation.run.generation ||
    run.clientSchemaVersion !== operation.run.clientSchemaVersion ||
    !Number.isSafeInteger(run.sessionAuthorityGeneration) ||
    run.sessionAuthorityGeneration < 0 ||
    run.status !== 'superseded' ||
    run.phase !== 'finalizing' ||
    run.nextEventSequence !== operation.run.nextEventSequence + 1 ||
    run.startedAt !== null ||
    run.terminalAt === null ||
    run.updatedAt !== run.terminalAt ||
    events.length !== 1 ||
    !event ||
    event.schemaVersion !== operation.run.schemaVersion ||
    event.runId !== run.id ||
    event.sequence !== operation.run.nextEventSequence ||
    event.type !== 'run_superseded' ||
    event.occurredAt !== run.terminalAt ||
    !isExactSupersededPayload(event.payload)
  ) {
    throw new Error('paused_customer_run_intake_replay_invalid');
  }
  assertExactPausedCustomerUserTurn(operation, turn);
}

function isExactSupersededPayload(
  payload: Record<string, unknown>,
): boolean {
  const keys = Object.keys(payload).sort();
  return (
    keys.length === 3 &&
    keys[0] === 'agentMode' &&
    keys[1] === 'status' &&
    keys[2] === 'suppressed' &&
    payload.status === 'superseded' &&
    payload.suppressed === true &&
    payload.agentMode === 'human_paused'
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) =>
        `${JSON.stringify(key)}:${canonicalJson(entry)}`
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
