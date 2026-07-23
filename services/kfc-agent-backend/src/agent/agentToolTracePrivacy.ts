import { stateRevision } from '../graph/turnSupport.js';
import {
  privacySafeToolResultSummary,
} from '../graph/verifiedState.js';
import { getToolBoundary } from '../ordering/toolBoundaries.js';
import {
  agentToolArgumentSchemas,
} from '../ordering/toolCatalog.js';
import type {
  AgentToolCallResult,
  SourceProvenance,
  ToolCallRequest,
  ToolName,
} from '../ordering/types.js';
import {
  isPrivateResponseEvidenceTool,
} from './responseEvidenceContracts.js';

export function isPrivateEvidenceToolName(
  toolName: ToolName,
): boolean {
  return isPrivateResponseEvidenceTool(toolName);
}

export async function privacySafeAgentToolCallIdentity(
  toolName: ToolName,
  toolCallId: string,
): Promise<Record<string, unknown>> {
  return isPrivateEvidenceToolName(toolName)
    ? {
        toolCallIdRedacted: true,
        toolCallIdDigest: await stateRevision(toolCallId),
      }
    : { toolCallId };
}

function privateToolTraceOutcome(
  toolName: ToolName,
  ok: boolean,
): string {
  switch (toolName) {
    case 'getRecentOrder':
      return ok
        ? 'recent_order_observed'
        : 'recent_order_lookup_failed';
    case 'getOrderStatus':
      return ok
        ? 'order_status_observed'
        : 'order_status_lookup_failed';
    case 'checkPaymentStatus':
      return ok
        ? 'payment_status_observed'
        : 'payment_status_check_failed';
    default:
      return ok
        ? 'private_tool_observed'
        : 'private_tool_failed';
  }
}

function privateToolProvenanceMetadata(
  provenance: readonly SourceProvenance[],
): Array<Pick<SourceProvenance, 'fixtureMode' | 'serverPolicy'>> {
  return provenance.map((source) => ({
    fixtureMode: source.fixtureMode,
    ...(source.serverPolicy
      ? { serverPolicy: structuredClone(source.serverPolicy) }
      : {}),
  }));
}

export async function privacySafeAgentToolSpanInputs(input: {
  request: ToolCallRequest;
  auditArguments?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const auditArguments =
    input.auditArguments ?? input.request.arguments;
  const base = {
    toolName: input.request.toolName,
    boundary: getToolBoundary(input.request.toolName),
    argumentsRedacted: true,
    argumentsDigest: await stateRevision(auditArguments),
  };
  if (isPrivateEvidenceToolName(input.request.toolName)) {
    return {
      ...base,
      privateEvidenceTool: true,
    };
  }
  if (input.request.toolName !== 'quoteFulfillment') return base;
  const parsed =
    agentToolArgumentSchemas.quoteFulfillment.safeParse(
      auditArguments,
    );
  return {
    ...base,
    addressSource:
      parsed.success && 'savedAddressRef' in parsed.data
        ? 'saved_address_ref'
        : 'explicit_address',
    method: parsed.success ? parsed.data.method : null,
  };
}

export async function privacySafeAgentToolSpanOutputs(input: {
  result: AgentToolCallResult;
  auditArguments: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const executionOutcome = input.result.ok ? 'success' : 'error';
  if (isPrivateEvidenceToolName(input.result.toolName)) {
    return {
      toolName: input.result.toolName,
      ok: input.result.ok,
      executionOutcome,
      privateEvidenceTool: true,
      outcome: privateToolTraceOutcome(
        input.result.toolName,
        input.result.ok,
      ),
      provenance: privateToolProvenanceMetadata(
        input.result.provenance,
      ),
    };
  }
  const resultSummary = privacySafeToolResultSummary(
    input.result,
    input.auditArguments,
  );
  if (input.result.toolName !== 'quoteFulfillment') {
    return {
      ok: input.result.ok,
      executionOutcome,
      resultSummary,
      provenance: input.result.provenance,
    };
  }
  return {
    ok: input.result.ok,
    executionOutcome,
    outcome: input.result.ok
      ? 'fulfillment_quote_observed'
      : 'fulfillment_quote_failed',
    resultDigest: await stateRevision({
      ok: input.result.ok,
      resultSummary,
      provenance: input.result.provenance,
    }),
  };
}

export function privacySafeAgentToolSpanFailure(
  toolName: ToolName,
  error: unknown,
): unknown {
  if (isPrivateEvidenceToolName(toolName)) {
    return new Error(privateToolTraceOutcome(toolName, false));
  }
  if (toolName === 'quoteFulfillment') {
    return new Error('fulfillment_quote_failed');
  }
  return error;
}
