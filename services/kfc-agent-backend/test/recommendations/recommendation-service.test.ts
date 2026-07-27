import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { kfcRecommendationPackStateDefinition } from '../../src/recommendations/application/context-factory.js';
import { createRecommendationInspectionService } from '../../src/recommendations/application/inspection-service.js';
import {
  createBundledRecommendationApplicationService,
  createRecommendationApplicationService,
} from '../../src/recommendations/application/recommendation-service.js';
import type {
  RecommendationApplicationServiceDependencies,
  RecommendationClock,
  RecommendationServerContextSource,
} from '../../src/recommendations/application/service-types.js';
import type {
  RecommendationDecisionEngine,
  RecommendationDecisionResult,
} from '../../src/recommendations/application/types.js';
import type {
  Placement,
  RecommendationDecisionRequest,
  RecommendationDecisionResponse,
  RecommendationOutcomeRequest,
} from '../../src/recommendations/domain/contracts.js';
import {
  parseRecommendationDecisionRequest,
  parseRecommendationDecisionResponse,
  parseRecommendationImpressionRequest,
  parseRecommendationOutcomeRequest,
  parseRecommendationState,
} from '../../src/recommendations/domain/schemas.js';
import type { RecommendationDecisionContext } from '../../src/recommendations/eligibility/types.js';
import { StoredDemoCustomerHistoryRepository } from '../../src/recommendations/history/stored-demo-history-repository.js';
import type {
  AppendRecommendationEventInput,
  AppendRecommendationEventResult,
  CommitRecommendationDecisionInput,
  CommitRecommendationDecisionResult,
} from '../../src/recommendations/persistence/repository.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createPackStateEnvelope } from '../../src/runtime/businessPack.js';
import { initialRecommendationState } from '../../src/recommendations/state/state-machine.js';

const serverInstant = '2026-07-27T09:30:00Z';

const fixedClock: RecommendationClock = {
  now: () => serverInstant,
};

const serverContextSource: RecommendationServerContextSource = {
  load: async () => ({
    storeTimezone: 'Asia/Ho_Chi_Minh',
  }),
};

function snapshotBinding(name: string) {
  return {
    snapshotId: `${name}-application-001`,
    digest: name.at(0)!.repeat(64),
    sourceRevision: `${name}-revision-001`,
    observedAt: '2026-07-27T08:00:00Z',
    effectiveAt: '2026-07-27T08:00:00Z',
    expiresAt: '2026-07-27T10:00:00Z',
    complete: true,
    commerceEnvironment: 'kfc-vietnam-demo',
    provenance: { source: 'test', reference: name },
  };
}

function requestFor(input: {
  suffix: string;
  placement: Placement;
  verifiedCustomerRef?: string | null;
  cartRevision?: string;
  lines?: RecommendationDecisionRequest['cart']['lines'];
}): RecommendationDecisionRequest {
  const cartRevision = input.cartRevision ?? `cart-revision-${input.suffix}`;
  const lines = input.lines ?? [];
  return parseRecommendationDecisionRequest({
    schemaVersion: 'kfc-recommendation-v1',
    requestId: `rec-request-${input.suffix}`,
    idempotencyKey: `rec-idempotency-${input.suffix}`,
    orderFlowId: `order-flow-${input.suffix.split('-')[0]}`,
    sessionId: `session-${input.suffix.split('-')[0]}`,
    placement: input.placement,
    verifiedCustomerRef: input.verifiedCustomerRef ?? null,
    storeId: 'KFCVN0002',
    fulfilmentMode: 'pickup',
    decisionTime: '2026-07-27T09:00:00Z',
    cart: {
      cartId: `cart-${input.suffix.split('-')[0]}`,
      revision: cartRevision,
      subtotal: {
        amount: lines.reduce(
          (total, line) => total + line.unitPrice.amount * line.quantity,
          0,
        ),
        currency: 'VND',
      },
      lines,
    },
    cartRevision,
    commerceSnapshotBindings: {
      catalog: snapshotBinding('a-catalog'),
      modifierGraph: snapshotBinding('b-modifier'),
      store: snapshotBinding('c-store'),
      availability: snapshotBinding('d-availability'),
      promotion: snapshotBinding('e-promotion'),
    },
    eligibilityPolicyVersion: 'kfc-recommendation-policy-v1',
    experimentProfile: {
      profileId: 'experiment-application-001',
      outputMode: 'baseline',
    },
  });
}

function technical(): RecommendationDecisionResult['technical'] {
  return {
    potentialCandidates: [],
    eligibilityDecisions: [],
    eligiblePrePolicyRanking: [],
    merchandisingResolution: {
      suppressed: false,
      replacement: null,
      rankedCandidates: [],
      effects: [],
      reasonCodes: [],
    },
    emptyReason: null,
  };
}

const versionBindings = {
  catalog: 'catalog-application-001',
  modifierGraph: 'modifier-application-001',
  store: 'store-application-001',
  availability: 'availability-application-001',
  promotion: 'promotion-application-001',
  eligibilityPolicy: 'kfc-recommendation-policy-v1',
  sanitySnapshot: {
    snapshotId: 'sanity-application-001',
    digest: 'f'.repeat(64),
    contributingRevisions: ['sanity-revision-001'],
  },
  featureSchema: 'feature-application-001',
  servingRanker: 'ranker-application-001',
  shadowModel: null,
  calibration: null,
  experiment: 'experiment-application-001',
  loggingPolicy: 'logging-application-001',
};

function responseFor(
  context: RecommendationDecisionContext,
): RecommendationDecisionResponse {
  const { request } = context;
  const actionIds =
    request.placement === 'smart_cross_sell'
      ? ['product:smart-001', 'product:smart-002', 'product:smart-003']
      : request.placement === 'modifier_upsell'
        ? [`modifier:${context.parentCartLineId}:group:option`]
        : ['product:20752'];
  const actions = actionIds.map((actionId, index) =>
    request.placement === 'modifier_upsell'
      ? {
          type: 'apply_modifier' as const,
          actionId,
          parentCartLineId: context.parentCartLineId!,
          parentSellableItemId: '20752',
          optionId: '41091',
          groupPath: ['group'],
          quantity: 1,
          priceImpact: { amount: 7_000, currency: 'VND' as const },
          cartRevision: request.cartRevision,
        }
      : {
          type: 'add_product' as const,
          actionId,
          sellableItemId:
            request.placement === 'smart_cross_sell'
              ? `smart-item-${index + 1}`
              : '20752',
          quantity: 1,
          priceImpact: { amount: 50_000, currency: 'VND' as const },
          cartRevision: request.cartRevision,
        },
  );
  return parseRecommendationDecisionResponse({
    schemaVersion: 'kfc-recommendation-v1',
    recommendationId: `recommendation:${request.requestId}`,
    requestId: request.requestId,
    orderFlowId: request.orderFlowId,
    placement: request.placement,
    status: 'recommended',
    decisionSource: 'ranked',
    primaryOffer: { actions },
    displayFacts: actions.map((action) => ({
      actionId: action.actionId,
      name: action.actionId,
      imageUrl: null,
      priceImpact: action.priceImpact,
    })),
    reasonCodes: [],
    merchandisingEffects: [],
    versionBindings,
    counts: {
      potential: actions.length,
      eligible: actions.length,
      ineligible: 0,
      scored: actions.length,
      displayed: actions.length,
      complete: true,
    },
    traceRef: `trace:${request.requestId}`,
  });
}

class RecordingEngine implements RecommendationDecisionEngine {
  readonly contexts: RecommendationDecisionContext[] = [];

  async decide(
    context: RecommendationDecisionContext,
  ): Promise<RecommendationDecisionResult> {
    this.contexts.push(structuredClone(context));
    return { response: responseFor(context), technical: technical() };
  }
}

function dependencies(
  store: MemoryStore,
  decisionEngine: RecommendationDecisionEngine,
  overrides: Partial<RecommendationApplicationServiceDependencies> = {},
): RecommendationApplicationServiceDependencies {
  return {
    decisionEngine,
    persistence: store,
    historyRepository: new StoredDemoCustomerHistoryRepository(store),
    contextSource: serverContextSource,
    packState: kfcRecommendationPackStateDefinition,
    clock: fixedClock,
    ...overrides,
  };
}

async function application(
  decisionEngine: RecommendationDecisionEngine = new RecordingEngine(),
  store = new MemoryStore(),
) {
  const service = createRecommendationApplicationService(
    dependencies(store, decisionEngine),
  );
  const inspection = createRecommendationInspectionService({
    persistence: store,
    packState: kfcRecommendationPackStateDefinition,
  });
  return { service, inspection, store };
}

async function bundledApplication(store = new MemoryStore()) {
  const service = createBundledRecommendationApplicationService({
    persistence: store,
    contextSource: serverContextSource,
    clock: fixedClock,
  });
  const inspection = createRecommendationInspectionService({
    persistence: store,
    packState: kfcRecommendationPackStateDefinition,
  });
  return { service, inspection, store };
}

function outcomeFor(input: {
  eventId: string;
  eventType: RecommendationOutcomeRequest['eventType'];
  actionId: string | null;
  cartRevision: string | null;
  payload?: Record<string, string>;
}): RecommendationOutcomeRequest {
  return parseRecommendationOutcomeRequest({
    schemaVersion: 'kfc-recommendation-event-v1',
    occurredAt: '2026-07-27T09:10:00Z',
    actor: 'customer',
    payload: input.payload ?? {},
    ...input,
  });
}

async function smartFlowFixture(input: { interveningDecision?: boolean } = {}) {
  const engine = new RecordingEngine();
  const { service, inspection } = await application(engine);
  const starterRequest = requestFor({
    suffix: 'flow-starter',
    placement: 'local_favorite',
    cartRevision: 'cart-revision-empty',
  });
  const starter = await service.decide({ request: starterRequest });
  if (starter.status !== 'decided') throw new Error('starter expected');
  await service.recordOutcome(
    starter.response.recommendationId,
    outcomeFor({
      eventId: 'recommendation-event-starter-mutation',
      eventType: 'cart_mutation_succeeded',
      actionId: starter.response.primaryOffer!.actions[0]!.actionId,
      cartRevision: 'cart-revision-with-starter',
      payload: { customerMessage: 'never persist this prose' },
    }),
  );
  const lines = parseRecommendationDecisionRequest({
    ...starterRequest,
    cartRevision: 'cart-revision-with-starter',
    cart: {
      ...starterRequest.cart,
      revision: 'cart-revision-with-starter',
      subtotal: { amount: 129_000, currency: 'VND' },
      lines: [
        {
          lineId: 'line-20752',
          sellableItemId: '20752',
          quantity: 1,
          unitPrice: { amount: 129_000, currency: 'VND' },
          modifiers: [],
        },
      ],
    },
  }).cart.lines;
  if (input.interveningDecision) {
    await service.decide({
      request: requestFor({
        suffix: 'flow-z-intervening',
        placement: 'local_favorite',
        cartRevision: 'cart-revision-with-starter',
        lines,
      }),
      requestKind: 'customer_requested',
    });
  }
  const modifierRequest = requestFor({
    suffix: 'flow-modifier',
    placement: 'modifier_upsell',
    cartRevision: 'cart-revision-with-starter',
    lines,
  });
  const modifier = await service.decide({ request: modifierRequest });
  if (modifier.status !== 'decided') throw new Error('modifier expected');
  await service.recordOutcome(
    modifier.response.recommendationId,
    outcomeFor({
      eventId: 'recommendation-event-modifier-dismissed',
      eventType: 'explicitly_dismissed',
      actionId: null,
      cartRevision: modifierRequest.cartRevision,
    }),
  );
  const smartRequest = requestFor({
    suffix: 'flow-smart',
    placement: 'smart_cross_sell',
    cartRevision: modifierRequest.cartRevision,
    lines,
  });
  const smart = await service.decide({
    request: smartRequest,
    trusted: { remainingBudgetVnd: 150_000 },
  });
  if (smart.status !== 'decided') throw new Error('smart expected');
  return {
    engine,
    service,
    inspection,
    starterRequest,
    smartRequest,
    smart,
  };
}

async function localEventFixture(suffix: string) {
  const { service, inspection } = await application();
  const request = requestFor({ suffix, placement: 'local_favorite' });
  const decision = await service.decide({ request });
  if (decision.status !== 'decided') throw new Error('decision expected');
  const projection = await inspection.recommendation(
    decision.response.recommendationId,
  );
  const renderedActions = decision.response.primaryOffer!.actions.map(
    (action, index) => ({
      actionId: action.actionId,
      position: index + 1,
    }),
  );
  const impression = parseRecommendationImpressionRequest({
    schemaVersion: 'kfc-recommendation-event-v1',
    eventId: `recommendation-event-${suffix}-impression`,
    occurredAt: '2026-07-27T09:10:00Z',
    assistantTurnId: `assistant-turn-${suffix}`,
    attachmentId: `attachment-${suffix}`,
    renderedActions,
    cartRevision: request.cartRevision,
    actionDigest: projection!.recommendation.actionDigest,
  });
  return {
    service,
    inspection,
    request,
    decision,
    renderedActions,
    impression,
  };
}

describe('Recommendation application service', () => {
  it('serves a real anonymous Local Favorite and persists exact server-authored decision events', async () => {
    const { service, inspection } = await bundledApplication();
    const request = requestFor({
      suffix: 'anonymous-local',
      placement: 'local_favorite',
    });

    const result = await service.decide({ request });

    expect(result).toMatchObject({
      status: 'decided',
      response: {
        requestId: request.requestId,
        placement: 'local_favorite',
        status: 'recommended',
        primaryOffer: { actions: [{ actionId: 'product:20732' }] },
      },
    });
    if (result.status !== 'decided') throw new Error('decision expected');
    expect(Object.keys(result)).toEqual(['status', 'response']);

    const projection = await inspection.recommendation(
      result.response.recommendationId,
    );
    const requested = projection!.events.find(
      (event) => event.eventType === 'decision_requested',
    )!;
    const completed = projection!.events.find(
      (event) => event.eventType === 'decision_completed',
    )!;
    expect(requested).toMatchObject({
      recommendationId: null,
      cartRevision: request.cartRevision,
      occurredAt: serverInstant,
      recordedAt: serverInstant,
      versionBindings: result.response.versionBindings,
      payload: {
        requestFingerprint: projection!.recommendation.requestFingerprint,
        cartRevision: request.cartRevision,
      },
    });
    expect(Object.keys(requested.payload).sort()).toEqual([
      'cartRevision',
      'requestFingerprint',
    ]);
    expect(completed).toMatchObject({
      recommendationId: result.response.recommendationId,
      occurredAt: serverInstant,
      recordedAt: serverInstant,
      payload: {
        status: result.response.status,
        source: result.response.decisionSource,
        counts: result.response.counts,
        actionDigest: projection!.recommendation.actionDigest,
        traceRef: result.response.traceRef,
      },
    });
    expect(Object.keys(completed.payload).sort()).toEqual([
      'actionDigest',
      'counts',
      'source',
      'status',
      'traceRef',
    ]);
    expect(requested.eventId).toMatch(/^recommendation-event:[a-f0-9]{24}$/u);
    expect(completed.eventId).toMatch(/^recommendation-event:[a-f0-9]{24}$/u);
    expect(requested.eventId).not.toBe(completed.eventId);
    const expectedEventId = (eventType: string) =>
      `recommendation-event:${createHash('sha256')
        .update(JSON.stringify(`${request.requestId}:${eventType}`))
        .digest('hex')
        .slice(0, 24)}`;
    expect(requested.eventId).toBe(expectedEventId('decision_requested'));
    expect(completed.eventId).toBe(expectedEventId('decision_completed'));
    expect(requested.recordedAt).not.toBe(request.decisionTime);
  });

  it('loads only linked synthetic history for a real returning For You decision', async () => {
    const { service } = await bundledApplication();
    const linked = requestFor({
      suffix: 'returning-linked',
      placement: 'for_you',
      verifiedCustomerRef: 'demo-returning-linked',
    });

    await expect(service.decide({ request: linked })).resolves.toMatchObject({
      status: 'decided',
      response: {
        placement: 'for_you',
        status: 'recommended',
        primaryOffer: { actions: [{ actionId: 'product:20751' }] },
      },
    });
  });

  it('infers the Modifier parent from the successful starter action and new cart line', async () => {
    const { engine } = await smartFlowFixture({ interveningDecision: true });
    const modifierContext = engine.contexts.find(
      (context) => context.request.placement === 'modifier_upsell',
    );

    expect(modifierContext?.parentCartLineId).toBe('line-20752');
  });

  it('records the Smart slate and completes the proactive flow', async () => {
    const { service, inspection, starterRequest, smartRequest, smart } =
      await smartFlowFixture();
    const smartProjection = await inspection.recommendation(
      smart.response.recommendationId,
    );
    const smartActions = smart.response.primaryOffer!.actions;
    await expect(
      service.recordImpression(
        smart.response.recommendationId,
        parseRecommendationImpressionRequest({
          schemaVersion: 'kfc-recommendation-event-v1',
          eventId: 'recommendation-event-smart-impression-flow',
          occurredAt: '2026-07-27T09:09:00Z',
          assistantTurnId: 'assistant-turn-smart-flow',
          attachmentId: 'attachment-smart-flow',
          renderedActions: smartActions.map((action, index) => ({
            actionId: action.actionId,
            position: index + 1,
          })),
          cartRevision: smartRequest.cartRevision,
          actionDigest: smartProjection!.recommendation.actionDigest,
        }),
      ),
    ).resolves.toMatchObject({ status: 'recorded' });
    await expect(
      service.recordOutcome(
        smart.response.recommendationId,
        outcomeFor({
          eventId: 'recommendation-event-smart-ignored',
          eventType: 'ignored',
          actionId: null,
          cartRevision: smartRequest.cartRevision,
        }),
      ),
    ).resolves.toMatchObject({ status: 'recorded' });

    const flow = await inspection.orderFlow(starterRequest.orderFlowId);
    expect(flow).toMatchObject({
      state: {
        revision: 7,
        stage: 'complete',
        attemptedPlacements: [
          'local_favorite',
          'modifier_upsell',
          'smart_cross_sell',
        ],
        shownActionIds: smartActions.map((action) => action.actionId),
      },
      pendingAction: null,
      eventCounts: {
        decision_requested: 3,
        decision_completed: 3,
        cart_mutation_succeeded: 1,
        explicitly_dismissed: 1,
        impression_rendered: 1,
        ignored: 1,
      },
    });
  });

  it('keeps proactive placement attempts once-only after completion', async () => {
    const { service, inspection, starterRequest, smartRequest, smart } =
      await smartFlowFixture();
    await service.recordOutcome(
      smart.response.recommendationId,
      outcomeFor({
        eventId: 'recommendation-event-smart-ignored-once-only',
        eventType: 'ignored',
        actionId: null,
        cartRevision: smartRequest.cartRevision,
      }),
    );

    const repeatRequest = parseRecommendationDecisionRequest({
      ...smartRequest,
      requestId: 'rec-request-flow-smart-repeat',
      idempotencyKey: 'rec-idempotency-flow-smart-repeat',
    });
    const repeat = await service.decide({ request: repeatRequest });
    expect(repeat).toMatchObject({
      status: 'decided',
      response: { status: 'recommended' },
    });
    expect(
      (await inspection.orderFlow(starterRequest.orderFlowId))!.state,
    ).toMatchObject({
      stage: 'complete',
      attemptedPlacements: [
        'local_favorite',
        'modifier_upsell',
        'smart_cross_sell',
      ],
    });
  });

  it('allows an explicit post-completion request without reopening proactive stages', async () => {
    const engine = new RecordingEngine();
    const store = new MemoryStore();
    const request = requestFor({
      suffix: 'complete-starter',
      placement: 'local_favorite',
    });
    const completeState = parseRecommendationState({
      ...initialRecommendationState(request.orderFlowId),
      revision: 4,
      stage: 'complete',
      attemptedPlacements: [
        'local_favorite',
        'modifier_upsell',
        'smart_cross_sell',
      ],
      nextEligiblePlacement: null,
    });
    await store.putPackState(
      request.sessionId,
      await createPackStateEnvelope({
        packRef: kfcRecommendationPackStateDefinition.packRef,
        schemaVersion: kfcRecommendationPackStateDefinition.schemaVersion,
        state: { recommendationState: completeState },
      }),
    );
    const { service, inspection } = await application(engine, store);
    const explicitRequest = parseRecommendationDecisionRequest({
      ...request,
      requestId: 'rec-request-complete-explicit',
      idempotencyKey: 'rec-idempotency-complete-explicit',
    });

    const explicit = await service.decide({
      request: explicitRequest,
      requestKind: 'customer_requested',
    });

    expect(explicit.status).toBe('decided');
    expect(
      (await inspection.orderFlow(request.orderFlowId))!.state,
    ).toMatchObject({
      revision: 5,
      stage: 'complete',
      attemptedPlacements: [
        'local_favorite',
        'modifier_upsell',
        'smart_cross_sell',
      ],
      nextEligiblePlacement: null,
    });
  });

  it('replays canonical decisions and conflicts changed requests before engine work', async () => {
    const engine = new RecordingEngine();
    const { service } = await application(engine);
    const request = requestFor({
      suffix: 'replay-local',
      placement: 'local_favorite',
    });
    const first = await service.decide({ request });

    await expect(
      service.decide({ request: structuredClone(request) }),
    ).resolves.toEqual({
      status: 'replay',
      response:
        first.status === 'decided' ? first.response : (undefined as never),
    });
    const changed = parseRecommendationDecisionRequest({
      ...request,
      cart: {
        ...request.cart,
        subtotal: { amount: 1, currency: 'VND' },
      },
    });
    await expect(service.decide({ request: changed })).resolves.toEqual({
      status: 'idempotency_conflict',
    });
    expect(engine.contexts).toHaveLength(1);
  });

  it('conflicts a replay when trusted decision context changes', async () => {
    const engine = new RecordingEngine();
    const { service } = await application(engine);
    const request = requestFor({
      suffix: 'trusted-fingerprint',
      placement: 'local_favorite',
    });
    await service.decide({
      request,
      trusted: { remainingBudgetVnd: 100_000 },
    });

    await expect(
      service.decide({
        request,
        trusted: { remainingBudgetVnd: 200_000 },
      }),
    ).resolves.toEqual({ status: 'idempotency_conflict' });
    expect(engine.contexts).toHaveLength(1);
  });

  it('uses state revision to identify the latest decision when server timestamps tie', async () => {
    const { service, inspection } = await application();
    const older = requestFor({
      suffix: 'tie-z',
      placement: 'local_favorite',
    });
    const newer = requestFor({
      suffix: 'tie-a',
      placement: 'local_favorite',
    });
    await service.decide({ request: older });
    await service.decide({
      request: newer,
      requestKind: 'customer_requested',
    });

    await expect(
      inspection.orderFlow(older.orderFlowId),
    ).resolves.toMatchObject({
      state: { revision: 2 },
      latestDecision: { requestId: newer.requestId },
    });
  });

  it('records and replays an exact impression without another state revision', async () => {
    const { service, decision, renderedActions, impression, inspection } =
      await localEventFixture('impression-replay');
    const recorded = await service.recordImpression(
      decision.response.recommendationId,
      impression,
    );
    expect(recorded).toMatchObject({
      status: 'recorded',
      event: {
        recordedAt: serverInstant,
        actionId: null,
        payload: {
          assistantTurnId: impression.assistantTurnId,
          attachmentId: impression.attachmentId,
          renderedActions,
          actionDigest: impression.actionDigest,
        },
      },
    });
    await expect(
      service.recordImpression(
        decision.response.recommendationId,
        structuredClone(impression),
      ),
    ).resolves.toMatchObject({ status: 'replay' });
    expect(
      (await inspection.recommendation(decision.response.recommendationId))!
        .state.revision,
    ).toBe(2);
  });

  it('rejects a conflicting impression event fingerprint', async () => {
    const { service, decision, impression } = await localEventFixture(
      'impression-conflict',
    );
    await service.recordImpression(
      decision.response.recommendationId,
      impression,
    );
    await expect(
      service.recordImpression(decision.response.recommendationId, {
        ...impression,
        attachmentId: 'attachment-conflict',
      }),
    ).resolves.toEqual({ status: 'idempotency_conflict' });
  });

  it('rejects an impression bound to another cart revision', async () => {
    const { service, decision, impression } = await localEventFixture(
      'impression-wrong-cart',
    );
    await expect(
      service.recordImpression(
        decision.response.recommendationId,
        parseRecommendationImpressionRequest({
          ...impression,
          eventId: 'recommendation-event-smart-wrong-cart',
          cartRevision: 'wrong-cart-revision',
        }),
      ),
    ).resolves.toEqual({ status: 'cart_revision_conflict' });
  });

  it('rejects an impression that does not contain the exact rendered slate', async () => {
    const { service, decision, renderedActions, impression } =
      await localEventFixture('impression-render-mismatch');
    await expect(
      service.recordImpression(
        decision.response.recommendationId,
        parseRecommendationImpressionRequest({
          ...impression,
          eventId: 'recommendation-event-smart-render-mismatch',
          renderedActions: [
            ...renderedActions,
            { actionId: 'product:render-mismatch', position: 2 },
          ],
        }),
      ),
    ).resolves.toEqual({ status: 'render_binding_conflict' });
  });

  it('persists exact empty outcome payloads and fingerprints discarded ingress prose', async () => {
    const { service, decision, request } =
      await localEventFixture('outcome-payload');
    const ignored = outcomeFor({
      eventId: 'recommendation-event-outcome-payload',
      eventType: 'ignored',
      actionId: null,
      cartRevision: request.cartRevision,
      payload: { customerMessage: 'private customer prose' },
    });
    await expect(
      service.recordOutcome(decision.response.recommendationId, ignored),
    ).resolves.toMatchObject({
      status: 'recorded',
      event: { payload: {}, recordedAt: serverInstant },
    });
    await expect(
      service.recordOutcome(
        decision.response.recommendationId,
        structuredClone(ignored),
      ),
    ).resolves.toMatchObject({ status: 'replay' });
  });

  it('conflicts a reused outcome event ID when discarded ingress prose changes', async () => {
    const { service, decision, request } =
      await localEventFixture('outcome-conflict');
    const ignored = outcomeFor({
      eventId: 'recommendation-event-outcome-conflict',
      eventType: 'ignored',
      actionId: null,
      cartRevision: request.cartRevision,
      payload: { customerMessage: 'private customer prose' },
    });
    await service.recordOutcome(decision.response.recommendationId, ignored);

    await expect(
      service.recordOutcome(decision.response.recommendationId, {
        ...ignored,
        payload: { customerMessage: 'changed private prose' },
      }),
    ).resolves.toEqual({ status: 'idempotency_conflict' });
  });

  it('rejects a selected action outside the stored offer', async () => {
    const { service, decision, request } = await localEventFixture(
      'outcome-wrong-action',
    );
    await expect(
      service.recordOutcome(
        decision.response.recommendationId,
        outcomeFor({
          eventId: 'recommendation-event-wrong-action',
          eventType: 'selected',
          actionId: 'product:not-offered',
          cartRevision: request.cartRevision,
        }),
      ),
    ).resolves.toEqual({ status: 'render_binding_conflict' });
  });

  it('rejects a fresh outcome after the recommendation resolves', async () => {
    const { service, decision, request } =
      await localEventFixture('outcome-stale');
    await service.recordOutcome(
      decision.response.recommendationId,
      outcomeFor({
        eventId: 'recommendation-event-resolve-recommendation',
        eventType: 'ignored',
        actionId: null,
        cartRevision: request.cartRevision,
      }),
    );
    await expect(
      service.recordOutcome(
        decision.response.recommendationId,
        outcomeFor({
          eventId: 'recommendation-event-stale',
          eventType: 'ignored',
          actionId: null,
          cartRevision: request.cartRevision,
        }),
      ),
    ).resolves.toEqual({ status: 'stale_recommendation' });
  });

  it('maps stale decision CAS to state_conflict without partial writes', async () => {
    class StaleDecisionStore extends MemoryStore {
      override async commitRecommendationDecision(
        _input: CommitRecommendationDecisionInput,
      ): Promise<CommitRecommendationDecisionResult> {
        return { status: 'stale' };
      }
    }
    const decisionStore = new StaleDecisionStore();
    const decisionService = createRecommendationApplicationService(
      dependencies(decisionStore, new RecordingEngine()),
    );
    const request = requestFor({
      suffix: 'stale-decision',
      placement: 'local_favorite',
    });
    await expect(decisionService.decide({ request })).resolves.toEqual({
      status: 'state_conflict',
    });
    await expect(
      decisionStore.listRecommendationEvents({ sessionId: request.sessionId }),
    ).resolves.toEqual([]);
  });

  it('maps stale event CAS to state_conflict without partial writes', async () => {
    class StaleEventStore extends MemoryStore {
      stale = false;

      override async appendRecommendationEvent(
        input: AppendRecommendationEventInput,
      ): Promise<AppendRecommendationEventResult> {
        return this.stale
          ? { status: 'stale' }
          : super.appendRecommendationEvent(input);
      }
    }
    const eventStore = new StaleEventStore();
    const { service, inspection } = await application(
      new RecordingEngine(),
      eventStore,
    );
    const request = requestFor({
      suffix: 'stale-event',
      placement: 'local_favorite',
    });
    const decided = await service.decide({ request });
    if (decided.status !== 'decided') throw new Error('decision expected');
    const projection = await inspection.recommendation(
      decided.response.recommendationId,
    );
    eventStore.stale = true;
    const action = decided.response.primaryOffer!.actions[0]!;
    await expect(
      service.recordImpression(
        decided.response.recommendationId,
        parseRecommendationImpressionRequest({
          schemaVersion: 'kfc-recommendation-event-v1',
          eventId: 'recommendation-event-stale-impression',
          occurredAt: '2026-07-27T09:10:00Z',
          assistantTurnId: 'assistant-turn-stale',
          attachmentId: 'attachment-stale',
          renderedActions: [{ actionId: action.actionId, position: 1 }],
          cartRevision: request.cartRevision,
          actionDigest: projection!.recommendation.actionDigest,
        }),
      ),
    ).resolves.toEqual({ status: 'state_conflict' });
    expect(
      (
        await eventStore.listRecommendationEvents({
          recommendationId: decided.response.recommendationId,
        })
      ).map((event) => event.eventType),
    ).toEqual(['decision_completed']);
  });

  it('returns redacted recommendation, order-flow, and session inspection projections', async () => {
    const { service, inspection } = await bundledApplication();
    const request = requestFor({
      suffix: 'inspection-linked',
      placement: 'for_you',
      verifiedCustomerRef: 'demo-returning-linked',
    });
    const result = await service.decide({
      request,
      trusted: {
        verifiedCohorts: ['private-cohort'],
        verifiedDietaryEvidence: {
          evidenceId: 'private-dietary-evidence',
          excludedSellableItemIds: ['item-private'],
        },
      },
    });
    if (result.status !== 'decided') throw new Error('decision expected');

    const recommendation = await inspection.recommendation(
      result.response.recommendationId,
    );
    const orderFlow = await inspection.orderFlow(request.orderFlowId);
    const session = await inspection.session(request.sessionId);
    const serialized = JSON.stringify({ recommendation, orderFlow, session });

    expect(recommendation).toMatchObject({
      schemaVersion: 'kfc-recommendation-inspection-v1',
      recommendation: { response: result.response },
      correlations: {
        sessionId: request.sessionId,
        orderFlowId: request.orderFlowId,
        requestId: request.requestId,
        recommendationId: result.response.recommendationId,
        traceRef: result.response.traceRef,
      },
    });
    expect(orderFlow).toMatchObject({
      schemaVersion: 'kfc-recommendation-order-flow-inspection-v1',
      latestDecision: {
        recommendationId: result.response.recommendationId,
      },
    });
    expect(session).toEqual(orderFlow);
    for (const forbidden of [
      'demo-returning-linked',
      'synthetic-poc-order-001',
      'private-cohort',
      'private-dietary-evidence',
      'customerHistory',
      'verifiedCustomerRef',
      'idempotencyKey',
      'commerceSnapshotBindings',
      'customerMessage',
      'password',
      'payment',
      'email',
      'hiddenReasoning',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('returns an empty protected projection for a session without decisions', async () => {
    const { inspection } = await application();

    await expect(
      inspection.session('session-without-decisions'),
    ).resolves.toEqual({
      schemaVersion: 'kfc-recommendation-order-flow-inspection-v1',
      state: null,
      latestDecision: null,
      pendingAction: null,
      correlations: {
        sessionId: 'session-without-decisions',
        orderFlowId: null,
        recommendationId: null,
        requestId: null,
        traceRef: null,
      },
      eventCounts: {},
    });
  });

  it('strictly rejects unknown application context before reserving or invoking the engine', async () => {
    const engine = new RecordingEngine();
    const { service, store } = await application(engine);
    const request = requestFor({
      suffix: 'strict-input',
      placement: 'local_favorite',
    });

    await expect(
      service.decide({
        request,
        trusted: {
          verifiedCohorts: ['known'],
          customerProse: 'forbidden',
        },
      } as never),
    ).rejects.toThrow();
    expect(engine.contexts).toEqual([]);
    await expect(
      store.listRecommendationEvents({ sessionId: request.sessionId }),
    ).resolves.toEqual([]);
  });
});
