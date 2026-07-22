import type {
  ConfirmationResumeClaimInput,
  ConfirmationResumeClaimResult,
  ConfirmationResumeCompletionResult,
  ConfirmationResumeOperationIdentity,
  ConfirmationResumeOperationState,
  ConfirmationResumeRepository,
} from './confirmationResumeAuthority.js';
import type {
  ConversationStore,
  IrreversibleOperationInput,
  IrreversibleOperationReservation,
} from '../persistence/contracts.js';

export interface ConversationStoreConfirmationResumeRepositoryOptions {
  pollIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function operationInput(
  identity: ConfirmationResumeOperationIdentity,
  sessionId: string,
): IrreversibleOperationInput {
  return {
    requestId: identity.requestId,
    sessionId,
    operation: identity.operation,
    bindingFingerprint: identity.bindingFingerprint,
  };
}

function operationState(
  reservation: IrreversibleOperationReservation,
): ConfirmationResumeOperationState {
  if (reservation.status === 'completed') {
    return { status: 'completed', result: reservation.result };
  }
  return reservation.status === 'unknown'
    ? { status: 'unknown', lastError: reservation.lastError }
    : { status: 'pending' };
}

export function createConversationStoreConfirmationResumeRepository(
  store: ConversationStore,
  options: ConversationStoreConfirmationResumeRepositoryOptions = {},
): ConfirmationResumeRepository {
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1) {
    throw new Error('confirmation_resume_poll_interval_invalid');
  }
  const sleep = options.sleep ?? (
    (milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
  );
  const sessionIds = new Map<string, string>();

  const exactOperation = async (
    identity: ConfirmationResumeOperationIdentity,
  ): Promise<IrreversibleOperationReservation | { status: 'conflict' } | undefined> => {
    const sessionId = sessionIds.get(identity.requestId);
    if (!sessionId || !store.getIrreversibleOperation) return undefined;
    try {
      return await store.getIrreversibleOperation(
        operationInput(identity, sessionId),
      );
    } catch {
      return { status: 'conflict' };
    }
  };

  return {
    async getPause(requestId) {
      const pause = await store.getConfirmationPauseStorageSnapshot(
        requestId,
      );
      if (pause) sessionIds.set(requestId, pause.record.sessionId);
      return pause;
    },
    async inspectOperation(identity) {
      const reservation = await exactOperation(identity);
      if (!reservation || reservation.status === 'conflict') {
        return reservation;
      }
      return operationState(reservation);
    },
    async claimOperation(
      input: ConfirmationResumeClaimInput,
    ): Promise<ConfirmationResumeClaimResult> {
      sessionIds.set(input.requestId, input.sessionId);
      const reservation =
        await store.reserveConfirmationResumeOperation(input);
      if (
        reservation.status === 'conflict' ||
        reservation.status === 'expired' ||
        reservation.status === 'not_found'
      ) {
        return reservation;
      }
      if (reservation.status === 'reserved') {
        return {
          status: 'claimed',
          attempt: reservation.attempt,
          leaseToken: reservation.leaseToken,
          reconciliation: reservation.reconciliation,
          sessionAuthorityGeneration:
            reservation.sessionAuthorityGeneration,
        };
      }
      if (
        reservation.status !== 'pending' &&
        reservation.status !== 'unknown' &&
        reservation.status !== 'completed'
      ) {
        return { status: 'conflict' };
      }
      return operationState(reservation);
    },
    async waitForOperation(identity, timeoutMs) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const reservation = await exactOperation(identity);
        if (
          reservation?.status === 'completed' ||
          reservation?.status === 'unknown'
        ) {
          return operationState(reservation);
        }
        if (reservation?.status === 'conflict') {
          return { status: 'unknown', lastError: 'operation_conflict' };
        }
        await sleep(
          Math.min(pollIntervalMs, timeoutMs - (Date.now() - startedAt)),
        );
      }
      return { status: 'pending' };
    },
    async completeOperation(input): Promise<ConfirmationResumeCompletionResult> {
      const sessionId = sessionIds.get(input.identity.requestId);
      if (!sessionId || !store.completeIrreversibleOperation) {
        return { status: 'lost' };
      }
      try {
        return await store.completeIrreversibleOperation(
          operationInput(input.identity, sessionId),
          {
            attempt: input.attempt,
            leaseToken: input.leaseToken,
            sessionAuthorityGeneration:
              input.sessionAuthorityGeneration,
          },
          input.result,
        );
      } catch {
        return { status: 'conflict' };
      }
    },
    async markOperationUnknown(input) {
      const sessionId = sessionIds.get(input.identity.requestId);
      if (!sessionId || !store.failIrreversibleOperation) return;
      try {
        await store.failIrreversibleOperation(
          operationInput(input.identity, sessionId),
          {
            attempt: input.attempt,
            leaseToken: input.leaseToken,
            sessionAuthorityGeneration:
              input.sessionAuthorityGeneration,
          },
          input.errorCode,
        );
      } catch {
        // Losing the exact lease is already fail-closed. Never claim success.
      }
    },
  };
}
