import {
  selectedPaymentMethodAuthoritySchema,
} from '../domain/opaqueProviderId.js';
import type { ConversationTurn } from '../domain/types.js';
import type { AgentTurnInput } from '../graph/agentTurnState.js';
import {
  agentStateWithCurrentOrderStatusEvidence,
} from '../graph/orderStatusEvidenceProjection.js';
import type { AgentGraphState } from '../graph/state.js';
import {
  loadPriorVerifiedState,
} from '../graph/verifiedState.js';
import { countCustomerTurns } from '../monitor/sessionIntelligence.js';
import { buildBoundedRecentTurns } from '../session/sessionContext.js';
import {
  semanticConversationTurns,
} from './trustedActionConversation.js';

export interface LoadedAgentTurnState {
  state: AgentGraphState;
  customerTurnCount: number;
  currentUserTurn?: ConversationTurn;
}

export function assembleLoadedTurnState(input: {
  turnInput: AgentTurnInput;
  prior: Awaited<ReturnType<typeof loadPriorVerifiedState>>;
  semanticTurns: ConversationTurn[];
  currentUserTurn?: ConversationTurn;
}): LoadedAgentTurnState {
  const {
    turnInput,
    prior,
    semanticTurns,
    currentUserTurn,
  } = input;
  const priorSelectedPaymentMethod =
    selectedPaymentMethodAuthoritySchema.safeParse(
      prior.selectedPaymentMethod,
    );
  const publicationTurns =
    turnInput.trustedCustomerAction &&
      currentUserTurn &&
      !semanticTurns.some((turn) => turn.id === currentUserTurn.id)
      ? [...semanticTurns, currentUserTurn]
      : semanticTurns;
  return {
    state: agentStateWithCurrentOrderStatusEvidence({
      sessionId: turnInput.sessionId,
      customerId: turnInput.customerId,
      channel: turnInput.channel,
      latestUserMessage: currentUserTurn?.text ?? turnInput.text,
      recentTurns: buildBoundedRecentTurns(publicationTurns),
      cart: prior.cart,
      address: prior.address,
      addressDraft: prior.addressDraft,
      orderPreview: prior.orderPreview,
      order: prior.order,
      cancellationStatusChecked: prior.cancellationStatusChecked,
      userConfirmedOrder: false,
      escalationReasons: [],
      retrievedEvidence: [],
      selectedModifiers: prior.selectedModifiers,
      fulfillment: prior.fulfillment,
      exactCartAvailabilityObservation:
        prior.exactCartAvailabilityObservation,
      promotionContext: prior.promotionContext,
      promotionOffers: prior.promotionOffers,
      contentEvidence: prior.contentEvidence,
      menuSearchResults: prior.menuSearchResults,
      verifiedCollections: prior.verifiedCollections,
      activeCollectionKeys: prior.activeCollectionKeys,
      activeMenuCollection: prior.activeMenuCollection,
      commerceApprovalReceipts: prior.commerceApprovalReceipts,
      menuItemDetail: prior.menuItemDetail,
      menuModifierOptions: prior.menuModifierOptions,
      customerContext: prior.customerContext,
      pendingSavedAddressRef: prior.pendingSavedAddressRef,
      paymentAttempt: prior.paymentAttempt,
      selectedPaymentMethod: priorSelectedPaymentMethod.success
        ? priorSelectedPaymentMethod.data
        : undefined,
      paymentMethodEvidence: prior.paymentMethodEvidence,
      invoiceRequest: prior.invoiceRequest,
      handoff: prior.handoff,
      toolTrace: prior.toolTrace ?? [],
    }),
    customerTurnCount: countCustomerTurns(semanticTurns),
    currentUserTurn,
  };
}

/**
 * Rehydrates an already-persisted exact user turn without invoking intake or
 * any store mutation. Cancellation/deadline recovery must never append a
 * replacement turn when the original request had no external message ID.
 */
export async function rehydrateExactTurnStateReadOnly(
  input: AgentTurnInput,
  currentUserTurnId: string,
): Promise<LoadedAgentTurnState> {
  const exactId = currentUserTurnId.trim();
  if (!exactId) throw new Error('agent_current_user_turn_missing');
  const [prior, allTurns] = await Promise.all([
    loadPriorVerifiedState(input.store, input.sessionId),
    input.store.listTurns(input.sessionId),
  ]);
  const exactCurrentTurnIndex = allTurns.findIndex(
    (turn) => turn.id === exactId,
  );
  const currentUserTurn = allTurns[exactCurrentTurnIndex];
  if (
    exactCurrentTurnIndex < 0 ||
    !currentUserTurn ||
    currentUserTurn.role !== 'user' ||
    currentUserTurn.sessionId !== input.sessionId ||
    currentUserTurn.channel !== input.channel ||
    (currentUserTurn.externalUserId ?? null) !==
      (input.customerId ?? null)
  ) {
    throw new Error('agent_current_user_turn_missing');
  }
  const semanticTurns = semanticConversationTurns(
    allTurns.slice(0, exactCurrentTurnIndex + 1),
  );
  return assembleLoadedTurnState({
    turnInput: input,
    prior,
    semanticTurns,
    currentUserTurn,
  });
}
