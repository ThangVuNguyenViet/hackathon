import type { Runtime } from '@langchain/langgraph';
import { prepareModelAuthoredPaymentSelection } from '../ordering/paymentMethodAuthority.js';
import { agentToolCallDisposition } from '../ordering/toolCallDisposition.js';
import { agentToolArgumentSchemas } from '../ordering/toolCatalog.js';
import type { ToolName } from '../ordering/types.js';
import { isRecord, toolCallId } from './agentBoundaryPolicy.js';
import {
  lastToolCalls,
  requiredDomainState,
} from './agentStateGraphContracts.js';
import type {
  KfcAgentStateUpdate,
  KfcAgentStateValue,
} from './agentStateSchema.js';
import { publicationBundle } from './agentPublicationRuntime.js';
import { GROUNDED_RESPONSE_TOOL_NAME } from './responseGrounding.js';
import { issueResponsePublicationAttestation } from './responsePrivacyAttestation.js';
import { validateSelectedActionGroundedResponse } from './selectedActionResponseBoundary.js';
import { isValidApprovalBatchShape } from './agentApprovalBatchShape.js';
import {
  isToolName,
  runtimeDispatchFailure,
  type PendingToolCall,
  type SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';
import { checkpointSafeApprovalFor } from './checkpointSafeApproval.js';
import { validateModelQuoteFulfillmentAddressAuthority } from './modelQuoteFulfillmentAddressAuthority.js';
import {
  claimPendingSavedAddressQuote,
  responseDisclosesPrivateSavedAddress,
} from './savedAddressVerifiedRef.js';

type AgentRuntime = Runtime<{ runtime?: SingleAgentRuntimeContext }>;
type RuntimeResolver = (
  state: KfcAgentStateValue,
  runtime: AgentRuntime,
) => Promise<SingleAgentRuntimeContext>;
type BindingToolNames = (
  state: KfcAgentStateValue,
  runtime: SingleAgentRuntimeContext,
) => readonly ToolName[];

const modelToolUseScopes = new WeakMap<SingleAgentRuntimeContext, string>();

function modelToolUseScope(runtime: SingleAgentRuntimeContext): string {
  const existing = modelToolUseScopes.get(runtime);
  if (existing) return existing;
  const issued = crypto.randomUUID();
  modelToolUseScopes.set(runtime, issued);
  return issued;
}

function rejectedToolCalls(input: {
  validationError?: string;
  failure?: string;
}): KfcAgentStateUpdate {
  return {
    pendingToolCalls: [],
    queuedToolCalls: [],
    checkpointSafeApproval: null,
    ...(input.failure
      ? { failure: input.failure }
      : {
          validationError: input.validationError ?? 'invalid_tool_arguments',
          correctionMessagesNeeded: true,
        }),
  };
}

export function createValidateAgentToolCallsNode(input: {
  resolveRuntime: RuntimeResolver;
  bindingToolNames: BindingToolNames;
}) {
  return async (
    state: KfcAgentStateValue,
    graphRuntime: AgentRuntime,
  ): Promise<KfcAgentStateUpdate> => {
    const calls = lastToolCalls(state.messages ?? []);
    const responseCalls = calls.filter(
      (call) => call.name === GROUNDED_RESPONSE_TOOL_NAME,
    );
    if (responseCalls.length > 0) {
      const responseCall = responseCalls[0];
      let bundle;
      try {
        bundle = await publicationBundle(
          state,
          await input.resolveRuntime(state, graphRuntime),
        );
      } catch {
        return { failure: 'agent_model_publication_authority_invalid' };
      }
      const validated = validateSelectedActionGroundedResponse({
        raw: responseCall && calls.length === 1 ? responseCall.args : undefined,
        publicationBundle: bundle,
        state: requiredDomainState(state),
        envelope: state.structuredAction,
        outcome: state.structuredActionOutcome,
        authority: state.selectedActionResponseAuthority,
        currentTurnToolTrace: state.currentTurnToolTrace,
        approvalDecision: state.approvalDecision,
        validatedApprovalActionDigest: state.validatedApprovalActionDigest,
      });
      if (!validated.ok) {
        return {
          ...rejectedToolCalls({
            validationError: validated.errorCode,
          }),
          responseText: null,
          responseFactualClaims: null,
          selectedActionResponseReference: null,
          responsePublicationValidated: false,
          responsePublicationAttestation: null,
        };
      }
      if (
        !state.modelPublicationAuthority ||
        (await responseDisclosesPrivateSavedAddress({
          authority: state.modelPublicationAuthority,
          currentTurnEvidence: state.currentTurnResponseEvidence,
          customerText: validated.customerText,
          state: requiredDomainState(state),
        }))
      ) {
        return {
          ...rejectedToolCalls({
            validationError: state.modelPublicationAuthority
              ? 'agent_private_saved_address_disclosure_forbidden'
              : 'agent_model_publication_authority_invalid',
          }),
          responseText: null,
          responseFactualClaims: null,
          selectedActionResponseReference: null,
          responsePublicationValidated: false,
          responsePublicationAttestation: null,
        };
      }
      const publication = await issueResponsePublicationAttestation({
        raw: validated.publicationDeclaration,
        bundle,
        customerText: validated.customerText,
        factualClaims: validated.factualClaims,
      });
      if (!publication.ok) {
        return {
          ...rejectedToolCalls({
            validationError: publication.errorCode,
          }),
          responseText: null,
          responseFactualClaims: null,
          selectedActionResponseReference: null,
          responsePublicationValidated: false,
          responsePublicationAttestation: null,
        };
      }
      return {
        pendingToolCalls: [],
        queuedToolCalls: [],
        checkpointSafeApproval: null,
        responseText: validated.customerText,
        responseFactualClaims: validated.factualClaims,
        selectedActionResponseReference:
          validated.selectedActionResponse ?? null,
        responsePublicationValidated: true,
        responsePublicationAttestation: publication.attestation,
        validationError: null,
        correctionMessagesNeeded: false,
      };
    }
    if (state.structuredAction) {
      return rejectedToolCalls({
        validationError: 'structured_response_commerce_tool_forbidden',
      });
    }

    const runtime = await input.resolveRuntime(state, graphRuntime);
    const dispatchFailure = await runtimeDispatchFailure(runtime);
    if (dispatchFailure) {
      return rejectedToolCalls({ failure: dispatchFailure });
    }
    const advertisedToolNames = new Set(input.bindingToolNames(state, runtime));
    const classifiedCalls = [];
    for (const call of calls) {
      if (
        !isToolName(call.name) ||
        !isRecord(call.args) ||
        !advertisedToolNames.has(call.name)
      ) {
        return rejectedToolCalls({
          validationError: isToolName(call.name)
            ? 'agent_tool_not_advertised'
            : 'invalid_tool_call',
        });
      }
      const disposition = agentToolCallDisposition(call.name, call.args);
      if (!disposition.success) return rejectedToolCalls({});
      classifiedCalls.push({ call, disposition: disposition.data });
    }
    if (
      !isValidApprovalBatchShape(
        classifiedCalls.map(({ disposition }) => disposition),
      )
    ) {
      return rejectedToolCalls({
        validationError: 'approval_batch_shape_invalid',
      });
    }

    const pending: PendingToolCall[] = [];
    const callSignatures = new Set<string>();
    let savedAddressPreparedState:
      ReturnType<typeof requiredDomainState> | undefined;
    let livePublicationBundle:
      Awaited<ReturnType<typeof publicationBundle>> | undefined;
    for (const { call, disposition } of classifiedCalls) {
      let canonicalArguments = disposition.arguments;
      let auditArguments: Record<string, unknown> | undefined;
      const currentCallId = toolCallId(call);
      if (disposition.toolName === 'quoteFulfillment') {
        if (!state.currentUserTurn) {
          return rejectedToolCalls({
            failure: 'agent_address_authority_mismatch',
          });
        }
        try {
          livePublicationBundle ??= await publicationBundle(state, runtime);
        } catch {
          return rejectedToolCalls({
            failure: 'agent_model_publication_authority_invalid',
          });
        }
        const quoteArguments =
          agentToolArgumentSchemas.quoteFulfillment.parse(canonicalArguments);
        if ('savedAddressRef' in quoteArguments) {
          const publishedRef =
            livePublicationBundle.modelState.pendingSavedAddressRef;
          if (
            calls.length !== 1 ||
            quoteArguments.method !== 'delivery' ||
            publishedRef?.kind !== 'saved_address' ||
            publishedRef.id !== quoteArguments.savedAddressRef.id
          ) {
            return rejectedToolCalls({
              validationError:
                'structured_action_saved_address_ref_unavailable',
            });
          }
          const claimed = await claimPendingSavedAddressQuote({
            ref: quoteArguments.savedAddressRef,
            method: quoteArguments.method,
            useId:
              `model-tool:${modelToolUseScope(runtime)}:` +
              `${state.currentUserTurn.id}:${currentCallId}`,
            callId: currentCallId,
            turnInput: runtime.turnInput,
            state: requiredDomainState(state),
          });
          if (!claimed.ok) {
            return rejectedToolCalls({
              validationError: claimed.errorCode,
            });
          }
          auditArguments = structuredClone(disposition.arguments);
          canonicalArguments = claimed.call.arguments;
          savedAddressPreparedState = claimed.state;
        } else {
          const addressAuthority =
            await validateModelQuoteFulfillmentAddressAuthority({
              publicationBundle: livePublicationBundle,
              currentUserTurn: state.currentUserTurn,
              recentTurns: requiredDomainState(state).recentTurns ?? [],
              proposedAddress: quoteArguments.address,
            });
          if (!addressAuthority.ok) {
            return rejectedToolCalls({
              failure: addressAuthority.errorCode,
            });
          }
          auditArguments = structuredClone(disposition.arguments);
          canonicalArguments = {
            ...quoteArguments,
            address: addressAuthority.address,
          };
        }
      }
      const signature = `${disposition.toolName}:${JSON.stringify(
        canonicalArguments,
      )}`;
      if (callSignatures.has(signature)) {
        return rejectedToolCalls({
          validationError: 'duplicate_tool_call',
        });
      }
      callSignatures.add(signature);
      pending.push({
        id: currentCallId,
        toolName: disposition.toolName,
        arguments: canonicalArguments,
        ...(auditArguments ? { auditArguments } : {}),
      });
    }

    let preparedState = savedAddressPreparedState ?? requiredDomainState(state);
    for (const call of pending) {
      const nextState = prepareModelAuthoredPaymentSelection(
        preparedState,
        call,
      );
      if (!nextState) {
        return rejectedToolCalls({
          validationError: 'unverified_payment_method',
        });
      }
      preparedState = nextState;
    }
    return {
      domainState: preparedState,
      pendingToolCalls: pending,
      queuedToolCalls: [],
      checkpointSafeApproval: await checkpointSafeApprovalFor(runtime, pending),
      validationError: null,
      correctionMessagesNeeded: false,
    };
  };
}
