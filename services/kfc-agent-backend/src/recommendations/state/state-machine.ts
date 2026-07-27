import type {
  Placement,
  RecommendationDecisionResponse,
  RecommendationEvent,
  RecommendationState,
} from '../domain/contracts.js';
import {
  parseRecommendationDecisionResponse,
  parseRecommendationEvent,
  parseRecommendationState,
} from '../domain/schemas.js';
import type { RecommendationDecisionContext } from '../eligibility/types.js';
import type { RecommendationRequestKind } from './types.js';

type Flow = RecommendationDecisionContext['flow'];

const starterPlacement = (placement: Placement): boolean =>
  placement === 'local_favorite' || placement === 'for_you';

function parsedState(state: RecommendationState): RecommendationState {
  return parseRecommendationState(structuredClone(state));
}

function transition(
  state: RecommendationState,
  changes: Omit<Partial<RecommendationState>, 'revision'>,
): RecommendationState {
  return parseRecommendationState({
    ...state,
    ...changes,
    revision: state.revision + 1,
  });
}

function readyStageFor(
  state: RecommendationState,
  placement: Placement,
): Flow['stage'] {
  if (
    state.stage === 'starter_eligible' &&
    state.nextEligiblePlacement === 'starter' &&
    starterPlacement(placement)
  ) {
    return 'starter_ready';
  }
  if (
    state.stage === 'modifier_eligible' &&
    state.nextEligiblePlacement === 'modifier_upsell' &&
    placement === 'modifier_upsell'
  ) {
    return 'modifier_ready';
  }
  if (
    (state.stage === 'modifier_resolved' ||
      state.stage === 'smart_cross_sell_eligible') &&
    state.nextEligiblePlacement === 'smart_cross_sell' &&
    placement === 'smart_cross_sell'
  ) {
    return 'smart_cross_sell_ready';
  }
  return 'complete';
}

function assertOrderFlow(
  state: RecommendationState,
  orderFlowId: string,
): void {
  if (state.orderFlowId !== orderFlowId) {
    throw new Error('recommendation_order_flow_mismatch');
  }
}

function pendingFor(
  response: RecommendationDecisionResponse,
  decisionTime: string,
): RecommendationState['pendingRecommendation'] {
  if (response.status !== 'recommended' || !response.primaryOffer) return null;
  return {
    recommendationId: response.recommendationId,
    requestId: response.requestId,
    placement: response.placement,
    actionIds: response.primaryOffer.actions.map((action) => action.actionId),
    cartRevision: response.primaryOffer.actions[0]!.cartRevision,
    traceRef: response.traceRef,
    decidedAt: decisionTime,
  };
}

function attemptsWith(
  attemptedPlacements: RecommendationState['attemptedPlacements'],
  placement: Placement,
): RecommendationState['attemptedPlacements'] {
  return [...attemptedPlacements, placement];
}

function appendUnique<T extends string>(
  existing: readonly T[],
  values: readonly T[],
): T[] {
  return [...new Set([...existing, ...values])];
}

function renderedActionIds(event: RecommendationEvent): string[] {
  const payloadActionIds = event.payload.renderedActionIds;
  const fromPayload = Array.isArray(payloadActionIds)
    ? payloadActionIds.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  return appendUnique(
    fromPayload,
    event.actionId === null ? [] : [event.actionId],
  );
}

function isOutcomeEvent(event: RecommendationEvent): boolean {
  return [
    'selected',
    'explicitly_dismissed',
    'ignored',
    'superseded',
    'cart_mutation_succeeded',
    'cart_mutation_failed',
    'checkout_completed',
    'order_abandoned',
    'order_cancelled',
  ].includes(event.eventType);
}

function pendingForOutcome(
  state: RecommendationState,
  event: RecommendationEvent,
): NonNullable<RecommendationState['pendingRecommendation']> {
  const pending = state.pendingRecommendation;
  const actionRequired = [
    'selected',
    'cart_mutation_succeeded',
    'cart_mutation_failed',
  ].includes(event.eventType);
  const mutationOutcome = [
    'cart_mutation_succeeded',
    'cart_mutation_failed',
  ].includes(event.eventType);
  if (
    pending === null ||
    pending.placement !== event.placement ||
    pending.recommendationId !== event.recommendationId ||
    pending.requestId !== event.requestId ||
    (actionRequired && event.actionId === null) ||
    (event.actionId !== null && !pending.actionIds.includes(event.actionId)) ||
    (!mutationOutcome &&
      event.cartRevision !== null &&
      event.cartRevision !== pending.cartRevision)
  ) {
    throw new Error('recommendation_outcome_not_pending');
  }
  return pending;
}

export function initialRecommendationState(
  orderFlowId: string,
): RecommendationState {
  return parseRecommendationState({
    schemaVersion: 'kfc-recommendation-state-v1',
    revision: 0,
    orderFlowId,
    stage: 'starter_eligible',
    attemptedPlacements: [],
    shownActionIds: [],
    rejectedActionIds: [],
    pendingRecommendation: null,
    recordedOutcomeEventIds: [],
    nextEligiblePlacement: 'starter',
  });
}

export function flowForDecision(
  state: RecommendationState,
  placement: Placement,
  requestKind: RecommendationRequestKind,
): Flow {
  const current = parsedState(state);
  const alreadyAttempted = current.attemptedPlacements.includes(placement);
  return {
    stage:
      requestKind === 'proactive' && alreadyAttempted
        ? 'complete'
        : readyStageFor(current, placement),
    attemptedPlacements: [...current.attemptedPlacements],
    previouslyShownActionIds: [...current.shownActionIds],
    rejectedActionIds: [...current.rejectedActionIds],
  };
}

export function applyRecommendationDecision(
  state: RecommendationState,
  response: RecommendationDecisionResponse,
  decisionTime: string,
): RecommendationState {
  const current = parsedState(state);
  const decision = parseRecommendationDecisionResponse(response);
  assertOrderFlow(current, decision.orderFlowId);

  if (current.stage === 'complete') {
    throw new Error('recommendation_decision_not_eligible');
  }
  if (
    current.attemptedPlacements.includes(decision.placement) ||
    readyStageFor(current, decision.placement) === 'complete'
  ) {
    throw new Error('recommendation_decision_not_eligible');
  }

  const attemptedPlacements = attemptsWith(
    current.attemptedPlacements,
    decision.placement,
  );
  const pendingRecommendation = pendingFor(decision, decisionTime);

  if (starterPlacement(decision.placement)) {
    return transition(current, {
      stage: 'starter_resolved',
      attemptedPlacements,
      pendingRecommendation,
      nextEligiblePlacement: null,
    });
  }
  if (decision.placement === 'modifier_upsell') {
    if (decision.status === 'recommended') {
      return transition(current, {
        stage: 'modifier_pending',
        attemptedPlacements,
        pendingRecommendation,
        nextEligiblePlacement: null,
      });
    }
    return transition(current, {
      stage: 'smart_cross_sell_eligible',
      attemptedPlacements,
      pendingRecommendation: null,
      nextEligiblePlacement: 'smart_cross_sell',
    });
  }
  if (decision.status === 'recommended') {
    return transition(current, {
      stage: 'smart_cross_sell_pending',
      attemptedPlacements,
      pendingRecommendation,
      nextEligiblePlacement: null,
    });
  }
  return transition(current, {
    stage: 'complete',
    attemptedPlacements,
    pendingRecommendation: null,
    nextEligiblePlacement: null,
  });
}

export function applyCustomerRequestedRecommendationDecision(
  state: RecommendationState,
  response: RecommendationDecisionResponse,
): RecommendationState {
  const current = parsedState(state);
  const decision = parseRecommendationDecisionResponse(response);
  assertOrderFlow(current, decision.orderFlowId);
  if (current.stage !== 'complete') {
    throw new Error('recommendation_customer_requested_state_invalid');
  }
  return transition(current, {});
}

export function applyRecommendationImpression(
  state: RecommendationState,
  event: RecommendationEvent,
): RecommendationState {
  const current = parsedState(state);
  const impression = parseRecommendationEvent(event);
  assertOrderFlow(current, impression.orderFlowId);
  if (impression.eventType !== 'impression_rendered') {
    throw new Error('recommendation_impression_event_invalid');
  }
  const shownActionIds = appendUnique(
    current.shownActionIds,
    renderedActionIds(impression),
  );
  if (shownActionIds.length === current.shownActionIds.length) return current;
  return transition(current, { shownActionIds });
}

export function applyCustomerRequestedRecommendationOutcome(
  state: RecommendationState,
  event: RecommendationEvent,
  displayedActionIds: readonly string[],
): RecommendationState {
  const current = parsedState(state);
  const outcome = parseRecommendationEvent(event);
  assertOrderFlow(current, outcome.orderFlowId);
  if (current.stage !== 'complete' || !isOutcomeEvent(outcome)) {
    throw new Error('recommendation_customer_requested_outcome_invalid');
  }
  if (current.recordedOutcomeEventIds.includes(outcome.eventId)) return current;
  if (
    outcome.actionId !== null &&
    !displayedActionIds.includes(outcome.actionId)
  ) {
    throw new Error('recommendation_customer_requested_outcome_invalid');
  }
  return transition(current, {
    recordedOutcomeEventIds: appendUnique(current.recordedOutcomeEventIds, [
      outcome.eventId,
    ]),
    rejectedActionIds:
      outcome.eventType === 'explicitly_dismissed'
        ? appendUnique(
            current.rejectedActionIds,
            displayedActionIds as readonly (typeof current.rejectedActionIds)[number][],
          )
        : [...current.rejectedActionIds],
  });
}

export function applyRecommendationOutcome(
  state: RecommendationState,
  event: RecommendationEvent,
  displayedActionIds: readonly string[],
): RecommendationState {
  const current = parsedState(state);
  const outcome = parseRecommendationEvent(event);
  assertOrderFlow(current, outcome.orderFlowId);
  if (!isOutcomeEvent(outcome)) {
    throw new Error('recommendation_outcome_event_invalid');
  }
  if (current.recordedOutcomeEventIds.includes(outcome.eventId)) return current;
  pendingForOutcome(current, outcome);

  const rejectedActionIds =
    outcome.eventType === 'explicitly_dismissed'
      ? appendUnique(
          current.rejectedActionIds,
          displayedActionIds as readonly (typeof current.rejectedActionIds)[number][],
        )
      : [...current.rejectedActionIds];
  const next = transition(current, {
    recordedOutcomeEventIds: appendUnique(current.recordedOutcomeEventIds, [
      outcome.eventId,
    ]),
    rejectedActionIds,
  });

  const clearsPending = [
    'explicitly_dismissed',
    'ignored',
    'superseded',
  ].includes(outcome.eventType);
  const completesMutation = [
    'cart_mutation_succeeded',
    'cart_mutation_failed',
  ].includes(outcome.eventType);
  const advancesPlacement = clearsPending || completesMutation;

  if (starterPlacement(outcome.placement)) {
    if (advancesPlacement) {
      return parseRecommendationState({
        ...next,
        stage: 'modifier_eligible',
        pendingRecommendation: null,
        nextEligiblePlacement: 'modifier_upsell',
      });
    }
    return next;
  }
  if (outcome.placement === 'modifier_upsell') {
    if (advancesPlacement) {
      return parseRecommendationState({
        ...next,
        stage: 'smart_cross_sell_eligible',
        pendingRecommendation: null,
        nextEligiblePlacement: 'smart_cross_sell',
      });
    }
    return next;
  }
  if (advancesPlacement) {
    return parseRecommendationState({
      ...next,
      stage: 'complete',
      pendingRecommendation: null,
      nextEligiblePlacement: null,
    });
  }
  return next;
}
