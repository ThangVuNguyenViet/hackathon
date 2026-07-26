import type { GeneratedModifierGroup } from '../../fixtures/schema.js';
import { digestCommerceAction } from '../../ordering/commerceDigest.js';
import { canonicalUtcInstantOccursBefore } from '../domain/canonical-instant.js';
import { KFC_RECOMMENDATION_POLICY_VERSION } from '../domain/versions.js';
import type {
  EligibilityDecision,
  EligibilityEvaluationInput,
  EligibilityReasonCode,
  PotentialRecommendationCandidate,
  RecommendationDecisionContext,
} from './types.js';

const reasonOrder: readonly EligibilityReasonCode[] = [
  'eligible',
  'placement_already_attempted',
  'placement_not_yet_eligible',
  'verified_history_required',
  'zero_history_required',
  'parent_cart_line_required',
  'catalog_unavailable',
  'store_unavailable',
  'non_sellable_product',
  'already_in_cart',
  'previously_shown',
  'previously_rejected',
  'verified_dietary_exclusion',
  'modifier_parent_mismatch',
  'modifier_group_at_capacity',
  'no_positive_price_modifier',
];

const uniqueSorted = (values: readonly string[]): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const orderedReasons = (
  reasons: ReadonlySet<Exclude<EligibilityReasonCode, 'eligible'>>,
): EligibilityReasonCode[] =>
  reasonOrder.filter(
    (reason): reason is Exclude<EligibilityReasonCode, 'eligible'> =>
      reason !== 'eligible' && reasons.has(reason),
  );

export async function createEligibilityDecision(input: {
  actionId: string;
  eligible: boolean;
  reasonCodes: EligibilityReasonCode[];
  evidenceBindings: string[];
}): Promise<EligibilityDecision> {
  const evidenceBindings = uniqueSorted(input.evidenceBindings);
  const reasonCodes: EligibilityReasonCode[] = input.eligible
    ? ['eligible']
    : orderedReasons(
        new Set(input.reasonCodes.filter((reason) => reason !== 'eligible')),
      );
  const decision = {
    policyVersion: KFC_RECOMMENDATION_POLICY_VERSION,
    actionId: input.actionId,
    eligible: input.eligible,
    reasonCodes,
    evidenceBindings,
  } as const;
  return { ...decision, digest: await digestCommerceAction(decision) };
}

function visibleCompletedOrders(context: RecommendationDecisionContext) {
  if (
    !context.customerHistory ||
    !context.request.verifiedCustomerRef ||
    context.customerHistory.verifiedCustomerRef !==
      context.request.verifiedCustomerRef
  ) {
    return null;
  }
  return context.customerHistory.completedOrders.filter((order) =>
    canonicalUtcInstantOccursBefore(
      order.completedAt,
      context.request.decisionTime,
    ),
  );
}

function weekdayAt(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  }).format(new Date(instant));
}

function modifierGroupAtPath(
  groups: readonly GeneratedModifierGroup[],
  groupPath: readonly string[],
): GeneratedModifierGroup | null {
  let currentGroups = groups;
  let group: GeneratedModifierGroup | null = null;
  for (const groupId of groupPath) {
    group = currentGroups.find((entry) => entry.groupId === groupId) ?? null;
    if (!group) return null;
    currentGroups = group.options.flatMap((option) => option.modifierGroups);
  }
  return group;
}

function evaluatePlacement(
  context: RecommendationDecisionContext,
  reasons: Set<Exclude<EligibilityReasonCode, 'eligible'>>,
  bindings: string[],
): void {
  const { placement } = context.request;
  bindings.push(`placement:${placement}`, `flow-stage:${context.flow.stage}`);
  if (context.flow.attemptedPlacements.includes(placement)) {
    reasons.add('placement_already_attempted');
    bindings.push(`attempted-placement:${placement}`);
  }
  if (
    (placement === 'local_favorite' || placement === 'for_you') &&
    context.flow.stage !== 'starter_ready'
  ) {
    reasons.add('placement_not_yet_eligible');
  }
  if (
    placement === 'modifier_upsell' &&
    context.flow.stage !== 'modifier_ready'
  ) {
    reasons.add('placement_not_yet_eligible');
  }
  if (
    placement === 'smart_cross_sell' &&
    context.flow.stage !== 'smart_cross_sell_ready'
  ) {
    reasons.add('placement_not_yet_eligible');
  }

  const visibleOrders = visibleCompletedOrders(context);
  if (placement === 'for_you') {
    if (!visibleOrders) {
      reasons.add('verified_history_required');
      bindings.push('history:unverified');
    } else {
      bindings.push(
        `history:verified:${context.customerHistory!.verifiedCustomerRef}`,
        ...visibleOrders.map((order) => `completed-order:${order.orderId}`),
      );
      if (visibleOrders.length === 0) reasons.add('zero_history_required');
    }
  }
  if (placement === 'local_favorite') {
    if (visibleOrders?.length) {
      reasons.add('zero_history_required');
      bindings.push(
        ...visibleOrders.map((order) => `completed-order:${order.orderId}`),
      );
    } else {
      bindings.push(
        visibleOrders ? 'history:verified-empty' : 'history:unavailable',
      );
    }
  }
}

function evaluateGeneratedItem(
  input: EligibilityEvaluationInput,
  sellableItemId: string,
  reasons: Set<Exclude<EligibilityReasonCode, 'eligible'>>,
  bindings: string[],
): void {
  const item = input.commerceFacts.menuItems.find(
    (entry) => entry.itemId === sellableItemId,
  );
  if (!item || !item.available) reasons.add('catalog_unavailable');
  bindings.push(`catalog-item:${sellableItemId}:${item?.available ?? false}`);

  const availability = input.commerceFacts.storeAvailability.find(
    (entry) => entry.storeId === input.context.request.storeId,
  );
  const disposition = availability?.[input.context.request.fulfilmentMode];
  const weekday = weekdayAt(
    input.context.request.decisionTime,
    input.context.storeTimezone,
  );
  const isExcluded =
    disposition?.excludedItemIds.includes(sellableItemId) ?? false;
  const isTimeslotBlocked =
    disposition?.timeslotExclusions.some(
      (exclusion) =>
        exclusion.itemId === sellableItemId &&
        exclusion.repeatDays.includes(weekday),
    ) ?? false;
  bindings.push(
    `availability:${input.context.request.storeId}:${input.context.request.fulfilmentMode}:${sellableItemId}:${isExcluded}:${isTimeslotBlocked}`,
  );
  if (!disposition || isExcluded || isTimeslotBlocked)
    reasons.add('store_unavailable');
  if (!item || item.priceVnd <= 0) reasons.add('non_sellable_product');
}

function evaluateProduct(
  input: EligibilityEvaluationInput,
  candidate: PotentialRecommendationCandidate,
  reasons: Set<Exclude<EligibilityReasonCode, 'eligible'>>,
  bindings: string[],
): void {
  evaluateGeneratedItem(input, candidate.sellableItemId, reasons, bindings);

  if (
    input.context.request.cart.lines.some(
      (line) => line.sellableItemId === candidate.sellableItemId,
    )
  ) {
    reasons.add('already_in_cart');
    bindings.push(`cart-item:${candidate.sellableItemId}`);
  }
  if (
    input.context.flow.previouslyShownActionIds.includes(
      candidate.action.actionId,
    )
  ) {
    reasons.add('previously_shown');
    bindings.push(`shown-action:${candidate.action.actionId}`);
  }
  if (
    input.context.flow.rejectedActionIds.includes(candidate.action.actionId)
  ) {
    reasons.add('previously_rejected');
    bindings.push(`rejected-action:${candidate.action.actionId}`);
  }
  if (
    input.context.verifiedDietaryEvidence?.excludedSellableItemIds.includes(
      candidate.sellableItemId,
    )
  ) {
    reasons.add('verified_dietary_exclusion');
    bindings.push(
      `dietary-evidence:${input.context.verifiedDietaryEvidence.evidenceId}`,
    );
  }
}

function evaluateModifier(
  input: EligibilityEvaluationInput,
  candidate: PotentialRecommendationCandidate,
  reasons: Set<Exclude<EligibilityReasonCode, 'eligible'>>,
  bindings: string[],
): void {
  if (candidate.action.type !== 'apply_modifier') {
    reasons.add('modifier_parent_mismatch');
    return;
  }
  const action = candidate.action;
  const requestedLineId = input.context.parentCartLineId;
  const parentLine = requestedLineId
    ? input.context.request.cart.lines.find(
        (line) => line.lineId === requestedLineId,
      )
    : undefined;
  if (!parentLine) {
    reasons.add('parent_cart_line_required');
    bindings.push('parent-line:missing');
    return;
  }

  bindings.push(
    `parent-line:${parentLine.lineId}:${parentLine.sellableItemId}`,
  );
  evaluateGeneratedItem(input, parentLine.sellableItemId, reasons, bindings);
  const modifierRoot = input.commerceFacts.menuModifiers.find(
    (modifier) => modifier.itemId === parentLine.sellableItemId,
  );
  const group = modifierRoot
    ? modifierGroupAtPath(modifierRoot.modifierGroups, action.groupPath)
    : null;
  const option = group?.options.find(
    (entry) => entry.modifierId === action.optionId,
  );
  if (
    action.parentCartLineId !== parentLine.lineId ||
    action.parentSellableItemId !== parentLine.sellableItemId ||
    candidate.parentCartLineId !== parentLine.lineId ||
    candidate.sellableItemId !== parentLine.sellableItemId ||
    candidate.targetId !== action.optionId ||
    !group ||
    !option
  ) {
    reasons.add('modifier_parent_mismatch');
  }
  const max = typeof group?.max === 'number' ? group.max : null;
  const currentQuantity = parentLine.modifiers
    .filter(
      (modifier) =>
        modifier.groupPath.length === action.groupPath.length &&
        modifier.groupPath.every(
          (segment, index) => segment === action.groupPath[index],
        ),
    )
    .reduce((total, modifier) => total + modifier.quantity, 0);
  bindings.push(
    `modifier-group:${action.groupPath.join(':')}:${max ?? 'unbounded'}:${currentQuantity}`,
  );
  if (max !== null && currentQuantity + action.quantity > max) {
    reasons.add('modifier_group_at_capacity');
  }
  if (action.priceImpact.amount <= 0) {
    reasons.add('no_positive_price_modifier');
  }
}

async function evaluateCandidate(
  input: EligibilityEvaluationInput,
  candidate: PotentialRecommendationCandidate,
): Promise<EligibilityDecision> {
  const reasons = new Set<Exclude<EligibilityReasonCode, 'eligible'>>();
  const bindings = [
    `action:${candidate.action.actionId}`,
    `target:${candidate.targetId}`,
    `policy:${KFC_RECOMMENDATION_POLICY_VERSION}`,
  ];
  evaluatePlacement(input.context, reasons, bindings);
  if (candidate.action.type === 'add_product') {
    evaluateProduct(input, candidate, reasons, bindings);
  } else {
    evaluateModifier(input, candidate, reasons, bindings);
  }
  return createEligibilityDecision({
    actionId: candidate.action.actionId,
    eligible: reasons.size === 0,
    reasonCodes: orderedReasons(reasons),
    evidenceBindings: bindings,
  });
}

export async function evaluateEligibility(
  input: EligibilityEvaluationInput,
): Promise<EligibilityDecision[]> {
  const sortedCandidates = [...input.candidates].sort((left, right) =>
    left.action.actionId.localeCompare(right.action.actionId),
  );
  return Promise.all(
    sortedCandidates.map((candidate) => evaluateCandidate(input, candidate)),
  );
}
