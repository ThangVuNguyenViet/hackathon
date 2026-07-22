import type { z } from "zod";
import {
  agentToolArgumentSchemas,
  parseAgentToolArguments,
} from "./toolCatalog.js";
import type { ToolName } from "./types.js";

export type AgentToolCallEffect =
  | "provider_read"
  | "reversible_mutation"
  | "irreversible_mutation";

export interface CanonicalAgentToolCallDisposition {
  toolName: ToolName;
  arguments: Record<string, unknown>;
  effect: AgentToolCallEffect;
}

export type AgentToolCallDispositionResult =
  | {
      success: true;
      data: CanonicalAgentToolCallDisposition;
    }
  | {
      success: false;
      error: z.ZodError;
    };

function effectForCanonicalCall(
  toolName: ToolName,
): AgentToolCallEffect {
  switch (toolName) {
    case "updateCart":
    case "previewOrder":
    case "collectInvoice":
      return "reversible_mutation";
    case "placeOrder":
    case "createPaymentLink":
    case "handoff":
    case "resolveHandoff":
      return "irreversible_mutation";
    case "acquireVoucher":
    case "redeemReward":
      return "irreversible_mutation";
    default:
      return "provider_read";
  }
}

export function agentToolCallDisposition(
  toolName: ToolName,
  rawArguments: Record<string, unknown>,
): AgentToolCallDispositionResult {
  const parsed = parseAgentToolArguments(toolName, rawArguments);
  if (!parsed.success) return parsed;
  const canonicalArguments = parsed.data as Record<string, unknown>;
  return {
    success: true,
    data: {
      toolName,
      arguments: canonicalArguments,
      effect: effectForCanonicalCall(toolName),
    },
  };
}

export type CanonicalAgentToolArguments<Name extends ToolName> =
  z.infer<(typeof agentToolArgumentSchemas)[Name]>;
