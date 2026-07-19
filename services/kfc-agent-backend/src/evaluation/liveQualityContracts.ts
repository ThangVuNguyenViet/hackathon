import type { KfcGenUiWidgetKind } from '../genui/kfcGenUi.js';

export const LIVE_QUALITY_DATASET_NAME = 'kfc-live-quality-v2';
export const LIVE_QUALITY_DATASET_DESCRIPTION =
  'Repository-owned KFC live acceptance inventory generated from the nine canonical scenario JSON files.';
export const LIVE_QUALITY_DATASET_SPLIT = 'acceptance';
// v1 remains untouched; this corpus publishes to a separately owned v2 dataset after review.
export const LIVE_QUALITY_SCHEMA_VERSION = 'kfc-live-quality-v2';
export const LIVE_QUALITY_INVENTORY_VERSION = '2026-07-19.1';
export const LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST =
  'a340596061d621777f0b46b3e435c7f956e368af2ca18d65a1180ed62479995f';
export const LIVE_QUALITY_EXPECTED_SCENARIO_COUNT = 9;
export const LIVE_QUALITY_EXPECTED_TURN_COUNT = 48;
export const LIVE_QUALITY_EXPECTED_CASE_COUNT = LIVE_QUALITY_EXPECTED_TURN_COUNT * 2;
export const LIVE_QUALITY_REPETITIONS = 3;
export const LIVE_QUALITY_EXPECTED_RUNS_PER_PROVIDER =
  LIVE_QUALITY_EXPECTED_SCENARIO_COUNT * 2 * LIVE_QUALITY_REPETITIONS;
export const LIVE_QUALITY_EXPECTED_EVALUATIONS_PER_PROVIDER =
  LIVE_QUALITY_EXPECTED_TURN_COUNT * 2 * LIVE_QUALITY_REPETITIONS;
export const LIVE_QUALITY_SYNC_OWNER = 'kfc-live-quality-dataset-sync';
export const LIVE_QUALITY_SOURCE_PATH = 'ai-talent-tracks/fnb/conversations/*.json';

export type LiveQualityMode = 'genui' | 'text';
export type LiveQualityProvider = 'openai' | 'gemini';
export type ObservableStateKey =
  | 'cart'
  | 'address'
  | 'fulfillment'
  | 'order'
  | 'paymentAttempt'
  | 'handoff'
  | 'customerContext'
  | 'promotionContext'
  | 'contentEvidence'
  | 'paymentMethodEvidence'
  | 'invoiceRequest'
  | 'cancellationStatusChecked';
export type ObservableEffect =
  | 'cart_mutated'
  | 'fulfillment_changed'
  | 'order_created'
  | 'payment_changed'
  | 'handoff_created'
  | 'approval_requested'
  | 'voucher_acquired'
  | 'reward_redeemed'
  | 'private_contact_disclosed';

export interface OutcomeFact {
  source: 'state' | 'genui' | 'presentation';
  path: string;
  operator: 'present' | 'absent' | 'equals' | 'contains' | 'set_equals' | 'lte' | 'gte';
  value?: unknown;
}

export interface CollectionExpectation {
  key: string;
  scope: 'all' | 'filtered';
  minItems: number;
  maxItems?: number;
  exactVerifiedItems: boolean;
  requireComplete: boolean;
  requiredCategories: string[];
  requireCategoryTabs: boolean;
  selectionLimit?: number;
}

export interface ScenarioTurnOutcome {
  state: {
    mustChange: ObservableStateKey[];
    mustNotChange: ObservableStateKey[];
    facts: OutcomeFact[];
  };
  effects: {
    required: ObservableEffect[];
    forbidden: ObservableEffect[];
  };
  presentation: {
    genUi: {
      required: boolean;
      allowedWidgetKinds: KfcGenUiWidgetKind[];
      requiredDataPaths: string[];
      forbiddenActions: string[];
    };
    collections: CollectionExpectation[];
  };
  provenance: {
    requiredEvidenceKinds: string[];
    requireOfficialSameReference: boolean;
  };
  persistence: {
    transcriptDelta: 2;
    contiguousEvents: true;
    checkpointRequired: true;
  };
  latency: { maxTurnMs: number };
}

export interface TurnExpectation {
  id: string;
  turnIndex: number;
  input: string;
  useCaseIds: string[];
  outcome: ScenarioTurnOutcome;
}

export interface LiveScenarioCase {
  schemaVersion: 'kfc-outcome-scenario-v2';
  fileName: string;
  id: string;
  title: string;
  channel: 'messenger_mock' | 'zalo_mock' | 'kfc';
  goal: string;
  useCases: string[];
  finalState: string;
  setup: {
    requiresCustomerAccess: boolean;
    seedPaidOrder: boolean;
    seedPendingPayment: boolean;
  };
  turnExpectations: TurnExpectation[];
}

export interface LiveQualityDatasetInputs {
  caseId: string;
  scenarioFile: string;
  scenario: {
    id: string;
    title: string;
    channel: LiveScenarioCase['channel'];
    goal: string;
    useCaseIds: string[];
    finalState: string;
    setup: LiveScenarioCase['setup'];
  };
  turnIndex: number;
  mode: LiveQualityMode;
  customerMessage: string;
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

export interface CollectionSnapshot {
  scope: 'all' | 'filtered';
  itemIds: string[];
  categories: string[];
  total: number;
  returned: number;
  complete: boolean;
  categoryTabs?: string[];
  selectionLimit?: number;
}

export interface LiveQualityEvidence {
  kind: string;
  ref: string;
  official: boolean;
  sourceFile?: string;
  sourceUrl?: string;
  sourceApi?: string;
}

export interface LiveQualityExperimentOutput {
  responseText: string;
  effects: Array<{
    kind: ObservableEffect;
    ok: boolean;
    receiptId?: string;
  }>;
  evidence: LiveQualityEvidence[];
  stateBefore: Record<string, unknown>;
  stateAfter: Record<string, unknown>;
  presentationFacts: Record<string, unknown>;
  verifiedCollections: Record<string, CollectionSnapshot>;
  presentedCollections: Record<string, CollectionSnapshot>;
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
    | 'state'
    | 'effects'
    | 'grounding'
    | 'presentation'
    | 'provenance'
    | 'persistence'
    | 'latency'
    | 'mode_parity'
    | 'acceptance';
  score: boolean;
  comment?: string;
}
