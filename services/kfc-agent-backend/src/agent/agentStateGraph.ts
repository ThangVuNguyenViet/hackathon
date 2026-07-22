import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, SystemMessage } from '@langchain/core/messages';
import {
  END,
  START,
  StateGraph,
  interrupt,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import {
  routeAfterApprovalResume,
  routePreparedStructuredAction,
} from './agentApprovalRouting.js';
import { persistAuthenticatedApprovalRejection } from './approvalRejectionPersistence.js';
import {
  classifyApprovalRevalidationFailure,
  createRejectionToolMessage,
} from './agentBoundaryPolicy.js';
import {
  KFC_AGENT_GRAPH_NODE_NAMES,
  KFC_AGENT_GRAPH_ROUTE_SOURCE_NAMES,
  requiredDomainState as domainState,
  type KfcAgentGraphInput,
  type KfcAgentRuntimeResolver,
} from './agentStateGraphContracts.js';
import {
  KfcAgentState,
  type KfcAgentStateUpdate as Update,
  type KfcAgentStateValue as State,
} from './agentStateSchema.js';
import {
  createAgentToolProfileResolver,
  type AgentToolCapabilityResolver,
} from './agentToolProfile.js';
import {
  AGENT_AFTER_TRUSTED_TOOL_DESTINATIONS,
  routeAfterTrustedTool,
} from './agentModelInvocation.js';
import {
  freshMessages,
  persistCompletedTurn,
  runtimeDispatchFailure,
  runtimeExternalCallFailure,
  runtimeContextSchema,
  toolCallRequiresApproval,
  validateApprovalResume,
  type PendingToolCall,
  type SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';
import {
  activePublicationTurn,
  loadPublicationTurn,
  modelPublicationContext,
  modelPublicationContextWithDiagnostics,
  publicationBundle,
  publicationToolTracePrefixDigest,
  publicationTurnUpdate,
} from './agentPublicationRuntime.js';
import {
  modelPresentationContext,
  resolveModelPresentationContext,
} from './agentPresentationContext.js';
import { executeAgentToolNode } from './agentToolExecutionNode.js';
import {
  prepareStructuredCustomerAction,
  structuredResponseMessages,
} from './structuredCustomerAction.js';
import { claimSavedAddressQuote } from './savedAddressVerifiedRef.js';
import {
  checkpointSafeApprovalFor,
  checkpointSafeApprovalInterrupt,
  checkpointSafeApprovalMatchesCall,
  rehydrateCheckpointSafeApprovalCall,
} from './checkpointSafeApproval.js';
import { persistAgentFailedClosedEvent } from './agentFailurePersistence.js';
import { activeAgentToolNames } from './agentActiveToolProfile.js';
import {
  createAgentRuntimeScope,
  type AgentRuntime,
} from './agentRuntimeScope.js';
import {
  traceAgentGraphNodes,
  traceAgentGraphRoutes,
} from './agentGraphObservability.js';
import { createKfcAgent } from './kfcCreateAgent.js';
import { createKfcSemanticAgentNode } from './kfcSemanticAgentNode.js';
import {
  buildSelectedActionGraphAuthorities,
  validateSelectedActionGroundedResponse,
} from './selectedActionResponseBoundary.js';
import {
  issueResponsePublicationAttestation,
  validateResponsePublicationDeclarationConsistency,
} from './responsePrivacyAttestation.js';
import { responseDisclosesPrivateSavedAddress } from './savedAddressVerifiedRef.js';
import {
  isIssuedModelPublicationBundle,
  type ModelPublicationBundle,
} from './modelPublicationProjection.js';
import { validateGroundedResponse } from './responseGrounding.js';
import {
  EXPLICIT_CART_ACTION_INCOMPLETE,
  explicitCartActionNeedsContinuation,
} from './explicitCartActionContinuation.js';

export const KFC_AGENT_RUNTIME_ID = 'langgraph-create-agent-workflow-v1';

const CORRECTABLE_GROUNDED_RESPONSE_ERRORS = new Set([
  'agent_grounded_response_invalid',
  'agent_model_publication_reference_invalid',
  'agent_response_claim_unsupported',
  'agent_response_evidence_mismatch',
  'agent_response_official_source_required',
  'agent_response_evidence_limitation_mismatch',
  'agent_response_customer_language_invalid',
]);

export { KFC_AGENT_GRAPH_NODE_NAMES, KFC_AGENT_GRAPH_ROUTE_SOURCE_NAMES };
export type { KfcAgentGraphInput, KfcAgentRuntimeResolver };
export {
  createKfcSemanticAgentNode,
  type KfcSemanticAgentLike,
  type KfcSemanticAgentNodeDependencies,
} from './kfcSemanticAgentNode.js';

export function createKfcAgentStateGraph(input: {
  model: BaseChatModel;
  checkpointer: BaseCheckpointSaver;
  resolveRuntime?: KfcAgentRuntimeResolver;
  resolveToolCapabilities?: AgentToolCapabilityResolver;
}) {
  if (!input.model.bindTools) {
    throw new Error('agent_model_tool_binding_unsupported');
  }
  const resolveToolProfile = createAgentToolProfileResolver(
    input.resolveToolCapabilities,
  );
  const { resolveRuntime } = createAgentRuntimeScope({
    resolveRuntime: input.resolveRuntime,
  });
  const activeToolNames = (state: State, runtime: SingleAgentRuntimeContext) =>
    activeAgentToolNames({
      state,
      runtime,
      resolveToolProfile,
    });
  const semanticAgent = createKfcAgent({ model: input.model });
  const semanticRuntimeByState = new WeakMap<
    object,
    SingleAgentRuntimeContext
  >();
  const semanticAgentNode = createKfcSemanticAgentNode({
    agent: semanticAgent,
    runtimeContextForState: async (state, config) => {
      const runtime = await resolveRuntime(state, config);
      semanticRuntimeByState.set(state, runtime);
      return runtime;
    },
    hydrateState: async (state, runtime) => {
      const hydrated = await activePublicationTurn({ state, runtime });
      runtime.state = hydrated.state;
      return publicationTurnUpdate(hydrated);
    },
    resolveActiveToolNames: (state, runtime) =>
      state.structuredAction
        ? []
        : [
            ...activeToolNames(
              state.domainState
                ? state
                : { ...state, domainState: runtime.state ?? null },
              runtime,
            ),
          ],
    resolveModelSystemContext: async (
      state,
      runtime,
      domainState,
      currentTurnToolTrace,
    ) => {
      if (state.structuredAction) return undefined;
      const bundle = await publicationBundle(
        {
          ...state,
          domainState,
          currentTurnToolTrace,
        },
        runtime,
      );
      const span = await runtime.turnTrace.startSpan({
        name: 'agent_publication_context_build',
        runType: 'chain',
        inputs: { stage: 'publication_context_build' },
        metadata: {},
        tags: ['agent-publication-context'],
      });
      try {
        const context = modelPublicationContextWithDiagnostics(bundle, null);
        await span.end({
          stage: 'publication_context_build',
          ...context.diagnostics,
        });
        return context.serialized;
      } catch (error) {
        await span.fail(error);
        throw error;
      }
    },
    validateStructuredResponse: async ({ state, response, runtime }) => {
      const span = await runtime.turnTrace.startSpan({
        name: 'agent_publication_validation',
        runType: 'chain',
        inputs: { stage: 'publication_validation' },
        metadata: {},
        tags: ['agent-publication-validation'],
      });
      try {
        const bundle = state.modelPublicationBundle;
        let result;
        if (!bundle || !isIssuedModelPublicationBundle(bundle)) {
          result = {
            ok: false as const,
            errorCode: 'agent_model_publication_authority_invalid',
            correctable: false,
          };
        } else if (
          explicitCartActionNeedsContinuation({
            currentUserMessage:
              state.currentUserTurn?.text ??
              state.domainState?.latestUserMessage,
            currentTurnToolTrace: state.currentTurnToolTrace,
          })
        ) {
          // A final response is premature while an explicit cart mutation is
          // still pending. Route this through the tool-enabled correction
          // before validating prose that should not have been authored yet.
          result = {
            ok: false as const,
            errorCode: EXPLICIT_CART_ACTION_INCOMPLETE,
            correctable: true,
          };
        } else {
          const validation = validateGroundedResponse({
            raw: response,
            bundle,
            currentUserMessage:
              state.currentUserTurn?.text ??
              state.domainState?.latestUserMessage,
            currentTurnToolTrace: state.currentTurnToolTrace,
          });
          if (!validation.ok) {
            result = {
              ok: false as const,
              errorCode: validation.errorCode,
              correctable: CORRECTABLE_GROUNDED_RESPONSE_ERRORS.has(
                validation.errorCode,
              ),
            };
          } else {
            const publicationConsistency =
              validateResponsePublicationDeclarationConsistency({
                raw: response.publicationDeclaration,
                bundle,
                factualClaims: response.factualClaims,
              });
            result = publicationConsistency.ok
              ? { ok: true as const }
              : publicationConsistency;
          }
        }
        await span.end({
          stage: 'publication_validation',
          validationCategory: result.ok ? 'accepted' : result.errorCode,
          correctable: result.ok ? false : result.correctable,
          citedEvidenceReferences:
            response.factualClaims.evidenceReferences.map((reference) => ({
              evidenceId: reference.evidenceId,
              claimKinds: [...reference.claimKinds],
            })),
          invalidEvidenceReferences:
            response.factualClaims.evidenceReferences.filter((reference) => {
              const evidence = bundle?.evidence.find(
                (entry) => entry.evidenceId === reference.evidenceId,
              );
              return (
                !evidence ||
                !bundle?.allowedEvidenceIds.includes(reference.evidenceId) ||
                reference.claimKinds.some(
                  (claimKind) => !evidence.claimKinds.includes(claimKind),
                )
              );
            }),
        });
        return result;
      } catch (error) {
        await span.fail(error);
        throw error;
      }
    },
    assertRuntimeActive: async (state) => {
      const runtime = semanticRuntimeByState.get(state);
      if (!runtime) throw new Error('agent_runtime_context_missing');
      const failure = await runtimeDispatchFailure(runtime);
      if (failure) throw new Error(failure);
    },
  });
  const invokeSemanticAgent = async (
    state: State,
    graphRuntime: AgentRuntime,
  ): Promise<Update> => {
    if (!state.structuredAction) {
      return semanticAgentNode(state, graphRuntime);
    }
    const outcome = state.structuredActionOutcome;
    if (!outcome) {
      return { failure: 'selected_action_effect_authority_missing' };
    }
    const runtime = await resolveRuntime(state, graphRuntime);
    const verifiedState = domainState(state);
    const authorities = buildSelectedActionGraphAuthorities({
      envelope: state.structuredAction,
      outcome,
      state: verifiedState,
      currentTurnToolTrace: state.currentTurnToolTrace,
      approvalDecision: state.approvalDecision,
      validatedApprovalActionDigest: state.validatedApprovalActionDigest,
    });
    if (!authorities.ok) return { failure: authorities.errorCode };

    let bundle: ModelPublicationBundle;
    try {
      bundle = await publicationBundle(
        { ...state, domainState: verifiedState },
        runtime,
      );
    } catch {
      return { failure: 'agent_model_publication_authority_invalid' };
    }
    const preparedState: State = {
      ...state,
      modelPublicationBundle: bundle,
      selectedActionResponseAuthority: authorities.authority,
      selectedActionResponseReference: null,
      messages: structuredResponseMessages({
        envelope: state.structuredAction,
        outcome,
        selectedActionResponseReference: authorities.reference,
        presentationContext: resolveModelPresentationContext(runtime.turnInput),
        publicationBundle: bundle,
        state: verifiedState,
        messages: state.messages,
      }),
    };
    const update = await semanticAgentNode(preparedState, graphRuntime);
    return {
      ...update,
      selectedActionResponseAuthority: authorities.authority,
    };
  };
  const appendTransientMessages = (state: State, update: Update): Update =>
    update.messages
      ? {
          ...update,
          messages: [...(state.messages ?? []), ...update.messages],
        }
      : update;

  const loadContext = async (
    _state: State,
    graphRuntime: AgentRuntime,
  ): Promise<Update> => {
    const runtime = await resolveRuntime(_state, graphRuntime);
    // Persistence failures intentionally escape; converting them to provider
    // failures would make state-store outages look retryable.
    const loaded = await loadPublicationTurn(runtime);
    runtime.state = loaded.state;
    return {
      domainState: loaded.state,
      currentTurnToolTrace: [],
      currentUserTurn: loaded.currentUserTurn,
      currentTurnId: loaded.currentUserTurn.id,
      turnToolTraceStartIndex: loaded.state.toolTrace?.length ?? 0,
      turnToolTracePrefixDigest: await publicationToolTracePrefixDigest(
        loaded.state.toolTrace ?? [],
      ),
      modelPublicationAuthority: loaded.authority,
      modelPublicationBundle: loaded.bundle,
      graphExecutedToolResults: [],
      currentTurnResponseEvidence: [],
      toolEvidenceReceipts: [],
      customerTurnCount: loaded.customerTurnCount,
      messages: [
        new SystemMessage(modelPresentationContext(runtime.turnInput)),
        new SystemMessage(modelPublicationContext(loaded.bundle, null)),
        ...freshMessages(
          loaded.state,
          runtime.turnInput,
          loaded.currentUserTurn,
        ),
      ],
      turnDeadlineAt: runtime.externalCallContext.deadlineAt,
      structuredAction: runtime.turnInput.trustedCustomerAction ?? null,
      structuredActionRevisionValidated: false,
      structuredActionAfterTool: null,
      structuredActionOutcome: null,
      selectedActionResponseAuthority: null,
      selectedActionResponseReference: null,
      providerAttempts: 0,
      providerAttemptEvidence: [],
      providerRetries: 0,
      semanticCorrections: 0,
      toolCallLedger: [],
      pendingToolCalls: [],
      queuedToolCalls: [],
      checkpointSafeApproval: null,
      providerFailure: null,
      providerFailureDiagnostic: null,
      validationError: null,
      approvalDecision: null,
      validatedApprovalActionDigest: null,
      responseText: null,
      responseProjectionDigest: null,
      responseFactualClaims: null,
      responsePublicationDeclaration: null,
      responsePublicationValidated: false,
      responsePublicationAttestation: null,
      output: null,
      failure: runtimeExternalCallFailure(runtime),
    };
  };

  const prepareStructuredAction = async (
    state: State,
    graphRuntime: AgentRuntime,
  ): Promise<Update> => {
    if (!state.structuredAction) {
      return { failure: 'structured_action_envelope_missing' };
    }
    if (
      state.structuredAction.command.kind === 'accept_fulfillment' &&
      state.structuredAction.command.savedAddressRef
    ) {
      const runtime = await resolveRuntime(state, graphRuntime);
      const cancellationFailure = await runtimeDispatchFailure(runtime);
      if (cancellationFailure) return { failure: cancellationFailure };
      const claimed = await claimSavedAddressQuote({
        envelope: state.structuredAction,
        turnInput: runtime.turnInput,
        state: domainState(state),
      });
      if (!claimed.ok) return { failure: claimed.errorCode };
      /*
       * The raw verified address exists only in this node's local execution
       * input. The checkpointed structured action carries the opaque ref, and
       * the node returns with pendingToolCalls empty.
       */
      const execution = await executeAgentToolNode({
        state: {
          ...state,
          domainState: claimed.state,
          pendingToolCalls: [claimed.call],
          queuedToolCalls: [],
          structuredActionRevisionValidated: true,
          structuredActionAfterTool: 'respond',
        },
        graphRuntime,
        resolveRuntime,
      });
      return {
        ...appendTransientMessages(state, execution),
        checkpointSafeApproval: null,
        structuredActionRevisionValidated: true,
        structuredActionAfterTool: 'respond',
      };
    }
    const prepared = prepareStructuredCustomerAction({
      envelope: state.structuredAction,
      revisionValidated: state.structuredActionRevisionValidated,
      state: domainState(state),
    });
    if (prepared.kind === 'reject') {
      return { failure: prepared.errorCode };
    }
    if (prepared.kind === 'present') {
      return {
        domainState: prepared.state,
        pendingToolCalls: [],
        queuedToolCalls: [],
        checkpointSafeApproval: null,
        structuredActionRevisionValidated: true,
        structuredActionAfterTool: 'respond',
        structuredActionOutcome: 'presentation_ready',
      };
    }
    const pendingToolCalls: PendingToolCall[] = [
      {
        id: `structured:${state.structuredAction.actionDigest}:${
          prepared.call.toolName
        }`,
        toolName: prepared.call.toolName,
        arguments: prepared.call.arguments,
      },
    ];
    return {
      pendingToolCalls,
      queuedToolCalls: [],
      checkpointSafeApproval: await checkpointSafeApprovalFor(
        await resolveRuntime(state, graphRuntime),
        pendingToolCalls,
      ),
      structuredActionRevisionValidated: true,
      structuredActionAfterTool: prepared.afterTool,
    };
  };

  const requestApproval = async (
    state: State,
    graphRuntime: AgentRuntime,
  ): Promise<Update> => {
    const runtime = await resolveRuntime(state, graphRuntime);
    const cancellationFailure = await runtimeDispatchFailure(runtime);
    if (cancellationFailure) return { failure: cancellationFailure };
    const approval = state.checkpointSafeApproval;
    const transientCalls = state.pendingToolCalls ?? [];
    const queuedCalls = state.queuedToolCalls ?? [];
    const resumedRequestId = runtime.turnInput.confirmationResume?.requestId;
    if (
      !approval ||
      queuedCalls.length > 0 ||
      transientCalls.length > 1 ||
      (transientCalls.length === 0 && approval.requestId !== resumedRequestId)
    ) {
      return { failure: 'agent_approval_interrupt_invalid' };
    }
    let call = transientCalls.length === 1 ? transientCalls[0] : undefined;
    if (!call) {
      const action = runtime.turnInput.confirmationResume?.action;
      if (!action) return { failure: 'agent_approval_interrupt_invalid' };
      try {
        call = await rehydrateCheckpointSafeApprovalCall({
          approval,
          action,
        });
      } catch {
        return { failure: 'agent_confirmation_action_mismatch' };
      }
    }
    if (
      !toolCallRequiresApproval(call) ||
      !(await checkpointSafeApprovalMatchesCall({ approval, call }))
    ) {
      return { failure: 'agent_approval_interrupt_invalid' };
    }
    const activeTurn = await activePublicationTurn({ state, runtime });
    runtime.state = activeTurn.state;
    let paused = true;
    try {
      interrupt(checkpointSafeApprovalInterrupt(approval));
      paused = false;
      return {
        ...publicationTurnUpdate(activeTurn),
        pendingToolCalls: [call],
        queuedToolCalls: [],
        turnDeadlineAt: runtime.externalCallContext.deadlineAt,
      };
    } finally {
      if (paused) runtime.disposeExternalCalls();
    }
  };

  const revalidateApproval = async (
    state: State,
    graphRuntime: AgentRuntime,
  ): Promise<Update> => {
    const pendingToolCalls = state.pendingToolCalls ?? [];
    const call = pendingToolCalls[0];
    if (!call || pendingToolCalls.length !== 1) {
      return { failure: 'agent_approval_interrupt_invalid' };
    }
    const runtime = await resolveRuntime(state, graphRuntime);
    const cancellationFailure = await runtimeDispatchFailure(runtime);
    if (cancellationFailure) return { failure: cancellationFailure };
    try {
      const hydrated = await activePublicationTurn({ state, runtime });
      const hydrationUpdate = publicationTurnUpdate(hydrated);
      runtime.state = hydrated.state;
      const durableMessages = freshMessages(
        hydrated.state,
        runtime.turnInput,
        hydrated.currentUserTurn,
      );
      const approvalMessages = state.structuredAction
        ? durableMessages
        : [
            ...durableMessages,
            new AIMessage({
              content: '',
              tool_calls: [
                {
                  id: call.id,
                  name: call.toolName,
                  args: call.arguments,
                },
              ],
            }),
          ];
      const actionDigest = await validateApprovalResume(runtime, {
        toolName: call.toolName,
        arguments: call.arguments,
      });
      const decision =
        runtime.turnInput.confirmationResume?.commerceReceipt?.decision;
      if (decision !== 'approve' && decision !== 'reject') {
        return { failure: 'authenticated_agent_approval_receipt_required' };
      }
      if (decision === 'reject') {
        return {
          ...hydrationUpdate,
          domainState: await persistAuthenticatedApprovalRejection({
            runtime,
            state: hydrated.state,
            call,
            hasStructuredAction: Boolean(state.structuredAction),
          }),
          messages: state.structuredAction
            ? approvalMessages
            : [...approvalMessages, createRejectionToolMessage(call)],
          pendingToolCalls: [],
          queuedToolCalls: [],
          checkpointSafeApproval: null,
          approvalDecision: decision,
          validatedApprovalActionDigest: actionDigest,
          ...(state.structuredAction
            ? { structuredActionOutcome: 'customer_rejected' as const }
            : {}),
        };
      }
      return {
        ...hydrationUpdate,
        messages: approvalMessages,
        pendingToolCalls: [call],
        queuedToolCalls: [],
        approvalDecision: decision,
        validatedApprovalActionDigest: actionDigest,
      };
    } catch (error) {
      return {
        failure:
          runtimeExternalCallFailure(runtime) ??
          classifyApprovalRevalidationFailure(error),
      };
    }
  };

  const validatePublication = async (
    state: State,
    graphRuntime: AgentRuntime,
  ): Promise<Update> => {
    const runtime = await resolveRuntime(state, graphRuntime);
    const dispatchFailure = await runtimeDispatchFailure(runtime);
    if (dispatchFailure) return { failure: dispatchFailure };
    if (
      !state.responseText ||
      !state.responseProjectionDigest ||
      !state.responseFactualClaims ||
      !state.responsePublicationDeclaration
    ) {
      return { failure: 'agent_grounded_response_required' };
    }
    const active = await activePublicationTurn({
      state,
      runtime,
      requireDurableRefresh:
        state.structuredAction?.command.kind === 'edit_cart' &&
        Boolean(state.selectedActionResponseAuthority),
    });
    runtime.state = active.state;
    const validated = validateSelectedActionGroundedResponse({
      raw: {
        customerText: state.responseText,
        projectionDigest: state.responseProjectionDigest,
        factualClaims: state.responseFactualClaims,
        publicationDeclaration: state.responsePublicationDeclaration,
        selectedActionResponse: state.selectedActionResponseReference,
      },
      publicationBundle: active.bundle,
      state: active.state,
      envelope: state.structuredAction,
      outcome: state.structuredActionOutcome,
      authority: state.selectedActionResponseAuthority,
      currentTurnToolTrace: state.currentTurnToolTrace,
      approvalDecision: state.approvalDecision,
      validatedApprovalActionDigest: state.validatedApprovalActionDigest,
    });
    if (!validated.ok) return { failure: validated.errorCode };
    if (
      await responseDisclosesPrivateSavedAddress({
        authority: active.authority,
        currentTurnEvidence: active.currentTurnResponseEvidence,
        customerText: validated.customerText,
        state: active.state,
      })
    ) {
      return { failure: 'agent_private_saved_address_disclosure_forbidden' };
    }
    const publication = await issueResponsePublicationAttestation({
      raw: validated.publicationDeclaration,
      bundle: active.bundle,
      customerText: validated.customerText,
      factualClaims: validated.factualClaims,
    });
    if (!publication.ok) return { failure: publication.errorCode };
    return {
      ...publicationTurnUpdate(active),
      responseText: validated.customerText,
      responseProjectionDigest: state.responseProjectionDigest,
      responseFactualClaims: validated.factualClaims,
      responsePublicationDeclaration: validated.publicationDeclaration,
      selectedActionResponseReference: validated.selectedActionResponse ?? null,
      responsePublicationAttestation: publication.attestation,
      responsePublicationValidated: true,
      validationError: null,
      correctionMessagesNeeded: false,
    };
  };

  const persistAndProject = async (
    state: State,
    graphRuntime: AgentRuntime,
  ): Promise<Update> => {
    const runtime = await resolveRuntime(state, graphRuntime);
    try {
      const failure = state.failure ?? runtimeExternalCallFailure(runtime);
      if (failure) {
        const status = await persistAgentFailedClosedEvent({
          turnInput: runtime.turnInput,
          payload: {
            errorCode: failure,
            ...(failure.startsWith('agent_provider_call_failed:') &&
            state.providerAttemptEvidence.length > 0
              ? { providerAttempts: state.providerAttemptEvidence }
              : {}),
          },
        });
        if (status === 'stale') {
          runtime.abortExternalCalls(
            new DOMException(
              'Customer run was superseded before failure commit',
              'AbortError',
            ),
          );
          if (failure === 'agent_turn_deadline_exceeded') {
            return state.failure ? {} : { failure };
          }
          return { failure: 'customer_run_cancelled' };
        }
        return state.failure ? {} : { failure };
      }
      const nextDomainState = domainState(state);
      if (!state.responseText || !state.responsePublicationAttestation) {
        return { failure: 'agent_response_publication_attestation_missing' };
      }
      const output = await persistCompletedTurn({
        turnInput: runtime.turnInput,
        turnTrace: runtime.turnTrace,
        state: nextDomainState,
        currentTurnToolTrace: state.currentTurnToolTrace,
        responseText: state.responseText,
        responseFactualClaims: state.responseFactualClaims ?? undefined,
        responsePublicationAttestation: state.responsePublicationAttestation,
        modelPublicationAuthority: state.modelPublicationAuthority ?? undefined,
        currentTurnResponseEvidence: state.currentTurnResponseEvidence,
        graphExecutedToolResults: state.graphExecutedToolResults,
      });
      const rejectionAction = runtime.turnInput.confirmationResume?.action;
      if (
        runtime.turnInput.confirmationResume?.commerceReceipt?.decision ===
          'reject' &&
        rejectionAction
      ) {
        output.state = await persistAuthenticatedApprovalRejection({
          runtime,
          state: output.state,
          call: rejectionAction,
          hasStructuredAction: Boolean(state.structuredAction),
        });
      }
      return { output };
    } finally {
      runtime.disposeExternalCalls();
    }
  };

  const failClosed = (state: State): Update => ({
    failure: state.failure ?? 'agent_failed_closed',
  });
  const routeAfterLoadContext = (state: State) => {
    if (state.failure) return 'fail_closed';
    return state.structuredAction
      ? 'prepare_structured_action'
      : 'semantic_agent';
  };
  const routeAfterSemanticAgent = (state: State) =>
    state.failure ? 'fail_closed' : 'validate_publication';
  const routeAfterPublicationValidation = (state: State) =>
    state.failure ? 'fail_closed' : 'persist_and_project';
  const observedNodes = traceAgentGraphNodes(
    KFC_AGENT_GRAPH_NODE_NAMES,
    {
      load_context: loadContext,
      prepare_structured_action: prepareStructuredAction,
      semantic_agent: invokeSemanticAgent,
      validate_publication: validatePublication,
      request_approval: requestApproval,
      revalidate_approval: revalidateApproval,
      execute_trusted_action: async (state, graphRuntime) => {
        const execution = await executeAgentToolNode({
          state,
          graphRuntime,
          resolveRuntime,
        });
        return {
          ...appendTransientMessages(state, execution),
          checkpointSafeApproval: execution.checkpointSafeApproval ?? null,
        };
      },
      persist_and_project: persistAndProject,
      fail_closed: failClosed,
    },
    resolveRuntime,
  );
  const observedRoutes = traceAgentGraphRoutes(
    KFC_AGENT_GRAPH_ROUTE_SOURCE_NAMES,
    {
      load_context: routeAfterLoadContext,
      prepare_structured_action: routePreparedStructuredAction,
      semantic_agent: routeAfterSemanticAgent,
      validate_publication: routeAfterPublicationValidation,
      revalidate_approval: routeAfterApprovalResume,
      execute_trusted_action: routeAfterTrustedTool,
      persist_and_project: () => END,
    },
  );
  return new StateGraph(KfcAgentState, {
    context: runtimeContextSchema,
  })
    .addNode('load_context', observedNodes.load_context)
    .addNode(
      'prepare_structured_action',
      observedNodes.prepare_structured_action,
    )
    .addNode('semantic_agent', observedNodes.semantic_agent)
    .addNode('validate_publication', observedNodes.validate_publication)
    .addNode('request_approval', observedNodes.request_approval)
    .addNode('revalidate_approval', observedNodes.revalidate_approval)
    .addNode('execute_trusted_action', observedNodes.execute_trusted_action)
    .addNode('persist_and_project', observedNodes.persist_and_project)
    .addNode('fail_closed', observedNodes.fail_closed)
    .addEdge(START, 'load_context')
    .addConditionalEdges('load_context', observedRoutes.load_context, {
      fail_closed: 'fail_closed',
      prepare_structured_action: 'prepare_structured_action',
      semantic_agent: 'semantic_agent',
    })
    .addConditionalEdges('semantic_agent', observedRoutes.semantic_agent, {
      fail_closed: 'fail_closed',
      validate_publication: 'validate_publication',
    })
    .addConditionalEdges(
      'validate_publication',
      observedRoutes.validate_publication,
      {
        fail_closed: 'fail_closed',
        persist_and_project: 'persist_and_project',
      },
    )
    .addConditionalEdges(
      'prepare_structured_action',
      observedRoutes.prepare_structured_action,
      {
        fail_closed: 'fail_closed',
        request_approval: 'request_approval',
        execute_trusted_action: 'execute_trusted_action',
        semantic_agent: 'semantic_agent',
      },
    )
    .addEdge('request_approval', 'revalidate_approval')
    .addConditionalEdges(
      'revalidate_approval',
      observedRoutes.revalidate_approval,
      {
        fail_closed: 'fail_closed',
        request_approval: 'request_approval',
        execute_trusted_action: 'execute_trusted_action',
        semantic_agent: 'semantic_agent',
      },
    )
    .addConditionalEdges(
      'execute_trusted_action',
      observedRoutes.execute_trusted_action,
      AGENT_AFTER_TRUSTED_TOOL_DESTINATIONS,
    )
    .addEdge('fail_closed', 'persist_and_project')
    .addConditionalEdges(
      'persist_and_project',
      observedRoutes.persist_and_project,
      { [END]: END },
    )
    .compile({ checkpointer: input.checkpointer });
}

export type KfcAgentStateGraph = ReturnType<typeof createKfcAgentStateGraph>;

export type KfcAgentStateGraphResult = State;
export type KfcAgentStateGraphUpdate = Update;
