import { mergeConfigs } from '@langchain/core/runnables';
import { getConfig } from '@langchain/langgraph';
import type { AgentGraphState } from '../graph/state.js';
import {
  classifyProviderFailure,
} from './agentBoundaryPolicy.js';
import type { ProviderAttemptEvidence } from './agentModelInvocation.js';
import {
  responseFactualClaimsMatch,
  validateResponseClaimVerification,
  type ResponseClaimVerifier,
  type ResponseFactualClaims,
} from './responseGrounding.js';
import {
  validateModelPublicationReference,
  type ModelPublicationBundle,
} from './modelPublicationProjection.js';
import type {
  ResponsePublicationAttestation,
} from './responsePrivacyAttestation.js';
import {
  buildSelectedActionGraphAuthorities,
} from './selectedActionResponseBoundary.js';
import type {
  SelectedActionResponseAuthority,
  SelectedActionResponseReference,
} from './selectedActionResponseAuthority.js';
import {
  buildSelectedActionSemanticTarget,
  validateSelectedActionSemanticAttestation,
  type SelectedActionSemanticTarget,
} from './selectedActionResponseVerification.js';
import type {
  TrustedCustomerActionEnvelope,
} from '../domain/customerCommand.js';
import type {
  ToolTraceEntry,
} from '../ordering/types.js';
import type {
  StructuredActionOutcome,
} from './structuredCustomerAction.js';
import { stateRevision } from '../graph/turnSupport.js';
import {
  runtimeDispatchFailure,
  type SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';

export interface ResponseVerificationState {
  approvalDecision: 'approve' | 'reject' | null;
  currentTurnToolTrace: ToolTraceEntry[];
  domainState: AgentGraphState | null;
  providerAttempts: number;
  providerAttemptEvidence: ProviderAttemptEvidence[];
  responseFactualClaims: ResponseFactualClaims | null;
  responseText: string | null;
  responseVerificationCalls: number;
  selectedActionResponseAuthority:
    SelectedActionResponseAuthority | null;
  selectedActionResponseReference:
    SelectedActionResponseReference | null;
  structuredAction: TrustedCustomerActionEnvelope | null;
  structuredActionOutcome: StructuredActionOutcome | null;
  turnDeadlineAt: number;
  validatedApprovalActionDigest: string | null;
}

export interface ResponseVerificationUpdate {
  failure?: string;
  providerAttempts?: number;
  providerAttemptEvidence?: ProviderAttemptEvidence[];
  responseVerificationCalls?: number;
  responseVerificationLatencyMs?: number;
  responseVerified?: boolean;
  responsePublicationAttestation?: ResponsePublicationAttestation;
}

function verifiedState(state: ResponseVerificationState): AgentGraphState {
  if (!state.domainState) throw new Error('agent_domain_state_missing');
  return state.domainState;
}

function selectedActionTarget(
  state: ResponseVerificationState,
  domainState: AgentGraphState,
): SelectedActionSemanticTarget | undefined {
  if (!state.structuredAction) return undefined;
  if (
    !state.structuredActionOutcome ||
    !state.selectedActionResponseAuthority ||
    !state.selectedActionResponseReference
  ) {
    throw new Error('selected_action_semantic_target_missing');
  }
  const current = buildSelectedActionGraphAuthorities({
    envelope: state.structuredAction,
    outcome: state.structuredActionOutcome,
    state: domainState,
    currentTurnToolTrace: state.currentTurnToolTrace,
    approvalDecision: state.approvalDecision,
    validatedApprovalActionDigest: state.validatedApprovalActionDigest,
  });
  if (!current.ok) throw new Error(current.errorCode);
  const target = buildSelectedActionSemanticTarget({
    command: state.structuredAction.command,
    reference: state.selectedActionResponseReference,
    authority: state.selectedActionResponseAuthority,
    currentAuthority: current.currentAuthority,
  });
  if (!target.ok) throw new Error(target.errorCode);
  return target.target;
}

export async function verifyResponse(input: {
  maximumProviderCalls: number;
  responseClaimVerifier: ResponseClaimVerifier;
  publicationBundle:
    | ModelPublicationBundle
    | (() => Promise<ModelPublicationBundle>);
  runtime: SingleAgentRuntimeContext;
  state: ResponseVerificationState;
}): Promise<ResponseVerificationUpdate> {
  const { state } = input;
  if (state.responseVerificationCalls >= 1) {
    return { failure: 'agent_response_verification_limit_exceeded' };
  }
  if (!state.responseText || !state.responseFactualClaims) {
    return { failure: 'agent_grounded_response_invalid' };
  }
  if (state.providerAttempts >= input.maximumProviderCalls) {
    return { failure: 'agent_provider_call_limit_exceeded' };
  }
  const initialFailure = await runtimeDispatchFailure(input.runtime);
  if (initialFailure) return { failure: initialFailure };

  let publicationBundle: ModelPublicationBundle;
  try {
    publicationBundle =
      typeof input.publicationBundle === 'function'
        ? await input.publicationBundle()
        : input.publicationBundle;
  } catch {
    return { failure: 'agent_model_publication_authority_invalid' };
  }
  const domainState = verifiedState(state);
  if (
    !validateModelPublicationReference({
      bundle: publicationBundle,
      projectionDigest: publicationBundle.projectionDigest,
    }) ||
    await stateRevision(domainState.latestUserMessage) !==
      publicationBundle.lifecycle.currentUserMessageDigest
  ) {
    return { failure: 'agent_response_grounding_rejected' };
  }
  let semanticTarget: SelectedActionSemanticTarget | undefined;
  try {
    semanticTarget = selectedActionTarget(state, domainState);
  } catch {
    return { failure: 'agent_response_grounding_rejected' };
  }
  const attempt = state.providerAttempts + 1;
  const startedAt = performance.now();
  const span = await input.runtime.turnTrace.startSpan({
    name: 'response_grounding_verification',
    runType: 'llm',
    inputs: {
      evidenceIds: publicationBundle.allowedEvidenceIds,
      projectionDigest: publicationBundle.projectionDigest,
      selectedActionDigest:
        semanticTarget?.currentAuthority.actionDigest ?? null,
    },
  });
  const spanFailure = await runtimeDispatchFailure(input.runtime);
  if (spanFailure) {
    await span.fail(new Error(spanFailure));
    return { failure: spanFailure };
  }
  if (typeof input.publicationBundle === 'function') {
    try {
      if (await input.publicationBundle() !== publicationBundle) {
        await span.fail(
          new Error('agent_model_publication_authority_invalid'),
        );
        return { failure: 'agent_model_publication_authority_invalid' };
      }
    } catch {
      await span.fail(
        new Error('agent_model_publication_authority_invalid'),
      );
      return { failure: 'agent_model_publication_authority_invalid' };
    }
  }
  try {
    const remainingMs = Math.max(
      1,
      input.runtime.externalCallContext.deadlineAt - Date.now(),
    );
    const invocationConfig = {
      ...mergeConfigs(getConfig(), { timeout: remainingMs }),
      signal: input.runtime.externalCallContext.signal,
    };
    const output = await input.responseClaimVerifier.verify({
      customerText: state.responseText,
      currentUserMessage: domainState.latestUserMessage,
      publicationBundle,
      ...(semanticTarget
        ? { selectedActionTarget: semanticTarget }
        : {}),
    }, invocationConfig);
    const resultFailure = await runtimeDispatchFailure(input.runtime);
    if (resultFailure) {
      await span.fail(new Error(resultFailure));
      return { failure: resultFailure };
    }
    if (typeof input.publicationBundle === 'function') {
      try {
        if (await input.publicationBundle() !== publicationBundle) {
          await span.fail(
            new Error('agent_model_publication_authority_invalid'),
          );
          return { failure: 'agent_model_publication_authority_invalid' };
        }
      } catch {
        await span.fail(
          new Error('agent_model_publication_authority_invalid'),
        );
        return { failure: 'agent_model_publication_authority_invalid' };
      }
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    const verifiedClaims = await validateResponseClaimVerification({
      raw: output,
      bundle: publicationBundle,
      customerText: state.responseText,
    });
    let currentSemanticTarget: SelectedActionSemanticTarget | undefined;
    let selectedActionTargetCurrent = true;
    try {
      currentSemanticTarget = selectedActionTarget(state, domainState);
    } catch {
      selectedActionTargetCurrent = false;
    }
    const selectedAction = validateSelectedActionSemanticAttestation({
      raw: verifiedClaims.ok
        ? verifiedClaims.verification.selectedActionAttestation
        : undefined,
      ...(currentSemanticTarget
        ? { target: currentSemanticTarget }
        : {}),
    });
    if (
      !verifiedClaims.ok ||
      !selectedActionTargetCurrent ||
      !selectedAction.ok ||
      !responseFactualClaimsMatch(
        state.responseFactualClaims,
        verifiedClaims.verification.factualClaims,
      )
    ) {
      await span.end({ outcome: 'rejected', latencyMs });
      return {
        providerAttempts: attempt,
        providerAttemptEvidence: [
          ...state.providerAttemptEvidence,
          {
            attempt,
            outcome: 'invalid_response',
            purpose: 'response_verification',
          },
        ],
        responseVerificationCalls: 1,
        responseVerificationLatencyMs: latencyMs,
        failure: 'agent_response_grounding_rejected',
      };
    }
    await span.end({ outcome: 'success', latencyMs });
    const finalFailure = await runtimeDispatchFailure(input.runtime);
    if (finalFailure) return { failure: finalFailure };
    if (typeof input.publicationBundle === 'function') {
      try {
        if (await input.publicationBundle() !== publicationBundle) {
          return { failure: 'agent_model_publication_authority_invalid' };
        }
      } catch {
        return { failure: 'agent_model_publication_authority_invalid' };
      }
    }
    return {
      providerAttempts: attempt,
      providerAttemptEvidence: [
        ...state.providerAttemptEvidence,
        {
          attempt,
          outcome: 'success',
          purpose: 'response_verification',
        },
      ],
      responseVerificationCalls: 1,
      responseVerificationLatencyMs: latencyMs,
      responsePublicationAttestation:
        verifiedClaims.verification.publicationAttestation,
      responseVerified: true,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const dispatchFailure = await runtimeDispatchFailure(input.runtime);
    if (dispatchFailure) {
      await span.fail(new Error(dispatchFailure));
      return { failure: dispatchFailure };
    }
    const provider = classifyProviderFailure(error);
    await span.fail(
      new Error(`response_verification_${provider.errorClass}`),
    );
    return {
      providerAttempts: attempt,
      providerAttemptEvidence: [
        ...state.providerAttemptEvidence,
        {
          attempt,
          outcome: 'error',
          errorClass: provider.errorClass,
          retryable: false,
          purpose: 'response_verification',
        },
      ],
      responseVerificationCalls: 1,
      responseVerificationLatencyMs: latencyMs,
      failure:
        `agent_response_verification_failed:${provider.errorClass}`,
    };
  }
}
