import { ZodError } from 'zod';
import { parseAutomaticRecommendationResponse } from '../contracts/automatic-recommendation-response.js';
import {
  parseAutomaticScorerRequest,
  reconcileAutomaticScorerResponse,
} from '../contracts/automatic-scorer.js';
import {
  automaticModelBinding,
  resolveQualifiedAutomaticRecommendationBundle,
} from './bundles.js';
import { discoverAutomaticRecommendationCandidates } from './candidates.js';
import { composeAutomaticRecommendationSlate } from './composition.js';
import { resolveAutomaticRecommendationContext } from './context.js';
import {
  AutomaticRecommendationBindingError,
  AutomaticRecommendationInfrastructureError,
} from './errors.js';
import { evaluateAutomaticRecommendationEligibility } from './eligibility.js';
import { buildAutomaticRecommendationFeatureRows } from './features.js';
import type {
  AutomaticModelBinding,
  AutomaticQualifiedBundlePort,
  AutomaticRecommendationCandidate,
  AutomaticRecommendationContextPorts,
  AutomaticRecommendationIdPort,
  AutomaticRecommendationScorerPort,
  AutomaticRecommendationType,
  AutomaticScoredCandidate,
} from './types.js';

type RecommendationResponse = ReturnType<
  typeof parseAutomaticRecommendationResponse
>;

export interface AutomaticEngineExecutionEvidence {
  readonly contextBindings: unknown;
  readonly potentialCandidates: readonly unknown[];
  readonly eligibilityDecisions: readonly unknown[];
  readonly featureReconciliation: unknown;
  readonly scoresCalibration: unknown | null;
  readonly composition: unknown;
  readonly modelReleaseProvenance: unknown | null;
  readonly traceLocator: string | null;
}

interface AutomaticEngineDecision {
  readonly response: RecommendationResponse;
  readonly execution: AutomaticEngineExecutionEvidence;
}

function expiresAt(instant: string, ttlMs: number): string {
  return new Date(new Date(instant).getTime() + ttlMs).toISOString();
}

function emptyOrPausedResponse({
  requestId,
  recommendationId,
  recommendationType,
  status,
  emptyReason,
  cartRevision,
  catalogRevision,
  expires,
  counts,
}: {
  requestId: string;
  recommendationId: string;
  recommendationType: AutomaticRecommendationType;
  status: 'empty' | 'paused';
  emptyReason:
    | 'no_qualified_model'
    | 'no_eligible_candidates'
    | 'insufficient_history'
    | 'parent_cart_line_not_found'
    | 'empty_cart'
    | 'no_candidate_above_threshold'
    | 'recommendation_serving_paused';
  cartRevision: string;
  catalogRevision: string;
  expires: string;
  counts: {
    potential: number;
    eligible: number;
    scored: number;
    displayed: 0;
  };
}): RecommendationResponse {
  return parseAutomaticRecommendationResponse({
    schemaVersion: 'kfc-automatic-recommendation-v1',
    requestId,
    recommendationId,
    recommendationType,
    status,
    emptyReason,
    cartRevision,
    catalogRevision,
    expiresAt: expires,
    model: null,
    proposals: [],
    counts,
  });
}

function reasonCodes(
  recommendationType: AutomaticRecommendationType,
  candidate: AutomaticRecommendationCandidate,
): readonly string[] {
  if (recommendationType === 'modifier_upsell') {
    return ['completes_your_item'];
  }
  if (recommendationType === 'for_you') {
    return ['matches_your_history'];
  }
  if (candidate.promotionActive) {
    return ['active_offer'];
  }
  return ['completes_your_meal'];
}

function proposal(
  recommendationId: string,
  recommendationType: AutomaticRecommendationType,
  candidate: AutomaticRecommendationCandidate,
) {
  const priceImpact = {
    amount: candidate.action.priceImpactVnd,
    currency: 'VND' as const,
  };
  const action =
    candidate.action.type === 'add_product'
      ? {
          type: 'add_product' as const,
          sellableItemId: candidate.action.sellableItemId,
          quantity: candidate.action.quantity,
          priceImpact,
        }
      : {
          type: 'apply_modifier' as const,
          parentCartLineId: candidate.action.parentCartLineId,
          parentSellableItemId: candidate.action.parentSellableItemId,
          optionId: candidate.action.optionId,
          groupPath: candidate.action.groupPath,
          quantity: candidate.action.quantity,
          priceImpact,
        };
  return {
    actionId: `action:${recommendationId}:${candidate.candidateId}`,
    action,
    display: {
      name: candidate.name,
      imageUrl: candidate.imageUrl,
      priceImpact,
    },
    reasonCodes: reasonCodes(recommendationType, candidate),
  };
}

function recommendedResponse({
  requestId,
  recommendationId,
  recommendationType,
  cartRevision,
  catalogRevision,
  expires,
  model,
  candidates,
  potential,
  eligible,
  scored,
}: {
  requestId: string;
  recommendationId: string;
  recommendationType: AutomaticRecommendationType;
  cartRevision: string;
  catalogRevision: string;
  expires: string;
  model: AutomaticModelBinding;
  candidates: readonly AutomaticRecommendationCandidate[];
  potential: number;
  eligible: number;
  scored: number;
}): RecommendationResponse {
  return parseAutomaticRecommendationResponse({
    schemaVersion: 'kfc-automatic-recommendation-v1',
    requestId,
    recommendationId,
    recommendationType,
    status: 'recommended',
    emptyReason: null,
    cartRevision,
    catalogRevision,
    expiresAt: expires,
    model,
    proposals: candidates.map((candidate) =>
      proposal(recommendationId, recommendationType, candidate),
    ),
    counts: {
      potential,
      eligible,
      scored,
      displayed: candidates.length,
    },
  });
}

export function createAutomaticRecommendationEngine({
  contextPorts,
  qualifiedBundlePort,
  scorer,
  ids,
  recommendationTtlMs,
}: {
  contextPorts: AutomaticRecommendationContextPorts;
  qualifiedBundlePort: AutomaticQualifiedBundlePort;
  scorer: AutomaticRecommendationScorerPort;
  ids: AutomaticRecommendationIdPort;
  recommendationTtlMs: number;
}) {
  const execute = async (
    recommendationType: AutomaticRecommendationType,
    requestValue: unknown,
  ): Promise<AutomaticEngineDecision> => {
    const complete = (
      response: RecommendationResponse,
      execution: Omit<AutomaticEngineExecutionEvidence, 'traceLocator'>,
    ): AutomaticEngineDecision => ({
      response,
      execution: { ...execution, traceLocator: null },
    });
    let resolution;
    try {
      resolution = await resolveAutomaticRecommendationContext({
        recommendationType,
        request: requestValue,
        ports: contextPorts,
      });
    } catch (error) {
      if (
        error instanceof ZodError ||
        error instanceof AutomaticRecommendationBindingError
      ) {
        throw error;
      }
      throw new AutomaticRecommendationInfrastructureError('context', error);
    }

    const recommendationId = ids.nextRecommendationId();
    const requestId =
      typeof requestValue === 'object' &&
      requestValue !== null &&
      'requestId' in requestValue &&
      typeof requestValue.requestId === 'string'
        ? requestValue.requestId
        : 'invalid-request';
    const responseExpiry = expiresAt(
      resolution.kind === 'ready'
        ? resolution.context.decisionTime
        : resolution.decisionTime,
      recommendationTtlMs,
    );

    if (resolution.kind !== 'ready') {
      const response = emptyOrPausedResponse({
        requestId,
        recommendationId,
        recommendationType,
        status: resolution.kind === 'paused' ? 'paused' : 'empty',
        emptyReason: resolution.reason,
        cartRevision: resolution.cartRevision,
        catalogRevision: resolution.catalogRevision,
        expires: responseExpiry,
        counts: { potential: 0, eligible: 0, scored: 0, displayed: 0 },
      });
      return complete(response, {
        contextBindings: {
          resolution: resolution.kind,
          cartRevision: resolution.cartRevision,
          catalogRevision: resolution.catalogRevision,
        },
        potentialCandidates: [],
        eligibilityDecisions: [],
        featureReconciliation: { status: 'not_started' },
        scoresCalibration: null,
        composition: { status: response.status },
        modelReleaseProvenance: null,
      });
    }

    const context = resolution.context;
    const candidates = discoverAutomaticRecommendationCandidates(context);
    const eligibility = evaluateAutomaticRecommendationEligibility(
      context,
      candidates,
    );
    const eligibleCandidates = eligibility.filter(
      ({ status }) => status === 'eligible',
    );
    if (eligibleCandidates.length === 0) {
      const response = emptyOrPausedResponse({
        requestId,
        recommendationId,
        recommendationType,
        status: 'empty',
        emptyReason: 'no_eligible_candidates',
        cartRevision: context.order.cart.revision,
        catalogRevision: context.catalog.catalogRevision,
        expires: responseExpiry,
        counts: {
          potential: candidates.length,
          eligible: 0,
          scored: 0,
          displayed: 0,
        },
      });
      return complete(response, {
        contextBindings: {
          orderingJourneyRef: context.order.orderingJourneyRef,
          opportunityRef: context.order.opportunityRef,
          catalogRevision: context.catalog.catalogRevision,
        },
        potentialCandidates: candidates,
        eligibilityDecisions: eligibility,
        featureReconciliation: { status: 'not_started' },
        scoresCalibration: null,
        composition: { status: 'empty', reason: 'no_eligible_candidates' },
        modelReleaseProvenance: null,
      });
    }

    let bundle;
    try {
      bundle =
        await resolveQualifiedAutomaticRecommendationBundle(
          qualifiedBundlePort,
        );
    } catch (error) {
      throw new AutomaticRecommendationInfrastructureError('bundle', error);
    }
    if (bundle === null) {
      const response = emptyOrPausedResponse({
        requestId,
        recommendationId,
        recommendationType,
        status: 'empty',
        emptyReason: 'no_qualified_model',
        cartRevision: context.order.cart.revision,
        catalogRevision: context.catalog.catalogRevision,
        expires: responseExpiry,
        counts: {
          potential: candidates.length,
          eligible: eligibleCandidates.length,
          scored: 0,
          displayed: 0,
        },
      });
      return complete(response, {
        contextBindings: {
          orderingJourneyRef: context.order.orderingJourneyRef,
          opportunityRef: context.order.opportunityRef,
          catalogRevision: context.catalog.catalogRevision,
        },
        potentialCandidates: candidates,
        eligibilityDecisions: eligibility,
        featureReconciliation: { status: 'not_started' },
        scoresCalibration: null,
        composition: { status: 'empty', reason: 'no_qualified_model' },
        modelReleaseProvenance: null,
      });
    }

    const model = automaticModelBinding(bundle, recommendationType);
    let featureRows;
    let scorerRequest;
    try {
      featureRows = buildAutomaticRecommendationFeatureRows(
        context,
        eligibility,
      );
      scorerRequest = parseAutomaticScorerRequest({
        schemaVersion: 'kfc-automatic-scorer-v1',
        requestId,
        recommendationType,
        model,
        candidates: featureRows,
      });
    } catch (error) {
      throw new AutomaticRecommendationInfrastructureError('features', error);
    }
    let scorerResponse;
    try {
      scorerResponse = reconcileAutomaticScorerResponse(
        scorerRequest,
        await scorer.score(scorerRequest),
      );
    } catch (error) {
      throw new AutomaticRecommendationInfrastructureError('scorer', error);
    }

    const candidateById = new Map(
      eligibleCandidates.map(({ candidate }) => [
        candidate.candidateId,
        candidate,
      ]),
    );
    const priceById = new Map(
      featureRows.map(({ candidateId, priceImpactVnd }) => [
        candidateId,
        priceImpactVnd,
      ]),
    );
    const threshold = bundle.models[recommendationType].minimumJointProbability;
    const passingScores: AutomaticScoredCandidate[] = scorerResponse.scores
      .filter(({ jointProbability }) => jointProbability > threshold)
      .map((score) => {
        const candidate = candidateById.get(score.candidateId);
        const priceImpactVnd = priceById.get(score.candidateId);
        if (candidate === undefined || priceImpactVnd === undefined) {
          throw new AutomaticRecommendationInfrastructureError('scorer');
        }
        return {
          candidate,
          selectionProbability: score.selectionProbability,
          jointProbability: score.jointProbability,
          expectedRetainedValueVnd: priceImpactVnd * score.jointProbability,
        };
      });
    if (passingScores.length === 0) {
      const response = emptyOrPausedResponse({
        requestId,
        recommendationId,
        recommendationType,
        status: 'empty',
        emptyReason: 'no_candidate_above_threshold',
        cartRevision: context.order.cart.revision,
        catalogRevision: context.catalog.catalogRevision,
        expires: responseExpiry,
        counts: {
          potential: candidates.length,
          eligible: eligibleCandidates.length,
          scored: scorerResponse.scores.length,
          displayed: 0,
        },
      });
      return complete(response, {
        contextBindings: {
          orderingJourneyRef: context.order.orderingJourneyRef,
          opportunityRef: context.order.opportunityRef,
          catalogRevision: context.catalog.catalogRevision,
        },
        potentialCandidates: candidates,
        eligibilityDecisions: eligibility,
        featureReconciliation: { featureRows },
        scoresCalibration: scorerResponse,
        composition: {
          status: 'empty',
          reason: 'no_candidate_above_threshold',
          passingCandidateIds: [],
        },
        modelReleaseProvenance: model,
      });
    }

    const composed = composeAutomaticRecommendationSlate(
      recommendationType,
      passingScores,
    );
    const response = recommendedResponse({
      requestId,
      recommendationId,
      recommendationType,
      cartRevision: context.order.cart.revision,
      catalogRevision: context.catalog.catalogRevision,
      expires: responseExpiry,
      model,
      candidates: composed,
      potential: candidates.length,
      eligible: eligibleCandidates.length,
      scored: scorerResponse.scores.length,
    });
    return complete(response, {
      contextBindings: {
        orderingJourneyRef: context.order.orderingJourneyRef,
        opportunityRef: context.order.opportunityRef,
        catalogRevision: context.catalog.catalogRevision,
      },
      potentialCandidates: candidates,
      eligibilityDecisions: eligibility,
      featureReconciliation: { featureRows },
      scoresCalibration: scorerResponse,
      composition: {
        status: 'recommended',
        passingCandidateIds: passingScores.map(
          ({ candidate }) => candidate.candidateId,
        ),
        displayedCandidateIds: composed.map(({ candidateId }) => candidateId),
      },
      modelReleaseProvenance: model,
    });
  };
  return {
    async decide(
      recommendationType: AutomaticRecommendationType,
      requestValue: unknown,
    ): Promise<RecommendationResponse> {
      return (await execute(recommendationType, requestValue)).response;
    },
    decideWithEvidence: execute,
  };
}
