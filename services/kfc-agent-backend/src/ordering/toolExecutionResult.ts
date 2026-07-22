import type { ToolResult } from "../domain/types.js";
import type {
  SourceProvenance,
  ToolCallFailure,
  ToolCallRequest,
  ToolCallSuccessFor,
  ToolName,
  ToolResultByName,
} from "./types.js";

const emptyProvenance: SourceProvenance[] = [];

export const externalCallCancelledErrorCode =
  "agent_tool_execution_cancelled";

function isSourceProvenance(value: unknown): value is SourceProvenance {
  return (
    typeof value === "object" &&
    value !== null &&
    "fixtureMode" in value &&
    "sourceFile" in value &&
    typeof (value as { fixtureMode?: unknown }).fixtureMode === "string" &&
    typeof (value as { sourceFile?: unknown }).sourceFile === "string"
  );
}

function dedupeProvenance(
  entries: SourceProvenance[],
): SourceProvenance[] {
  return [
    ...new Map(
      entries.map((entry) => [
        JSON.stringify([
          entry.fixtureMode,
          entry.sourceFile,
          entry.sourceUrl ?? null,
          entry.sourceApi ?? null,
          entry.serverPolicy?.policyId ?? null,
          entry.serverPolicy?.revision ?? null,
          entry.officialAuthority?.authorityRef ?? null,
          entry.officialAuthority?.revision ?? null,
        ]),
        entry,
      ]),
    ).values(),
  ];
}

function collectProvenance(
  value: unknown,
  seen = new Set<unknown>(),
): SourceProvenance[] {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);

  const matches: SourceProvenance[] = [];
  const candidate = value as Record<string, unknown>;
  if (isSourceProvenance(candidate)) matches.push(candidate);
  if (isSourceProvenance(candidate.provenance)) {
    matches.push(candidate.provenance);
  }
  if (isSourceProvenance(candidate.source)) matches.push(candidate.source);

  if (Array.isArray(value)) {
    for (const entry of value) {
      matches.push(...collectProvenance(entry, seen));
    }
  } else {
    for (const nested of Object.values(candidate)) {
      matches.push(...collectProvenance(nested, seen));
    }
  }

  return dedupeProvenance(matches);
}

export function resultFromToolResult<Name extends ToolName>(
  toolName: Name,
  response: ToolResult<ToolResultByName[Name]>,
): ToolCallFailure | ToolCallSuccessFor<Name> {
  const provenance = dedupeProvenance([
    ...(response.provenance ?? []),
    ...collectProvenance(response.value),
  ]);
  if (!response.ok || response.value === undefined) {
    return {
      toolName,
      ok: false,
      errorCode: response.errorCode,
      message: response.message,
      provenance,
    };
  }
  return {
    toolName,
    ok: true,
    value: response.value,
    message: response.message,
    provenance,
  };
}

export function result(
  request: ToolCallRequest,
  _ok: false,
  _value: undefined,
  message: string,
  errorCode?: string,
  provenance: SourceProvenance[] = emptyProvenance,
): ToolCallFailure {
  return {
    toolName: request.toolName,
    ok: false,
    message,
    errorCode,
    provenance,
  };
}

export function cancelledResult(
  request: ToolCallRequest,
): ToolCallFailure {
  return result(
    request,
    false,
    undefined,
    "External tool execution was cancelled before dispatch",
    externalCallCancelledErrorCode,
  );
}
