import {
  isGraphInterrupt,
} from '@langchain/langgraph';
import type {
  KfcAgentStateUpdate,
  KfcAgentStateValue,
} from './agentStateSchema.js';
import type {
  AgentRuntime,
} from './agentRuntimeScope.js';
import type {
  SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';

type RuntimeResolver = (
  state: KfcAgentStateValue,
  runtime: AgentRuntime,
) => Promise<SingleAgentRuntimeContext>;

type GraphNode = (
  state: KfcAgentStateValue,
  runtime: AgentRuntime,
) => KfcAgentStateUpdate | Promise<KfcAgentStateUpdate>;

type GraphRoute = (
  state: KfcAgentStateValue,
) => string | Promise<string>;

type NamedGraphNodes<Names extends readonly string[]> = Record<
  Names[number],
  GraphNode
>;

type NamedGraphRoutes<Names extends readonly string[]> = Record<
  Names[number],
  GraphRoute
>;

export interface PrivacySafeGraphTraceState {
  providerAttempts?: number;
  providerRetries?: number;
  semanticCorrections?: number;
  pendingToolCalls?: readonly unknown[];
  queuedToolCalls?: readonly unknown[];
  graphExecutedToolResults?: readonly unknown[];
  structuredAction?: unknown;
  failure?: unknown;
  validationError?: unknown;
  providerAttemptEvidence?: ReadonlyArray<{
    attempt?: unknown;
    outcome?: unknown;
    purpose?: unknown;
    errorClass?: unknown;
    retryable?: unknown;
  }>;
  providerFailure?: {
    errorClass?: unknown;
    retryable?: unknown;
  } | null;
}

const providerAttemptOutcomes =
  new Set(['error', 'invalid_response', 'success']);
const providerAttemptPurposes = new Set([
  'agent_decision',
  'response_composition',
]);
const providerErrorClasses = new Set([
  'aborted',
  'client_error',
  'network_error',
  'rate_limited',
  'server_error',
  'timeout',
  'unknown',
]);

const validationErrorCategories: Readonly<Record<string, string>> = {
  invalid_tool_call: 'tool_call_invalid',
  invalid_tool_arguments: 'tool_arguments_invalid',
  agent_tool_not_advertised: 'tool_not_advertised',
  agent_tool_profile_stale: 'tool_profile_stale',
  approval_batch_shape_invalid: 'approval_batch_invalid',
  duplicate_tool_call: 'duplicate_tool_call',
  structured_response_commerce_tool_forbidden: 'tool_contract_invalid',
  structured_action_tool_contract_invalid: 'tool_contract_invalid',
  structured_action_saved_address_ref_unavailable:
    'saved_address_authority_invalid',
  structured_action_saved_address_ref_missing:
    'saved_address_authority_invalid',
  structured_action_saved_address_payload_invalid:
    'saved_address_authority_invalid',
  structured_action_saved_address_conflicts_with_draft:
    'saved_address_authority_invalid',
  structured_action_verified_state_stale: 'verified_state_stale',
  structured_action_cart_required: 'cart_required',
  unverified_payment_method: 'payment_method_unverified',
  agent_grounded_response_invalid: 'response_grounding_invalid',
  agent_response_claim_unsupported: 'response_grounding_invalid',
  agent_response_evidence_mismatch: 'response_grounding_invalid',
  agent_response_official_source_required: 'response_grounding_invalid',
  agent_model_publication_reference_invalid: 'response_publication_invalid',
  agent_model_publication_authority_invalid: 'response_publication_invalid',
  agent_response_publication_rejected: 'response_publication_invalid',
  agent_private_saved_address_disclosure_forbidden:
    'private_saved_address_disclosure_blocked',
  selected_action_semantic_target_missing: 'selected_action_response_invalid',
  selected_action_semantic_attestation_missing:
    'selected_action_response_invalid',
  selected_action_semantic_alignment_rejected:
    'selected_action_response_invalid',
  selected_action_rejection_authority_missing:
    'selected_action_response_invalid',
  selected_action_tool_effect_missing: 'selected_action_response_invalid',
  selected_action_response_authority_missing:
    'selected_action_response_invalid',
  selected_action_response_reference_required:
    'selected_action_response_invalid',
  selected_action_response_reference_invalid:
    'selected_action_response_invalid',
  selected_action_response_authority_invalid:
    'selected_action_response_invalid',
  selected_action_response_current_authority_invalid:
    'selected_action_response_invalid',
  selected_action_response_stale_outcome: 'selected_action_response_invalid',
  selected_action_response_action_mismatch:
    'selected_action_response_invalid',
  selected_action_response_effect_mismatch:
    'selected_action_response_invalid',
  selected_action_response_revision_mismatch:
    'selected_action_response_invalid',
  selected_action_response_entity_mismatch:
    'selected_action_response_invalid',
  selected_action_response_mutation_unverified:
    'selected_action_response_invalid',
};

function validationErrorCategory(value: unknown): string | null {
  return typeof value === 'string'
    ? validationErrorCategories[value] ?? null
    : null;
}

function boundedEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
): string | null {
  return typeof value === 'string' && allowed.has(value)
    ? value
    : null;
}

/**
 * A deliberately bounded graph-state projection for LangSmith. It contains no
 * messages, customer prose, model output, tool names/arguments/results,
 * addresses, contact details, provider errors, or secrets.
 */
export function privacySafeGraphTraceState(
  state: PrivacySafeGraphTraceState,
): Record<string, boolean | number | string | null> {
  const latestAttempt = state.providerAttemptEvidence?.at(-1);
  return {
    providerAttempts: state.providerAttempts ?? 0,
    providerRetries: state.providerRetries ?? 0,
    semanticCorrections: state.semanticCorrections ?? 0,
    pendingToolCallCount: state.pendingToolCalls?.length ?? 0,
    queuedToolCallCount: state.queuedToolCalls?.length ?? 0,
    executedToolResultCount: state.graphExecutedToolResults?.length ?? 0,
    hasStructuredAction: state.structuredAction != null,
    hasFailure: state.failure != null,
    failureCategory: validationErrorCategory(state.failure),
    hasValidationError: state.validationError != null,
    validationErrorCategory: validationErrorCategory(state.validationError),
    latestProviderAttempt:
      typeof latestAttempt?.attempt === 'number' &&
        Number.isSafeInteger(latestAttempt.attempt) &&
        latestAttempt.attempt >= 0
        ? latestAttempt.attempt
        : null,
    latestProviderOutcome: boundedEnum(
      latestAttempt?.outcome,
      providerAttemptOutcomes,
    ),
    latestProviderPurpose: boundedEnum(
      latestAttempt?.purpose,
      providerAttemptPurposes,
    ),
    latestProviderErrorClass: boundedEnum(
      latestAttempt?.errorClass,
      providerErrorClasses,
    ),
    latestProviderRetryable:
      typeof latestAttempt?.retryable === 'boolean'
        ? latestAttempt.retryable
        : null,
    providerFailureErrorClass: boundedEnum(
      state.providerFailure?.errorClass,
      providerErrorClasses,
    ),
    providerFailureRetryable:
      typeof state.providerFailure?.retryable === 'boolean'
        ? state.providerFailure.retryable
        : null,
  };
}

function privacySafeNodeOutputs(
  update: KfcAgentStateUpdate,
): Record<string, unknown> {
  const failureCategory = validationErrorCategory(update.failure);
  const validationCategory = validationErrorCategory(update.validationError);
  return {
    status: 'completed',
    updateKeys: Object.keys(update).sort(),
    emittedFailure: update.failure != null,
    emittedValidationError: update.validationError != null,
    ...(failureCategory ? { failureCategory } : {}),
    ...(validationCategory
      ? { validationErrorCategory: validationCategory }
      : {}),
  };
}

export function traceAgentGraphNode(
  nodeName: string,
  node: GraphNode,
  resolveRuntime: RuntimeResolver,
): GraphNode {
  return async (state, graphRuntime) => {
    const runtime = await resolveRuntime(state, graphRuntime);
    const span = await runtime.turnTrace.startSpan({
      name: nodeName,
      runType: 'chain',
      inputs: {
        node: nodeName,
        ...privacySafeGraphTraceState(state),
      },
      metadata: {},
      tags: ['agent-graph-node'],
    });
    try {
      const update = await node(state, graphRuntime);
      const observedUpdate = {
        ...update,
        graphTrace: runtime.turnTrace,
      };
      await span.end(privacySafeNodeOutputs(observedUpdate));
      return observedUpdate;
    } catch (error) {
      if (isGraphInterrupt(error)) {
        await span.end({ status: 'interrupted' });
      } else {
        // The tracer receives only a constant error. Application failures may
        // contain provider details or other data that must not enter a trace.
        await span.fail(new Error('agent_graph_node_failed_closed'));
      }
      throw error;
    }
  };
}

export function traceAgentGraphRoute(
  sourceNode: string,
  route: GraphRoute,
): (
  state: KfcAgentStateValue,
) => Promise<string> {
  return async (state) => {
    const turnTrace = state.graphTrace;
    if (!turnTrace) {
      throw new Error('agent_graph_trace_context_missing');
    }
    const span = await turnTrace.startSpan({
      name: `route:${sourceNode}`,
      runType: 'chain',
      inputs: {
        sourceNode,
        ...privacySafeGraphTraceState(state),
      },
      metadata: {},
      tags: ['agent-graph-route'],
    });
    try {
      const destination = await route(state);
      await span.end({ destination });
      return destination;
    } catch (error) {
      await span.fail(new Error('agent_graph_route_failed_closed'));
      throw error;
    }
  };
}

export function traceAgentGraphNodes<const Names extends readonly string[]>(
  names: Names,
  nodes: NamedGraphNodes<Names>,
  resolveRuntime: RuntimeResolver,
): NamedGraphNodes<Names> {
  const traced = {} as NamedGraphNodes<Names>;
  for (const name of names as readonly Names[number][]) {
    traced[name] = traceAgentGraphNode(
      name,
      nodes[name],
      resolveRuntime,
    );
  }
  return traced;
}

export function traceAgentGraphRoutes<const Names extends readonly string[]>(
  names: Names,
  routes: NamedGraphRoutes<Names>,
): NamedGraphRoutes<Names> {
  const traced = {} as NamedGraphRoutes<Names>;
  for (const name of names as readonly Names[number][]) {
    traced[name] = traceAgentGraphRoute(name, routes[name]);
  }
  return traced;
}
