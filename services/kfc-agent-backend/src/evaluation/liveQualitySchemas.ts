import { z } from 'zod';
import { KFC_GENUI_WIDGET_KINDS } from '../genui/kfcGenUi.js';
import { TOOL_NAMES } from '../ordering/types.js';
import {
  LIVE_QUALITY_DATASET_NAME,
  LIVE_QUALITY_DATASET_SPLIT,
  LIVE_QUALITY_INVENTORY_VERSION,
  LIVE_QUALITY_SCHEMA_VERSION,
  LIVE_QUALITY_SOURCE_PATH,
  LIVE_QUALITY_SYNC_OWNER,
  type LiveQualityDatasetCase,
  type TurnExpectation,
} from './liveQualityContracts.js';

const nonEmptyString = z.string().min(1);
const toolNameSchema = z.enum(TOOL_NAMES);
const widgetKindSchema = z.enum(KFC_GENUI_WIDGET_KINDS);
const mutableStateSchema = z.enum([
  'cart',
  'address',
  'fulfillment',
  'order',
  'paymentAttempt',
  'handoff',
  'menuSearchResults',
  'promotionContext',
  'customerContext',
  'paymentMethodEvidence',
  'contentEvidence',
  'invoiceRequest',
]);

const semanticResponseActSchema = z.enum([
  'acknowledge_delivery_note_and_invoice_intent',
  'clarify_availability_or_address',
  'reject_post_order_mutation',
  'request_reorder_confirmation',
  'acknowledge_complaint_without_invented_resolution',
  'handle_unintelligible_input',
  'clarify_ambiguous_reference',
  'refuse_private_employee_contact',
  'request_personalized_selection_confirmation',
  'explain_human_handoff',
]);

const argumentConstraintSchema = z.object({
  path: nonEmptyString,
  operator: z.enum(['exists', 'equals', 'one_of', 'equals_state_path']),
  value: z.unknown().optional(),
  values: z.array(z.unknown()).optional(),
  statePath: nonEmptyString.optional(),
  stateSource: z.enum(['before', 'after']).optional(),
}).strict().superRefine((constraint, context) => {
  if (constraint.operator === 'equals' && constraint.value === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'equals requires value' });
  }
  if (constraint.operator === 'one_of' && !(constraint.values?.length)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'one_of requires values' });
  }
  if (constraint.operator === 'equals_state_path' && !constraint.statePath) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'equals_state_path requires statePath' });
  }
});

const statePathConstraintSchema = z.object({
  path: nonEmptyString,
  operator: z.enum(['changed', 'unchanged', 'equals', 'present', 'absent']),
  value: z.unknown().optional(),
}).strict().superRefine((constraint, context) => {
  if (constraint.operator === 'equals' && constraint.value === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'equals requires value' });
  }
});

const semanticClaimSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('semantic_response'),
    requirementId: nonEmptyString,
    act: semanticResponseActSchema,
    description: nonEmptyString,
  }).strict(),
  z.object({
    kind: z.literal('grounded_tool_outcome'),
    requirementId: nonEmptyString,
    anyOf: z.array(toolNameSchema).min(1),
    expectedOk: z.union([z.boolean(), z.literal('either')]),
    resultSummaryOneOf: z.array(nonEmptyString),
    statePaths: z.array(nonEmptyString),
    genUiPaths: z.array(nonEmptyString),
    textAnyOf: z.array(nonEmptyString),
  }).strict(),
]);

export const turnExpectationSchema = z.object({
  id: nonEmptyString,
  input: nonEmptyString,
  preconditions: z.array(nonEmptyString).min(1),
  evidenceBindings: z.array(nonEmptyString).min(1),
  toolCounts: z.array(z.object({
    toolName: toolNameSchema,
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative().optional(),
  }).strict()),
  toolOrder: z.array(toolNameSchema),
  toolOrderGroups: z.array(z.array(toolNameSchema).min(1)),
  argumentConstraints: z.array(z.object({
    toolName: toolNameSchema,
    constraints: z.array(argumentConstraintSchema).min(1),
  }).strict()),
  stateTransition: z.object({
    mayChange: z.array(mutableStateSchema),
    mustChange: z.array(mutableStateSchema),
    mustNotChange: z.array(mutableStateSchema),
    pathConstraints: z.array(statePathConstraintSchema),
  }).strict(),
  claims: z.object({
    required: z.array(semanticClaimSchema).min(1),
    forbidden: z.array(nonEmptyString),
  }).strict(),
  genUi: z.object({
    required: z.boolean(),
    allowedWidgetKinds: z.array(widgetKindSchema),
    requiredDataPaths: z.array(nonEmptyString),
    requiredActions: z.array(nonEmptyString),
    forbiddenActions: z.array(nonEmptyString),
  }).strict(),
  messenger: z.object({
    projection: z.literal('semantic_parity'),
    forbiddenText: z.array(nonEmptyString),
  }).strict(),
  providerEvidence: z.object({
    requireToolProvenance: z.boolean(),
    requireRevisionOrSource: z.boolean(),
    providerTools: z.array(toolNameSchema),
    acceptedFailedTools: z.array(toolNameSchema),
  }).strict(),
  persistenceEvidence: z.object({
    transcriptDelta: z.literal(2),
    contiguousEvents: z.literal(true),
    checkpointRequired: z.literal(true),
    checkpointReadable: z.literal(true),
  }).strict(),
  latency: z.object({
    maxTurnMs: z.number().int().positive(),
  }).strict(),
  artifacts: z.array(z.enum([
    'transcript',
    'tool_trace',
    'provider_evidence',
    'checkpoint',
    'genui',
    'messenger_projection',
  ])),
  turnIndex: z.number().int().positive(),
  useCaseIds: z.array(nonEmptyString).min(1),
  requiredGroups: z.array(z.array(toolNameSchema).min(1)).optional(),
  allowedTools: z.array(toolNameSchema),
  semanticResponse: z.array(z.object({
    act: semanticResponseActSchema,
    description: nonEmptyString,
  }).strict()).optional(),
  exactArguments: z.record(
    toolNameSchema,
    z.array(argumentConstraintSchema),
  ).optional(),
  expectedToolOutcomes: z.record(
    toolNameSchema,
    z.object({
      ok: z.union([z.boolean(), z.literal('either')]),
      resultSummaryOneOf: z.array(nonEmptyString).optional(),
    }).strict(),
  ).optional(),
  statePathConstraints: z.array(statePathConstraintSchema).optional(),
  requiredCatalogCodes: z.array(nonEmptyString).optional(),
  requiredCatalogModifierText: nonEmptyString.optional(),
  requiredFulfillmentLocation: z.object({
    district: nonEmptyString,
    city: nonEmptyString,
  }).strict().optional(),
  requiredBooleanEntities: z.array(nonEmptyString).optional(),
  forbiddenTools: z.array(toolNameSchema).optional(),
  allowEmptyTools: z.boolean().optional(),
  allowDeterministicExecution: z.boolean().optional(),
  enforceToolOrder: z.boolean().optional(),
}).strict() satisfies z.ZodType<TurnExpectation>;

export const liveQualityDatasetCaseSchema = z.object({
  inputs: z.object({
    caseId: nonEmptyString,
    scenarioFile: z.string().regex(/^\d{2}-[^/]+\.json$/),
    turnIndex: z.number().int().positive(),
    mode: z.enum(['genui', 'text']),
    customerMessage: nonEmptyString,
    preconditions: z.array(nonEmptyString).min(1),
    evidenceBindings: z.array(nonEmptyString).min(1),
  }).strict(),
  outputs: z.object({
    expectation: turnExpectationSchema,
  }).strict(),
  metadata: z.object({
    caseId: nonEmptyString,
    schemaVersion: z.literal(LIVE_QUALITY_SCHEMA_VERSION),
    inventoryVersion: z.literal(LIVE_QUALITY_INVENTORY_VERSION),
    sourcePath: z.literal(LIVE_QUALITY_SOURCE_PATH),
    datasetName: z.literal(LIVE_QUALITY_DATASET_NAME),
    managedBy: z.literal(LIVE_QUALITY_SYNC_OWNER),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  split: z.literal(LIVE_QUALITY_DATASET_SPLIT),
}).strict() satisfies z.ZodType<LiveQualityDatasetCase>;
