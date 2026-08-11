import {
  agentStateWithCurrentOrderStatusEvidence,
} from '../graph/orderStatusEvidenceProjection.js';
import {
  emitDerivedEvents,
  emitSessionIntelligence,
} from '../graph/commerceMonitoring.js';
import type {
  AgentTurnInput,
  AgentTurnOutput,
  ReplyIntent,
} from '../businesses/kfc/turnContracts.js';
import type { ConversationTurn } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import {
  emitDashboardEvent,
  traceStateSummary,
  verifiedStateSnapshotSourceType,
} from '../graph/turnSupport.js';
import {
  buildVerifiedStateSnapshot,
  persistVerifiedStateSnapshot,
} from '../graph/verifiedState.js';
import {
  kfcGenUiAttachmentForPersistence,
  kfcGenUiVerifiedStateRevision,
} from '../genui/kfcGenUi.js';
import { selectKfcGenUiAttachment } from '../genui/kfcGenUiSelector.js';
import { countCustomerTurns } from '../monitor/sessionIntelligence.js';
import type { AgentTraceSpan } from '../observability/agentTracing.js';
import {
  projectVerifiedMenuCollectionToText,
} from '../ordering/verifiedCollections.js';
import type { ToolTraceEntry } from '../ordering/types.js';
import {
  assertPresentationMatchesChannel,
  buildChannelPresentation,
  buildSocialPresentation,
} from '../presentation/channelPresentation.js';
import {
  resolveResponseProfile,
} from '../presentation/responseProfile.js';
import {
  currentTurnPaymentStatusFromIssuedExecutions,
  currentTurnRecentOrderFromIssuedExecutions,
  type GraphExecutedToolResult,
} from './graphExecutedToolResult.js';
import {
  authorityHasScopes,
  modelPublicationAuthorityIsLive,
  type ModelPublicationAuthority,
} from './modelPublicationAuthority.js';
import type {
  CurrentTurnResponseEvidence,
} from './modelPublicationProjection.js';
import {
  issueSavedAddressPresentationReference,
} from './savedAddressVerifiedRef.js';
import type {
  ResponseFactualClaims,
} from './responseGrounding.js';
import type {
  ResponsePublicationAttestation,
} from './responsePrivacyAttestation.js';
import {
  assertPublicationCommitAuthority,
} from './agentPublicationCommitAuthority.js';
import { paymentAttemptMatchesOrder } from '../ordering/paymentOrderAuthority.js';

function replyIntentFor(
  state: AgentGraphState,
  trace: ToolTraceEntry[],
): ReplyIntent {
  if (trace.some((entry) => entry.ok && entry.toolName === 'placeOrder')) {
    return 'order_created';
  }
  if (state.handoff) return 'human_review_required';
  if (
    paymentAttemptMatchesOrder(state.paymentAttempt, state.order) &&
    state.paymentAttempt?.status === 'failed'
  ) {
    return 'payment_retry';
  }
  return 'general_reply';
}

export async function persistCompletedTurn(input: {
  turnInput: AgentTurnInput;
  turnTrace: AgentTraceSpan;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
  responseText: string;
  responseFactualClaims?: ResponseFactualClaims;
  responsePublicationAttestation?: ResponsePublicationAttestation | null;
  modelPublicationAuthority?: ModelPublicationAuthority;
  currentTurnResponseEvidence?: readonly CurrentTurnResponseEvidence[];
  graphExecutedToolResults?: readonly GraphExecutedToolResult[];
}): Promise<AgentTurnOutput> {
  const runGuard = input.turnInput.runGuard;
  if (runGuard && !runGuard.commitFence) {
    throw new Error('agent_run_commit_fence_missing');
  }
  if (
    Boolean(input.modelPublicationAuthority) !==
      Boolean(input.responsePublicationAttestation)
  ) {
    throw new Error('agent_response_publication_attestation_missing');
  }
  if (
    input.modelPublicationAuthority &&
    input.responsePublicationAttestation
  ) {
    const assertCurrent = await assertPublicationCommitAuthority({
      state: input.state,
      authority: input.modelPublicationAuthority,
      currentTurnEvidence: input.currentTurnResponseEvidence ?? [],
      accessContext: input.turnInput.accessContext,
      guestCheckoutAuthority:
        input.turnInput.guestCheckoutAuthority,
      verifiedGuestAuthority:
        input.turnInput.confirmationResume
          ?.verifiedGuestAuthority,
      runFence: input.turnInput.runGuard?.commitFence,
      confirmationResume:
        input.turnInput.confirmationResume !== undefined,
      responseText: input.responseText,
      responsePublicationAttestation:
        input.responsePublicationAttestation,
    });
    assertCurrent();
  }
  Object.assign(
    input.state,
    agentStateWithCurrentOrderStatusEvidence(input.state),
  );
  const responseProfile = resolveResponseProfile(input.turnInput);
  const successfulToolNames = input.currentTurnToolTrace
    .filter((entry) => entry.ok)
    .map((entry) => entry.toolName);
  const genUiIssuedAt = new Date();
  const genUiExpiresAt = new Date(
    genUiIssuedAt.getTime() + 60 * 60_000,
  ).toISOString();
  const savedAddressCandidate =
    !successfulToolNames.includes('quoteFulfillment') &&
      input.modelPublicationAuthority &&
      input.currentTurnResponseEvidence
      ? await issueSavedAddressPresentationReference({
          authority: input.modelPublicationAuthority,
          currentTurnEvidence: input.currentTurnResponseEvidence,
          verifiedRevision: kfcGenUiVerifiedStateRevision(input.state),
          createdAt: genUiIssuedAt.toISOString(),
          expiresAt: genUiExpiresAt,
        })
      : undefined;
  if (savedAddressCandidate && !runGuard?.commitFence) {
    throw new Error('agent_run_commit_fence_missing');
  }
  const savedAddressPresentation =
    responseProfile === 'genui'
      ? savedAddressCandidate
      : undefined;
  const recentOrderPresentation =
    responseProfile === 'genui' &&
      input.modelPublicationAuthority &&
      input.graphExecutedToolResults &&
      modelPublicationAuthorityIsLive(
        input.modelPublicationAuthority,
      ) &&
      authorityHasScopes(input.modelPublicationAuthority, [
        'customer:read',
        'order:read',
      ]) &&
      input.currentTurnToolTrace.some(
        ({ toolName }) => toolName === 'checkPaymentStatus',
      ) &&
      !input.state.order
      ? currentTurnRecentOrderFromIssuedExecutions({
          authority: input.modelPublicationAuthority,
          executions: input.graphExecutedToolResults,
        })
      : undefined;
  const paymentStatusPresentation =
    responseProfile === 'genui' &&
      input.modelPublicationAuthority &&
      input.graphExecutedToolResults &&
      modelPublicationAuthorityIsLive(
        input.modelPublicationAuthority,
      ) &&
      authorityHasScopes(input.modelPublicationAuthority, [
        'payment:read',
      ])
      ? currentTurnPaymentStatusFromIssuedExecutions({
          authority: input.modelPublicationAuthority,
          executions: input.graphExecutedToolResults,
        })
      : undefined;
  const reuseVerifiedMenuResults =
    input.responseFactualClaims?.evidenceReferences.some(
      ({ evidenceId }) =>
        evidenceId === 'active_collection:searchMenu',
    ) ?? false;
  const genUi =
    responseProfile === 'genui'
      ? selectKfcGenUiAttachment({
        state: input.state,
        turnToolNames: successfulToolNames,
        reuseVerifiedMenuResults,
        ...(savedAddressPresentation
          ? { savedAddressPresentation }
          : {}),
        ...(recentOrderPresentation
          ? { recentOrderPresentation }
          : {}),
        ...(paymentStatusPresentation
          ? { paymentStatusPresentation }
          : {}),
        issuedAt: genUiIssuedAt,
      })
      : undefined;
  const activeMenu = input.state.activeMenuCollection?.result;
  const standaloneText =
    responseProfile !== 'genui' &&
    successfulToolNames.includes('searchMenu') &&
    activeMenu?.scope.scope === 'all'
      ? [
          input.responseText,
          ...projectVerifiedMenuCollectionToText(activeMenu).chunks,
        ].join('\n\n')
      : input.responseText;
  const presentation =
    responseProfile === 'genui'
      ? buildChannelPresentation({
        channel: input.turnInput.channel,
        responseProfile,
        graphResponseText: input.responseText,
        genUi,
      })
      : input.turnInput.channel === 'kfc'
        ? { profile: 'social' as const, text: standaloneText }
        : buildSocialPresentation({
          channel: input.turnInput.channel,
          standaloneText,
          state: input.state,
        });
  assertPresentationMatchesChannel(
    input.turnInput.channel,
    presentation,
    responseProfile,
  );
  const metadata = {
    ...(input.turnInput.metadata?.release
      ? { release: input.turnInput.metadata.release }
      : {}),
    ...(input.turnInput.responseProfile
      ? { responseProfile: input.turnInput.responseProfile }
      : {}),
    ...(presentation.profile === 'genui' && genUi
      ? {
          genUi: kfcGenUiAttachmentForPersistence(genUi, {
            currentTurnPrivateOrder:
              recentOrderPresentation !== undefined,
          }),
        }
      : {}),
    ...(presentation.profile === 'social' && presentation.media?.length
      ? {
          attachments: presentation.media.map((item) => ({
            type: 'image' as const,
            url: item.imageUrl,
            title: item.title,
          })),
        }
      : {}),
  };
  const assistantTurn = {
    sessionId: input.turnInput.sessionId,
    channel: input.turnInput.channel,
    role: 'assistant',
    text: presentation.text,
    externalMessageId: null,
    externalUserId: input.turnInput.customerId,
    deliveryStatus: 'pending',
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  } as const;
  let turn: ConversationTurn;
  if (runGuard?.commitFence) {
    if (
      input.modelPublicationAuthority &&
      input.responsePublicationAttestation
    ) {
      const assertCurrent = await assertPublicationCommitAuthority({
        state: input.state,
        authority: input.modelPublicationAuthority,
        currentTurnEvidence: input.currentTurnResponseEvidence ?? [],
        accessContext: input.turnInput.accessContext,
        guestCheckoutAuthority:
          input.turnInput.guestCheckoutAuthority,
        verifiedGuestAuthority:
          input.turnInput.confirmationResume
            ?.verifiedGuestAuthority,
        runFence: input.turnInput.runGuard?.commitFence,
        confirmationResume:
          input.turnInput.confirmationResume !== undefined,
        responseText: input.responseText,
        responsePublicationAttestation:
          input.responsePublicationAttestation,
      });
      assertCurrent();
    }
    if (savedAddressCandidate) {
      input.state.pendingSavedAddressRef = savedAddressCandidate.ref;
    }
    const publicationAuthority = input.modelPublicationAuthority;
    const publicationNotAfter =
      publicationAuthority?.privateAccess.state === 'authenticated'
        ? publicationAuthority.privateAccess.authenticationExpiresAt
        : publicationAuthority?.privateAccess.state === 'guest_checkout'
          ? publicationAuthority.privateAccess.authorityExpiresAt
          : undefined;
    const committed =
      await input.turnInput.store.commitAssistantTurnIfRunCurrent({
        fence: runGuard.commitFence,
        ...(publicationNotAfter ? { notAfter: publicationNotAfter } : {}),
        stateEvent: {
          sessionId: input.turnInput.sessionId,
          sourceType: verifiedStateSnapshotSourceType,
          payload: {
            verifiedState: buildVerifiedStateSnapshot(input.state),
          },
        },
        assistantTurn,
        ...(savedAddressCandidate
          ? {
              verifiedRefs: [
                savedAddressCandidate.persistence.record,
              ],
            }
          : {}),
      });
    if (committed.status === 'stale') {
      throw new Error('customer_run_cancelled');
    }
    turn = committed.turn;
  } else {
    if (
      input.modelPublicationAuthority &&
      input.responsePublicationAttestation
    ) {
      const assertCurrent = await assertPublicationCommitAuthority({
        state: input.state,
        authority: input.modelPublicationAuthority,
        currentTurnEvidence: input.currentTurnResponseEvidence ?? [],
        accessContext: input.turnInput.accessContext,
        guestCheckoutAuthority:
          input.turnInput.guestCheckoutAuthority,
        verifiedGuestAuthority:
          input.turnInput.confirmationResume
            ?.verifiedGuestAuthority,
        runFence: input.turnInput.runGuard?.commitFence,
        confirmationResume:
          input.turnInput.confirmationResume !== undefined,
        responseText: input.responseText,
        responsePublicationAttestation:
          input.responsePublicationAttestation,
      });
      assertCurrent();
    }
    if (savedAddressCandidate) {
      input.state.pendingSavedAddressRef = savedAddressCandidate.ref;
    }
    await persistVerifiedStateSnapshot(input.turnInput.store, input.state);
    turn = await input.turnInput.store.appendTurn(assistantTurn);
  }
  emitDerivedEvents(
    input.turnInput,
    input.state,
    input.currentTurnToolTrace,
  );
  emitDashboardEvent(input.turnInput, 'conversation_turn_created', {
    turnId: turn.id,
    role: turn.role,
    channel: turn.channel,
    deliveryStatus: turn.deliveryStatus,
    externalMessageId: turn.externalMessageId,
    externalUserId: turn.externalUserId,
    text: turn.text,
    metadata: turn.metadata,
  });
  const customerTurnCount = countCustomerTurns(input.state.recentTurns);
  const intelligenceSpan = await input.turnTrace.startSpan({
    name: 'session_intelligence',
    runType: 'chain',
    inputs: {
      customerTurnCount,
      state: traceStateSummary(input.state),
    },
    metadata: { component: 'resolveMonitorSessionIntelligence' },
    tags: ['agent-session-intelligence'],
  });
  try {
    await emitSessionIntelligence(
      input.turnInput,
      input.state,
      customerTurnCount,
    );
    await intelligenceSpan.end({
      customerTurnCount,
      escalationReasons: [...input.state.escalationReasons],
    });
  } catch (error) {
    await intelligenceSpan.fail(error);
    throw error;
  }
  return {
    state: input.state,
    responseText: presentation.text,
    presentation,
    replyIntent: replyIntentFor(
      input.state,
      input.currentTurnToolTrace,
    ),
    genUi: presentation.profile === 'genui' ? genUi : undefined,
    assistantTurnId: turn.id,
    status: 'completed',
  };
}
