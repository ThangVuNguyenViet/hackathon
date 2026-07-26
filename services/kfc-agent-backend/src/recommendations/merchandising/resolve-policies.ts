import type {
  CustomerReasonCode,
  MerchandisingEffect,
} from '../domain/contracts.js';
import type { RecommendationDecisionContext } from '../eligibility/types.js';
import type { RankedCandidate } from '../ranking/types.js';
import {
  compareCanonicalInstants,
  type RecommendationPolicy,
} from './policy.js';

export interface MerchandisingResolution {
  suppressed: boolean;
  replacement: RankedCandidate[] | null;
  rankedCandidates: RankedCandidate[];
  effects: MerchandisingEffect[];
  reasonCodes: CustomerReasonCode[];
}

export interface ResolveMerchandisingPoliciesInput {
  context: RecommendationDecisionContext;
  rankedCandidates: readonly RankedCandidate[];
  policies: readonly RecommendationPolicy[];
  cartCategoryIds: readonly string[];
}

const constraintFields = [
  'includedStoreIds',
  'excludedStoreIds',
  'fulfilmentModes',
  'minimumBasketSubtotalVnd',
  'maximumBasketSubtotalVnd',
  'requiredCartProductIds',
  'excludedCartProductIds',
  'requiredCartCategoryIds',
  'excludedCartCategoryIds',
  'verifiedCohorts',
] as const;

export function applicableMerchandisingPolicies(
  context: RecommendationDecisionContext,
  policies: readonly RecommendationPolicy[],
  cartCategoryIds: readonly string[] = [],
): RecommendationPolicy[] {
  return policies
    .filter((policy) => policyApplies(context, policy, cartCategoryIds))
    .sort((left, right) => {
      const priority = right.priority - left.priority;
      if (priority !== 0) return priority;
      const specificity = specificityOf(right) - specificityOf(left);
      if (specificity !== 0) return specificity;
      const startsAt = compareCanonicalInstants(right.startsAt, left.startsAt);
      if (startsAt !== 0) return startsAt;
      return left.policyId.localeCompare(right.policyId);
    });
}

export function resolveMerchandisingPolicies(
  input: ResolveMerchandisingPoliciesInput,
): MerchandisingResolution {
  const applicable = applicableMerchandisingPolicies(
    input.context,
    input.policies,
    input.cartCategoryIds,
  );
  const effects: MerchandisingEffect[] = [];
  const reasonCodes: CustomerReasonCode[] = [];
  const addEffect = (
    policy: RecommendationPolicy,
    targetActionId: string | null,
  ): void => {
    effects.push({
      policyId: policy.policyId,
      action: policy.action,
      targetActionId,
      detail: policy.approvedText.en,
    });
    if (!reasonCodes.includes(policy.reasonCode))
      reasonCodes.push(policy.reasonCode);
  };

  const excluded = new Set(
    applicable
      .filter((policy) => policy.action === 'exclude_target')
      .flatMap((policy) => policy.targetIds),
  );
  const available = input.rankedCandidates.filter(
    (entry) => !excluded.has(entry.candidate.action.actionId),
  );
  for (const policy of applicable.filter(
    (entry) => entry.action === 'exclude_target',
  )) {
    for (const targetId of policy.targetIds) {
      if (
        input.rankedCandidates.some(
          (entry) => entry.candidate.action.actionId === targetId,
        )
      ) {
        addEffect(policy, targetId);
      }
    }
  }

  const suppression = applicable.find(
    (policy) => policy.action === 'suppress_placement',
  );
  if (suppression) {
    addEffect(suppression, null);
    return {
      suppressed: true,
      replacement: null,
      rankedCandidates: [],
      effects,
      reasonCodes,
    };
  }

  const replacementPolicy = applicable.find((policy) => {
    if (policy.action !== 'replace_slate') return false;
    return policy.targetIds.every((targetId) =>
      available.some((entry) => entry.candidate.action.actionId === targetId),
    );
  });
  const replacement = replacementPolicy
    ? replacementPolicy.targetIds.map((targetId) =>
        available.find(
          (entry) => entry.candidate.action.actionId === targetId,
        )!,
      )
    : null;
  if (replacementPolicy) addEffect(replacementPolicy, null);

  const slate = replacement ?? available;
  const boosted = applyStrongestBoosts(slate, applicable, addEffect);
  const rankedCandidates = applyPins(boosted, applicable, addEffect);
  return {
    suppressed: false,
    replacement,
    rankedCandidates,
    effects,
    reasonCodes,
  };
}

function policyApplies(
  context: RecommendationDecisionContext,
  policy: RecommendationPolicy,
  cartCategoryIds: readonly string[],
): boolean {
  const { request } = context;
  if (!policy.enabled || policy.placement !== request.placement) return false;
  if (
    policy.environment !==
    request.commerceSnapshotBindings.catalog.commerceEnvironment
  ) {
    return false;
  }
  if (compareCanonicalInstants(request.decisionTime, policy.startsAt) < 0)
    return false;
  if (
    policy.endsAt !== null &&
    compareCanonicalInstants(request.decisionTime, policy.endsAt) >= 0
  ) {
    return false;
  }
  if (
    (policy.includedStoreIds.length > 0 &&
      !policy.includedStoreIds.includes(request.storeId)) ||
    policy.excludedStoreIds.includes(request.storeId) ||
    (policy.fulfilmentModes.length > 0 &&
      !policy.fulfilmentModes.includes(request.fulfilmentMode))
  ) {
    return false;
  }
  const subtotal = request.cart.subtotal.amount;
  if (
    (policy.minimumBasketSubtotalVnd !== null &&
      subtotal < policy.minimumBasketSubtotalVnd) ||
    (policy.maximumBasketSubtotalVnd !== null &&
      subtotal > policy.maximumBasketSubtotalVnd)
  ) {
    return false;
  }
  const products = new Set<string>(
    request.cart.lines.map((line) => line.sellableItemId),
  );
  const categories = new Set(cartCategoryIds);
  if (
    !policy.requiredCartProductIds.every((id) => products.has(id)) ||
    policy.excludedCartProductIds.some((id) => products.has(id)) ||
    !policy.requiredCartCategoryIds.every((id) => categories.has(id)) ||
    policy.excludedCartCategoryIds.some((id) => categories.has(id)) ||
    !policy.verifiedCohorts.every((cohort) =>
      context.verifiedCohorts.includes(cohort),
    )
  ) {
    return false;
  }
  return true;
}

function specificityOf(policy: RecommendationPolicy): number {
  return constraintFields.filter((field) => {
    const value = policy[field];
    return Array.isArray(value) ? value.length > 0 : value !== null;
  }).length;
}

function applyStrongestBoosts(
  slate: readonly RankedCandidate[],
  policies: readonly RecommendationPolicy[],
  addEffect: (policy: RecommendationPolicy, targetActionId: string) => void,
): RankedCandidate[] {
  const strongestByTarget = new Map<string, RecommendationPolicy>();
  for (const policy of policies) {
    if (policy.action !== 'boost_target') continue;
    for (const targetId of policy.targetIds) {
      const existing = strongestByTarget.get(targetId);
      if (!existing || policy.boostWeight! > existing.boostWeight!) {
        strongestByTarget.set(targetId, policy);
      }
    }
  }
  return slate.map((entry) => {
    const policy = strongestByTarget.get(entry.candidate.action.actionId);
    if (!policy) return entry;
    addEffect(policy, entry.candidate.action.actionId);
    return { ...entry, score: entry.score + policy.boostWeight! };
  });
}

function applyPins(
  slate: readonly RankedCandidate[],
  policies: readonly RecommendationPolicy[],
  addEffect: (policy: RecommendationPolicy, targetActionId: string) => void,
): RankedCandidate[] {
  const result = [...slate].sort(
    (left, right) =>
      right.score - left.score ||
      left.candidate.action.actionId.localeCompare(
        right.candidate.action.actionId,
      ),
  );
  for (const policy of policies) {
    if (policy.action !== 'pin_target') continue;
    for (const targetId of policy.targetIds) {
      const index = result.findIndex(
        (entry) => entry.candidate.action.actionId === targetId,
      );
      if (index < 0) continue;
      const [entry] = result.splice(index, 1);
      result.splice(
        Math.min(policy.pinPosition! - 1, result.length),
        0,
        entry!,
      );
      addEffect(policy, targetId);
    }
  }
  return result;
}
