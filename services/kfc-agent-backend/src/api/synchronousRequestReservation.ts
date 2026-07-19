import { isRecord, sha256Fingerprint, type HandlerResponse } from "./routeHandlerContracts.js";
import type {
  ConversationStore,
  IrreversibleOperationInput,
} from "../persistence/memoryStore.js";

export interface KfcSynchronousRequestFence {
  complete(response: HandlerResponse): Promise<HandlerResponse>;
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
}): Promise<KfcSynchronousRequestReservation> {
  const { store } = input;
  if (
    !store.reserveIrreversibleOperation ||
    !store.getIrreversibleOperation ||
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
    throw error;
  }
  if (existing?.status === "completed") {
    return {
      status: "response",
      response: storedResponse(existing.result, true),
    };
  }
  if (existing?.status === "pending") {
    return {
      status: "response",
      response: inProgressResponse(),
    };
  }
  // A synchronous retry must not reclaim an expired in-flight lease while the
  // original model/tool turn can still finish. Only an explicitly failed
  // operation ("unknown") is safe to reconcile through a new reservation.
  let reservation;
  try {
    reservation = await store.reserveIrreversibleOperation(reservationInput);
  } catch (error) {
    if (isBindingConflict(error)) {
      return conflictResponse(input.bindingFingerprint);
    }
    throw error;
  }
  if (reservation.status === "completed") {
    return {
      status: "response",
      response: storedResponse(reservation.result, true),
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
  };
  return {
    status: "ready",
    fence: {
      async complete(response) {
        const completed = await store.completeIrreversibleOperation!(
          reservationInput,
          owner,
          { status: response.status, body: response.body },
        );
        if (completed.status === "completed") {
          return storedResponse(completed.result, false);
        }
        const terminal = await store.getIrreversibleOperation!(reservationInput);
        return terminal?.status === "completed"
          ? storedResponse(terminal.result, true)
          : inProgressResponse();
      },
      async fail(error) {
        await store.failIrreversibleOperation!(
          reservationInput,
          owner,
          error instanceof Error ? error.message : String(error),
        );
      },
    },
  };
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

function isBindingConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("binding conflict");
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
