import type { PackRef, PackStateEnvelope } from '../../runtime/businessPack.js';
import type {
  Placement,
  RecommendationDecisionRequest,
  RecommendationDecisionResponse,
  RecommendationEvent,
  RecommendationImpressionRequest,
  RecommendationOutcomeRequest,
  RecommendationState,
} from '../domain/contracts.js';
import type { CustomerHistoryRepository } from '../history/repository.js';
import type {
  RecommendationDecisionRecord,
  RecommendationPersistence,
} from '../persistence/repository.js';
import type { RecommendationRequestKind } from '../state/types.js';
import type {
  RecommendationDecisionEngine,
  RecommendationDecisionTechnicalEvidence,
} from './types.js';

export interface RecommendationTrustedContext {
  parentCartLineId?: string | null;
  remainingBudgetVnd?: number | null;
  verifiedCohorts?: string[];
  verifiedDietaryEvidence?: {
    evidenceId: string;
    excludedSellableItemIds: string[];
  } | null;
}

export interface RecommendationDecisionApplicationInput {
  request: RecommendationDecisionRequest;
  requestKind?: RecommendationRequestKind;
  trusted?: RecommendationTrustedContext;
}

export type RecommendationDecisionApplicationResult =
  | {
      status: 'decided' | 'replay';
      response: RecommendationDecisionResponse;
    }
  | {
      status: 'pending' | 'idempotency_conflict' | 'state_conflict';
    };

export type EventApplicationResult =
  | {
      status: 'recorded' | 'replay';
      event: RecommendationEvent;
    }
  | {
      status:
        | 'not_found'
        | 'idempotency_conflict'
        | 'state_conflict'
        | 'stale_recommendation'
        | 'cart_revision_conflict'
        | 'render_binding_conflict';
    };

export interface RecommendationApplicationService {
  decide(
    input: RecommendationDecisionApplicationInput,
  ): Promise<RecommendationDecisionApplicationResult>;

  recordImpression(
    recommendationId: string,
    request: RecommendationImpressionRequest,
  ): Promise<EventApplicationResult>;

  recordOutcome(
    recommendationId: string,
    request: RecommendationOutcomeRequest,
  ): Promise<EventApplicationResult>;
}

export interface RecommendationClock {
  now(): string;
}

export interface RecommendationServerContext {
  storeTimezone: string;
}

export interface RecommendationServerContextSource {
  load(
    request: RecommendationDecisionRequest,
  ): Promise<RecommendationServerContext>;
}

export type RecommendationPackState = Record<string, unknown> & {
  recommendationState?: RecommendationState;
};

export interface RecommendationPackStateDefinition {
  packRef: PackRef;
  schemaVersion: string;
  parseState(value: unknown): RecommendationPackState;
}

export interface RecommendationPackStateReader {
  getPackState(
    sessionId: string,
    packRef: PackRef,
  ): Promise<PackStateEnvelope | undefined>;
}

export type RecommendationApplicationPersistence = RecommendationPersistence &
  RecommendationPackStateReader;

export interface RecommendationApplicationServiceDependencies {
  decisionEngine: RecommendationDecisionEngine;
  persistence: RecommendationApplicationPersistence;
  historyRepository: CustomerHistoryRepository;
  contextSource: RecommendationServerContextSource;
  packState: RecommendationPackStateDefinition;
  clock: RecommendationClock;
}

export interface RecommendationInspectionServiceDependencies {
  persistence: RecommendationApplicationPersistence;
  packState: RecommendationPackStateDefinition;
}

export interface RecommendationInspectionService {
  recommendation(
    recommendationId: string,
  ): Promise<RecommendationInspectionEnvelope | null>;
  orderFlow(
    orderFlowId: string,
  ): Promise<RecommendationOrderFlowInspectionEnvelope | null>;
  session(sessionId: string): Promise<RecommendationSessionInspectionEnvelope>;
}

export interface RecommendationInspectionEnvelope {
  schemaVersion: 'kfc-recommendation-inspection-v1';
  recommendation: {
    response: RecommendationDecisionResponse;
    actionDigest: string;
    requestFingerprint: string;
    recordedAt: string;
  };
  technical: RecommendationDecisionTechnicalEvidence;
  state: RecommendationState;
  events: RecommendationEvent[];
  correlations: {
    sessionId: string;
    orderFlowId: string;
    requestId: string;
    recommendationId: string;
    traceRef: string;
  };
}

export interface RecommendationOrderFlowInspectionEnvelope {
  schemaVersion: 'kfc-recommendation-order-flow-inspection-v1';
  state: RecommendationState;
  latestDecision: {
    recommendationId: string;
    requestId: string;
    placement: Placement;
    status: RecommendationDecisionResponse['status'];
    traceRef: string;
    recordedAt: string;
  } | null;
  pendingAction: RecommendationState['pendingRecommendation'];
  correlations: {
    sessionId: string;
    orderFlowId: string;
    recommendationId: string | null;
    requestId: string | null;
    traceRef: string | null;
  };
  eventCounts: Partial<Record<RecommendationEvent['eventType'], number>>;
}

export type RecommendationSessionInspectionEnvelope =
  | RecommendationOrderFlowInspectionEnvelope
  | {
      schemaVersion: 'kfc-recommendation-order-flow-inspection-v1';
      state: null;
      latestDecision: null;
      pendingAction: null;
      correlations: {
        sessionId: string;
        orderFlowId: null;
        recommendationId: null;
        requestId: null;
        traceRef: null;
      };
      eventCounts: {};
    };

export interface LoadedRecommendationPackState {
  envelope: PackStateEnvelope | undefined;
  packState: RecommendationPackState;
  state: RecommendationState;
  expectedDigest: string | null;
}

export interface RecommendationContextFactoryInput {
  request: RecommendationDecisionRequest;
  requestKind: RecommendationRequestKind;
  trusted: RecommendationTrustedContext;
  state: RecommendationState;
  starterDecision: RecommendationDecisionRecord | undefined;
}
