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
  routeValidatedToolCalls,
} from './agentApprovalRouting.js';
import { persistAuthenticatedApprovalRejection } from './approvalRejectionPersistence.js';
import {
  classifyApprovalRevalidationFailure,
  createCorrectionToolMessage,
  createRejectionToolMessage,
} from './agentBoundaryPolicy.js';
import {
  KFC_AGENT_GRAPH_NODE_NAMES,
  KFC_AGENT_GRAPH_ROUTE_SOURCE_NAMES,
  lastToolCalls,
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
  AGENT_AFTER_NORMAL_TOOL_DESTINATIONS,
  AGENT_AFTER_TRUSTED_TOOL_DESTINATIONS,
  AGENT_MODEL_DESTINATIONS,
  AGENT_SYSTEM_PROMPT,
  MAXIMUM_AGENT_PROVIDER_CALLS,
  invokeAgentModel,
  providerRetryUpdate,
  requiredAgentToolChoice,
  routeAfterNormalTool,
  routeAfterTrustedTool,
  routeAgentModelResult,
} from './agentModelInvocation.js';
import {
  freshMessages,
  messageText,
  persistCompletedTurn,
  commerceToolDefinitions,
  runtimeDispatchFailure,
  runtimeExternalCallFailure,
  runtimeContextSchema,
  toolCallRequiresApproval,
  validateApprovalResume,
  type PendingToolCall,
  type SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';
import {
  GROUNDED_RESPONSE_TOOL_NAME,
  ordinaryGroundedResponseToolDefinition,
  selectedActionGroundedResponseToolDefinition,
} from './responseGrounding.js';
import {
  activePublicationTurn,
  loadPublicationTurn,
  modelPublicationContext,
  publicationAuthority,
  publicationBundle,
  publicationToolTracePrefixDigest,
  publicationTurnUpdate,
} from './agentPublicationRuntime.js';
import {
  modelPresentationContext,
  resolveModelPresentationContext,
} from './agentPresentationContext.js';
import {
  executeAgentToolNode,
} from './agentToolExecutionNode.js';
import {
  buildSelectedActionGraphAuthorities,
} from './selectedActionResponseBoundary.js';
import {
  prepareStructuredCustomerAction,
  structuredResponseCorrectionMessage,
  structuredResponseMessages,
} from './structuredCustomerAction.js';
import {
  claimSavedAddressQuote,
} from './savedAddressVerifiedRef.js';
import {
  checkpointSafeApprovalInterrupt,
  checkpointSafeApprovalMatchesCall,
  rehydrateCheckpointSafeApprovalCall,
} from './checkpointSafeApproval.js';
import {
  checkpointSafeApprovalFor,
  createValidateAgentToolCallsNode,
} from './agentToolCallValidationNode.js';
import {
  persistAgentFailedClosedEvent,
} from './agentFailurePersistence.js';
import {
  activeAgentToolNames,
} from './agentActiveToolProfile.js';
import {
  ordinaryToolBindingManifest,
  ordinaryToolBindingUpdateAfterExecution,
} from './agentToolBindingManifest.js';
import {
  createAgentRuntimeScope,
  type AgentRuntime,
} from './agentRuntimeScope.js';
import {
  traceAgentGraphNodes,
  traceAgentGraphRoutes,
} from './agentGraphObservability.js';

const maximumSemanticCorrections = 1;
export const KFC_AGENT_RUNTIME_ID = 'langgraph-stategraph-v1';

export {
  KFC_AGENT_GRAPH_NODE_NAMES,
  KFC_AGENT_GRAPH_ROUTE_SOURCE_NAMES,
};
export type {
  KfcAgentGraphInput,
  KfcAgentRuntimeResolver,
};

export function createKfcAgentStateGraph(input: {
  model: BaseChatModel;
  checkpointer: BaseCheckpointSaver;
  resolveRuntime?: KfcAgentRuntimeResolver;
  resolveToolCapabilities?: AgentToolCapabilityResolver;
}) {
  if (!input.model.bindTools) {
    throw new Error('agent_model_tool_binding_unsupported');
  }
  const bindTools = input.model.bindTools.bind(input.model);
  const groundedResponseModel = bindTools([
    selectedActionGroundedResponseToolDefinition,
  ], {
    tool_choice: GROUNDED_RESPONSE_TOOL_NAME,
  });
  const resolveToolProfile = createAgentToolProfileResolver(
    input.resolveToolCapabilities,
  );
  const { resolveRuntime, invokeWithinTurnScope } =
    createAgentRuntimeScope({
      resolveRuntime: input.resolveRuntime,
    });
  const activeToolNames = (
    state: State,
    runtime: SingleAgentRuntimeContext,
  ) => activeAgentToolNames({
    state,
    runtime,
    resolveToolProfile,
  });
  const bindingToolNames = (
    state: State,
    runtime: SingleAgentRuntimeContext,
  ) => ordinaryToolBindingManifest({
    phase: state.ordinaryToolBindingPhase,
    activeToolNames: activeToolNames(state, runtime),
    continuationBaseToolNames: state.continuationBaseToolNames,
  });
  const appendTransientMessages = (
    state: State,
    update: Update,
  ): Update => update.messages
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
    return {
      domainState: loaded.state,
      currentTurnToolTrace: [],
      currentUserTurn: loaded.currentUserTurn,
      currentTurnId: loaded.currentUserTurn.id,
      turnToolTraceStartIndex: loaded.state.toolTrace?.length ?? 0,
      turnToolTracePrefixDigest:
        await publicationToolTracePrefixDigest(
          loaded.state.toolTrace ?? [],
        ),
      modelPublicationAuthority: loaded.authority,
      modelPublicationBundle: loaded.bundle,
      graphExecutedToolResults: [],
      currentTurnResponseEvidence: [],
      toolEvidenceReceipts: [],
      customerTurnCount: loaded.customerTurnCount,
      messages: freshMessages(
        loaded.state,
        runtime.turnInput,
        loaded.currentUserTurn,
      ),
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
      advertisedToolNames: [],
      ordinaryToolBindingPhase: 'initial',
      continuationBaseToolNames: [],
      pendingToolCalls: [],
      queuedToolCalls: [],
      checkpointSafeApproval: null,
      providerFailure: null,
      validationError: null,
      approvalDecision: null,
      validatedApprovalActionDigest: null,
      responseText: null,
      responseFactualClaims: null,
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
    const pendingToolCalls: PendingToolCall[] = [{
        id: `structured:${state.structuredAction.actionDigest}:${
          prepared.call.toolName
        }`,
        toolName: prepared.call.toolName,
        arguments: prepared.call.arguments,
      }];
    return {
      pendingToolCalls,
      queuedToolCalls: [],
      checkpointSafeApproval:
        await checkpointSafeApprovalFor(
          await resolveRuntime(state, graphRuntime),
          pendingToolCalls,
        ),
      structuredActionRevisionValidated: true,
      structuredActionAfterTool: prepared.afterTool,
    };
  };

  const callModel = async (
    state: State,
    graphRuntime: AgentRuntime,
  ): Promise<Update> => {
    const envelope = state.structuredAction;
    if (envelope) {
      const outcome = state.structuredActionOutcome;
      if (!outcome) {
        return { failure: 'structured_action_envelope_missing' };
      }
      const authorities = buildSelectedActionGraphAuthorities({
        envelope,
        outcome,
        state: domainState(state),
        currentTurnToolTrace: state.currentTurnToolTrace,
        approvalDecision: state.approvalDecision,
        validatedApprovalActionDigest:
          state.validatedApprovalActionDigest,
      });
      if (!authorities.ok) return { failure: authorities.errorCode };
      return invokeWithinTurnScope(
        state,
        graphRuntime,
        async (runtime) => {
          const update = await invokeAgentModel({
            model: groundedResponseModel,
            messages: async () => structuredResponseMessages({
              envelope,
              outcome,
              selectedActionResponseReference: authorities.reference,
              presentationContext: resolveModelPresentationContext({
                channel: runtime.turnInput.channel,
                responseProfile: runtime.turnInput.responseProfile,
              }),
              publicationBundle:
                await publicationBundle(state, runtime),
              state: domainState(state),
              messages: state.messages,
            }),
            observation: { kind: 'response_composition' },
            runtime,
            state,
          });
          return {
            ...appendTransientMessages(state, update),
            advertisedToolNames: [],
            selectedActionResponseAuthority: authorities.authority,
          };
        },
      );
    }
    return invokeWithinTurnScope(
      state,
      graphRuntime,
      async (runtime) => {
        const advertisedToolNames = bindingToolNames(state, runtime);
        const toolDefinitions = [
          ...commerceToolDefinitions(advertisedToolNames),
          ordinaryGroundedResponseToolDefinition,
        ];
        const model = bindTools(toolDefinitions, {
          tool_choice: advertisedToolNames.length === 0
            ? GROUNDED_RESPONSE_TOOL_NAME
            : requiredAgentToolChoice(
                toolDefinitions.map(({ name }) => name),
              ),
        });
        const update = await invokeAgentModel({
          model,
          messages: async () => {
            const bundle = await publicationBundle(state, runtime);
            return [
              new SystemMessage(AGENT_SYSTEM_PROMPT),
              new SystemMessage(
                modelPresentationContext(runtime.turnInput),
              ),
              new SystemMessage(modelPublicationContext(bundle, null)),
              ...state.messages,
            ];
          },
          observation: { kind: 'planning' },
          runtime,
          state,
        });
        return {
          ...appendTransientMessages(state, update),
          advertisedToolNames: [...advertisedToolNames],
        };
      },
    );
  };

  const validateToolCalls = createValidateAgentToolCallsNode({
    resolveRuntime,
    bindingToolNames,
  });
  const recordSemanticCorrection = async (
    state: State,
    graphRuntime: AgentRuntime,
  ): Promise<Update> => {
    const cancellationFailure = await runtimeDispatchFailure(
      await resolveRuntime(state, graphRuntime),
    );
    if (cancellationFailure) return { failure: cancellationFailure };
    if (state.semanticCorrections >= maximumSemanticCorrections) {
      return { failure: 'agent_semantic_correction_limit_exceeded' };
    }
    const calls = lastToolCalls(state.messages);
    const correctionMessages = state.correctionMessagesNeeded
      ? state.structuredAction
        ? [structuredResponseCorrectionMessage(
            state.validationError ?? 'grounded_response_required',
          )]
        : calls.length > 0
        ? calls.map((call) =>
            createCorrectionToolMessage(
              call,
              state.validationError ?? 'tool_call_rejected',
            ),
          )
        : [new SystemMessage(
            `The previous response was rejected: ${
              state.validationError ?? 'grounded_response_required'
            }. Call ${GROUNDED_RESPONSE_TOOL_NAME} with corrected typed output.`,
          )]
      : [];
    return {
      messages: [...(state.messages ?? []), ...correctionMessages],
      pendingToolCalls: [],
      queuedToolCalls: [],
      checkpointSafeApproval: null,
      semanticCorrections: state.semanticCorrections + 1,
      ordinaryToolBindingPhase: 'response_only',
      responseText: null,
      responseFactualClaims: null,
      selectedActionResponseReference: null,
      responsePublicationValidated: false,
      responsePublicationAttestation: null,
      validationError: null,
      correctionMessagesNeeded: false,
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
    const resumedRequestId =
      runtime.turnInput.confirmationResume?.requestId;
    if (
      !approval ||
      (
        transientCalls.length === 0 &&
        approval.requestId !== resumedRequestId
      )
    ) {
      return { failure: 'agent_approval_interrupt_invalid' };
    }
    let call = transientCalls.length === 1
      ? transientCalls[0]
      : undefined;
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
      transientCalls.length > 1 ||
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
              tool_calls: [{
                id: call.id,
                name: call.toolName,
                args: call.arguments,
              }],
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

  const executeTools = async (
    state: State,
    graphRuntime: AgentRuntime,
  ): Promise<Update> => {
    const execution = await executeAgentToolNode({
      state,
      graphRuntime,
      resolveRuntime,
    });
    const update = {
      ...appendTransientMessages(state, execution),
      checkpointSafeApproval: null,
    };
    if (state.structuredAction || execution.failure) return update;
    return {
      ...update,
      ...ordinaryToolBindingUpdateAfterExecution({
        phase: state.ordinaryToolBindingPhase,
        advertisedToolNames: state.advertisedToolNames,
        hasRemainingCalls:
          (execution.pendingToolCalls?.length ?? 0) > 0,
      }),
    };
  };

  const finalizeResponse = (state: State): Update => {
    if (
      state.responseText &&
      state.responsePublicationValidated &&
      state.responsePublicationAttestation
    ) {
      return {};
    }
    return {
      responseText: null,
      validationError: messageText(state.messages.at(-1))
        ? 'agent_grounded_response_required'
        : 'agent_response_missing',
      correctionMessagesNeeded: true,
    };
  };

  const recordProviderRetry = async (
    state: State,
    graphRuntime: AgentRuntime,
  ): Promise<Update> => {
    const cancellationFailure = await runtimeDispatchFailure(
      await resolveRuntime(state, graphRuntime),
    );
    return cancellationFailure
      ? { failure: cancellationFailure }
      : providerRetryUpdate(state);
  };

  const persistAndProject = async (
    state: State,
    graphRuntime: AgentRuntime,
  ): Promise<Update> => {
    const runtime = await resolveRuntime(state, graphRuntime);
    try {
      const failure =
        state.failure ?? runtimeExternalCallFailure(runtime);
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
          runtime.abortExternalCalls(new DOMException(
            'Customer run was superseded before failure commit',
            'AbortError',
          ));
          return { failure: 'customer_run_cancelled' };
        }
        return state.failure ? {} : { failure };
      }
      const nextDomainState = domainState(state);
      if (
        !state.responseText ||
        !state.responsePublicationAttestation
      ) {
        return { failure: 'agent_response_publication_attestation_missing' };
      }
      const output = await persistCompletedTurn({
        turnInput: runtime.turnInput,
        turnTrace: runtime.turnTrace,
        state: nextDomainState,
        currentTurnToolTrace: state.currentTurnToolTrace,
        responseText: state.responseText,
        responseFactualClaims:
          state.responseFactualClaims ?? undefined,
        responsePublicationAttestation:
          state.responsePublicationAttestation,
        modelPublicationAuthority:
          state.modelPublicationAuthority ?? undefined,
        currentTurnResponseEvidence: state.currentTurnResponseEvidence,
        graphExecutedToolResults: state.graphExecutedToolResults,
      });
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
      : 'call_model';
  };
  const routeAfterCorrectionOrRetry = (state: State) => state.failure
    ? 'fail_closed'
    : 'call_model';
  const routeAfterFinalize = (state: State) => {
    if (state.failure) return 'fail_closed';
    return state.validationError
      ? 'record_semantic_correction'
      : 'persist_and_project';
  };
  const observedNodes = traceAgentGraphNodes(
    KFC_AGENT_GRAPH_NODE_NAMES,
    {
      load_context: loadContext,
      prepare_structured_action: prepareStructuredAction,
      call_model: callModel,
      validate_tool_calls: validateToolCalls,
      record_semantic_correction: recordSemanticCorrection,
      request_approval: requestApproval,
      revalidate_approval: revalidateApproval,
      execute_tools: executeTools,
      execute_trusted_action: executeTools,
      record_provider_retry: recordProviderRetry,
      finalize_response: finalizeResponse,
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
      call_model: routeAgentModelResult,
      validate_tool_calls: routeValidatedToolCalls,
      record_semantic_correction: routeAfterCorrectionOrRetry,
      revalidate_approval: routeAfterApprovalResume,
      execute_tools: routeAfterNormalTool,
      execute_trusted_action: routeAfterTrustedTool,
      record_provider_retry: routeAfterCorrectionOrRetry,
      finalize_response: routeAfterFinalize,
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
    .addNode('call_model', observedNodes.call_model)
    .addNode('validate_tool_calls', observedNodes.validate_tool_calls)
    .addNode(
      'record_semantic_correction',
      observedNodes.record_semantic_correction,
    )
    .addNode('request_approval', observedNodes.request_approval)
    .addNode('revalidate_approval', observedNodes.revalidate_approval)
    .addNode('execute_tools', observedNodes.execute_tools)
    .addNode(
      'execute_trusted_action',
      observedNodes.execute_trusted_action,
    )
    .addNode(
      'record_provider_retry',
      observedNodes.record_provider_retry,
    )
    .addNode('finalize_response', observedNodes.finalize_response)
    .addNode('persist_and_project', observedNodes.persist_and_project)
    .addNode('fail_closed', observedNodes.fail_closed)
    .addEdge(START, 'load_context')
    .addConditionalEdges(
      'load_context',
      observedRoutes.load_context,
      {
        fail_closed: 'fail_closed',
        prepare_structured_action: 'prepare_structured_action',
        call_model: 'call_model',
      },
    )
    .addConditionalEdges(
      'prepare_structured_action',
      observedRoutes.prepare_structured_action,
      {
        fail_closed: 'fail_closed',
        request_approval: 'request_approval',
        execute_trusted_action: 'execute_trusted_action',
        call_model: 'call_model',
      },
    )
    .addConditionalEdges(
      'call_model',
      observedRoutes.call_model,
      AGENT_MODEL_DESTINATIONS,
    )
    .addConditionalEdges(
      'validate_tool_calls',
      observedRoutes.validate_tool_calls,
      {
        fail_closed: 'fail_closed',
        record_semantic_correction: 'record_semantic_correction',
        request_approval: 'request_approval',
        execute_tools: 'execute_tools',
        finalize_response: 'finalize_response',
      },
    )
    .addConditionalEdges(
      'record_semantic_correction',
      observedRoutes.record_semantic_correction,
      {
        fail_closed: 'fail_closed',
        call_model: 'call_model',
      },
    )
    .addEdge('request_approval', 'revalidate_approval')
    .addConditionalEdges(
      'revalidate_approval',
      observedRoutes.revalidate_approval,
      {
        fail_closed: 'fail_closed',
        request_approval: 'request_approval',
        execute_tools: 'execute_tools',
        execute_trusted_action: 'execute_trusted_action',
        call_model: 'call_model',
      },
    )
    .addConditionalEdges(
      'execute_tools',
      observedRoutes.execute_tools,
      AGENT_AFTER_NORMAL_TOOL_DESTINATIONS,
    )
    .addConditionalEdges(
      'execute_trusted_action',
      observedRoutes.execute_trusted_action,
      AGENT_AFTER_TRUSTED_TOOL_DESTINATIONS,
    )
    .addConditionalEdges(
      'record_provider_retry',
      observedRoutes.record_provider_retry,
      {
        fail_closed: 'fail_closed',
        call_model: 'call_model',
      },
    )
    .addConditionalEdges(
      'finalize_response',
      observedRoutes.finalize_response,
      {
        fail_closed: 'fail_closed',
        record_semantic_correction: 'record_semantic_correction',
        persist_and_project: 'persist_and_project',
      },
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
