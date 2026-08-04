import type {
  AutomaticEligibilityDecision,
  AutomaticEligibilityEvidenceCode,
  AutomaticRecommendationCandidate,
  AutomaticRecommendationContext,
} from './types.js';

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((segment, index) => segment === right[index])
  );
}

function modifierBindingCode(
  context: AutomaticRecommendationContext,
  candidate: AutomaticRecommendationCandidate,
): AutomaticEligibilityEvidenceCode | null {
  if (candidate.action.type !== 'apply_modifier') {
    return 'modifier_parent_mismatch';
  }
  const action = candidate.action;
  const parentCartLine = context.parentCartLine;
  if (
    parentCartLine === null ||
    action.parentCartLineId !== parentCartLine.lineId ||
    action.parentSellableItemId !== parentCartLine.sellableItemId
  ) {
    return 'modifier_parent_mismatch';
  }
  const parentItem = context.catalog.items.find(
    ({ sellableItemId }) => sellableItemId === parentCartLine.sellableItemId,
  );
  const group = parentItem?.modifierGroups.find(({ groupPath }) =>
    samePath(groupPath, action.groupPath),
  );
  const option = group?.options.find(
    ({ optionId }) => optionId === action.optionId,
  );
  const exactCandidateId = `modifier:${parentCartLine.lineId}:${action.groupPath.join('/')}:${action.optionId}`;
  return option === undefined || candidate.candidateId !== exactCandidateId
    ? 'modifier_path_mismatch'
    : null;
}

function exclusionCode(
  context: AutomaticRecommendationContext,
  candidate: AutomaticRecommendationCandidate,
): AutomaticEligibilityEvidenceCode {
  if (context.recommendationType === 'modifier_upsell') {
    const bindingCode = modifierBindingCode(context, candidate);
    if (bindingCode !== null) {
      return bindingCode;
    }
    if (candidate.action.type !== 'apply_modifier') {
      return 'modifier_parent_mismatch';
    }
    const action = candidate.action;
    const parentItem = context.catalog.items.find(
      ({ sellableItemId }) => sellableItemId === action.parentSellableItemId,
    );
    const group = parentItem?.modifierGroups.find(({ groupPath }) =>
      samePath(groupPath, action.groupPath),
    );
    const option = group?.options.find(
      ({ optionId }) => optionId === action.optionId,
    );
    if (
      parentItem === undefined ||
      group === undefined ||
      option === undefined
    ) {
      return 'modifier_path_mismatch';
    }
    if (!parentItem.sellable) {
      return 'not_sellable';
    }
    if (!parentItem.safe || !option.safe) {
      return 'unsafe_candidate';
    }
    if (
      !parentItem.availableFulfilmentModes.includes(
        context.order.fulfilmentMode,
      ) ||
      !option.available
    ) {
      return 'unavailable_for_fulfilment';
    }
    const appliedInGroup = context.parentCartLine?.modifiers.filter(
      (modifier) => samePath(modifier.groupPath, action.groupPath),
    );
    if (
      appliedInGroup?.some(({ optionId }) => optionId === action.optionId) ===
      true
    ) {
      return 'modifier_already_applied';
    }
    if (group.selectionMode === 'single' && (appliedInGroup?.length ?? 0) > 0) {
      return 'modifier_group_satisfied';
    }
    return 'eligible';
  }
  if (candidate.action.type !== 'add_product') {
    return 'candidate_not_in_catalog';
  }
  const sellableItemId = candidate.action.sellableItemId;
  const item = context.catalog.items.find(
    (catalogItem) => catalogItem.sellableItemId === sellableItemId,
  );
  if (
    item === undefined ||
    candidate.candidateId !== `product:${sellableItemId}`
  ) {
    return 'candidate_not_in_catalog';
  }
  if (!item.sellable) {
    return 'not_sellable';
  }
  if (!item.safe) {
    return 'unsafe_candidate';
  }
  if (!item.availableFulfilmentModes.includes(context.order.fulfilmentMode)) {
    return 'unavailable_for_fulfilment';
  }
  if (
    context.order.cart.lines.some(
      (line) => line.sellableItemId === sellableItemId,
    )
  ) {
    return 'already_in_cart';
  }
  return 'eligible';
}

export function evaluateAutomaticRecommendationEligibility(
  context: AutomaticRecommendationContext,
  candidates: readonly AutomaticRecommendationCandidate[],
): AutomaticEligibilityDecision[] {
  return candidates.map((candidate) => {
    const code = exclusionCode(context, candidate);
    return {
      candidate,
      status: code === 'eligible' ? 'eligible' : 'excluded',
      evidence: {
        code,
        catalogRevision: context.catalog.catalogRevision,
      },
    };
  });
}
