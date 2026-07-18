import type { KfcGenUiWidgetKind } from '../genui/kfcGenUi.js';
import type { ToolName, ToolTraceEntry } from '../ordering/types.js';

export const LIVE_QUALITY_DATASET_NAME = 'kfc-live-quality-v1';
export const LIVE_QUALITY_DATASET_DESCRIPTION =
  'Repository-owned KFC live acceptance inventory. Regenerate from scenarioCoverageLedger.ts.';
export const LIVE_QUALITY_DATASET_SPLIT = 'acceptance';
export const LIVE_QUALITY_SCHEMA_VERSION = 'kfc-live-quality-v1';
export const LIVE_QUALITY_INVENTORY_VERSION = '2026-07-15.1';
export const LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST =
  '5e5728af8ea78cd92c7c328091920c452391cc3caa4b594343db56f08b182857';
export const LIVE_QUALITY_EXPECTED_TURN_COUNT = 46;
export const LIVE_QUALITY_EXPECTED_CASE_COUNT = LIVE_QUALITY_EXPECTED_TURN_COUNT * 2;
export const LIVE_QUALITY_SYNC_OWNER = 'kfc-live-quality-dataset-sync';
export const LIVE_QUALITY_SOURCE_PATH =
  'services/kfc-agent-backend/test/scenarios/scenarioCoverageLedger.ts';

export type LiveQualityMode = 'genui' | 'text';

export interface ScenarioToolCountConstraint {
  toolName: ToolName;
  min: number;
  max?: number;
}

export type ScenarioSemanticClaimPredicate =
  | { kind: 'safe_customer_response' }
  | {
      kind: 'grounded_tool_outcome';
      anyOf: ToolName[];
      statePaths: string[];
      genUiPaths: string[];
      textAnyOf: string[];
    };

export interface ScenarioTurnOracle {
  id: string;
  input: string;
  preconditions: string[];
  evidenceBindings: string[];
  toolCounts: ScenarioToolCountConstraint[];
  toolOrder: ToolName[];
  toolOrderGroups: ToolName[][];
  argumentConstraints: Array<{ toolName: ToolName; requiredPaths: string[] }>;
  stateTransition: {
    mayChange: Array<'cart' | 'address' | 'fulfillment' | 'order' | 'paymentAttempt' | 'handoff'>;
    mustChange: Array<'cart' | 'address' | 'fulfillment' | 'order' | 'paymentAttempt' | 'handoff'>;
    mustNotChange: Array<'cart' | 'address' | 'fulfillment' | 'order' | 'paymentAttempt' | 'handoff'>;
  };
  claims: { required: ScenarioSemanticClaimPredicate[]; forbidden: string[] };
  genUi: {
    required: boolean;
    allowedWidgetKinds: KfcGenUiWidgetKind[];
    requiredDataPaths: string[];
    requiredActions: string[];
    forbiddenActions: string[];
  };
  messenger: { projection: 'semantic_parity'; forbiddenText: string[] };
  providerEvidence: {
    requireToolProvenance: boolean;
    requireRevisionOrSource: boolean;
    providerTools: ToolName[];
    allowFailure: boolean;
  };
  persistenceEvidence: { transcriptDelta: 2; contiguousEvents: true; checkpointRequired: true };
  latency: { maxTurnMs: number };
  artifacts: Array<
    'transcript' | 'tool_trace' | 'provider_evidence' | 'checkpoint' | 'genui' | 'messenger_projection'
  >;
}

export interface TurnExpectation extends ScenarioTurnOracle {
  turnIndex: number;
  useCaseIds: string[];
  requiredGroups?: ToolName[][];
  allowedTools: ToolName[];
  allowProviderFailure?: boolean;
  requiredCatalogCodes?: string[];
  requiredCatalogModifierText?: string;
  requiredFulfillmentLocation?: { district: string; city: string };
  requiredBooleanEntities?: string[];
  forbiddenTools?: ToolName[];
  allowEmptyTools?: boolean;
  allowDeterministicExecution?: boolean;
  enforceToolOrder?: boolean;
}

export interface LiveScenarioCase {
  fileName: string;
  turnExpectations: TurnExpectation[];
  targetWidgetKinds?: KfcGenUiWidgetKind[];
  forbiddenWidgetKinds?: KfcGenUiWidgetKind[];
  requiresCustomerAccess?: boolean;
  seedPaidOrder?: boolean;
  seedPendingPayment?: boolean;
}

export interface LiveQualityDatasetInputs {
  caseId: string;
  scenarioFile: string;
  turnIndex: number;
  mode: LiveQualityMode;
  customerMessage: string;
  preconditions: string[];
  evidenceBindings: string[];
}

export interface LiveQualityDatasetOutputs {
  expectation: TurnExpectation;
}

export interface LiveQualityDatasetCase {
  inputs: LiveQualityDatasetInputs;
  outputs: LiveQualityDatasetOutputs;
  metadata: {
    caseId: string;
    schemaVersion: typeof LIVE_QUALITY_SCHEMA_VERSION;
    inventoryVersion: string;
    sourcePath: typeof LIVE_QUALITY_SOURCE_PATH;
    datasetName: typeof LIVE_QUALITY_DATASET_NAME;
    managedBy: typeof LIVE_QUALITY_SYNC_OWNER;
    fingerprint: string;
  };
  split: typeof LIVE_QUALITY_DATASET_SPLIT;
}

export interface LiveQualityExperimentOutput {
  responseText: string;
  plannerRecords: Array<{
    toolNames: ToolName[];
    calls: Array<{ toolName: ToolName; arguments: Record<string, unknown> }>;
    error?: string;
    booleanEntities: Record<string, boolean>;
    catalogCandidateCodes: string[];
    catalogModifierOptionNames: string[];
    fulfillmentLocations: Array<{ district: string; city: string }>;
  }>;
  executedTools: ToolTraceEntry[];
  stateBefore: Record<string, unknown>;
  stateAfter: Record<string, unknown>;
  genUi?: unknown;
  durationMs: number;
  persistence: {
    transcriptRevisionBefore: number;
    transcriptRevisionAfter: number;
    eventRevisionBefore: number;
    eventRevisionAfter: number;
    eventIdsBefore: string[];
    eventIds: string[];
    eventIdsAfter: string[];
    checkpointId?: string;
    checkpointNamespace?: string;
  };
}

export interface LiveQualityEvaluationScore {
  key:
    | 'tool_contract'
    | 'state_transition'
    | 'grounded_response'
    | 'presentation_contract'
    | 'provider_evidence'
    | 'persistence'
    | 'latency'
    | 'acceptance';
  score: boolean;
  comment?: string;
}
