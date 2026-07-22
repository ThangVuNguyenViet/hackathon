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
  SCENARIO_MUTABLE_STATE_KEYS,
  type LiveQualityDatasetCase,
  type LiveQualityV3TurnExpectation,
  type LiveScenarioCase,
  type TurnExpectation,
} from './liveQualityContracts.js';

const nonEmptyString = z.string().min(1);
const toolNameSchema = z.enum(TOOL_NAMES);
const widgetKindSchema = z.enum(KFC_GENUI_WIDGET_KINDS);
const mutableStateSchema = z.enum(SCENARIO_MUTABLE_STATE_KEYS);

const semanticResponseActSchema = z.enum([
  'acknowledge_delivery_note_and_invoice_intent',
  'compare_verified_menu_items',
  'recommend_supported_non_spicy_option',
  'recommend_verified_value_conversion_with_consent',
  'apply_verified_value_conversion_after_consent',
  'describe_preference_without_allergen_claim',
  'disclose_unverified_allergen_safety',
  'report_verified_item_unavailable',
  'clarify_availability_or_address',
  'reject_post_order_mutation',
  'request_reorder_confirmation',
  'acknowledge_complaint_without_invented_resolution',
  'handle_unintelligible_input',
  'clarify_ambiguous_reference',
  'refuse_private_employee_contact',
  'request_personalized_selection_confirmation',
  'recommend_verified_food_and_drink_for_group_budget',
  'clarify_interpreted_order_before_mutation',
  'request_membership_action_confirmation_without_execution',
  'avoid_internal_metadata_disclosure',
  'explain_human_handoff',
]);

const argumentConstraintSchema = z
  .object({
    path: nonEmptyString,
    operator: z.enum([
      'exists',
      'absent',
      'equals',
      'one_of',
      'equals_state_path',
    ]),
    value: z.unknown().optional(),
    values: z.array(z.unknown()).optional(),
    statePath: nonEmptyString.optional(),
    stateSource: z.enum(['before', 'after']).optional(),
  })
  .strict()
  .superRefine((constraint, context) => {
    if (constraint.operator === 'equals' && constraint.value === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'equals requires value',
      });
    }
    if (constraint.operator === 'one_of' && !constraint.values?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'one_of requires values',
      });
    }
    if (constraint.operator === 'equals_state_path' && !constraint.statePath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'equals_state_path requires statePath',
      });
    }
  });

const statePathConstraintSchema = z
  .object({
    path: nonEmptyString,
    operator: z.enum(['changed', 'unchanged', 'equals', 'present', 'absent']),
    value: z.unknown().optional(),
  })
  .strict()
  .superRefine((constraint, context) => {
    if (constraint.operator === 'equals' && constraint.value === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'equals requires value',
      });
    }
  });

const semanticClaimSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('semantic_response'),
      requirementId: nonEmptyString,
      act: semanticResponseActSchema,
      description: nonEmptyString,
    })
    .strict(),
  z
    .object({
      kind: z.literal('grounded_tool_outcome'),
      requirementId: nonEmptyString,
      anyOf: z.array(toolNameSchema).min(1),
      expectedOk: z.union([z.boolean(), z.literal('either')]),
      resultSummaryOneOf: z.array(nonEmptyString),
      statePaths: z.array(nonEmptyString),
      genUiPaths: z.array(nonEmptyString),
      textAnyOf: z.array(nonEmptyString),
    })
    .strict(),
]);

const liveQualityV3SemanticClaimSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('semantic_response'),
      requirementId: nonEmptyString,
      act: semanticResponseActSchema,
      description: nonEmptyString,
    })
    .strict(),
  z
    .object({
      kind: z.literal('grounded_tool_outcome'),
      requirementId: nonEmptyString,
      anyOf: z.array(toolNameSchema).min(1),
      expectedOk: z.union([z.boolean(), z.literal('either')]),
      resultSummaryOneOf: z.array(nonEmptyString),
      statePaths: z.array(nonEmptyString),
      genUiPaths: z.array(nonEmptyString),
    })
    .strict(),
]);

export const turnExpectationSchema = z
  .object({
    id: nonEmptyString,
    input: nonEmptyString,
    preconditions: z.array(nonEmptyString).min(1),
    evidenceBindings: z.array(nonEmptyString).min(1),
    toolCounts: z.array(
      z
        .object({
          toolName: toolNameSchema,
          min: z.number().int().nonnegative(),
          max: z.number().int().nonnegative().optional(),
        })
        .strict(),
    ),
    toolOrder: z.array(toolNameSchema),
    toolOrderGroups: z.array(z.array(toolNameSchema).min(1)),
    argumentConstraints: z.array(
      z
        .object({
          toolName: toolNameSchema,
          constraints: z.array(argumentConstraintSchema).min(1),
          argumentEncoding: z.literal('sha256_digest_only').optional(),
        })
        .strict(),
    ),
    stateTransition: z
      .object({
        mayChange: z.array(mutableStateSchema),
        mustChange: z.array(mutableStateSchema),
        mustNotChange: z.array(mutableStateSchema),
        pathConstraints: z.array(statePathConstraintSchema),
      })
      .strict(),
    claims: z
      .object({
        required: z.array(semanticClaimSchema).min(1),
        forbidden: z.array(nonEmptyString),
      })
      .strict(),
    genUi: z
      .object({
        required: z.boolean(),
        requireCompleteMenuCollection: z.boolean().optional(),
        allowedWidgetKinds: z.array(widgetKindSchema),
        requiredDataPaths: z.array(nonEmptyString),
        requiredActions: z.array(nonEmptyString),
        forbiddenActions: z.array(nonEmptyString),
      })
      .strict(),
    messenger: z
      .object({
        projection: z.literal('semantic_parity'),
        forbiddenText: z.array(nonEmptyString),
      })
      .strict(),
    providerEvidence: z
      .object({
        requireToolProvenance: z.boolean(),
        requireRevisionOrSource: z.boolean(),
        providerTools: z.array(toolNameSchema),
        acceptedFailedTools: z.array(toolNameSchema),
      })
      .strict(),
    persistenceEvidence: z
      .object({
        transcriptDelta: z.literal(2),
        contiguousEvents: z.literal(true),
        checkpointRequired: z.literal(true),
        checkpointReadable: z.literal(true),
      })
      .strict(),
    latency: z
      .object({
        maxTurnMs: z.number().int().positive(),
      })
      .strict(),
    artifacts: z.array(
      z.enum([
        'transcript',
        'tool_trace',
        'provider_evidence',
        'checkpoint',
        'genui',
        'messenger_projection',
      ]),
    ),
    turnIndex: z.number().int().positive(),
    useCaseIds: z.array(nonEmptyString).min(1),
    requiredGroups: z.array(z.array(toolNameSchema).min(1)).optional(),
    allowedTools: z.array(toolNameSchema),
    semanticResponse: z
      .array(
        z
          .object({
            act: semanticResponseActSchema,
            description: nonEmptyString,
          })
          .strict(),
      )
      .optional(),
    exactArguments: z
      .record(toolNameSchema, z.array(argumentConstraintSchema))
      .optional(),
    expectedToolOutcomes: z
      .record(
        toolNameSchema,
        z
          .object({
            ok: z.union([z.boolean(), z.literal('either')]),
            resultSummaryOneOf: z.array(nonEmptyString).optional(),
          })
          .strict(),
      )
      .optional(),
    statePathConstraints: z.array(statePathConstraintSchema).optional(),
    requiredCatalogCodes: z.array(nonEmptyString).optional(),
    requiredCatalogItemEvidence: z
      .array(
        z
          .object({
            code: nonEmptyString,
            available: z.boolean().optional(),
            priceVnd: z.number().int().nonnegative().optional(),
          })
          .strict(),
      )
      .optional(),
    requiredCatalogModifierEvidence: z
      .array(
        z
          .object({
            itemCode: nonEmptyString,
            groupId: nonEmptyString,
            modifierId: nonEmptyString,
            groupMin: z.number().int().nonnegative().optional(),
            default: z.boolean().optional(),
            quantity: z.number().int().nonnegative().optional(),
          })
          .strict(),
      )
      .optional(),
    requiredCatalogModifierText: nonEmptyString.optional(),
    requiredCatalogCategoryIds: z.array(nonEmptyString).optional(),
    requiredCatalogModifierIds: z.array(nonEmptyString).optional(),
    verifiedCatalogArgumentTools: z.array(toolNameSchema).optional(),
    requiredFulfillmentLocation: z
      .object({
        district: nonEmptyString,
        city: nonEmptyString,
      })
      .strict()
      .optional(),
    requiredBooleanEntities: z.array(nonEmptyString).optional(),
    forbiddenTools: z.array(toolNameSchema).optional(),
    allowEmptyTools: z.boolean().optional(),
    allowDeterministicExecution: z.boolean().optional(),
    enforceToolOrder: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<TurnExpectation>;

const liveScenarioAdvisoryMetadataSchema = z
  .object({
    role: z.enum(['core', 'supporting']),
    phaseEndTurnIndex: z.number().int().positive(),
    judgmentPolicy: z.enum(['warning', 'evidence_only', 'blocking']),
    criteria: z
      .array(
        z
          .object({
            id: nonEmptyString,
            description: nonEmptyString,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine(({ criteria }, context) => {
    const ids = criteria.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['criteria'],
        message: 'Advisory criterion IDs must be unique',
      });
    }
  });

export const liveScenarioCaseSchema = z
  .object({
    fileName: z.string().regex(/^\d{2}-[^/]+\.json$/),
    advisory: liveScenarioAdvisoryMetadataSchema.optional(),
    turnExpectations: z.array(turnExpectationSchema).min(1),
    targetWidgetKinds: z.array(widgetKindSchema).optional(),
    forbiddenWidgetKinds: z.array(widgetKindSchema).optional(),
    requiresCustomerAccess: z.boolean().optional(),
    seedPaidOrder: z.boolean().optional(),
    seedPendingPayment: z.boolean().optional(),
  })
  .strict()
  .superRefine(({ advisory, turnExpectations }, context) => {
    if (
      advisory &&
      !turnExpectations.some(
        ({ turnIndex }) => turnIndex === advisory.phaseEndTurnIndex,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['advisory', 'phaseEndTurnIndex'],
        message: 'Advisory phase end must reference a scenario turn',
      });
    }
  }) satisfies z.ZodType<LiveScenarioCase>;

export const liveQualityV3TurnExpectationSchema = turnExpectationSchema
  .omit({
    allowDeterministicExecution: true,
    enforceToolOrder: true,
    exactArguments: true,
    expectedToolOutcomes: true,
    semanticResponse: true,
    statePathConstraints: true,
    toolOrder: true,
    toolOrderGroups: true,
  })
  .extend({
    claims: z
      .object({
        required: z.array(liveQualityV3SemanticClaimSchema).min(1),
      })
      .strict(),
    messenger: z
      .object({
        projection: z.literal('semantic_parity'),
      })
      .strict(),
    responsePrivacy: z
      .object({
        internalMetadataDisclosure: z.literal('forbidden'),
      })
      .strict(),
  })
  .strict() satisfies z.ZodType<LiveQualityV3TurnExpectation>;

export const liveQualityDatasetCaseSchema = z
  .object({
    inputs: z
      .object({
        caseId: nonEmptyString,
        scenarioFile: z.string().regex(/^\d{2}-[^/]+\.json$/),
        turnIndex: z.number().int().positive(),
        mode: z.enum(['genui', 'text']),
        customerMessage: nonEmptyString,
        preconditions: z.array(nonEmptyString).min(1),
        evidenceBindings: z.array(nonEmptyString).min(1),
      })
      .strict(),
    outputs: z
      .object({
        expectation: turnExpectationSchema,
      })
      .strict(),
    metadata: z
      .object({
        caseId: nonEmptyString,
        schemaVersion: z.literal(LIVE_QUALITY_SCHEMA_VERSION),
        inventoryVersion: z.literal(LIVE_QUALITY_INVENTORY_VERSION),
        sourcePath: z.literal(LIVE_QUALITY_SOURCE_PATH),
        datasetName: z.literal(LIVE_QUALITY_DATASET_NAME),
        managedBy: z.literal(LIVE_QUALITY_SYNC_OWNER),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    split: z.literal(LIVE_QUALITY_DATASET_SPLIT),
  })
  .strict() satisfies z.ZodType<LiveQualityDatasetCase>;
