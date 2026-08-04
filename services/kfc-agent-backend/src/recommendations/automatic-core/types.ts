import type {
  AutomaticRecommendationRequest,
  AutomaticRecommendationType,
} from '../contracts/automatic-recommendation.js';

export interface AutomaticModifierOptionSnapshot {
  optionId: string;
  name: string;
  imageUrl: string | null;
  priceImpactVnd: number;
  available: boolean;
  safe: boolean;
}

export interface AutomaticModifierGroupSnapshot {
  groupPath: readonly string[];
  selectionMode: 'single' | 'multiple';
  options: readonly AutomaticModifierOptionSnapshot[];
}

export interface AutomaticCatalogItemSnapshot {
  sellableItemId: string;
  name: string;
  imageUrl: string | null;
  categoryId: string;
  unitPriceVnd: number;
  sellable: boolean;
  safe: boolean;
  availableFulfilmentModes: readonly ('pickup' | 'delivery')[];
  promotionActive: boolean;
  discountAmountVnd: number;
  localDemandCount: number | null;
  basketAssociationCount: number | null;
  basketComplementarityScore: number | null;
  modifierGroups: readonly AutomaticModifierGroupSnapshot[];
}

export interface AutomaticCatalogSnapshot {
  catalogRevision: string;
  resolvedAt: string;
  timeZone: string;
  items: readonly AutomaticCatalogItemSnapshot[];
}

export interface AutomaticCompletedHistorySnapshot {
  verifiedCustomerRef: string;
  historyRevision: string;
  completedOrderCount: number;
  lastCompletedOrderAt: string | null;
  itemOrderCounts: Readonly<Record<string, number>>;
  categoryOrderCounts: Readonly<Record<string, number>>;
}

type AutomaticCart = AutomaticRecommendationRequest['cart'];

export interface AutomaticTrustedOrderContextSnapshot {
  orderingJourneyRef: string;
  opportunityRef: string;
  storeId: string;
  fulfilmentMode: 'pickup' | 'delivery';
  locale: string;
  cart: AutomaticCart;
  remainingBudgetVnd: number | null;
  parentCartLineId: string | null;
  verifiedCustomerRef: string | null;
}

export interface AutomaticRecommendationContextPorts {
  orderContext: {
    readSnapshot(input: {
      orderingJourneyRef: string;
      opportunityRef: string;
    }): Promise<AutomaticTrustedOrderContextSnapshot | null>;
  };
  catalog: {
    readSnapshot(input: {
      storeId: string;
      fulfilmentMode: 'pickup' | 'delivery';
      locale: string;
    }): Promise<AutomaticCatalogSnapshot>;
  };
  history: {
    readCompletedHistory(
      verifiedCustomerRef: string,
    ): Promise<AutomaticCompletedHistorySnapshot | null>;
  };
  exposure: {
    readState(
      recommendationType: AutomaticRecommendationType,
    ): Promise<'enabled' | 'paused'>;
  };
  clock: {
    now(): Date;
  };
}

type CartLine = AutomaticCart['lines'][number];

export interface AutomaticRecommendationContext {
  recommendationType: AutomaticRecommendationType;
  request: AutomaticRecommendationRequest;
  order: AutomaticTrustedOrderContextSnapshot;
  decisionTime: string;
  catalog: AutomaticCatalogSnapshot;
  history: AutomaticCompletedHistorySnapshot | null;
  parentCartLine: CartLine | null;
}

export type AutomaticContextEmptyReason =
  'insufficient_history' | 'parent_cart_line_not_found' | 'empty_cart';

export type AutomaticRecommendationContextResolution =
  | { kind: 'ready'; context: AutomaticRecommendationContext }
  | {
      kind: 'empty';
      reason: AutomaticContextEmptyReason;
      decisionTime: string;
      cartRevision: string;
      catalogRevision: string;
    }
  | {
      kind: 'paused';
      reason: 'recommendation_serving_paused';
      decisionTime: string;
      cartRevision: string;
      catalogRevision: string;
    };

interface ProductAction {
  type: 'add_product';
  sellableItemId: string;
  quantity: number;
  priceImpactVnd: number;
}

interface ModifierAction {
  type: 'apply_modifier';
  parentCartLineId: string;
  parentSellableItemId: string;
  groupPath: readonly string[];
  optionId: string;
  quantity: number;
  priceImpactVnd: number;
}

export interface AutomaticRecommendationCandidate {
  candidateId: string;
  categoryId: string;
  name: string;
  imageUrl: string | null;
  sellable: boolean;
  safe: boolean;
  available: boolean;
  promotionActive: boolean;
  action: ProductAction | ModifierAction;
}

export type AutomaticEligibilityEvidenceCode =
  | 'eligible'
  | 'candidate_not_in_catalog'
  | 'not_sellable'
  | 'unsafe_candidate'
  | 'unavailable_for_fulfilment'
  | 'already_in_cart'
  | 'modifier_parent_mismatch'
  | 'modifier_path_mismatch'
  | 'modifier_already_applied'
  | 'modifier_group_satisfied';

export interface AutomaticEligibilityDecision {
  candidate: AutomaticRecommendationCandidate;
  status: 'eligible' | 'excluded';
  evidence: {
    code: AutomaticEligibilityEvidenceCode;
    catalogRevision: string;
  };
}

export type AutomaticFeatureValue = string | number | boolean | null;

export interface AutomaticRecommendationFeatureRow {
  candidateId: string;
  eligibility: 'eligible';
  priceImpactVnd: number;
  features: Readonly<Record<string, AutomaticFeatureValue>>;
}

export interface AutomaticQualifiedModelConfiguration {
  modelRevision: string;
  calibratorRevision: string;
  featureSchemaDigest: string;
  thresholdRevision: string;
  minimumJointProbability: number;
}

export interface AutomaticQualifiedRecommendationBundle {
  schemaVersion: 'kfc-qualified-automatic-bundle-v1';
  bundleId: string;
  bundleDigest: string;
  composerContractDigest: string;
  qualificationRunId: string;
  qualificationEvidenceDigest: string;
  models: Record<
    AutomaticRecommendationType,
    AutomaticQualifiedModelConfiguration
  >;
}

export interface AutomaticQualifiedBundlePort {
  readQualifiedBundle(): Promise<unknown>;
}

export interface AutomaticModelBinding {
  bundleId: string;
  bundleDigest: string;
  modelRevision: string;
  calibratorRevision: string;
  featureSchemaDigest: string;
  thresholdRevision: string;
  composerContractDigest: string;
  qualificationRunId: string;
  qualificationEvidenceDigest: string;
}

export interface AutomaticScorerRequest {
  schemaVersion: 'kfc-automatic-scorer-v1';
  requestId: string;
  recommendationType: AutomaticRecommendationType;
  model: AutomaticModelBinding;
  candidates: readonly AutomaticRecommendationFeatureRow[];
}

export interface AutomaticRecommendationScorerPort {
  score(request: AutomaticScorerRequest): Promise<unknown>;
}

export interface AutomaticRecommendationIdPort {
  nextRecommendationId(): string;
}

export interface AutomaticScoredCandidate {
  candidate: AutomaticRecommendationCandidate;
  selectionProbability: number;
  jointProbability: number;
  expectedRetainedValueVnd: number;
}

export type { AutomaticRecommendationRequest, AutomaticRecommendationType };
