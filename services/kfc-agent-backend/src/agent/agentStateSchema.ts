import {
  StateSchema,
  UntrackedValue,
} from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import { z } from 'zod/v4';
import type {
  Channel,
  ConversationTurn,
  ConversationTurnMetadata,
} from '../domain/types.js';
import {
  trustedCustomerActionEnvelopeSchema,
  type TrustedCustomerActionEnvelope,
} from '../domain/customerCommand.js';
import type { AgentTurnOutput } from '../graph/agentTurnState.js';
import type { AgentGraphState } from '../graph/state.js';
import {
  TOOL_NAMES,
  type ToolName,
  type ToolTraceEntry,
} from '../ordering/types.js';
import type { ProviderFailure } from './agentBoundaryPolicy.js';
import type { ProviderAttemptEvidence } from './agentModelInvocation.js';
import type {
  OrdinaryToolBindingPhase,
} from './agentToolBindingManifest.js';
import type { PendingToolCall } from './singleAgentRuntime.js';
import {
  independentParallelReadToolNames,
} from './parallelReadBatch.js';
import type { AgentTraceSpan } from '../observability/agentTracing.js';
import {
  checkpointSafeApprovalSchema,
  type CheckpointSafeApproval,
} from './checkpointSafeApproval.js';
import {
  responseFactualClaimsSchema,
  type ResponseFactualClaims,
} from './responseGrounding.js';
import type { GraphExecutedToolResult } from './graphExecutedToolResult.js';
import type { ModelPublicationAuthority } from './modelPublicationAuthority.js';
import {
  CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_RESULT,
  CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_SCHEMA_VERSION,
  type CheckpointSafeToolEvidenceReceipt,
  type CurrentTurnResponseEvidence,
  type ModelPublicationBundle,
} from './modelPublicationProjection.js';
import {
  selectedActionResponseAuthoritySchema,
  selectedActionResponseReferenceSchema,
  type SelectedActionResponseAuthority,
  type SelectedActionResponseReference,
} from './selectedActionResponseAuthority.js';
import type {
  StructuredActionAfterTool,
  StructuredActionOutcome,
} from './structuredCustomerAction.js';
import {
  responsePublicationAttestationSchema,
  type ResponsePublicationAttestation,
} from './responsePrivacyAttestation.js';

interface SerializableStateField<Input, Output> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: 'zod';
    readonly types?: {
      readonly input: Input;
      readonly output: Output;
    };
    readonly validate: (
      value: unknown,
    ) =>
      | { readonly value: Output }
      | {
        readonly issues: ReadonlyArray<{
          readonly message: string;
          readonly path?: ReadonlyArray<PropertyKey>;
        }>;
      };
    readonly jsonSchema: {
      readonly input: () => Record<string, unknown>;
      readonly output: () => Record<string, unknown>;
    };
  };
}

/**
 * LangGraph 1.4's StateSchema implements Standard JSON Schema v1, while the
 * repository's pinned Zod 4 compatibility export predates that extension.
 * Keep the repository-wide Zod 3 dependency stable and adapt only graph-state
 * fields to the current LangGraph protocol.
 */
function stateField<Schema extends z.ZodType>(
  schema: Schema,
): SerializableStateField<z.input<Schema>, z.output<Schema>> {
  const jsonSchema = (io: 'input' | 'output') =>
    z.toJSONSchema(schema, {
      io,
      target: 'draft-7',
      unrepresentable: 'any',
    }) as Record<string, unknown>;
  return {
    '~standard': {
      version: 1,
      vendor: 'zod',
      validate: (value) => {
        const result = schema.safeParse(value);
        return result.success
          ? { value: result.data }
          : {
            issues: result.error.issues.map((issue) => ({
              message: issue.message,
              path: issue.path,
            })),
          };
      },
      jsonSchema: {
        input: () => jsonSchema('input'),
        output: () => jsonSchema('output'),
      },
    },
  };
}

const channelSchema: z.ZodType<Channel> = z.enum([
  'messenger',
  'zalo',
  'kfc',
  'messenger_mock',
  'zalo_mock',
]);

type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isStrictJsonValue(
  value: unknown,
  ancestors = new Set<object>(),
): value is JsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isStrictJsonValue(entry, ancestors))
    : isPlainObject(value) &&
      Reflect.ownKeys(value).every((key) => {
        if (typeof key !== 'string') return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor?.enumerable === true &&
          'value' in descriptor &&
          isStrictJsonValue(descriptor.value, ancestors);
      });
  ancestors.delete(value);
  return valid;
}

interface RuntimeSchema {
  safeParse(value: unknown): { success: boolean };
}

const strictJson = <Value>() =>
  z.custom<Value>(
    (value) => isStrictJsonValue(value),
    { message: 'Tracked state must be a finite, acyclic JSON value' },
  );

const checkedJson = <Value>(schema: RuntimeSchema) =>
  strictJson<Value>().refine(
    (value) => schema.safeParse(value).success,
    { message: 'Tracked state does not match its persisted schema' },
  );

const nullable = <Schema extends z.ZodType>(schema: Schema) =>
  schema.nullable().default(null);

const list = <Schema extends z.ZodType>(schema: Schema) =>
  z.array(schema).default(() => []);

const toolNameSchema: z.ZodType<ToolName> = z.enum(TOOL_NAMES);
const toolNameOrder = new Map(
  TOOL_NAMES.map((toolName, index) => [toolName, index]),
);
const independentToolNameSet = new Set<ToolName>(
  independentParallelReadToolNames,
);

function canonicalToolNameList(input?: {
  permitted?: ReadonlySet<ToolName>;
}): z.ZodType<ToolName[]> {
  return z.array(toolNameSchema).superRefine((toolNames, context) => {
    let previousIndex = -1;
    for (const [index, toolName] of toolNames.entries()) {
      const currentIndex = toolNameOrder.get(toolName);
      if (
        currentIndex === undefined ||
        currentIndex <= previousIndex ||
        (input?.permitted && !input.permitted.has(toolName))
      ) {
        context.addIssue({
          code: 'custom',
          path: [index],
          message: 'Tool names must be unique, permitted, and canonical',
        });
      }
      previousIndex = currentIndex ?? previousIndex;
    }
  }).default(() => []);
}

const checkpointSafeToolEvidenceReceiptSchema:
  z.ZodType<CheckpointSafeToolEvidenceReceipt> = z.object({
    schemaVersion: z.literal(
      CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_SCHEMA_VERSION,
    ),
    evidenceId: z.string().min(1),
    evidenceDigest: z.string().min(1),
    toolCallId: z.string().min(1),
    toolName: toolNameSchema,
    executionOutcome: z.enum(['success', 'error']),
    result: z.literal(CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_RESULT),
  }).strict();

const providerAttemptEvidenceSchema: z.ZodType<ProviderAttemptEvidence> =
  z.object({
    attempt: z.number().int().positive(),
    outcome: z.enum(['error', 'invalid_response', 'success']),
    errorClass: z.enum([
      'aborted',
      'client_error',
      'network_error',
      'rate_limited',
      'server_error',
      'timeout',
      'unknown',
    ]).optional(),
    retryable: z.boolean().optional(),
    purpose: z.enum([
      'agent_decision',
      'response_composition',
    ]),
  }).strict();

const providerFailureSchema: z.ZodType<ProviderFailure> = z.object({
  errorClass: z.enum([
    'aborted',
    'client_error',
    'network_error',
    'rate_limited',
    'server_error',
    'timeout',
    'unknown',
  ]),
  retryable: z.boolean(),
}).strict();

const untracked = <Value>() =>
  new UntrackedValue<Value>(undefined, { guard: false });

export const KfcAgentState = new StateSchema({
  messages: untracked<BaseMessage[]>(),
  sessionId: stateField(z.string().min(1)),
  customerId: stateField(z.string().min(1)),
  channel: stateField(channelSchema),
  text: untracked<string>(),
  externalMessageId: stateField(z.string().nullable().default(null)),
  metadata: untracked<ConversationTurnMetadata | null>(),
  domainState: untracked<AgentGraphState | null>(),
  graphTrace: untracked<AgentTraceSpan | null>(),
  currentTurnToolTrace: untracked<ToolTraceEntry[]>(),
  currentUserTurn: untracked<ConversationTurn | null>(),
  currentTurnId: stateField(z.string().min(1).nullable().default(null)),
  turnToolTraceStartIndex:
    stateField(z.number().int().nonnegative().default(0)),
  turnToolTracePrefixDigest: stateField(
    z.string().regex(/^[0-9a-f]{64}$/u).nullable().default(null),
  ),
  modelPublicationAuthority:
    untracked<ModelPublicationAuthority | null>(),
  modelPublicationBundle: untracked<ModelPublicationBundle | null>(),
  graphExecutedToolResults: untracked<GraphExecutedToolResult[]>(),
  currentTurnResponseEvidence:
    untracked<CurrentTurnResponseEvidence[]>(),
  toolEvidenceReceipts:
    stateField(list(checkpointSafeToolEvidenceReceiptSchema)),
  customerTurnCount: stateField(z.number().int().nonnegative().default(0)),
  turnDeadlineAt: stateField(z.number().nonnegative().default(0)),
  structuredAction: stateField(
    nullable(
      checkedJson<TrustedCustomerActionEnvelope>(
        trustedCustomerActionEnvelopeSchema,
      ),
    ),
  ),
  structuredActionRevisionValidated: stateField(z.boolean().default(false)),
  structuredActionAfterTool:
    stateField(nullable(
      z.enum(['prepare', 'respond']) satisfies
        z.ZodType<StructuredActionAfterTool>,
    )),
  structuredActionOutcome: stateField(nullable(
    z.enum([
      'customer_rejected',
      'presentation_ready',
      'tool_succeeded',
    ]) satisfies z.ZodType<StructuredActionOutcome>,
  )),
  selectedActionResponseAuthority:
    stateField(nullable(
      checkedJson<SelectedActionResponseAuthority>(
        selectedActionResponseAuthoritySchema,
      ),
    )),
  selectedActionResponseReference:
    stateField(nullable(
      checkedJson<SelectedActionResponseReference>(
        selectedActionResponseReferenceSchema,
      ),
    )),
  providerAttempts: stateField(
    z.number().int().nonnegative().default(0),
  ),
  providerAttemptEvidence: stateField(list(providerAttemptEvidenceSchema)),
  providerRetries: stateField(z.number().int().nonnegative().default(0)),
  semanticCorrections: stateField(
    z.number().int().nonnegative().default(0),
  ),
  advertisedToolNames: stateField(canonicalToolNameList()),
  ordinaryToolBindingPhase: stateField(
    z.enum(['initial', 'dependency_frontier', 'response_only'])
      .default('initial') satisfies z.ZodType<OrdinaryToolBindingPhase>,
  ),
  closedInitialIndependentToolNames: stateField(canonicalToolNameList({
    permitted: independentToolNameSet,
  })),
  consumedToolNames: stateField(canonicalToolNameList()),
  pendingToolCalls: untracked<PendingToolCall[]>(),
  queuedToolCalls: untracked<PendingToolCall[]>(),
  checkpointSafeApproval:
    stateField(nullable(
      checkedJson<CheckpointSafeApproval>(checkpointSafeApprovalSchema),
    )),
  providerFailure: stateField(nullable(providerFailureSchema)),
  validationError: stateField(z.string().nullable().default(null)),
  correctionMessagesNeeded: stateField(z.boolean().default(false)),
  approvalDecision: stateField(
    z.enum(['approve', 'reject']).nullable().default(null),
  ),
  validatedApprovalActionDigest:
    stateField(z.string().nullable().default(null)),
  responseText: untracked<string | null>(),
  responseFactualClaims: stateField(nullable(
    checkedJson<ResponseFactualClaims>(responseFactualClaimsSchema),
  )),
  responsePublicationAttestation: stateField(nullable(
    checkedJson<ResponsePublicationAttestation>(
      responsePublicationAttestationSchema,
    ),
  )),
  responsePublicationValidated: stateField(z.boolean().default(false)),
  output: untracked<AgentTurnOutput | null>(),
  failure: stateField(z.string().nullable().default(null)),
});

export type KfcAgentStateValue = typeof KfcAgentState.State;
export type KfcAgentStateUpdate = typeof KfcAgentState.Update;
