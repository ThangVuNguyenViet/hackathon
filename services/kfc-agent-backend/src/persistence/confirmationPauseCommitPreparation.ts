import type {
  ConfirmationPauseRecord,
  CommitConfirmationPauseIfRunCurrentInput,
  StoredEvent,
} from './contracts.js';
import {
  confirmationPauseIdentityDigest,
  parseCreateConfirmationPauseInput,
  pendingConfirmationPause,
} from './confirmationPause.js';

export interface PreparedConfirmationPauseCommit {
  input: CommitConfirmationPauseIfRunCurrentInput;
  record: ConfirmationPauseRecord;
  identityDigest: string;
  stateEvent: StoredEvent;
  pauseEvent: StoredEvent;
}

export async function prepareConfirmationPauseCommit(
  operation: CommitConfirmationPauseIfRunCurrentInput,
  now = new Date(),
): Promise<PreparedConfirmationPauseCommit> {
  const pause = await parseCreateConfirmationPauseInput(operation.pause);
  if (
    pause.sessionId !== operation.stateEvent.sessionId ||
    pause.expiresAt <= pause.createdAt
  ) {
    throw new Error('confirmation_pause_commit_shape_invalid');
  }
  const record = pendingConfirmationPause(pause);
  const identityDigest = await confirmationPauseIdentityDigest(pause);
  const stateEvent: StoredEvent = {
    id: `event_confirmation_pause_state_${pause.requestId}`,
    sessionId: pause.sessionId,
    sourceType: operation.stateEvent.sourceType,
    payload: structuredClone(operation.stateEvent.payload),
    createdAt: now.toISOString(),
  };
  const pauseEvent: StoredEvent = {
    id: `event_confirmation_pause_created_${pause.requestId}`,
    sessionId: pause.sessionId,
    sourceType: 'confirmation_pause_created',
    payload: {
      requestId: pause.requestId,
      sourceTurnId: pause.sourceTurnId,
      actionScope: pause.actionScope,
      actionId: pause.actionId,
      customerId: pause.customerId,
      channel: pause.channel,
      actionDigest: pause.actionDigest,
      approvalBindingDigest: pause.approvalBindingDigest,
      status: record.status,
    },
    createdAt: now.toISOString(),
  };
  return {
    input: { ...operation, pause },
    record,
    identityDigest,
    stateEvent,
    pauseEvent,
  };
}
