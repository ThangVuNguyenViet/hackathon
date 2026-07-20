import type { KfcGenUiWidgetKind } from '../genui/kfcGenUi.js';
import type { ToolName, ToolTraceEntry } from '../ordering/types.js';

export const LIVE_QUALITY_DATASET_NAME = 'kfc-live-quality-v2';
export const LIVE_QUALITY_DATASET_DESCRIPTION =
  'Repository-owned KFC live acceptance inventory. Regenerate from scenarioCoverageLedger.ts.';
export const LIVE_QUALITY_DATASET_SPLIT = 'acceptance';
export const LIVE_QUALITY_SCHEMA_VERSION = 'kfc-live-quality-v2';
export const LIVE_QUALITY_INVENTORY_VERSION = '2026-07-20.1';
export const LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST =
  '9684774444e7b844fab12de0da5b9530035aa8f8cf5b5c275fbebd68e2cb76d5';
export const LIVE_QUALITY_EXPECTED_SCENARIO_COUNT = 9;
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

export interface ScenarioArgumentConstraint {
  path: string;
  operator:
    | 'exists'
    | 'absent'
    | 'equals'
    | 'one_of'
    | 'equals_state_path';
  value?: unknown;
  values?: unknown[];
  statePath?: string;
  stateSource?: 'before' | 'after';
}

export interface ScenarioToolArgumentConstraint {
  toolName: ToolName;
  constraints: ScenarioArgumentConstraint[];
  argumentEncoding?: 'sha256_digest_only';
}

export interface ScenarioStatePathConstraint {
  path: string;
  operator: 'changed' | 'unchanged' | 'equals' | 'present' | 'absent';
  value?: unknown;
}

export const SCENARIO_MUTABLE_STATE_KEYS = [
  'cart',
  'address',
  'addressDraft',
  'fulfillment',
  'orderPreview',
  'order',
  'paymentAttempt',
  'handoff',
  'menuSearchResults',
  'activeMenuCollection',
  'menuItemDetail',
  'menuModifierOptions',
  'pendingSavedAddressRef',
  'promotionContext',
  'promotionOffers',
  'customerContext',
  'paymentMethodEvidence',
  'selectedPaymentMethod',
  'contentEvidence',
  'invoiceRequest',
] as const;

export type ScenarioMutableState =
  (typeof SCENARIO_MUTABLE_STATE_KEYS)[number];

export type ScenarioSemanticResponseAct =
  | 'acknowledge_delivery_note_and_invoice_intent'
  | 'clarify_availability_or_address'
  | 'reject_post_order_mutation'
  | 'request_reorder_confirmation'
  | 'acknowledge_complaint_without_invented_resolution'
  | 'handle_unintelligible_input'
  | 'clarify_ambiguous_reference'
  | 'refuse_private_employee_contact'
  | 'request_personalized_selection_confirmation'
  | 'recommend_verified_food_and_drink_for_group_budget'
  | 'clarify_interpreted_order_before_mutation'
  | 'request_membership_action_confirmation_without_execution'
  | 'avoid_internal_metadata_disclosure'
  | 'explain_human_handoff';

export type ScenarioSemanticClaimPredicate =
  | {
      kind: 'semantic_response';
      requirementId: string;
      act: ScenarioSemanticResponseAct;
      description: string;
    }
  | {
      kind: 'grounded_tool_outcome';
      requirementId: string;
      anyOf: ToolName[];
      expectedOk: boolean | 'either';
      resultSummaryOneOf: string[];
      statePaths: string[];
      genUiPaths: string[];
      /**
       * Legacy serialized compatibility only. Customer prose is judged
       * semantically and this field must never be scanned by the evaluator.
       */
      textAnyOf: string[];
    };

type GroundedToolOutcomeClaim = Extract<
  ScenarioSemanticClaimPredicate,
  { kind: 'grounded_tool_outcome' }
>;

export type LiveQualityV3SemanticClaimPredicate =
  | Extract<ScenarioSemanticClaimPredicate, { kind: 'semantic_response' }>
  | Omit<GroundedToolOutcomeClaim, 'textAnyOf'>;

export interface ScenarioTurnOracle {
  id: string;
  input: string;
  preconditions: string[];
  evidenceBindings: string[];
  toolCounts: ScenarioToolCountConstraint[];
  toolOrder: ToolName[];
  toolOrderGroups: ToolName[][];
  argumentConstraints: ScenarioToolArgumentConstraint[];
  stateTransition: {
    mayChange: ScenarioMutableState[];
    mustChange: ScenarioMutableState[];
    mustNotChange: ScenarioMutableState[];
    pathConstraints: ScenarioStatePathConstraint[];
  };
  claims: {
    required: ScenarioSemanticClaimPredicate[];
    /**
     * Required by the attested v2 serialized contract. The explicit v3
     * contract omits it because fixed customer-output phrases are not
     * agent-quality evidence.
     */
    forbidden: string[];
  };
  genUi: {
    required: boolean;
    /**
     * Focused runtime contract outside the attested v2 inventory.
     */
    requireCompleteMenuCollection?: boolean;
    allowedWidgetKinds: KfcGenUiWidgetKind[];
    requiredDataPaths: string[];
    requiredActions: string[];
    forbiddenActions: string[];
  };
  messenger: {
    projection: 'semantic_parity';
    /**
     * Required by the attested v2 serialized contract. The explicit v3
     * contract omits it because fixed customer-output phrases are not
     * agent-quality evidence.
     */
    forbiddenText: string[];
  };
  providerEvidence: {
    requireToolProvenance: boolean;
    requireRevisionOrSource: boolean;
    providerTools: ToolName[];
    acceptedFailedTools: ToolName[];
  };
  persistenceEvidence: {
    transcriptDelta: 2;
    contiguousEvents: true;
    checkpointRequired: true;
    checkpointReadable: true;
  };
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
  semanticResponse?: Array<{
    act: ScenarioSemanticResponseAct;
    description: string;
  }>;
  exactArguments?: Partial<Record<ToolName, ScenarioArgumentConstraint[]>>;
  expectedToolOutcomes?: Partial<Record<ToolName, {
    ok: boolean | 'either';
    resultSummaryOneOf?: string[];
  }>>;
  statePathConstraints?: ScenarioStatePathConstraint[];
  requiredCatalogCodes?: string[];
  requiredCatalogItemEvidence?: Array<{
    code: string;
    available?: boolean;
  }>;
  requiredCatalogModifierText?: string;
  requiredCatalogCategoryIds?: string[];
  requiredCatalogModifierIds?: string[];
  verifiedCatalogArgumentTools?: ToolName[];
  requiredFulfillmentLocation?: { district: string; city: string };
  requiredBooleanEntities?: string[];
  forbiddenTools?: ToolName[];
  allowEmptyTools?: boolean;
  /**
   * Legacy serialized compatibility only. Deterministic semantic execution is
   * never accepted by the evaluator.
   */
  allowDeterministicExecution?: boolean;
  enforceToolOrder?: boolean;
}

/**
 * Big-bang v3 quality contract. It deliberately omits v2 builder and
 * compatibility fields that are not acceptance evidence.
 */
export type LiveQualityV3TurnExpectation = Omit<
  TurnExpectation,
  | 'allowDeterministicExecution'
  | 'enforceToolOrder'
  | 'exactArguments'
  | 'expectedToolOutcomes'
  | 'semanticResponse'
  | 'statePathConstraints'
  | 'toolOrder'
  | 'toolOrderGroups'
  | 'claims'
  | 'messenger'
> & {
  claims: {
    required: LiveQualityV3SemanticClaimPredicate[];
  };
  messenger: {
    projection: 'semantic_parity';
  };
  responsePrivacy: {
    internalMetadataDisclosure: 'forbidden';
  };
};

export type LiveQualityEvaluationExpectation =
  | TurnExpectation
  | LiveQualityV3TurnExpectation;

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

export interface LiveQualityDatasetOutputs<
  Expectation extends { id: string } = TurnExpectation,
> {
  expectation: Expectation;
}

export interface ManagedLiveQualityDatasetIdentity<
  DatasetName extends string = string,
  SchemaVersion extends string = string,
  SourcePath extends string = string,
  ManagedBy extends string = string,
  Split extends string = string,
> {
  datasetName: DatasetName;
  schemaVersion: SchemaVersion;
  sourcePath: SourcePath;
  managedBy: ManagedBy;
  split: Split;
}

export interface ManagedLiveQualityDatasetCase<
  DatasetName extends string = string,
  SchemaVersion extends string = string,
  SourcePath extends string = string,
  ManagedBy extends string = string,
  Split extends string = string,
  Expectation extends { id: string } = TurnExpectation,
> {
  inputs: LiveQualityDatasetInputs;
  outputs: LiveQualityDatasetOutputs<Expectation>;
  metadata: {
    caseId: string;
    schemaVersion: SchemaVersion;
    inventoryVersion: string;
    sourcePath: SourcePath;
    datasetName: DatasetName;
    managedBy: ManagedBy;
    fingerprint: string;
  };
  split: Split;
}

export type LiveQualityDatasetCase = ManagedLiveQualityDatasetCase<
  typeof LIVE_QUALITY_DATASET_NAME,
  typeof LIVE_QUALITY_SCHEMA_VERSION,
  typeof LIVE_QUALITY_SOURCE_PATH,
  typeof LIVE_QUALITY_SYNC_OWNER,
  typeof LIVE_QUALITY_DATASET_SPLIT
>;

export type LiveQualityV3DatasetCase = ManagedLiveQualityDatasetCase<
  string,
  string,
  string,
  string,
  string,
  LiveQualityV3TurnExpectation
>;

export interface LiveQualityObservation {
  kind: 'payment_status_refreshed';
  toolName: 'checkPaymentStatus';
  orderId: string;
  status: 'pending' | 'paid' | 'failed';
}

export interface LiveQualityExperimentOutput {
  responseText: string;
  /**
   * Legacy runner compatibility only. Planner records never satisfy a tool,
   * identifier, semantic, or provider-evidence obligation.
   */
  plannerRecords?: Array<{
    toolNames: ToolName[];
    calls: Array<{ toolName: ToolName; arguments: Record<string, unknown> }>;
    error?: string;
    booleanEntities: Record<string, boolean>;
    catalogCandidateCodes: string[];
    catalogModifierOptionNames: string[];
    fulfillmentLocations: Array<{ district: string; city: string }>;
  }>;
  executedTools: ToolTraceEntry[];
  observations?: LiveQualityObservation[];
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
    checkpointThreadId?: string;
    checkpointVerified?: boolean;
  };
}

export type LiveQualityV3ExperimentOutput = Omit<
  LiveQualityExperimentOutput,
  'plannerRecords'
>;

export interface LiveQualityEvaluationScore {
  key:
    | 'tool_contract'
    | 'state_transition'
    | 'grounded_response'
    | 'semantic_response'
    | 'presentation_contract'
    | 'provider_evidence'
    | 'persistence'
    | 'latency'
    | 'acceptance';
  score: boolean;
  comment?: string;
}
