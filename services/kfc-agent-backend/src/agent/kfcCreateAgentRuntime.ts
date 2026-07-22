import { z } from 'zod';
import type { AgentGraphState } from '../graph/state.js';
import type { Order } from '../domain/types.js';
import {
  TOOL_NAMES,
  type ToolName,
  type ToolTraceEntry,
} from '../ordering/types.js';
import type { SingleAgentRuntimeContext } from './singleAgentRuntime.js';
import type { KfcCreateAgentToolCoordinator } from './kfcCreateAgentToolCoordinator.js';
import {
  MAX_TOOL_CALL_LEDGER_ENTRIES,
  type ToolCallLedgerEntry,
} from './agentToolCallLedger.js';
import {
  PROVIDER_ERROR_TYPES,
  type ProviderFailure,
  type ProviderFailureDiagnostic,
} from './agentBoundaryPolicy.js';
import type { ProviderAttemptEvidence } from './agentModelInvocation.js';
import {
  CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_RESULT,
  CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_SCHEMA_VERSION,
} from './modelPublicationProjection.js';

export interface SharedUsageLedger {
  used: number;
  readonly limit: number;
}

export interface KfcCreateAgentRuntime {
  providerAttempts: SharedUsageLedger;
  providerAttemptEvidence: ProviderAttemptEvidence[];
  providerFailure: ProviderFailure | null;
  providerFailureDiagnostic: ProviderFailureDiagnostic | null;
  providerRetry: SharedUsageLedger;
  semanticCorrections: SharedUsageLedger;
  providerAttemptPurpose: ProviderAttemptEvidence['purpose'];
  advertisedToolNames: ToolName[];
  toolCallLedger: ToolCallLedgerEntry[];
  assertRuntimeActive(): void | Promise<void>;
  startProviderAttemptSpan?(input: {
    attempt: number;
    purpose: ProviderAttemptEvidence['purpose'];
  }): Promise<{
    end(outputs: Record<string, unknown>): Promise<void>;
  }>;
  startProviderRetrySpan?(name: string): Promise<{
    end(outputs: Record<string, unknown>): Promise<void>;
  }>;
  trace?(event: string): void;
}

export type KfcCreateAgentContext = Record<string, unknown> & {
  runtime: SingleAgentRuntimeContext;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
  currentTurnStatusOrder?: Order;
  createAgentRuntime: KfcCreateAgentRuntime;
  toolCoordinator?: KfcCreateAgentToolCoordinator;
  resolveActiveToolNames(): ToolName[];
  resolveModelSystemContext?():
    string | undefined | Promise<string | undefined>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const toolNameSet = new Set<unknown>(TOOL_NAMES);
const toolCallEffectSet = new Set<unknown>([
  'provider_read',
  'reversible_mutation',
  'irreversible_mutation',
]);
const providerErrorClassSet = new Set<unknown>([
  'aborted',
  'client_error',
  'network_error',
  'rate_limited',
  'server_error',
  'timeout',
  'unknown',
]);
const providerAttemptOutcomeSet = new Set<unknown>([
  'error',
  'invalid_response',
  'success',
]);
const providerAttemptPurposeSet = new Set<unknown>([
  'agent_decision',
  'response_composition',
]);
const providerErrorTypeSet = new Set<unknown>(PROVIDER_ERROR_TYPES);

function isSharedUsageLedger(
  value: unknown,
  expectedLimit: number,
): value is SharedUsageLedger {
  return (
    isRecord(value) &&
    typeof value.used === 'number' &&
    Number.isInteger(value.used) &&
    value.used >= 0 &&
    value.used <= expectedLimit &&
    value.limit === expectedLimit
  );
}

function isToolNameArray(value: unknown): value is ToolName[] {
  return Array.isArray(value) && value.every((name) => toolNameSet.has(name));
}

function isToolName(value: unknown): value is ToolName {
  return toolNameSet.has(value);
}

function isCheckpointSafeReceipt(value: unknown, toolName: ToolName): boolean {
  return (
    isRecord(value) &&
    value.schemaVersion ===
      CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_SCHEMA_VERSION &&
    typeof value.evidenceId === 'string' &&
    value.evidenceId.length > 0 &&
    typeof value.evidenceDigest === 'string' &&
    value.evidenceDigest.length > 0 &&
    typeof value.toolCallId === 'string' &&
    value.toolCallId.length > 0 &&
    value.toolName === toolName &&
    value.executionOutcome === 'success' &&
    value.result === CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_RESULT
  );
}

function isToolCallLedgerEntry(value: unknown): value is ToolCallLedgerEntry {
  if (
    !isRecord(value) ||
    typeof value.signatureDigest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.signatureDigest) ||
    !isToolName(value.toolName) ||
    !toolCallEffectSet.has(value.effect)
  ) {
    return false;
  }
  const toolName = value.toolName;
  if (value.effect === 'provider_read') return value.receipt === null;
  return isCheckpointSafeReceipt(value.receipt, toolName);
}

function isToolCallLedger(value: unknown): value is ToolCallLedgerEntry[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_TOOL_CALL_LEDGER_ENTRIES &&
    value.every(isToolCallLedgerEntry)
  );
}

function isToolTraceEntry(value: unknown): value is ToolTraceEntry {
  return (
    isRecord(value) &&
    toolNameSet.has(value.toolName) &&
    isRecord(value.arguments) &&
    typeof value.ok === 'boolean' &&
    typeof value.resultSummary === 'string' &&
    Array.isArray(value.provenance) &&
    value.provenance.every(isRecord) &&
    (value.publicationEvidenceAudit === undefined ||
      isRecord(value.publicationEvidenceAudit))
  );
}

function isToolTrace(value: unknown): value is ToolTraceEntry[] {
  return Array.isArray(value) && value.every(isToolTraceEntry);
}

function isProviderAttemptEvidence(
  value: unknown,
): value is ProviderAttemptEvidence {
  return (
    isRecord(value) &&
    typeof value.attempt === 'number' &&
    Number.isInteger(value.attempt) &&
    value.attempt > 0 &&
    providerAttemptOutcomeSet.has(value.outcome) &&
    providerAttemptPurposeSet.has(value.purpose) &&
    (value.errorClass === undefined ||
      providerErrorClassSet.has(value.errorClass)) &&
    (value.retryable === undefined || typeof value.retryable === 'boolean')
  );
}

function isProviderFailure(value: unknown): value is ProviderFailure {
  return (
    isRecord(value) &&
    providerErrorClassSet.has(value.errorClass) &&
    typeof value.retryable === 'boolean'
  );
}

function isProviderFailureDiagnostic(
  value: unknown,
): value is ProviderFailureDiagnostic {
  return (
    isRecord(value) &&
    value.stage === 'model_invoke' &&
    (value.httpStatus === undefined ||
      (typeof value.httpStatus === 'number' &&
        Number.isInteger(value.httpStatus) &&
        value.httpStatus >= 400 &&
        value.httpStatus <= 599)) &&
    (value.errorType === undefined || providerErrorTypeSet.has(value.errorType))
  );
}

function isToolCoordinator(
  value: unknown,
): value is KfcCreateAgentToolCoordinator {
  return (
    isRecord(value) &&
    typeof value.acceptBatch === 'function' &&
    typeof value.execute === 'function' &&
    typeof value.snapshot === 'function'
  );
}

function isCreateAgentRuntime(value: unknown): value is KfcCreateAgentRuntime {
  if (!isRecord(value)) return false;
  return (
    isSharedUsageLedger(value.providerAttempts, 6) &&
    Array.isArray(value.providerAttemptEvidence) &&
    value.providerAttemptEvidence.every(isProviderAttemptEvidence) &&
    (value.providerFailure === null ||
      isProviderFailure(value.providerFailure)) &&
    (value.providerFailureDiagnostic === null ||
      isProviderFailureDiagnostic(value.providerFailureDiagnostic)) &&
    isSharedUsageLedger(value.providerRetry, 1) &&
    isSharedUsageLedger(value.semanticCorrections, 1) &&
    providerAttemptPurposeSet.has(value.providerAttemptPurpose) &&
    isToolNameArray(value.advertisedToolNames) &&
    isToolCallLedger(value.toolCallLedger) &&
    typeof value.assertRuntimeActive === 'function' &&
    (value.startProviderAttemptSpan === undefined ||
      typeof value.startProviderAttemptSpan === 'function') &&
    (value.startProviderRetrySpan === undefined ||
      typeof value.startProviderRetrySpan === 'function') &&
    (value.trace === undefined || typeof value.trace === 'function')
  );
}

export const kfcCreateAgentContextSchema = z
  .object({
    runtime: z.custom<KfcCreateAgentContext['runtime']>(isRecord),
    state: z.custom<KfcCreateAgentContext['state']>(isRecord),
    currentTurnToolTrace:
      z.custom<KfcCreateAgentContext['currentTurnToolTrace']>(isToolTrace),
    currentTurnStatusOrder: z
      .custom<NonNullable<KfcCreateAgentContext['currentTurnStatusOrder']>>(
        isRecord,
      )
      .optional(),
    createAgentRuntime:
      z.custom<KfcCreateAgentContext['createAgentRuntime']>(
        isCreateAgentRuntime,
      ),
    toolCoordinator: z
      .custom<NonNullable<KfcCreateAgentContext['toolCoordinator']>>(
        isToolCoordinator,
      )
      .optional(),
    resolveActiveToolNames: z.custom<
      KfcCreateAgentContext['resolveActiveToolNames']
    >((value) => typeof value === 'function'),
    resolveModelSystemContext: z
      .custom<NonNullable<KfcCreateAgentContext['resolveModelSystemContext']>>(
        (value) => typeof value === 'function',
      )
      .optional(),
  })
  .strict();

export function createKfcCreateAgentRuntime(input: {
  assertRuntimeActive(): void | Promise<void>;
  providerAttempts?: SharedUsageLedger;
  providerAttemptEvidence?: ProviderAttemptEvidence[];
  providerFailure?: ProviderFailure | null;
  providerFailureDiagnostic?: ProviderFailureDiagnostic | null;
  providerRetry?: SharedUsageLedger;
  semanticCorrections?: SharedUsageLedger;
  providerAttemptPurpose?: ProviderAttemptEvidence['purpose'];
  advertisedToolNames?: ToolName[];
  toolCallLedger?: ToolCallLedgerEntry[];
  startProviderAttemptSpan?: KfcCreateAgentRuntime['startProviderAttemptSpan'];
  startProviderRetrySpan?: KfcCreateAgentRuntime['startProviderRetrySpan'];
  trace?(event: string): void;
}): KfcCreateAgentRuntime {
  return {
    providerAttempts: input.providerAttempts ?? { used: 0, limit: 6 },
    providerAttemptEvidence: input.providerAttemptEvidence ?? [],
    providerFailure: input.providerFailure ?? null,
    providerFailureDiagnostic: input.providerFailureDiagnostic ?? null,
    providerRetry: input.providerRetry ?? { used: 0, limit: 1 },
    semanticCorrections: input.semanticCorrections ?? { used: 0, limit: 1 },
    providerAttemptPurpose: input.providerAttemptPurpose ?? 'agent_decision',
    advertisedToolNames: [...(input.advertisedToolNames ?? [])],
    toolCallLedger: structuredClone(input.toolCallLedger ?? []),
    assertRuntimeActive: input.assertRuntimeActive,
    ...(input.startProviderAttemptSpan
      ? { startProviderAttemptSpan: input.startProviderAttemptSpan }
      : {}),
    ...(input.startProviderRetrySpan
      ? { startProviderRetrySpan: input.startProviderRetrySpan }
      : {}),
    ...(input.trace ? { trace: input.trace } : {}),
  };
}
