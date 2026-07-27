import { digestCommerceAction } from '../../ordering/commerceDigest.js';
import { compareCanonicalUtcInstants } from '../domain/canonical-instant.js';
import type {
  CustomerReasonCode,
  DecisionSource,
  DecisionStatus,
  DisplayFact,
  MerchandisingEffect,
  Placement,
  RecommendationAction,
  VersionBindings,
} from '../domain/contracts.js';
import {
  parseRecommendationDecisionResponse,
  recommendationDecisionRequestSchema,
} from '../domain/schemas.js';
import { enumeratePotentialCandidates } from '../eligibility/enumerate-candidates.js';
import { evaluateEligibility } from '../eligibility/evaluate-eligibility.js';
import type {
  EligibilityDecision,
  PotentialRecommendationCandidate,
  RecommendationDecisionContext,
} from '../eligibility/types.js';
import {
  resolveMerchandisingPolicies,
  type MerchandisingResolution,
} from '../merchandising/resolve-policies.js';
import { composeSmartCrossSellSlate } from '../ranking/smart-cross-blend.js';
import type { RankedCandidate } from '../ranking/types.js';
import type {
  CommerceFactsSnapshot,
  PromotionFactsSnapshot,
  RankingStatisticsSnapshot,
} from '../snapshots/types.js';
import {
  isRecommendationShadowPlacement,
  type RecommendationOutputMode,
  type RecommendationShadowComparison,
  type RecommendationShadowScore,
} from '../shadow/contracts.js';
import { buildRecommendationShadowFeatureRows } from '../shadow/feature-rows.js';
import { RecommendationShadowScorerError } from '../shadow/http-shadow-scorer.js';
import type {
  RecommendationDecisionEmptyReason,
  RecommendationDecisionEngine,
  RecommendationDecisionEngineDependencies,
  RecommendationDecisionResult,
  RecommendationDecisionTechnicalEvidence,
} from './types.js';

const featureSchemaVersions: Record<Placement, string> = {
  local_favorite: 'contextual-popularity-feature-schema-v1',
  for_you: 'for-you-affinity-feature-schema-v1',
  modifier_upsell: 'modifier-upsell-feature-schema-v1',
  smart_cross_sell: 'smart-cross-sell-feature-schema-v1',
};

const noMerchandisingResolution = (): MerchandisingResolution => ({
  suppressed: false,
  replacement: null,
  rankedCandidates: [],
  effects: [],
  reasonCodes: [],
});

function inactiveShadowComparison(input: {
  outputMode: RecommendationOutputMode;
  status: 'not_applicable' | 'not_configured';
  eligibleActionIds?: string[];
  baselineOrderingActionIds?: string[];
}): RecommendationShadowComparison {
  return {
    status: input.status,
    outputMode: input.outputMode,
    modelRevision: null,
    eligibleActionIds: input.eligibleActionIds ?? [],
    baselineOrderingActionIds: input.baselineOrderingActionIds ?? [],
    activeTechnicalOrdering: 'baseline',
  };
}

function sameActionIds(
  scores: readonly RecommendationShadowScore[],
  eligibleActionIds: readonly string[],
): boolean {
  const actual = scores.map((score) => score.actionId).sort();
  const expected = [...eligibleActionIds].sort();
  return (
    new Set(actual).size === actual.length &&
    actual.length === expected.length &&
    actual.every((actionId, index) => actionId === expected[index])
  );
}

async function shadowComparison(input: {
  dependencies: RecommendationDecisionEngineDependencies;
  context: RecommendationDecisionContext;
  eligibleCandidates: readonly PotentialRecommendationCandidate[];
  baselineRanking: readonly RankedCandidate[];
  commerceFacts: CommerceFactsSnapshot;
  promotionFacts: PromotionFactsSnapshot;
  rankingStatistics: RankingStatisticsSnapshot;
}): Promise<RecommendationShadowComparison> {
  const outputMode = input.dependencies.shadowOutputMode ?? 'baseline';
  const eligibleActionIds = input.eligibleCandidates.map(
    (candidate) => candidate.action.actionId,
  );
  const baselineOrderingActionIds = input.baselineRanking.map(
    (entry) => entry.candidate.action.actionId,
  );
  if (!isRecommendationShadowPlacement(input.context.request.placement)) {
    return inactiveShadowComparison({
      outputMode,
      status: 'not_applicable',
      eligibleActionIds,
      baselineOrderingActionIds,
    });
  }
  const scorer = input.dependencies.shadowScorer;
  if (!scorer) {
    return inactiveShadowComparison({
      outputMode,
      status: 'not_configured',
      eligibleActionIds,
      baselineOrderingActionIds,
    });
  }
  const featureSchema =
    input.context.request.placement === 'smart_cross_sell'
      ? 'smart-cross-sell-feature-schema-v1'
      : 'modifier-upsell-feature-schema-v1';
  try {
    const result = await scorer.score({
      placement: input.context.request.placement,
      featureSchema,
      rows: buildRecommendationShadowFeatureRows({
        context: input.context,
        candidates: input.eligibleCandidates,
        commerceFacts: input.commerceFacts,
        promotionFacts: input.promotionFacts,
        rankingStatistics: input.rankingStatistics,
      }),
    });
    if (
      result.modelRevision !== scorer.modelRevision ||
      !sameActionIds(result.scores, eligibleActionIds) ||
      result.scores.some((score) => score.featureSchema !== featureSchema)
    ) {
      throw new RecommendationShadowScorerError('shadow_response_invalid');
    }
    const learnedOrdering = [...result.scores].sort(
      (left, right) =>
        right.expectedValueScore - left.expectedValueScore ||
        right.calibratedProbability - left.calibratedProbability ||
        left.actionId.localeCompare(right.actionId),
    );
    return {
      status: 'succeeded',
      outputMode,
      modelRevision: result.modelRevision,
      eligibleActionIds,
      baselineOrderingActionIds,
      activeTechnicalOrdering:
        outputMode === 'learned_technical' ? 'learned' : 'baseline',
      learnedOrdering,
      provenance: {
        modelRevision: result.modelRevision,
        modelArtifactIds: [
          ...new Set(result.scores.map((score) => score.modelArtifactId)),
        ].sort(),
        calibrationIds: [
          ...new Set(result.scores.map((score) => score.calibrationId)),
        ].sort(),
        featureSchema,
      },
    };
  } catch (error) {
    return {
      status: 'failed',
      outputMode,
      modelRevision: scorer.modelRevision,
      eligibleActionIds,
      baselineOrderingActionIds,
      activeTechnicalOrdering: 'baseline',
      failureCode:
        error instanceof RecommendationShadowScorerError &&
        (error.code === 'shadow_response_invalid' ||
          error.code === 'shadow_deadline_exceeded')
          ? error.code
          : 'shadow_unavailable',
    };
  }
}

const commerceBindings = (context: RecommendationDecisionContext) =>
  Object.values(context.request.commerceSnapshotBindings);

function isEffectiveAt(
  effectiveAt: string,
  expiresAt: string,
  decisionTime: string,
): boolean {
  const begins = compareCanonicalUtcInstants(effectiveAt, decisionTime);
  const ends = compareCanonicalUtcInstants(decisionTime, expiresAt);
  return begins !== null && ends !== null && begins <= 0 && ends < 0;
}

function isObservedAt(observedAt: string, decisionTime: string): boolean {
  const comparison = compareCanonicalUtcInstants(observedAt, decisionTime);
  return comparison !== null && comparison <= 0;
}

function authoritativeContextIsValid(input: {
  context: RecommendationDecisionContext;
  rankingStatistics: RankingStatisticsSnapshot;
  promotionFacts: PromotionFactsSnapshot;
  merchandising: Awaited<
    ReturnType<
      RecommendationDecisionEngineDependencies['merchandisingPolicyRepository']['loadPublishedSnapshot']
    >
  >;
}): boolean {
  const { context, rankingStatistics, promotionFacts, merchandising } = input;
  if (!recommendationDecisionRequestSchema.safeParse(context.request).success) {
    return false;
  }

  const { decisionTime } = context.request;
  const bindings = commerceBindings(context);
  const commerceEnvironment =
    context.request.commerceSnapshotBindings.catalog.commerceEnvironment;
  if (
    bindings.some(
      (binding) =>
        !binding.complete ||
        binding.commerceEnvironment !== commerceEnvironment ||
        !isObservedAt(binding.observedAt, decisionTime) ||
        !isEffectiveAt(binding.effectiveAt, binding.expiresAt, decisionTime),
    )
  ) {
    return false;
  }

  for (const snapshot of [rankingStatistics, promotionFacts]) {
    if (
      !snapshot.complete ||
      snapshot.commerceEnvironment !== commerceEnvironment ||
      !isObservedAt(snapshot.observedAt, decisionTime) ||
      !isEffectiveAt(snapshot.effectiveAt, snapshot.expiresAt, decisionTime)
    ) {
      return false;
    }
  }

  return (
    merchandising.snapshot.complete &&
    merchandising.snapshot.commerceEnvironment === commerceEnvironment &&
    isObservedAt(merchandising.snapshot.publishedAt, decisionTime)
  );
}

function allSnapshotsComplete(input: {
  context: RecommendationDecisionContext;
  rankingStatistics: RankingStatisticsSnapshot;
  promotionFacts: PromotionFactsSnapshot;
  merchandising: Awaited<
    ReturnType<
      RecommendationDecisionEngineDependencies['merchandisingPolicyRepository']['loadPublishedSnapshot']
    >
  >;
}): boolean {
  return (
    commerceBindings(input.context).every((binding) => binding.complete) &&
    input.rankingStatistics.complete &&
    input.promotionFacts.complete &&
    input.merchandising.snapshot.complete
  );
}

function cartCategoryIds(
  context: RecommendationDecisionContext,
  commerceFacts: CommerceFactsSnapshot,
): string[] {
  const itemCategories = new Map(
    commerceFacts.menuItems.map((item) => [item.itemId, item.categoryId]),
  );
  return [
    ...new Set(
      context.request.cart.lines.flatMap((line) => {
        const category = itemCategories.get(line.sellableItemId);
        return category ? [category] : [];
      }),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function emptyReasonFor(
  context: RecommendationDecisionContext,
  decisions: readonly EligibilityDecision[],
): RecommendationDecisionEmptyReason {
  if (context.flow.attemptedPlacements.includes(context.request.placement)) {
    return 'placement_already_attempted';
  }
  const reasonPriority = [
    'placement_not_yet_eligible',
    'verified_history_required',
    'parent_cart_line_required',
    'no_positive_price_modifier',
  ] as const;
  if (
    context.request.placement === 'modifier_upsell' &&
    (context.parentCartLineId === null ||
      !context.request.cart.lines.some(
        (line) => line.lineId === context.parentCartLineId,
      ))
  ) {
    return 'parent_cart_line_required';
  }
  for (const reason of reasonPriority) {
    if (decisions.some((decision) => decision.reasonCodes.includes(reason))) {
      return reason;
    }
  }
  return 'no_eligible_candidates';
}

function statusForEmptyReason(
  emptyReason: RecommendationDecisionEmptyReason,
): DecisionStatus {
  return [
    'placement_already_attempted',
    'placement_not_yet_eligible',
    'verified_history_required',
  ].includes(emptyReason ?? '')
    ? 'ineligible_context'
    : 'empty';
}

function shapePlacement(
  placement: Placement,
  resolution: MerchandisingResolution,
  remainingBudgetVnd: number | null,
): RankedCandidate[] {
  if (placement === 'smart_cross_sell') {
    return composeSmartCrossSellSlate(
      resolution.rankedCandidates,
      remainingBudgetVnd,
    );
  }
  const first = resolution.rankedCandidates[0];
  if (!first) return [];
  if (
    (placement === 'modifier_upsell' &&
      first.candidate.action.type !== 'apply_modifier') ||
    ((placement === 'local_favorite' || placement === 'for_you') &&
      first.candidate.action.type !== 'add_product')
  ) {
    return [];
  }
  return [first];
}

function selectedReasonCodes(
  selected: readonly RankedCandidate[],
  replaced: boolean,
): CustomerReasonCode[] {
  if (replaced) return ['merchandising_selection'];
  const result: CustomerReasonCode[] = [];
  for (const candidate of selected) {
    for (const reason of candidate.reasonCodes) {
      if (!result.includes(reason)) result.push(reason);
    }
  }
  return result;
}

function displayFactsFor(selected: readonly RankedCandidate[]): DisplayFact[] {
  return selected.map(({ candidate }) => ({
    actionId: candidate.action.actionId,
    name: candidate.name,
    imageUrl: candidate.imageUrl,
    priceImpact: candidate.action.priceImpact,
  }));
}

function responseVersionBindings(input: {
  context: RecommendationDecisionContext;
  merchandising: Awaited<
    ReturnType<
      RecommendationDecisionEngineDependencies['merchandisingPolicyRepository']['loadPublishedSnapshot']
    >
  >;
  servingRankerVersion: string;
}): VersionBindings {
  const { request } = input.context;
  return {
    catalog: request.commerceSnapshotBindings.catalog.snapshotId,
    modifierGraph: request.commerceSnapshotBindings.modifierGraph.snapshotId,
    store: request.commerceSnapshotBindings.store.snapshotId,
    availability: request.commerceSnapshotBindings.availability.snapshotId,
    promotion: request.commerceSnapshotBindings.promotion.snapshotId,
    eligibilityPolicy: request.eligibilityPolicyVersion,
    sanitySnapshot: input.merchandising.binding,
    featureSchema: featureSchemaVersions[request.placement],
    servingRanker: input.servingRankerVersion,
    shadowModel: null,
    calibration: null,
    experiment: request.experimentProfile.profileId,
    loggingPolicy: 'recommendation-logging-policy-v1',
  };
}

async function completeResult(input: {
  context: RecommendationDecisionContext;
  technical: RecommendationDecisionTechnicalEvidence;
  versionBindings: VersionBindings;
  complete: boolean;
  status: DecisionStatus;
  decisionSource: DecisionSource;
  selected: readonly RankedCandidate[];
  merchandisingEffects: MerchandisingEffect[];
}): Promise<RecommendationDecisionResult> {
  const actions: RecommendationAction[] = input.selected.map(
    (entry) => entry.candidate.action,
  );
  const recommendationDigest = await digestCommerceAction({
    requestId: input.context.request.requestId,
    actions,
  });
  const { shadowComparison: _shadowComparison, ...baselineTechnical } =
    input.technical;
  const traceDigest = await digestCommerceAction({
    requestId: input.context.request.requestId,
    technical: baselineTechnical,
  });
  const eligible = input.technical.eligibilityDecisions.filter(
    (decision) => decision.eligible,
  ).length;
  const potential = input.technical.potentialCandidates.length;
  const replaced =
    input.decisionSource === 'merchandising_replacement' &&
    input.technical.merchandisingResolution.replacement !== null;
  const response = parseRecommendationDecisionResponse({
    schemaVersion: 'kfc-recommendation-v1',
    recommendationId: `recommendation:${recommendationDigest.slice(0, 24)}`,
    requestId: input.context.request.requestId,
    orderFlowId: input.context.request.orderFlowId,
    placement: input.context.request.placement,
    status: input.status,
    decisionSource: input.decisionSource,
    primaryOffer: actions.length > 0 ? { actions } : null,
    displayFacts: displayFactsFor(input.selected),
    reasonCodes: selectedReasonCodes(input.selected, replaced),
    merchandisingEffects: input.merchandisingEffects,
    versionBindings: input.versionBindings,
    counts: {
      potential,
      eligible,
      ineligible: potential - eligible,
      scored: input.technical.eligiblePrePolicyRanking.length,
      displayed: actions.length,
      complete: input.complete,
    },
    traceRef: `trace:${traceDigest.slice(0, 24)}`,
  });
  return { response, technical: input.technical };
}

export class PureRecommendationDecisionEngine implements RecommendationDecisionEngine {
  constructor(
    private readonly dependencies: RecommendationDecisionEngineDependencies,
  ) {}

  async decide(
    context: RecommendationDecisionContext,
  ): Promise<RecommendationDecisionResult> {
    const commerceFacts = this.dependencies.commerceFactsRepository.load();
    const rankingStatistics =
      this.dependencies.rankingStatisticsRepository.load();
    const promotionFacts = this.dependencies.promotionFactsRepository.load();
    const merchandising =
      await this.dependencies.merchandisingPolicyRepository.loadPublishedSnapshot();
    const ranker = this.dependencies.rankerRepository.forPlacement(
      context.request.placement,
    );
    const versionBindings = responseVersionBindings({
      context,
      merchandising,
      servingRankerVersion: ranker.version,
    });
    const complete = allSnapshotsComplete({
      context,
      rankingStatistics,
      promotionFacts,
      merchandising,
    });
    const outputMode = this.dependencies.shadowOutputMode ?? 'baseline';

    if (
      !authoritativeContextIsValid({
        context,
        rankingStatistics,
        promotionFacts,
        merchandising,
      })
    ) {
      const technical: RecommendationDecisionTechnicalEvidence = {
        potentialCandidates: [],
        eligibilityDecisions: [],
        eligiblePrePolicyRanking: [],
        merchandisingResolution: noMerchandisingResolution(),
        emptyReason: 'invalid_context',
        shadowComparison: inactiveShadowComparison({
          outputMode,
          status: 'not_applicable',
        }),
      };
      return completeResult({
        context,
        technical,
        versionBindings,
        complete,
        status: 'invalid_context',
        decisionSource: 'fallback',
        selected: [],
        merchandisingEffects: [],
      });
    }

    const potentialCandidates = enumeratePotentialCandidates({
      context,
      commerceFacts,
      promotionFacts,
    });
    const eligibilityDecisions = await evaluateEligibility({
      context,
      candidates: potentialCandidates,
      commerceFacts,
    });
    const eligibleActionIds = new Set(
      eligibilityDecisions
        .filter((decision) => decision.eligible)
        .map((decision) => decision.actionId),
    );
    const eligibleCandidates = potentialCandidates.filter((candidate) =>
      eligibleActionIds.has(candidate.action.actionId),
    );
    if (eligibleCandidates.length === 0) {
      const emptyReason = emptyReasonFor(context, eligibilityDecisions);
      const technical: RecommendationDecisionTechnicalEvidence = {
        potentialCandidates,
        eligibilityDecisions,
        eligiblePrePolicyRanking: [],
        merchandisingResolution: noMerchandisingResolution(),
        emptyReason,
        shadowComparison: inactiveShadowComparison({
          outputMode,
          status: 'not_applicable',
          eligibleActionIds: [],
          baselineOrderingActionIds: [],
        }),
      };
      return completeResult({
        context,
        technical,
        versionBindings,
        complete,
        status: statusForEmptyReason(emptyReason),
        decisionSource: 'fallback',
        selected: [],
        merchandisingEffects: [],
      });
    }

    const eligiblePrePolicyRanking = ranker.rank({
      context,
      candidates: eligibleCandidates,
      eligibilityDecisions,
      rankingStatistics,
    });
    const comparison = await shadowComparison({
      dependencies: this.dependencies,
      context,
      eligibleCandidates,
      baselineRanking: eligiblePrePolicyRanking,
      commerceFacts,
      promotionFacts,
      rankingStatistics,
    });
    const merchandisingResolution = resolveMerchandisingPolicies({
      context,
      rankedCandidates: eligiblePrePolicyRanking,
      policies: merchandising.snapshot.policies,
      cartCategoryIds: cartCategoryIds(context, commerceFacts),
    });

    if (merchandisingResolution.suppressed) {
      const technical: RecommendationDecisionTechnicalEvidence = {
        potentialCandidates,
        eligibilityDecisions,
        eligiblePrePolicyRanking,
        merchandisingResolution,
        emptyReason: 'merchandising_suppressed',
        shadowComparison: comparison,
      };
      return completeResult({
        context,
        technical,
        versionBindings,
        complete,
        status: 'suppressed',
        decisionSource: 'suppressed',
        selected: [],
        merchandisingEffects: merchandisingResolution.effects,
      });
    }

    const selected = shapePlacement(
      context.request.placement,
      merchandisingResolution,
      context.remainingBudgetVnd,
    );
    if (selected.length === 0) {
      const technical: RecommendationDecisionTechnicalEvidence = {
        potentialCandidates,
        eligibilityDecisions,
        eligiblePrePolicyRanking,
        merchandisingResolution,
        emptyReason: 'no_eligible_candidates',
        shadowComparison: comparison,
      };
      return completeResult({
        context,
        technical,
        versionBindings,
        complete,
        status: 'empty',
        decisionSource: 'fallback',
        selected: [],
        merchandisingEffects: merchandisingResolution.effects,
      });
    }

    const technical: RecommendationDecisionTechnicalEvidence = {
      potentialCandidates,
      eligibilityDecisions,
      eligiblePrePolicyRanking,
      merchandisingResolution,
      emptyReason: null,
      shadowComparison: comparison,
    };
    return completeResult({
      context,
      technical,
      versionBindings,
      complete,
      status: 'recommended',
      decisionSource:
        merchandisingResolution.replacement === null
          ? 'ranked'
          : 'merchandising_replacement',
      selected,
      merchandisingEffects: merchandisingResolution.effects,
    });
  }
}
