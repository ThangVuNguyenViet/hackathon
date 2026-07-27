import { createHash } from 'node:crypto';
import type { AgentTraceApplicability } from '../observability/agentTracing.js';
import {
  LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST,
  LIVE_QUALITY_DATASET_NAME,
  LIVE_QUALITY_EXPECTED_CASE_COUNT,
  LIVE_QUALITY_EXPECTED_SCENARIO_COUNT,
  LIVE_QUALITY_EXPECTED_TURN_COUNT,
  LIVE_QUALITY_INVENTORY_VERSION,
  LIVE_QUALITY_SCHEMA_VERSION,
  LIVE_QUALITY_SOURCE_PATH,
  type LiveQualityMode,
} from './liveQualityContracts.js';

export interface ProtectedTraceRuntimeIdentity {
  runtimeId: string;
  provider: 'openai' | 'google';
  model: string;
  profile: string;
}

export interface ProtectedTraceQualificationPolicy {
  policyId: string;
  dataset: {
    name: string;
    schemaVersion: string;
    inventoryVersion: string;
    inventoryDigest: string;
    sourcePath: string;
    scenarioCount: number;
    turnCount: number;
    caseCount: number;
  };
  modes: readonly LiveQualityMode[];
  repetitionsPerMode: number;
  costPolicy: 'provider_reported_or_unavailable';
}

export const currentLiveQualityProtectedTracePolicy = {
  policyId: 'kfc-live-quality-v2-protected-trace-v1',
  dataset: {
    name: LIVE_QUALITY_DATASET_NAME,
    schemaVersion: LIVE_QUALITY_SCHEMA_VERSION,
    inventoryVersion: LIVE_QUALITY_INVENTORY_VERSION,
    inventoryDigest: LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST,
    sourcePath: LIVE_QUALITY_SOURCE_PATH,
    scenarioCount: LIVE_QUALITY_EXPECTED_SCENARIO_COUNT,
    turnCount: LIVE_QUALITY_EXPECTED_TURN_COUNT,
    caseCount: LIVE_QUALITY_EXPECTED_CASE_COUNT,
  },
  modes: ['text', 'genui'],
  repetitionsPerMode: 3,
  costPolicy: 'provider_reported_or_unavailable',
} as const satisfies ProtectedTraceQualificationPolicy;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

export function protectedTraceDatasetInventoryDigest(
  examples: readonly {
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    metadata: Record<string, unknown>;
    split: string;
  }[],
): string {
  const ordered = [...examples].sort((left, right) =>
    String(left.inputs.caseId).localeCompare(String(right.inputs.caseId)),
  );
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue(ordered)))
    .digest('hex');
}

export function reviewProtectedTraceRuntimeIdentity(
  value: unknown,
): ProtectedTraceRuntimeIdentity {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('runtimeId' in value) ||
    typeof value.runtimeId !== 'string' ||
    !('provider' in value) ||
    (value.provider !== 'openai' && value.provider !== 'google') ||
    !('model' in value) ||
    typeof value.model !== 'string' ||
    !value.model.trim() ||
    !('profile' in value) ||
    typeof value.profile !== 'string' ||
    !value.profile.trim()
  ) {
    throw new Error('protected_trace_runtime_identity_invalid');
  }
  return {
    runtimeId: value.runtimeId,
    provider: value.provider,
    model: value.model,
    profile: value.profile,
  };
}

interface ProtectedTraceTurnOracle {
  toolCounts: ReadonlyArray<{ toolName: string; min: number }>;
  allowedTools?: readonly string[];
  stateTransition: {
    mustChange: readonly unknown[];
    mayChange?: readonly unknown[];
  };
  genUi: {
    required: boolean;
    allowedWidgetKinds?: readonly unknown[];
  };
}

export function protectedTraceApplicabilityForTurn(
  expectation: ProtectedTraceTurnOracle,
  mode: LiveQualityMode,
): AgentTraceApplicability {
  const requiredTools = expectation.toolCounts.filter(({ min }) => min > 0);
  const allowedTools = new Set([
    ...expectation.toolCounts.map(({ toolName }) => toolName),
    ...(expectation.allowedTools ?? []),
  ]);
  const tool = requiredTools.length > 0
    ? 'required'
    : allowedTools.size > 0
      ? 'optional'
      : 'forbidden';
  const approval = requiredTools.some(({ toolName }) => toolName === 'placeOrder')
    ? 'required'
    : tool === 'forbidden'
      ? 'forbidden'
      : 'optional';
  const verifiedState = expectation.stateTransition.mustChange.length > 0
    ? 'required'
    : (expectation.stateTransition.mayChange?.length ?? 0) > 0 || tool !== 'forbidden'
      ? 'optional'
      : 'forbidden';
  const genui = mode === 'text'
    ? 'forbidden'
    : expectation.genUi.required
      ? 'required'
      : (expectation.genUi.allowedWidgetKinds?.length ?? 0) > 0
        ? 'optional'
        : 'forbidden';
  return { tool, approval, verifiedState, genui };
}

export function deriveProtectedTraceCampaignDimensions(
  policy: ProtectedTraceQualificationPolicy,
): {
  receiptCount: number;
  scenarioModeRuns: number;
  turnEvaluations: number;
} {
  const receiptCount = policy.modes.length * policy.repetitionsPerMode;
  return {
    receiptCount,
    scenarioModeRuns: policy.dataset.scenarioCount * receiptCount,
    turnEvaluations: policy.dataset.turnCount * receiptCount,
  };
}
