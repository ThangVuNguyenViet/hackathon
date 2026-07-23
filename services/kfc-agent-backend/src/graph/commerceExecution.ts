import type { ExternalCallContext } from "../clients/interfaces.js";
import {
  externalCallCancelledErrorCode,
  externalCallIsCancelled,
} from "../ordering/toolExecutor.js";
import type { ToolCallRequest, ToolTraceEntry } from "../ordering/types.js";
import type { AgentTurnInput } from "./agentTurnState.js";
import type { AgentGraphState } from "./state.js";
import { pushEscalationReasons } from "./turnSupport.js";

export function hasSuccessfulToolResult(
  entries: ToolTraceEntry[],
  toolNames: ToolTraceEntry["toolName"][],
): boolean {
  return entries.some(
    (entry) => entry.ok && toolNames.includes(entry.toolName),
  );
}

export async function ensureCartForTool(
  input: Pick<AgentTurnInput, "clients" | "sessionId">,
  state: AgentGraphState,
  call: ToolCallRequest,
  externalCallContext: ExternalCallContext,
): Promise<
  | { ok: true }
  | {
      ok: false;
      errorCode:
        typeof externalCallCancelledErrorCode | "cart_initialization_failed";
    }
> {
  if (externalCallIsCancelled(externalCallContext)) {
    return {
      ok: false,
      errorCode: externalCallCancelledErrorCode,
    };
  }
  if (call.toolName !== "updateCart" || state.cart) return { ok: true };

  const cartResult = await input.clients.cart.createCart(
    input.sessionId,
    externalCallContext,
  );
  if (externalCallIsCancelled(externalCallContext)) {
    return {
      ok: false,
      errorCode: externalCallCancelledErrorCode,
    };
  }
  if (!cartResult.ok || !cartResult.value) {
    pushEscalationReasons(state, ["cart_initialization_failed"]);
    return { ok: false, errorCode: "cart_initialization_failed" };
  }

  state.cart = cartResult.value;
  return { ok: true };
}
