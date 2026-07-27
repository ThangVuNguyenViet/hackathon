import { z } from 'zod';
import { digestCommerceAction } from '../../ordering/commerceDigest.js';
import { isKfcGenUiAttachment } from '../../genui/kfcGenUi.js';
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
import {
  compareCanonicalUtcInstants,
  strictlyLaterCanonicalUtcInstant,
} from '../domain/canonical-instant.js';
import type {
  AppendRecommendationEventInput,
  AppendRecommendationEventResult,
  CommitRecommendationDecisionResult,
  RecommendationDecisionRecord,
  ReserveRecommendationDecisionResult,
} from '../persistence/repository.js';
import { presentationBindingForDecision } from '../persistence/types.js';
import {
  applyCustomerRequestedRecommendationDecision,
  applyCustomerRequestedRecommendationOutcome,
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
} from './context-factory.js';
import type {
  EventApplicationResult,
  LoadedRecommendationPackState,
  RecommendationApplicationService,
  RecommendationApplicationServiceDependencies,
  RecommendationDecisionApplicationInput,
  RecommendationPresentation,
} from './service-types.js';
import type {
  RecommendationOutputMode,
  RecommendationShadowScorer,
} from '../shadow/contracts.js';
import type { MerchandisingPolicyRepository } from '../merchandising/repository.js';
import {
  runRecommendationTrace,
  type RecommendationTrace,
} from '../observability/recommendation-tracing.js';

const recommendationIdSchema = z.string().trim().min(1);
const mutationOutcomeTypes = new Set<RecommendationOutcomeRequest['eventType']>(
  ['cart_mutation_succeeded', 'cart_mutation_failed'],
);
const terminalOutcomeTypes = new Set<RecommendationOutcomeRequest['eventType']>(
  ['checkout_completed', 'order_abandoned', 'order_cancelled'],
);

function reservationReasonCode(
  result: ReserveRecommendationDecisionResult,
): string {
  return `decision_reserve_${result.status}`;
}

function commitReasonCode(result: CommitRecommendationDecisionResult): string {
  return `decision_commit_${result.status}`;
}

function appendReasonCode(result: AppendRecommendationEventResult): string {
  return `event_append_${result.status}`;
}

async function appendRecommendationEventTraced(input: {
  trace: RecommendationTrace;
  dependencies: RecommendationApplicationServiceDependencies;
  append: AppendRecommendationEventInput;
}): Promise<AppendRecommendationEventResult> {
  const { event, eventFingerprint } = input.append;
  return input.trace.span(
    {
      name: 'recommendation.persistence',
      inputs: {},
      metadata: {
        recommendation_id: event.recommendationId,
        request_id: event.requestId,
        event_id: event.eventId,
        event_digest: eventFingerprint,
      },
    },
    () =>
      input.dependencies.persistence.appendRecommendationEvent(input.append),
    (result) => ({
      eventCount: 1,
      reasonCodes: [appendReasonCode(result)],
    }),
  );
}
async function decisionEventId(
  requestId: string,
  eventType: 'decision_requested' | 'decision_completed',
): Promise<string> {
  const digest = await digestCommerceAction(`${requestId}:${eventType}`);
  return `recommendation-event:${digest.slice(0, 24)}`;
}

async function decisionEvents(input: {
  record: RecommendationDecisionRecord;
  requestedAt: string;
  completedAt: string;
}): Promise<[RecommendationEvent, RecommendationEvent]> {
  const { record, requestedAt, completedAt } = input;
  const shared = {
    schemaVersion: 'kfc-recommendation-event-v1' as const,
    requestId: record.request.requestId,
    orderFlowId: record.request.orderFlowId,
    sessionId: record.request.sessionId,
    placement: record.request.placement,
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
      occurredAt: requestedAt,
      recordedAt: requestedAt,
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
      occurredAt: completedAt,
      recordedAt: completedAt,
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

function maximumPersistedEventInstant(
  events: readonly RecommendationEvent[],
): string | undefined {
  let maximum: string | undefined;
  for (const event of events) {
    const instant = event.recordedAt;
    if (maximum === undefined) {
      maximum = instant;
      continue;
    }
    const comparison = compareCanonicalUtcInstants(instant, maximum);
    if (comparison === null) {
      throw new Error('canonical_utc_instant_invalid');
    }
    if (comparison > 0) maximum = instant;
  }
  return maximum;
}

function decisionRequestInstant(
  currentClockInstant: string,
  persistedEvents: readonly RecommendationEvent[],
): string {
  const durableMaximum = maximumPersistedEventInstant(persistedEvents);
  return durableMaximum === undefined
    ? currentClockInstant
    : strictlyLaterCanonicalUtcInstant(currentClockInstant, durableMaximum);
}

function applyDecision(
  state: RecommendationState,
  response: RecommendationDecisionResponse,
  decisionTime: string,
  requestKind: 'proactive' | 'customer_requested',
): RecommendationState {
  if (requestKind === 'customer_requested' && state.stage === 'complete') {
    return applyCustomerRequestedRecommendationDecision(state, response);
  }
  return applyRecommendationDecision(state, response, decisionTime);
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

function pendingMatchesRecommendation(
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

async function isCurrentRecommendation(
  dependencies: RecommendationApplicationServiceDependencies,
  loaded: LoadedRecommendationPackState,
  record: RecommendationDecisionRecord,
): Promise<'proactive' | 'customer_requested' | null> {
  if (pendingMatchesRecommendation(loaded, record)) return 'proactive';
  if (
    loaded.state.stage !== 'complete' ||
    loaded.state.pendingRecommendation !== null ||
    record.stateRevisionAfter > loaded.state.revision
  ) {
    return null;
  }
  const latest =
    await dependencies.persistence.latestRecommendationDecisionForOrderFlow(
      record.request.orderFlowId,
    );
  if (
    !latest ||
    latest.response.recommendationId !== record.response.recommendationId
  ) {
    return null;
  }
  const events = await dependencies.persistence.listRecommendationEvents({
    recommendationId: record.response.recommendationId,
  });
  return events.some((event) =>
    terminalOutcomeTypes.has(
      event.eventType as RecommendationOutcomeRequest['eventType'],
    ),
  )
    ? null
    : 'customer_requested';
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

async function hasExactPresentationDigests(
  record: RecommendationDecisionRecord,
): Promise<boolean> {
  const [actionDigest, decisionDigest, versionBindingDigest] =
    await Promise.all([
      digestCommerceAction(record.response.primaryOffer?.actions ?? []),
      digestCommerceAction(record.response),
      digestCommerceAction(record.response.versionBindings),
    ]);
  return (
    record.actionDigest === actionDigest &&
    record.renderBinding.actionDigest === actionDigest &&
    record.renderBinding.decisionDigest === decisionDigest &&
    record.renderBinding.versionBindingDigest === versionBindingDigest
  );
}

function presentationFromRecord(
  record: RecommendationDecisionRecord,
  customerId: string,
): RecommendationPresentation {
  return {
    response: structuredClone(record.response),
    binding: {
      recommendationId: record.renderBinding.recommendationId,
      assistantTurnId: record.renderBinding.assistantTurnId,
      attachmentId: record.renderBinding.attachmentId,
      renderedActions: structuredClone(record.renderBinding.renderedActions),
      actionDigest: record.renderBinding.actionDigest,
      decisionDigest: record.renderBinding.decisionDigest,
      versionBindingDigest: record.renderBinding.versionBindingDigest,
      sessionId: record.renderBinding.sessionId,
      customerId,
      cartRevision: record.renderBinding.cartRevision,
    },
  };
}

async function hasCommittedRecommendationPublication(
  dependencies: RecommendationApplicationServiceDependencies,
  record: RecommendationDecisionRecord,
): Promise<boolean> {
  const customerId = record.renderBinding.customerId;
  if (!customerId) return false;
  const turn = (
    await dependencies.persistence.listTurns(record.request.sessionId)
  ).find((candidate) => candidate.id === record.renderBinding.assistantTurnId);
  const attachment = turn?.metadata?.genUi;
  if (
    !turn ||
    turn.role !== 'assistant' ||
    turn.deliveryStatus !== 'sent' ||
    turn.externalUserId !== customerId ||
    !isKfcGenUiAttachment(attachment) ||
    attachment.widgetKind !== 'recommendationOffer' ||
    attachment.id !== record.renderBinding.attachmentId ||
    attachment.authority?.sessionId !== record.request.sessionId ||
    attachment.authority.customerId !== customerId ||
    attachment.authority.actionLifecycle !== 'one_shot' ||
    attachment.data.recommendationId !== record.response.recommendationId ||
    attachment.data.cartRevision !== record.renderBinding.cartRevision ||
    attachment.data.actionDigest !== record.renderBinding.actionDigest ||
    attachment.data.decisionDigest !== record.renderBinding.decisionDigest ||
    attachment.data.versionBindingDigest !==
      record.renderBinding.versionBindingDigest
  ) {
    return false;
  }
  const publishedActionIds = (
    Array.isArray(attachment.data.offers) ? attachment.data.offers : []
  ).flatMap((offer) =>
    typeof offer === 'object' &&
    offer !== null &&
    typeof (offer as Record<string, unknown>).recommendationActionId ===
      'string'
      ? [(offer as Record<string, string>).recommendationActionId]
      : [],
  );
  return (
    canonicalJson(publishedActionIds) ===
      canonicalJson(
        record.renderBinding.renderedActions.map((action) => action.actionId),
      ) &&
    record.renderBinding.renderedActions.every((rendered) =>
      attachment.actions.some(
        (action) => action.id === `recommendation_select:${rendered.actionId}`,
      ),
    )
  );
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
    async hasPriorCompletedHistory(verifiedCustomerRef: string) {
      const history =
        await dependencies.historyRepository.load(verifiedCustomerRef);
      return Boolean(
        history?.linked &&
        history.verifiedCustomerRef === verifiedCustomerRef &&
        history.completedOrders.length > 0,
      );
    },

    async decide(input: RecommendationDecisionApplicationInput) {
      const parsed = parseRecommendationDecisionApplicationInput(input);
      return runRecommendationTrace({
        tracer: dependencies.agentTracer,
        name: 'recommendation.decide',
        inputs: {},
        metadata: {
          order_flow_id: parsed.request.orderFlowId,
          request_id: parsed.request.requestId,
          policy_id: parsed.request.eligibilityPolicyVersion,
          experiment_id: parsed.request.experimentProfile.profileId,
        },
        run: async (trace) => {
          const requestFingerprint = await digestCommerceAction(parsed);
          const reservationCreatedAt = dependencies.clock.now();
          const ownerDigest = await digestCommerceAction(
            `${parsed.request.requestId}:${requestFingerprint}`,
          );
          const ownerToken = `recommendation-owner:${ownerDigest.slice(0, 24)}`;
          const reservation = await trace.span(
            {
              name: 'recommendation.persistence',
              inputs: {},
              metadata: {
                request_id: parsed.request.requestId,
                request_digest: requestFingerprint,
              },
            },
            () =>
              dependencies.persistence.reserveRecommendationDecision({
                sessionId: parsed.request.sessionId,
                idempotencyKey: parsed.request.idempotencyKey,
                requestId: parsed.request.requestId,
                requestFingerprint,
                ownerToken,
                createdAt: reservationCreatedAt,
              }),
            (result) => ({
              reasonCodes: [reservationReasonCode(result)],
            }),
          );
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
          const requestedAt = decisionRequestInstant(
            dependencies.clock.now(),
            await dependencies.persistence.listRecommendationEvents({
              sessionId: parsed.request.sessionId,
            }),
          );
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
          const decision = await dependencies.decisionEngine.decide(
            context,
            trace,
          );
          const completedAt = strictlyLaterCanonicalUtcInstant(
            dependencies.clock.now(),
            requestedAt,
          );
          let nextState: RecommendationState;
          try {
            nextState = applyDecision(
              loaded.state,
              decision.response,
              parsed.request.decisionTime,
              parsed.requestKind,
            );
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === 'recommendation_decision_not_eligible'
            ) {
              return { status: 'state_conflict' };
            }
            throw error;
          }
          const actionDigest = await digestCommerceAction(
            decision.response.primaryOffer?.actions ?? [],
          );
          const decisionDigest = await digestCommerceAction(decision.response);
          const versionBindingDigest = await digestCommerceAction(
            decision.response.versionBindings,
          );
          const record: RecommendationDecisionRecord = {
            request: parsed.request,
            response: decision.response,
            technical: decision.technical,
            requestFingerprint,
            actionDigest,
            renderBinding: presentationBindingForDecision({
              request: parsed.request,
              response: decision.response,
              requestFingerprint,
              actionDigest,
              decisionDigest,
              versionBindingDigest,
              customerId: parsed.trusted.presentationCustomerId ?? null,
            }),
            stateRevisionBefore: loaded.state.revision,
            stateRevisionAfter: nextState.revision,
            recordedAt: completedAt,
          };
          const commit = await trace.span(
            {
              name: 'recommendation.persistence',
              inputs: {},
              metadata: {
                request_id: parsed.request.requestId,
                recommendation_id: decision.response.recommendationId,
                trace_ref: decision.response.traceRef,
                request_digest: requestFingerprint,
                action_digest: actionDigest,
                decision_digest: decisionDigest,
                version_binding_digest: versionBindingDigest,
              },
            },
            async () =>
              dependencies.persistence.commitRecommendationDecision({
                ownerToken,
                expectedPackStateDigest: loaded.expectedDigest,
                nextPackState: await nextEnvelope(
                  dependencies,
                  loaded,
                  nextState,
                ),
                record,
                events: await decisionEvents({
                  record,
                  requestedAt,
                  completedAt,
                }),
              }),
            (result) => ({
              eventCount: 2,
              reasonCodes: [commitReasonCode(result)],
            }),
          );
          if (commit.status === 'stale') return { status: 'state_conflict' };
          return {
            status: commit.status === 'committed' ? 'decided' : 'replay',
            response: commit.record.response,
          };
        },
        summarize: (result) => ({
          ...(result.status === 'decided' || result.status === 'replay'
            ? {
                potentialCount: result.response.counts.potential,
                eligibleCount: result.response.counts.eligible,
                ineligibleCount: result.response.counts.ineligible,
                scoredCount: result.response.counts.scored,
                displayedCount: result.response.counts.displayed,
                reasonCodes: result.response.reasonCodes,
              }
            : {}),
        }),
      });
    },

    async presentationFor(recommendationId, principal) {
      const normalizedRecommendationId =
        recommendationIdSchema.parse(recommendationId);
      const record = await dependencies.persistence.getRecommendationDecision(
        normalizedRecommendationId,
      );
      if (
        !record ||
        record.response.status !== 'recommended' ||
        !record.response.primaryOffer ||
        record.renderBinding.sessionId !== principal.sessionId ||
        record.renderBinding.customerId !== principal.customerId ||
        !(await hasExactPresentationDigests(record))
      ) {
        return null;
      }
      return presentationFromRecord(record, principal.customerId);
    },

    async resolveTrustedAction(input) {
      const normalizedRecommendationId = recommendationIdSchema.parse(
        input.recommendationId,
      );
      const record = await dependencies.persistence.getRecommendationDecision(
        normalizedRecommendationId,
      );
      if (
        !record ||
        record.response.status !== 'recommended' ||
        !record.response.primaryOffer
      ) {
        return { status: 'not_found' };
      }
      if (
        record.renderBinding.sessionId !== input.sessionId ||
        record.renderBinding.customerId !== input.customerId ||
        !(await hasExactPresentationDigests(record))
      ) {
        return { status: 'untrusted_principal' };
      }
      if (
        record.request.cartRevision !== input.cartRevision ||
        record.renderBinding.cartRevision !== input.cartRevision
      ) {
        return { status: 'cart_revision_conflict' };
      }
      const action = record.response.primaryOffer.actions.find(
        (candidate) =>
          candidate.actionId === input.recommendationActionId &&
          candidate.cartRevision === input.cartRevision,
      );
      if (!action) return { status: 'action_not_found' };
      const loaded = await loadRecommendationPackState({
        persistence: dependencies.persistence,
        packState: dependencies.packState,
        sessionId: record.request.sessionId,
        orderFlowId: record.request.orderFlowId,
      });
      if (!(await isCurrentRecommendation(dependencies, loaded, record))) {
        return { status: 'stale_recommendation' };
      }
      return {
        status: 'resolved',
        action: structuredClone(action),
        presentation: presentationFromRecord(record, input.customerId),
      };
    },

    async recordImpression(
      recommendationId: string,
      input: RecommendationImpressionRequest,
    ): Promise<EventApplicationResult> {
      const normalizedRecommendationId =
        recommendationIdSchema.parse(recommendationId);
      const request = parseRecommendationImpressionRequest(input);
      return runRecommendationTrace({
        tracer: dependencies.agentTracer,
        name: 'recommendation.impression',
        inputs: {},
        metadata: {
          recommendation_id: normalizedRecommendationId,
          event_id: request.eventId,
          action_digest: request.actionDigest,
        },
        run: async (trace) => {
          const record =
            await dependencies.persistence.getRecommendationDecision(
              normalizedRecommendationId,
            );
          if (!record) return { status: 'not_found' };
          if (
            record.response.status !== 'recommended' ||
            !record.response.primaryOffer
          ) {
            return { status: 'stale_recommendation' };
          }
          const recommendationEvents =
            await dependencies.persistence.listRecommendationEvents({
              recommendationId: record.response.recommendationId,
            });
          const existing = recommendationEvents.find(
            (candidate) => candidate.eventId === request.eventId,
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
          if (
            !(await hasCommittedRecommendationPublication(dependencies, record))
          ) {
            return { status: 'render_binding_conflict' };
          }
          if (existing) {
            return mapAppendResult(
              await appendRecommendationEventTraced({
                trace,
                dependencies,
                append: {
                  eventFingerprint,
                  event,
                  expectedPackStateDigest: loaded.expectedDigest!,
                  nextPackState: loaded.envelope!,
                },
              }),
            );
          }
          const existingImpression = recommendationEvents.find(
            (candidate) => candidate.eventType === 'impression_rendered',
          );
          if (existingImpression) {
            const existingBinding = {
              assistantTurnId: existingImpression.payload.assistantTurnId,
              attachmentId: existingImpression.payload.attachmentId,
              renderedActions: existingImpression.payload.renderedActions,
              actionDigest: existingImpression.payload.actionDigest,
              cartRevision: existingImpression.cartRevision,
            };
            const requestedBinding = {
              assistantTurnId: request.assistantTurnId,
              attachmentId: request.attachmentId,
              renderedActions: request.renderedActions,
              actionDigest: request.actionDigest,
              cartRevision: request.cartRevision,
            };
            return canonicalJson(existingBinding) ===
              canonicalJson(requestedBinding)
              ? { status: 'replay', event: existingImpression }
              : { status: 'render_binding_conflict' };
          }
          if (!(await isCurrentRecommendation(dependencies, loaded, record))) {
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
            (action, index) => ({
              actionId: action.actionId,
              position: index + 1,
            }),
          );
          if (
            request.actionDigest !== record.actionDigest ||
            request.assistantTurnId !== record.renderBinding.assistantTurnId ||
            request.attachmentId !== record.renderBinding.attachmentId ||
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
          const nextState = applyRecommendationImpression(
            loaded.state,
            transitionEvent,
          );
          return mapAppendResult(
            await appendRecommendationEventTraced({
              trace,
              dependencies,
              append: {
                eventFingerprint,
                event,
                expectedPackStateDigest: loaded.expectedDigest!,
                nextPackState: await nextEnvelope(
                  dependencies,
                  loaded,
                  nextState,
                ),
              },
            }),
          );
        },
        summarize: (result) => ({
          eventCount:
            result.status === 'recorded' || result.status === 'replay' ? 1 : 0,
        }),
      });
    },

    async recordOutcome(
      recommendationId: string,
      input: RecommendationOutcomeRequest,
    ): Promise<EventApplicationResult> {
      const normalizedRecommendationId =
        recommendationIdSchema.parse(recommendationId);
      const request = parseRecommendationOutcomeRequest(input);
      return runRecommendationTrace({
        tracer: dependencies.agentTracer,
        name: 'recommendation.outcome',
        inputs: {},
        metadata: {
          recommendation_id: normalizedRecommendationId,
          event_id: request.eventId,
        },
        run: async (trace) => {
          const record =
            await dependencies.persistence.getRecommendationDecision(
              normalizedRecommendationId,
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
              await appendRecommendationEventTraced({
                trace,
                dependencies,
                append: {
                  eventFingerprint,
                  event,
                  expectedPackStateDigest: loaded.expectedDigest!,
                  nextPackState: loaded.envelope!,
                },
              }),
            );
          }
          const currentRecommendation = await isCurrentRecommendation(
            dependencies,
            loaded,
            record,
          );
          if (!currentRecommendation) {
            return { status: 'stale_recommendation' };
          }
          const actionIds = offeredActionIds(record);
          if (
            request.actionId !== null &&
            !actionIds.includes(request.actionId)
          ) {
            return { status: 'render_binding_conflict' };
          }
          if (request.cartRevision === null) {
            if (!terminalOutcomeTypes.has(request.eventType)) {
              return { status: 'cart_revision_conflict' };
            }
          } else if (
            !mutationOutcomeTypes.has(request.eventType) &&
            request.cartRevision !== record.request.cartRevision
          ) {
            return { status: 'cart_revision_conflict' };
          }
          let nextState: RecommendationState;
          try {
            nextState =
              currentRecommendation === 'customer_requested'
                ? applyCustomerRequestedRecommendationOutcome(
                    loaded.state,
                    event,
                    actionIds,
                  )
                : applyRecommendationOutcome(loaded.state, event, actionIds);
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
            await appendRecommendationEventTraced({
              trace,
              dependencies,
              append: {
                eventFingerprint,
                event,
                expectedPackStateDigest: loaded.expectedDigest!,
                nextPackState: await nextEnvelope(
                  dependencies,
                  loaded,
                  nextState,
                ),
              },
            }),
          );
        },
        summarize: (result) => ({
          eventCount:
            result.status === 'recorded' || result.status === 'replay' ? 1 : 0,
        }),
      });
    },
  };
}

export function createBundledRecommendationApplicationService(
  dependencies: Omit<
    RecommendationApplicationServiceDependencies,
    'decisionEngine' | 'historyRepository' | 'packState'
  > & {
    merchandisingPolicyRepository: MerchandisingPolicyRepository;
    shadowScorer?: RecommendationShadowScorer;
    shadowOutputMode?: RecommendationOutputMode;
  },
): RecommendationApplicationService {
  return createRecommendationApplicationService({
    ...dependencies,
    decisionEngine: createBundledRecommendationDecisionEngine({
      merchandisingPolicyRepository: dependencies.merchandisingPolicyRepository,
      shadowScorer: dependencies.shadowScorer,
      shadowOutputMode: dependencies.shadowOutputMode,
    }),
    historyRepository: new StoredDemoCustomerHistoryRepository(
      dependencies.persistence,
    ),
    packState: kfcRecommendationPackStateDefinition,
  });
}
