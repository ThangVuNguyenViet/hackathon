import type { StructuredToolParams } from "@langchain/core/tools";
import { getToolBoundary } from "../ordering/toolBoundaries.js";
import {
  agentToolArgumentSchemas,
  agentToolDescriptions,
  toolNames,
} from "../ordering/toolCatalog.js";
import type { ToolName } from "../ordering/types.js";
import { providerPortableToolSchema } from "./providerPortableToolSchema.js";

function toolDescription(name: ToolName): string {
  return [
    `KFC ${getToolBoundary(name)} capability ${name}.`,
    agentToolDescriptions[name],
    "Inspect the returned verified result before answering.",
  ].join(" ");
}

/**
 * Provider-facing schemas only. LangGraph owns dispatch, validation, approval,
 * tracing, and execution; model adapters receive no executable callback.
 */
export function commerceToolDefinitions(
  advertisedToolNames: readonly ToolName[] = toolNames,
): StructuredToolParams[] {
  const advertised = new Set(advertisedToolNames);
  return toolNames.filter((name) => advertised.has(name)).map((name) => ({
    name,
    description: toolDescription(name),
    schema: providerPortableToolSchema(agentToolArgumentSchemas[name]),
  }));
}
