import { isRecord, sha256Fingerprint, type HandlerResponse } from "./routeHandlerContracts.js";
import type {
  ConversationStore,
  IrreversibleOperationInput,
  RunCommitFence,
} from "../persistence/memoryStore.js";

export interface KfcSynchronousRequestFence {
  runGuard: {
    isCurrent(): Promise<boolean>;
    commitFence: RunCommitFence;
  };
  complete(response: HandlerResponse): Promise<{
    response: HandlerResponse;
    completedByOwner: boolean;
  }>;
  fail(error: unknown): Promise<void>;
}

export type KfcSynchronousRequestReservation =
  | { status: "ready"; fence: KfcSynchronousRequestFence }
  | { status: "response"; response: HandlerResponse };

export async function reserveKfcSynchronousRequest(input: {
  store: ConversationStore;
  sessionId: string;
  clientMessageId: string;
  bindingFingerprint: string;
  locallyActiveRequestIds?: Set<string>;
  projectResponse?(
    response: HandlerResponse,
  ): Promise<HandlerResponse>;
}): Promise<KfcSynchronousRequestReservation> {
  const { store } = input;
  if (
    !store.reserveIrreversibleOperation ||
    !store.getIrreversibleOperation ||
    !store.markIrreversibleOperationOutcomeUnknownIfExpired ||
    !store.completeIrreversibleOperation ||
    !store.failIrreversibleOperation
  ) {
    return {
      status: "response",
      response: {
        status: 503,
        body: { errorCode: "kfc_request_fence_unavailable" },
      },
    };
  }
  const reservationInput: IrreversibleOperationInput = {
    requestId: `kfc-synchronous-request:${await sha256Fingerprint({
      sessionId: input.sessionId,
      clientMessageId: input.clientMessageId,
    })}`,
    sessionId: input.sessionId,
    operation: "kfc_synchronous_request",
    bindingFingerprint: input.bindingFingerprint,
  };
  let existing;
  try {
    existing = await store.getIrreversibleOperation(reservationInput);
  } catch (error) {
    if (isBindingConflict(error)) {
      return conflictResponse(input.bindingFingerprint);
    }
    if (isSessionAuthorityUnavailable(error)) {
      return supersededResponse(input.sessionId);
    }
    throw error;
  }
  if (existing?.status === "completed") {
    return {
      status: "response",
      response: await projectStoredResponse(
        existing.result,
        true,
        input.projectResponse,
      ),
    };
  }
  if (existing?.status === "pending") {
    if (input.locallyActiveRequestIds?.has(reservationInput.requestId)) {
      return {
        status: "response",
        response: inProgressResponse(),
      };
    }
    const expired =
      await store.markIrreversibleOperationOutcomeUnknownIfExpired({
        ...reservationInput,
        reason: "kfc_synchronous_request_lease_expired",
      });
    if (expired.status === "completed") {
      return {
        status: "response",
        response: await projectStoredResponse(
          expired.result,
          true,
          input.projectResponse,
        ),
      };
    }
    if (expired.status === "unknown") {
      return {
        status: "response",
        response: outcomeUnknownResponse(),
      };
    }
    return {
      status: "response",
      response: inProgressResponse(),
    };
  }
  if (existing?.status === "unknown") {
    return {
      status: "response",
      response: outcomeUnknownResponse(),
    };
  }
  // Only a request with no prior durable attempt may reserve provider work.
  // Expired or explicitly failed attempts remain outcome-unknown and never
  // execute again under the same idempotency key.
  let reservation;
  try {
    reservation = await store.reserveIrreversibleOperation(reservationInput);
  } catch (error) {
    if (isBindingConflict(error)) {
      return conflictResponse(input.bindingFingerprint);
    }
    if (isSessionAuthorityUnavailable(error)) {
      return supersededResponse(input.sessionId);
    }
    throw error;
  }
  if (reservation.status === "completed") {
    return {
      status: "response",
      response: await projectStoredResponse(
        reservation.result,
        true,
        input.projectResponse,
      ),
    };
  }
  if (reservation.status !== "reserved") {
    return {
      status: "response",
      response: inProgressResponse(),
    };
  }
  const owner = {
    attempt: reservation.attempt,
    leaseToken: reservation.leaseToken,
    sessionAuthorityGeneration:
      reservation.sessionAuthorityGeneration,
  };
  input.locallyActiveRequestIds?.add(reservationInput.requestId);
  const commitFence = {
    kind: "operation_lease",
    requestId: reservationInput.requestId,
    operation: reservationInput.operation,
    bindingFingerprint: reservationInput.bindingFingerprint,
    attempt: owner.attempt,
    leaseToken: owner.leaseToken,
    sessionAuthorityGeneration:
      reservation.sessionAuthorityGeneration,
  } as const satisfies RunCommitFence;
  return {
    status: "ready",
    fence: {
      runGuard: {
        commitFence,
        isCurrent() {
          return store.isRunCommitFenceCurrent({
            sessionId: reservationInput.sessionId,
            fence: commitFence,
          });
        },
      },
      async complete(response) {
        try {
          const completed = await store.completeIrreversibleOperation!(
            reservationInput,
            owner,
            { status: response.status, body: response.body },
          );
          if (completed.status === "completed") {
            return {
              response: await projectStoredResponse(
                completed.result,
                false,
                input.projectResponse,
              ),
              completedByOwner: true,
            };
          }
          const terminal =
            await store.getIrreversibleOperation!(reservationInput);
          return {
            response:
              terminal?.status === "completed"
                ? await projectStoredResponse(
                    terminal.result,
                    true,
                    input.projectResponse,
                  )
                : inProgressResponse(),
            completedByOwner: false,
          };
        } finally {
          input.locallyActiveRequestIds?.delete(
            reservationInput.requestId,
          );
        }
      },
      async fail(error) {
        try {
          await store.failIrreversibleOperation!(
            reservationInput,
            owner,
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          input.locallyActiveRequestIds?.delete(
            reservationInput.requestId,
          );
        }
      },
    },
  };
}

async function projectStoredResponse(
  result: Record<string, unknown>,
  replayed: boolean,
  project:
    | ((response: HandlerResponse) => Promise<HandlerResponse>)
    | undefined,
): Promise<HandlerResponse> {
  const stored = storedResponse(result, replayed);
  return project ? project(stored) : stored;
}

function storedResponse(
  result: Record<string, unknown>,
  replayed: boolean,
): HandlerResponse {
  const status = result.status;
  const body = result.body;
  if (typeof status !== "number" || !isRecord(body)) {
    throw new Error("Stored KFC synchronous response is invalid");
  }
  return {
    status,
    body: replayed ? { ...body, replayed: true } : body,
  };
}

function inProgressResponse(): HandlerResponse {
  return {
    status: 409,
    body: { errorCode: "kfc_request_in_progress" },
  };
}

function outcomeUnknownResponse(): HandlerResponse {
  return {
    status: 409,
    body: { errorCode: "kfc_request_outcome_unknown" },
  };
}

function isBindingConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("binding conflict");
}

function isSessionAuthorityUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "session_ai_authority_unavailable"
  );
}

function supersededResponse(
  sessionId: string,
): KfcSynchronousRequestReservation {
  return {
    status: "response",
    response: {
      status: 409,
      body: {
        errorCode: "agent_run_superseded",
        sessionId,
        suppressed: true,
      },
    },
  };
}

function conflictResponse(bindingFingerprint: string): KfcSynchronousRequestReservation {
  return {
    status: "response",
    response: {
      status: 409,
      body: {
        errorCode: "idempotency_conflict",
        conflictingRequestFingerprint: bindingFingerprint,
      },
    },
  };
}
