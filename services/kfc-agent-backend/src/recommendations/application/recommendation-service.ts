import { z } from 'zod';
import { digestCommerceAction } from '../../ordering/commerceDigest.js';
import {
  canonicalJson,
  createPackStateEnvelope,
} from '../../runtime/businessPack.js';
import type {
  RecommendationDecisionResponse,
  RecommendationEvent,
  RecommendationImpressionRequest,
  RecommendationOutcomeRequest,
  RecommendationState,
} from '../domain/contracts.js';
import {
  parseRecommendationEvent,
  parseRecommendationImpressionRequest,
  parseRecommendationOutcomeRequest,
} from '../domain/schemas.js';
import type { RecommendationDecisionRecord } from '../persistence/repository.js';
import {
  applyRecommendationDecision,
  applyRecommendationImpression,
  applyRecommendationOutcome,
} from '../state/state-machine.js';
import { StoredDemoCustomerHistoryRepository } from '../history/stored-demo-history-repository.js';
import { createBundledRecommendationDecisionEngine } from './create-bundled-engine.js';
import {
  createRecommendationDecisionContext,
  kfcRecommendationPackStateDefinition,
  loadRecommendationPackState,
  parseRecommendationDecisionApplicationInput,
  stateWithCasRevision,
} from './context-factory.js';
import type {
  EventApplicationResult,
  LoadedRecommendationPackState,
  RecommendationApplicationService,
  RecommendationApplicationServiceDependencies,
  RecommendationDecisionApplicationInput,
} from './service-types.js';

const recommendationIdSchema = z.string().trim().min(1);
const mutationOutcomeTypes = new Set<RecommendationOutcomeRequest['eventType']>(
  ['cart_mutation_succeeded', 'cart_mutation_failed'],
);

async function decisionEventId(
  requestId: string,
  eventType: 'decision_requested' | 'decision_completed',
): Promise<string> {
  const digest = await digestCommerceAction(`${requestId}:${eventType}`);
  return `recommendation-event:${digest.slice(0, 24)}`;
}

async function decisionEvents(input: {
  record: RecommendationDecisionRecord;
  recordedAt: string;
}): Promise<[RecommendationEvent, RecommendationEvent]> {
  const { record, recordedAt } = input;
  const shared = {
    schemaVersion: 'kfc-recommendation-event-v1' as const,
    requestId: record.request.requestId,
    orderFlowId: record.request.orderFlowId,
    sessionId: record.request.sessionId,
    placement: record.request.placement,
    occurredAt: recordedAt,
    recordedAt,
    actor: 'system' as const,
    actionId: null,
    cartRevision: record.request.cartRevision,
    versionBindings: record.response.versionBindings,
  };
  return [
    parseRecommendationEvent({
      ...shared,
      eventId: await decisionEventId(
        record.request.requestId,
        'decision_requested',
      ),
      eventType: 'decision_requested',
      recommendationId: null,
      payload: {
        requestFingerprint: record.requestFingerprint,
        cartRevision: record.request.cartRevision,
      },
    }),
    parseRecommendationEvent({
      ...shared,
      eventId: await decisionEventId(
        record.request.requestId,
        'decision_completed',
      ),
      eventType: 'decision_completed',
      recommendationId: record.response.recommendationId,
      payload: {
        status: record.response.status,
        source: record.response.decisionSource,
        counts: record.response.counts,
        actionDigest: record.actionDigest,
        traceRef: record.response.traceRef,
      },
    }),
  ];
}

function applyDecision(
  state: RecommendationState,
  response: RecommendationDecisionResponse,
  decisionTime: string,
): RecommendationState {
  try {
    return stateWithCasRevision(
      state,
      applyRecommendationDecision(state, response, decisionTime),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'recommendation_decision_not_eligible'
    ) {
      return stateWithCasRevision(state, state);
    }
    throw error;
  }
}

async function nextEnvelope(
  dependencies: RecommendationApplicationServiceDependencies,
  loaded: LoadedRecommendationPackState,
  state: RecommendationState,
) {
  return createPackStateEnvelope({
    packRef: dependencies.packState.packRef,
    schemaVersion: dependencies.packState.schemaVersion,
    state: {
      ...loaded.packState,
      recommendationState: state,
    },
  });
}

function correlatedEventBase(
  record: RecommendationDecisionRecord,
  input: {
    eventId: string;
    eventType: RecommendationEvent['eventType'];
    occurredAt: string;
    recordedAt: string;
    actor: RecommendationEvent['actor'];
    actionId: string | null;
    cartRevision: string | null;
    payload: RecommendationEvent['payload'];
  },
): RecommendationEvent {
  return parseRecommendationEvent({
    schemaVersion: 'kfc-recommendation-event-v1',
    recommendationId: record.response.recommendationId,
    requestId: record.request.requestId,
    orderFlowId: record.request.orderFlowId,
    sessionId: record.request.sessionId,
    placement: record.request.placement,
    versionBindings: record.response.versionBindings,
    ...input,
  });
}

function offeredActionIds(record: RecommendationDecisionRecord): string[] {
  return (
    record.response.primaryOffer?.actions.map((action) => action.actionId) ?? []
  );
}

function isCurrentRecommendation(
  loaded: LoadedRecommendationPackState,
  record: RecommendationDecisionRecord,
): boolean {
  const pending = loaded.state.pendingRecommendation;
  return (
    pending !== null &&
    pending.recommendationId === record.response.recommendationId &&
    pending.requestId === record.request.requestId &&
    pending.placement === record.request.placement
  );
}

async function existingEvent(
  dependencies: RecommendationApplicationServiceDependencies,
  record: RecommendationDecisionRecord,
  eventId: string,
): Promise<RecommendationEvent | undefined> {
  return (
    await dependencies.persistence.listRecommendationEvents({
      recommendationId: record.response.recommendationId,
    })
  ).find((event) => event.eventId === eventId);
}

async function qualifyingStarterDecision(
  dependencies: RecommendationApplicationServiceDependencies,
  loaded: LoadedRecommendationPackState,
): Promise<RecommendationDecisionRecord | undefined> {
  const pending = loaded.state.pendingRecommendation;
  if (
    pending &&
    (pending.placement === 'local_favorite' || pending.placement === 'for_you')
  ) {
    return dependencies.persistence.getRecommendationDecision(
      pending.recommendationId,
    );
  }
  const mutation = (
    await dependencies.persistence.listRecommendationEvents({
      orderFlowId: loaded.state.orderFlowId,
    })
  )
    .filter(
      (event) =>
        event.eventType === 'cart_mutation_succeeded' &&
        event.recommendationId !== null &&
        (event.placement === 'local_favorite' || event.placement === 'for_you'),
    )
    .at(-1);
  if (!mutation?.recommendationId) return undefined;
  const decision = await dependencies.persistence.getRecommendationDecision(
    mutation.recommendationId,
  );
  if (
    !decision ||
    mutation.actionId === null ||
    !decision.response.primaryOffer?.actions.some(
      (action) => action.actionId === mutation.actionId,
    )
  ) {
    throw new Error('recommendation_starter_mutation_correlation_mismatch');
  }
  return decision;
}

function mapAppendResult(
  result: Awaited<
    ReturnType<
      RecommendationApplicationServiceDependencies['persistence']['appendRecommendationEvent']
    >
  >,
): EventApplicationResult {
  if (result.status === 'recorded' || result.status === 'replay') {
    return result;
  }
  return result.status === 'conflict'
    ? { status: 'idempotency_conflict' }
    : { status: 'state_conflict' };
}

export function createRecommendationApplicationService(
  dependencies: RecommendationApplicationServiceDependencies,
): RecommendationApplicationService {
  return {
    async decide(input: RecommendationDecisionApplicationInput) {
      const parsed = parseRecommendationDecisionApplicationInput(input);
      const requestFingerprint = await digestCommerceAction(parsed);
      const recordedAt = dependencies.clock.now();
      const ownerDigest = await digestCommerceAction(
        `${parsed.request.requestId}:${requestFingerprint}`,
      );
      const ownerToken = `recommendation-owner:${ownerDigest.slice(0, 24)}`;
      const reservation =
        await dependencies.persistence.reserveRecommendationDecision({
          sessionId: parsed.request.sessionId,
          idempotencyKey: parsed.request.idempotencyKey,
          requestId: parsed.request.requestId,
          requestFingerprint,
          ownerToken,
          createdAt: recordedAt,
        });
      if (reservation.status === 'replay') {
        return { status: 'replay', response: reservation.record.response };
      }
      if (reservation.status === 'pending') return { status: 'pending' };
      if (reservation.status === 'conflict') {
        return { status: 'idempotency_conflict' };
      }

      const loaded = await loadRecommendationPackState({
        persistence: dependencies.persistence,
        packState: dependencies.packState,
        sessionId: parsed.request.sessionId,
        orderFlowId: parsed.request.orderFlowId,
      });
      const starterDecision =
        parsed.request.placement === 'modifier_upsell'
          ? await qualifyingStarterDecision(dependencies, loaded)
          : undefined;
      const context = await createRecommendationDecisionContext({
        parsed: {
          ...parsed,
          state: loaded.state,
          starterDecision,
        },
        historyRepository: dependencies.historyRepository,
        contextSource: dependencies.contextSource,
      });
      const decision = await dependencies.decisionEngine.decide(context);
      const nextState = applyDecision(
        loaded.state,
        decision.response,
        parsed.request.decisionTime,
      );
      const actionDigest = await digestCommerceAction(
        decision.response.primaryOffer?.actions ?? [],
      );
      const record: RecommendationDecisionRecord = {
        request: parsed.request,
        response: decision.response,
        technical: decision.technical,
        requestFingerprint,
        actionDigest,
        stateRevisionBefore: loaded.state.revision,
        stateRevisionAfter: nextState.revision,
        recordedAt,
      };
      const commit =
        await dependencies.persistence.commitRecommendationDecision({
          ownerToken,
          expectedPackStateDigest: loaded.expectedDigest,
          nextPackState: await nextEnvelope(dependencies, loaded, nextState),
          record,
          events: await decisionEvents({ record, recordedAt }),
        });
      if (commit.status === 'stale') return { status: 'state_conflict' };
      return {
        status: commit.status === 'committed' ? 'decided' : 'replay',
        response: commit.record.response,
      };
    },

    async recordImpression(
      recommendationId: string,
      input: RecommendationImpressionRequest,
    ): Promise<EventApplicationResult> {
      recommendationIdSchema.parse(recommendationId);
      const request = parseRecommendationImpressionRequest(input);
      const record =
        await dependencies.persistence.getRecommendationDecision(
          recommendationId,
        );
      if (!record) return { status: 'not_found' };
      if (
        record.response.status !== 'recommended' ||
        !record.response.primaryOffer
      ) {
        return { status: 'stale_recommendation' };
      }
      const existing = await existingEvent(
        dependencies,
        record,
        request.eventId,
      );
      const event = correlatedEventBase(record, {
        eventId: request.eventId,
        eventType: 'impression_rendered',
        occurredAt: request.occurredAt,
        recordedAt: existing?.recordedAt ?? dependencies.clock.now(),
        actor: 'client',
        actionId: null,
        cartRevision: request.cartRevision,
        payload: {
          assistantTurnId: request.assistantTurnId,
          attachmentId: request.attachmentId,
          renderedActions: request.renderedActions,
          actionDigest: request.actionDigest,
        },
      });
      const eventFingerprint = await digestCommerceAction(request);
      const loaded = await loadRecommendationPackState({
        persistence: dependencies.persistence,
        packState: dependencies.packState,
        sessionId: record.request.sessionId,
        orderFlowId: record.request.orderFlowId,
      });
      if (existing) {
        return mapAppendResult(
          await dependencies.persistence.appendRecommendationEvent({
            eventFingerprint,
            event,
            expectedPackStateDigest: loaded.expectedDigest!,
            nextPackState: loaded.envelope!,
          }),
        );
      }
      if (!isCurrentRecommendation(loaded, record)) {
        return { status: 'stale_recommendation' };
      }
      if (
        request.cartRevision !== record.request.cartRevision ||
        record.response.primaryOffer.actions.some(
          (action) => action.cartRevision !== request.cartRevision,
        )
      ) {
        return { status: 'cart_revision_conflict' };
      }
      const expectedRendered = record.response.primaryOffer.actions.map(
        (action, index) => ({ actionId: action.actionId, position: index + 1 }),
      );
      if (
        request.actionDigest !== record.actionDigest ||
        canonicalJson(request.renderedActions) !==
          canonicalJson(expectedRendered)
      ) {
        return { status: 'render_binding_conflict' };
      }
      const transitionEvent = parseRecommendationEvent({
        ...event,
        payload: {
          renderedActionIds: request.renderedActions.map(
            (rendered) => rendered.actionId,
          ),
        },
      });
      const nextState = stateWithCasRevision(
        loaded.state,
        applyRecommendationImpression(loaded.state, transitionEvent),
      );
      return mapAppendResult(
        await dependencies.persistence.appendRecommendationEvent({
          eventFingerprint,
          event,
          expectedPackStateDigest: loaded.expectedDigest!,
          nextPackState: await nextEnvelope(dependencies, loaded, nextState),
        }),
      );
    },

    async recordOutcome(
      recommendationId: string,
      input: RecommendationOutcomeRequest,
    ): Promise<EventApplicationResult> {
      recommendationIdSchema.parse(recommendationId);
      const request = parseRecommendationOutcomeRequest(input);
      const record =
        await dependencies.persistence.getRecommendationDecision(
          recommendationId,
        );
      if (!record) return { status: 'not_found' };
      if (
        record.response.status !== 'recommended' ||
        !record.response.primaryOffer
      ) {
        return { status: 'stale_recommendation' };
      }
      const existing = await existingEvent(
        dependencies,
        record,
        request.eventId,
      );
      const event = correlatedEventBase(record, {
        eventId: request.eventId,
        eventType: request.eventType,
        occurredAt: request.occurredAt,
        recordedAt: existing?.recordedAt ?? dependencies.clock.now(),
        actor: request.actor,
        actionId: request.actionId,
        cartRevision: request.cartRevision,
        payload: {},
      });
      const eventFingerprint = await digestCommerceAction(request);
      const loaded = await loadRecommendationPackState({
        persistence: dependencies.persistence,
        packState: dependencies.packState,
        sessionId: record.request.sessionId,
        orderFlowId: record.request.orderFlowId,
      });
      if (existing) {
        return mapAppendResult(
          await dependencies.persistence.appendRecommendationEvent({
            eventFingerprint,
            event,
            expectedPackStateDigest: loaded.expectedDigest!,
            nextPackState: loaded.envelope!,
          }),
        );
      }
      if (!isCurrentRecommendation(loaded, record)) {
        return { status: 'stale_recommendation' };
      }
      const actionIds = offeredActionIds(record);
      if (request.actionId !== null && !actionIds.includes(request.actionId)) {
        return { status: 'render_binding_conflict' };
      }
      if (
        !mutationOutcomeTypes.has(request.eventType) &&
        request.cartRevision !== null &&
        request.cartRevision !== record.request.cartRevision
      ) {
        return { status: 'cart_revision_conflict' };
      }
      let nextState: RecommendationState;
      try {
        nextState = stateWithCasRevision(
          loaded.state,
          applyRecommendationOutcome(loaded.state, event, actionIds),
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'recommendation_outcome_not_pending'
        ) {
          return { status: 'stale_recommendation' };
        }
        throw error;
      }
      return mapAppendResult(
        await dependencies.persistence.appendRecommendationEvent({
          eventFingerprint,
          event,
          expectedPackStateDigest: loaded.expectedDigest!,
          nextPackState: await nextEnvelope(dependencies, loaded, nextState),
        }),
      );
    },
  };
}

export function createBundledRecommendationApplicationService(
  dependencies: Omit<
    RecommendationApplicationServiceDependencies,
    'decisionEngine' | 'historyRepository' | 'packState'
  >,
): RecommendationApplicationService {
  return createRecommendationApplicationService({
    ...dependencies,
    decisionEngine: createBundledRecommendationDecisionEngine(),
    historyRepository: new StoredDemoCustomerHistoryRepository(
      dependencies.persistence,
    ),
    packState: kfcRecommendationPackStateDefinition,
  });
}
