import type {
  RecommendationEvent,
  RecommendationState,
} from '../domain/contracts.js';
import { digestCommerceAction } from '../../ordering/commerceDigest.js';
import type { RecommendationDecisionRecord } from '../persistence/repository.js';
import type { RecommendationDecisionTechnicalEvidence } from './types.js';
import { loadRecommendationPackState } from './context-factory.js';
import type {
  RecommendationInspectionService,
  RecommendationInspectionServiceDependencies,
  RecommendationOrderFlowInspectionEnvelope,
  RecommendationSessionInspectionEnvelope,
} from './service-types.js';

function eventCounts(
  events: readonly RecommendationEvent[],
): Partial<Record<RecommendationEvent['eventType'], number>> {
  const result: Partial<Record<RecommendationEvent['eventType'], number>> = {};
  for (const event of events) {
    result[event.eventType] = (result[event.eventType] ?? 0) + 1;
  }
  return result;
}

const redactedBinding = (binding: string): string => {
  if (binding.startsWith('history:verified:')) {
    return 'redacted:verified-history';
  }
  if (binding.startsWith('completed-order:')) {
    return 'redacted:completed-order';
  }
  if (binding.startsWith('dietary-evidence:')) {
    return 'redacted:dietary-evidence';
  }
  return binding;
};

async function redactedTechnical(
  technical: RecommendationDecisionTechnicalEvidence,
): Promise<RecommendationDecisionTechnicalEvidence> {
  const result = structuredClone(technical);
  result.eligibilityDecisions = await Promise.all(
    result.eligibilityDecisions.map(async (decision) => {
      const digestInput = {
        policyVersion: decision.policyVersion,
        actionId: decision.actionId,
        eligible: decision.eligible,
        reasonCodes: decision.reasonCodes,
        evidenceBindings: [
          ...new Set(decision.evidenceBindings.map(redactedBinding)),
        ].sort(),
      };
      return {
        ...digestInput,
        digest: await digestCommerceAction(digestInput),
      };
    }),
  );
  return result;
}

function orderFlowEnvelope(input: {
  state: RecommendationState;
  latest: RecommendationDecisionRecord;
  events: RecommendationEvent[];
}): RecommendationOrderFlowInspectionEnvelope {
  const latest = input.latest;
  return {
    schemaVersion: 'kfc-recommendation-order-flow-inspection-v1',
    state: input.state,
    latestDecision: {
      recommendationId: latest.response.recommendationId,
      requestId: latest.request.requestId,
      placement: latest.request.placement,
      status: latest.response.status,
      traceRef: latest.response.traceRef,
      recordedAt: latest.recordedAt,
    },
    pendingAction: input.state.pendingRecommendation,
    correlations: {
      sessionId: latest.request.sessionId,
      orderFlowId: input.state.orderFlowId,
      recommendationId: latest.response.recommendationId,
      requestId: latest.request.requestId,
      traceRef: latest.response.traceRef,
    },
    eventCounts: eventCounts(input.events),
  };
}

async function decisionsForEvents(
  dependencies: RecommendationInspectionServiceDependencies,
  events: readonly RecommendationEvent[],
): Promise<RecommendationDecisionRecord[]> {
  const recommendationIds = [
    ...new Set(
      events.flatMap((event) =>
        event.eventType === 'decision_completed' && event.recommendationId
          ? [event.recommendationId]
          : [],
      ),
    ),
  ];
  const records = await Promise.all(
    recommendationIds.map((recommendationId) =>
      dependencies.persistence.getRecommendationDecision(recommendationId),
    ),
  );
  if (records.some((record) => !record)) {
    throw new Error('recommendation_inspection_decision_missing');
  }
  return records as RecommendationDecisionRecord[];
}

function latestOrderFlowDecision(
  records: readonly RecommendationDecisionRecord[],
): RecommendationDecisionRecord | undefined {
  return [...records].sort(
    (left, right) =>
      right.stateRevisionAfter - left.stateRevisionAfter ||
      right.recordedAt.localeCompare(left.recordedAt) ||
      right.response.recommendationId.localeCompare(
        left.response.recommendationId,
      ),
  )[0];
}

function latestSessionDecision(
  records: readonly RecommendationDecisionRecord[],
): RecommendationDecisionRecord | undefined {
  return [...records].sort(
    (left, right) =>
      right.recordedAt.localeCompare(left.recordedAt) ||
      right.response.recommendationId.localeCompare(
        left.response.recommendationId,
      ),
  )[0];
}

export function createRecommendationInspectionService(
  dependencies: RecommendationInspectionServiceDependencies,
): RecommendationInspectionService {
  return {
    async recommendation(recommendationId) {
      const record =
        await dependencies.persistence.getRecommendationDecision(
          recommendationId,
        );
      if (!record) return null;
      const loaded = await loadRecommendationPackState({
        persistence: dependencies.persistence,
        packState: dependencies.packState,
        sessionId: record.request.sessionId,
        orderFlowId: record.request.orderFlowId,
      });
      return {
        schemaVersion: 'kfc-recommendation-inspection-v1',
        recommendation: {
          response: record.response,
          actionDigest: record.actionDigest,
          requestFingerprint: record.requestFingerprint,
          recordedAt: record.recordedAt,
        },
        technical: await redactedTechnical(record.technical),
        state: loaded.state,
        events: (
          await dependencies.persistence.listRecommendationEvents({
            orderFlowId: record.request.orderFlowId,
          })
        ).filter(
          (event) =>
            event.requestId === record.request.requestId ||
            event.recommendationId === recommendationId,
        ),
        correlations: {
          sessionId: record.request.sessionId,
          orderFlowId: record.request.orderFlowId,
          requestId: record.request.requestId,
          recommendationId: record.response.recommendationId,
          traceRef: record.response.traceRef,
        },
      };
    },

    async orderFlow(orderFlowId) {
      const events = await dependencies.persistence.listRecommendationEvents({
        orderFlowId,
      });
      const latest = latestOrderFlowDecision(
        await decisionsForEvents(dependencies, events),
      );
      if (!latest) return null;
      const loaded = await loadRecommendationPackState({
        persistence: dependencies.persistence,
        packState: dependencies.packState,
        sessionId: latest.request.sessionId,
        orderFlowId,
      });
      return orderFlowEnvelope({ state: loaded.state, latest, events });
    },

    async session(
      sessionId: string,
    ): Promise<RecommendationSessionInspectionEnvelope> {
      const events = await dependencies.persistence.listRecommendationEvents({
        sessionId,
      });
      const record = latestSessionDecision(
        await decisionsForEvents(dependencies, events),
      );
      if (!record) {
        return {
          schemaVersion: 'kfc-recommendation-order-flow-inspection-v1',
          state: null,
          latestDecision: null,
          pendingAction: null,
          correlations: {
            sessionId,
            orderFlowId: null,
            recommendationId: null,
            requestId: null,
            traceRef: null,
          },
          eventCounts: {},
        };
      }
      if (record.request.sessionId !== sessionId) {
        throw new Error('recommendation_session_correlation_mismatch');
      }
      const orderFlowEvents =
        await dependencies.persistence.listRecommendationEvents({
          orderFlowId: record.request.orderFlowId,
        });
      const latest = latestOrderFlowDecision(
        await decisionsForEvents(dependencies, orderFlowEvents),
      );
      if (!latest || latest.request.sessionId !== sessionId) {
        throw new Error('recommendation_session_correlation_mismatch');
      }
      const loaded = await loadRecommendationPackState({
        persistence: dependencies.persistence,
        packState: dependencies.packState,
        sessionId,
        orderFlowId: record.request.orderFlowId,
      });
      return orderFlowEnvelope({
        state: loaded.state,
        latest,
        events: orderFlowEvents,
      });
    },
  };
}
