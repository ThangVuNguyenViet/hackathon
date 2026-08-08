import { createHash } from 'node:crypto';
import type {
  GeneratedFixtures,
  GeneratedModifierGroup,
  GeneratedModifierOption,
} from '../../fixtures/schema.js';
import type {
  AutomaticRecommendationRequest,
  AutomaticRecommendationType,
  AutomaticRecommendationResponse,
} from '../contracts/automatic-recommendation.js';
import {
  automaticRecommendationIdentityDigest,
  automaticRecommendationOperations,
  parseAutomaticRecommendationImpression,
  parseAutomaticRecommendationOutcome,
  parseAutomaticRecommendationRequest,
  parseAutomaticRecommendationResponse,
} from '../contracts/automatic-recommendation.js';
import { AUTOMATIC_FEATURE_SCHEMA_DIGEST } from '../automatic-core/features.js';
import { AUTOMATIC_COMPOSER_CONTRACT_DIGEST } from '../automatic-core/composition.js';
import { mockCatalogRevision } from '../../mock/mockCatalogRevision.js';
import type { AutomaticRecommendationHttpRuntime } from './http-runtime.js';

const MOCK_MODEL = {
  bundleId: 'fixture-mock-bundle-v1',
  bundleDigest: createHash('sha256')
    .update('fixture-mock-bundle-v1')
    .digest('hex'),
  modelRevision: 'fixture-mock-model-v1',
  calibratorRevision: 'fixture-mock-calibrator-v1',
  featureSchemaDigest: AUTOMATIC_FEATURE_SCHEMA_DIGEST,
  thresholdRevision: 'fixture-mock-threshold-v1',
  composerContractDigest: AUTOMATIC_COMPOSER_CONTRACT_DIGEST,
  qualificationRunId: 'fixture-mock-qualification-v1',
  qualificationEvidenceDigest: createHash('sha256')
    .update('fixture-mock-qualification-v1')
    .digest('hex'),
} as const;

const REASON_CODES = {
  local_favorite: ['popular_here'],
  for_you: ['matches_your_history'],
  smart_cross_sell: ['completes_your_meal'],
} as const;

type StoredRecommendation = {
  request: AutomaticRecommendationRequest;
  response: AutomaticRecommendationResponse;
  requestDigest: string;
  cartDigest: string;
  events: Array<{ eventId: string }>;
};

type ModifierCandidate = {
  groupPath: string[];
  option: GeneratedModifierOption;
};

function firstModifierOption(
  groups: readonly GeneratedModifierGroup[],
  groupPath: readonly string[] = [],
): ModifierCandidate | undefined {
  for (const group of groups) {
    const path = [...groupPath, group.groupId];
    for (const option of group.options) {
      if (option.priceDeltaVnd >= 0) return { groupPath: path, option };
      const nested = firstModifierOption(option.modifierGroups, [
        ...path,
        option.modifierId,
      ]);
      if (nested) return nested;
    }
  }
  return undefined;
}

function recommendationId(
  type: AutomaticRecommendationType,
  requestId: string,
): string {
  return `fixture-${type}-${createHash('sha256')
    .update(requestId)
    .digest('hex')
    .slice(0, 24)}`;
}

function itemCandidates(
  fixtures: GeneratedFixtures,
  request: AutomaticRecommendationRequest,
  type: AutomaticRecommendationType,
) {
  const cartItemIds = new Set(
    request.cart.lines.map((line) => line.sellableItemId),
  );
  const cartCategoryKeys = new Set(
    request.cart.lines
      .map((line) => {
        const item = fixtures.menuItems.find(
          (candidate) => candidate.code === line.sellableItemId,
        );
        return item ? `${item.categoryId}:${item.category}` : undefined;
      })
      .filter(
        (categoryKey): categoryKey is string => categoryKey !== undefined,
      ),
  );
  return fixtures.menuItems.filter((item) => {
    if (!item.available || cartItemIds.has(item.code)) return false;
    if (type === 'smart_cross_sell') {
      return !cartCategoryKeys.has(`${item.categoryId}:${item.category}`);
    }
    return true;
  });
}

function responseFor(
  fixtures: GeneratedFixtures,
  type: AutomaticRecommendationType,
  request: AutomaticRecommendationRequest,
  clock: () => Date,
): AutomaticRecommendationResponse {
  const recommendationIdValue = recommendationId(type, request.requestId);
  const catalogRevision = mockCatalogRevision(fixtures);
  const expiresAt = new Date(clock().getTime() + 5 * 60 * 1000).toISOString();
  const limit = type === 'modifier_upsell' ? 3 : 4;
  const availableCandidates = itemCandidates(fixtures, request, type);
  const proposals =
    type === 'modifier_upsell'
      ? (() => {
          const modifierRequest =
            'parentCartLineId' in request ? request : undefined;
          const parentLine = modifierRequest?.cart.lines.find(
            (line) => line.lineId === modifierRequest.parentCartLineId,
          );
          const parentItem = parentLine
            ? fixtures.menuItems.find(
                (item) => item.code === parentLine.sellableItemId,
              )
            : undefined;
          const modifierTree = parentItem
            ? fixtures.menuModifiers.find(
                (item) => item.itemCode === parentItem.code,
              )
            : undefined;
          const modifier = modifierTree
            ? firstModifierOption(modifierTree.modifierGroups)
            : undefined;
          if (!parentLine || !modifierTree || !modifier) return [];
          return [
            {
              actionId: `${recommendationIdValue}:action:1`,
              action: {
                type: 'apply_modifier' as const,
                parentCartLineId: parentLine.lineId,
                parentSellableItemId: parentLine.sellableItemId,
                optionId: modifier.option.modifierId,
                groupPath: modifier.groupPath,
                quantity: 1,
                priceImpact: {
                  amount: modifier.option.priceDeltaVnd,
                  currency: 'VND' as const,
                },
              },
              display: {
                name: modifier.option.name,
                imageUrl: null,
                priceImpact: {
                  amount: modifier.option.priceDeltaVnd,
                  currency: 'VND' as const,
                },
              },
              reasonCodes: ['completes_your_item' as const],
            },
          ];
        })()
      : availableCandidates.slice(0, limit).map((item, index) => ({
          actionId: `${recommendationIdValue}:action:${index + 1}`,
          action: {
            type: 'add_product' as const,
            sellableItemId: item.code,
            quantity: 1,
            priceImpact: { amount: item.priceVnd, currency: 'VND' as const },
          },
          display: {
            name: item.name,
            imageUrl: item.imageUrl,
            priceImpact: { amount: item.priceVnd, currency: 'VND' as const },
          },
          reasonCodes: REASON_CODES[type] ?? ['popular_here' as const],
        }));
  const emptyReason =
    proposals.length > 0
      ? null
      : type === 'modifier_upsell'
        ? 'no_eligible_candidates'
        : request.cart.lines.length === 0 && type === 'smart_cross_sell'
          ? 'empty_cart'
          : 'no_candidate_above_threshold';
  return parseAutomaticRecommendationResponse({
    schemaVersion: 'kfc-automatic-recommendation-v1',
    requestId: request.requestId,
    recommendationId: recommendationIdValue,
    recommendationType: type,
    status: proposals.length > 0 ? 'recommended' : 'empty',
    emptyReason,
    cartRevision: request.cart.revision,
    catalogRevision,
    expiresAt,
    model: proposals.length > 0 ? MOCK_MODEL : null,
    proposals,
    counts: {
      potential: type === 'modifier_upsell' ? 1 : availableCandidates.length,
      eligible:
        proposals.length > 0
          ? type === 'modifier_upsell'
            ? 1
            : availableCandidates.length
          : 0,
      scored: proposals.length,
      displayed: proposals.length,
    },
  });
}

export function createMockAutomaticRecommendationHttpRuntime(
  fixtures: GeneratedFixtures,
  options: { clock?: () => Date } = {},
): AutomaticRecommendationHttpRuntime {
  const clock = options.clock ?? (() => new Date());
  const records = new Map<string, StoredRecommendation>();

  return {
    async decide(type, body) {
      const request = parseAutomaticRecommendationRequest(type, body);
      const response = responseFor(fixtures, type, request, clock);
      records.set(response.recommendationId, {
        request,
        response,
        requestDigest: automaticRecommendationIdentityDigest({
          operationPath: automaticRecommendationOperations[type],
          identityType: 'request',
          payload: request,
        }),
        cartDigest: automaticRecommendationIdentityDigest({
          operationPath: '/v1/recommendations/cart',
          identityType: 'cart_revision',
          payload: request.cart,
        }),
        events: [],
      });
      return response;
    },

    async recordImpression(recommendationId, body) {
      const record = records.get(recommendationId);
      if (!record)
        throw new Error('recommendation inspection storage is unavailable');
      const event = parseAutomaticRecommendationImpression(body);
      if (
        !record.events.some(
          (existing) => JSON.stringify(existing) === JSON.stringify(event),
        )
      ) {
        record.events.push(event);
      }
    },

    async recordOutcome(recommendationId, body) {
      const record = records.get(recommendationId);
      if (!record)
        throw new Error('recommendation inspection storage is unavailable');
      const event = parseAutomaticRecommendationOutcome(body);
      if (
        !record.events.some(
          (existing) => JSON.stringify(existing) === JSON.stringify(event),
        )
      ) {
        record.events.push(event);
      }
    },

    async inspect(recommendationId) {
      const record = records.get(recommendationId);
      if (!record) throw new Error('recommendation not found');
      const response = parseAutomaticRecommendationResponse({
        schemaVersion: 'kfc-automatic-recommendation-v1',
        requestId: record.request.requestId,
        recommendationId: record.response.recommendationId,
        recommendationType: record.response.recommendationType,
        status: record.response.status,
        emptyReason: record.response.emptyReason,
        cartRevision: record.response.cartRevision,
        catalogRevision: record.response.catalogRevision,
        expiresAt: record.response.expiresAt,
        model: record.response.model,
        proposals: record.response.proposals,
        counts: record.response.counts,
      });
      return {
        schemaVersion: 'kfc-automatic-inspection-v1' as const,
        recommendationId,
        requestDigest: record.requestDigest,
        cartDigest: record.cartDigest,
        model: response.model,
        candidateEvidence: response.proposals.map((proposal) => ({
          actionId: proposal.actionId,
          action: proposal.action,
        })),
        persistenceEvidence: {
          mode: 'fixture-in-memory',
          eventCount: record.events.length,
          eventIds: record.events.map((event) => event.eventId),
        },
      };
    },

    readiness: async () => ({ ok: true }),
    close: async () => undefined,
  };
}

export { MOCK_MODEL };
