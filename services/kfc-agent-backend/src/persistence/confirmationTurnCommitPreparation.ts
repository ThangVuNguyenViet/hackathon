import type { CommitConfirmationTurnIfRunCurrentInput } from './contracts.js';
import { prepareConfirmationPauseCommit } from './confirmationPauseCommitPreparation.js';
import { prepareAssistantTurnCommit } from './runCommitPreparation.js';

export async function prepareConfirmationTurnCommit(
  operation: CommitConfirmationTurnIfRunCurrentInput,
) {
  if (
    operation.pause.sessionId !== operation.assistantTurn.sessionId ||
    operation.pause.channel !== operation.assistantTurn.channel
  ) {
    throw new Error('confirmation_turn_commit_shape_invalid');
  }
  const now = new Date(operation.pause.createdAt);
  const requestId = operation.pause.requestId;
  const assistant = prepareAssistantTurnCommit(
    {
      ...operation,
      assistantTurn: {
        ...operation.assistantTurn,
        id: operation.assistantTurn.id ?? `turn_confirmation_${requestId}`,
        createdAt:
          operation.assistantTurn.createdAt ?? operation.pause.createdAt,
      },
    },
    now,
  );
  const pause = await prepareConfirmationPauseCommit(operation, now);
  return {
    input: operation,
    record: pause.record,
    identityDigest: pause.identityDigest,
    stateEvent: {
      ...assistant.stateEvent,
      id: `event_confirmation_turn_state_${requestId}`,
    },
    pauseEvent: pause.pauseEvent,
    turnEvent: {
      ...assistant.turnEvent,
      id: `event_confirmation_turn_assistant_${requestId}`,
    },
    turn: assistant.turn,
    verifiedRefs: assistant.verifiedRefs,
    auditEvent: assistant.auditEvent,
  };
}
