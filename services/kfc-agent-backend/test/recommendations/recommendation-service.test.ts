import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { digestCommerceAction } from '../../src/ordering/commerceDigest.js';
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
import { compareCanonicalUtcInstants } from '../../src/recommendations/domain/canonical-instant.js';
import { StoredDemoCustomerHistoryRepository } from '../../src/recommendations/history/stored-demo-history-repository.js';
import { LocalMerchandisingPolicyRepository } from '../../src/recommendations/merchandising/local-policy-repository.js';
import type {
  AppendRecommendationEventInput,
  AppendRecommendationEventResult,
  CommitRecommendationDecisionInput,
  CommitRecommendationDecisionResult,
} from '../../src/recommendations/persistence/repository.js';
import { renderBindingForDecisionDigests } from '../../src/recommendations/persistence/types.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createPackStateEnvelope } from '../../src/runtime/businessPack.js';
import { initialRecommendationState } from '../../src/recommendations/state/state-machine.js';
import type { KfcGenUiAttachment } from '../../src/genui/kfcGenUi.js';

const serverInstant = '2026-07-27T09:30:00Z';
const completedServerInstant = '2026-07-27T09:30:00.1Z';

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
    shadowComparison: {
      status: 'not_applicable',
      outputMode: 'baseline',
      modelRevision: null,
      eligibleActionIds: [],
      baselineOrderingActionIds: [],
      activeTechnicalOrdering: 'baseline',
    },
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
    merchandisingPolicyRepository: new LocalMerchandisingPolicyRepository(),
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

async function publishRecommendationTurn(
  store: MemoryStore,
  recommendationId: string,
  customerId: string,
) {
  const record = await store.getRecommendationDecision(recommendationId);
  if (!record) throw new Error('recommendation expected');
  if (record.renderBinding.customerId !== customerId) {
    throw new Error('presentation customer binding expected');
  }
  const attachment: KfcGenUiAttachment = {
    id: record.renderBinding.attachmentId,
    lifecycleStage: 'recommendation',
    widgetKind: 'recommendationOffer',
    status: 'active',
    title: 'Gợi ý dành cho bạn',
    data: {
      recommendationId,
      cartRevision: record.renderBinding.cartRevision,
      actionDigest: record.renderBinding.actionDigest,
      decisionDigest: record.renderBinding.decisionDigest,
      versionBindingDigest: record.renderBinding.versionBindingDigest,
      offers: record.renderBinding.renderedActions.map((action) => ({
        recommendationActionId: action.actionId,
      })),
    },
    actions: [
      ...record.renderBinding.renderedActions.map((action) => ({
        id: `recommendation_select:${action.actionId}`,
        label: 'Chọn',
      })),
      { id: 'recommendation_dismiss', label: 'Không, cảm ơn' },
    ],
    authority: {
      schemaVersion: 'kfc-genui-v1',
      sessionId: record.request.sessionId,
      customerId,
      verifiedRevision: 'test-verified-revision',
      actionLifecycle: 'one_shot',
      issuedAt: serverInstant,
      expiresAt: '2099-01-01T00:00:00Z',
    },
    expiresAt: '2099-01-01T00:00:00Z',
  };
  await store.appendTurn({
    id: record.renderBinding.assistantTurnId,
    sessionId: record.request.sessionId,
    channel: 'kfc',
    role: 'assistant',
    text: 'Mình có một gợi ý cho bạn.',
    externalMessageId: null,
    externalUserId: customerId,
    deliveryStatus: 'sent',
    metadata: { genUi: attachment },
  });
}

async function smartFlowFixture(input: { interveningDecision?: boolean } = {}) {
  const engine = new RecordingEngine();
  const { service, inspection, store } = await application(engine);
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
    trusted: {
      remainingBudgetVnd: 150_000,
      presentationCustomerId: 'customer-flow-smart',
    },
  });
  if (smart.status !== 'decided') throw new Error('smart expected');
  return {
    engine,
    service,
    inspection,
    starterRequest,
    smartRequest,
    smart,
    store,
  };
}

async function localEventFixture(suffix: string) {
  const { service, inspection, store } = await application();
  const request = requestFor({ suffix, placement: 'local_favorite' });
  const customerId = `customer-${suffix}`;
  const decision = await service.decide({
    request,
    trusted: { presentationCustomerId: customerId },
  });
  if (decision.status !== 'decided') throw new Error('decision expected');
  await publishRecommendationTurn(
    store,
    decision.response.recommendationId,
    customerId,
  );
  const projection = await inspection.recommendation(
    decision.response.recommendationId,
  );
  const renderedActions = decision.response.primaryOffer!.actions.map(
    (action, index) => ({
      actionId: action.actionId,
      position: index + 1,
    }),
  );
  const actionDigest = projection!.recommendation.actionDigest;
  const impression = parseRecommendationImpressionRequest({
    schemaVersion: 'kfc-recommendation-event-v1',
    eventId: `recommendation-event-${suffix}-impression`,
    occurredAt: '2026-07-27T09:10:00Z',
    ...renderBindingForDecisionDigests(projection!.recommendation),
    renderedActions,
    cartRevision: request.cartRevision,
    actionDigest,
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

async function completedCustomerRequestFixture() {
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
    trusted: { presentationCustomerId: 'customer-complete-explicit' },
  });
  if (explicit.status !== 'decided') {
    throw new Error('customer-requested decision expected');
  }
  return { service, inspection, store, explicitRequest, explicit };
}

async function multiFlowSessionFixture(firstFlowComplete: boolean) {
  const engine = new RecordingEngine();
  const store = new MemoryStore();
  const { service, inspection } = await application(engine, store);
  const sessionId = 'session-multiple-order-flows';
  const firstRequest = parseRecommendationDecisionRequest({
    ...requestFor({
      suffix: 'multi-flow-first',
      placement: 'local_favorite',
    }),
    sessionId,
    orderFlowId: 'order-flow-multi-z',
    requestId: 'rec-request-multi-z',
    idempotencyKey: 'rec-idempotency-multi-z',
  });
  if (firstFlowComplete) {
    await store.putPackState(
      sessionId,
      await createPackStateEnvelope({
        packRef: kfcRecommendationPackStateDefinition.packRef,
        schemaVersion: kfcRecommendationPackStateDefinition.schemaVersion,
        state: {
          recommendationState: parseRecommendationState({
            ...initialRecommendationState(firstRequest.orderFlowId),
            revision: 4,
            stage: 'complete',
            attemptedPlacements: [
              'local_favorite',
              'modifier_upsell',
              'smart_cross_sell',
            ],
            nextEligiblePlacement: null,
          }),
        },
      }),
    );
  }
  await service.decide({
    request: firstRequest,
    ...(firstFlowComplete
      ? { requestKind: 'customer_requested' as const }
      : {}),
  });

  const secondRequest = parseRecommendationDecisionRequest({
    ...requestFor({
      suffix: 'multi-flow-second',
      placement: 'local_favorite',
    }),
    sessionId,
    orderFlowId: 'order-flow-multi-a',
    requestId: 'rec-request-multi-a',
    idempotencyKey: 'rec-idempotency-multi-a',
  });
  await store.putPackState(
    sessionId,
    await createPackStateEnvelope({
      packRef: kfcRecommendationPackStateDefinition.packRef,
      schemaVersion: kfcRecommendationPackStateDefinition.schemaVersion,
      state: {
        recommendationState: initialRecommendationState(
          secondRequest.orderFlowId,
        ),
      },
    }),
  );
  await service.decide({ request: secondRequest });
  return { inspection, sessionId, store, firstRequest, secondRequest };
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
      occurredAt: completedServerInstant,
      recordedAt: completedServerInstant,
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
    expect(
      compareCanonicalUtcInstants(requested.recordedAt, completed.recordedAt),
    ).toBe(-1);
    const expectedEventId = (eventType: string) =>
      `recommendation-event:${createHash('sha256')
        .update(JSON.stringify(`${request.requestId}:${eventType}`))
        .digest('hex')
        .slice(0, 24)}`;
    expect(requested.eventId).toBe(expectedEventId('decision_requested'));
    expect(completed.eventId).toBe(expectedEventId('decision_completed'));
    expect(requested.recordedAt).not.toBe(request.decisionTime);
  });

  it('samples decision completion time after engine work', async () => {
    let engineCompleted = false;
    class PhaseEngine extends RecordingEngine {
      override async decide(context: RecommendationDecisionContext) {
        const result = await super.decide(context);
        engineCompleted = true;
        return result;
      }
    }
    const clock: RecommendationClock = {
      now: () =>
        engineCompleted ? '2026-07-27T09:30:01Z' : '2026-07-27T09:30:00Z',
    };
    const store = new MemoryStore();
    const service = createRecommendationApplicationService(
      dependencies(store, new PhaseEngine(), { clock }),
    );
    const request = requestFor({
      suffix: 'decision-chronology',
      placement: 'local_favorite',
    });

    const result = await service.decide({ request });

    if (result.status !== 'decided') throw new Error('decision expected');
    const events = await store.listRecommendationEvents({
      sessionId: request.sessionId,
    });
    expect(events.map((event) => [event.eventType, event.recordedAt])).toEqual([
      ['decision_requested', '2026-07-27T09:30:00Z'],
      ['decision_completed', '2026-07-27T09:30:01Z'],
    ]);
  });

  it('initializes recommendation state in an existing KFC envelope without replacing other state', async () => {
    const engine = new RecordingEngine();
    const store = new MemoryStore();
    const request = requestFor({
      suffix: 'existing-pack-local',
      placement: 'local_favorite',
    });
    await store.putPackState(
      request.sessionId,
      await createPackStateEnvelope({
        packRef: kfcRecommendationPackStateDefinition.packRef,
        schemaVersion: kfcRecommendationPackStateDefinition.schemaVersion,
        state: { cancellationStatusChecked: true },
      }),
    );
    const { service } = await application(engine, store);

    const result = await service.decide({ request });

    expect(result).toMatchObject({
      status: 'decided',
      response: {
        requestId: request.requestId,
        orderFlowId: request.orderFlowId,
      },
    });
    await expect(
      store.getPackState(
        request.sessionId,
        kfcRecommendationPackStateDefinition.packRef,
      ),
    ).resolves.toMatchObject({
      state: {
        cancellationStatusChecked: true,
        recommendationState: {
          orderFlowId: request.orderFlowId,
          revision: 1,
        },
      },
    });
    await expect(
      store.listRecommendationEvents({ sessionId: request.sessionId }),
    ).resolves.toHaveLength(2);
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
    const { service, inspection, store, starterRequest, smartRequest, smart } =
      await smartFlowFixture();
    await publishRecommendationTurn(
      store,
      smart.response.recommendationId,
      'customer-flow-smart',
    );
    const smartProjection = await inspection.recommendation(
      smart.response.recommendationId,
    );
    const smartActions = smart.response.primaryOffer!.actions;
    const actionDigest = smartProjection!.recommendation.actionDigest;
    await expect(
      service.recordImpression(
        smart.response.recommendationId,
        parseRecommendationImpressionRequest({
          schemaVersion: 'kfc-recommendation-event-v1',
          eventId: 'recommendation-event-smart-impression-flow',
          occurredAt: '2026-07-27T09:09:00Z',
          ...renderBindingForDecisionDigests(smartProjection!.recommendation),
          renderedActions: smartActions.map((action, index) => ({
            actionId: action.actionId,
            position: index + 1,
          })),
          cartRevision: smartRequest.cartRevision,
          actionDigest,
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
    expect(repeat).toEqual({ status: 'state_conflict' });
    expect(
      await inspection.orderFlow(starterRequest.orderFlowId),
    ).toMatchObject({
      state: {
        stage: 'complete',
        attemptedPlacements: [
          'local_favorite',
          'modifier_upsell',
          'smart_cross_sell',
        ],
      },
      eventCounts: {
        decision_requested: 3,
        decision_completed: 3,
      },
    });
  });

  it('allows an explicit post-completion request without reopening proactive stages', async () => {
    const { inspection, explicitRequest, explicit } =
      await completedCustomerRequestFixture();

    expect(explicit.status).toBe('decided');
    expect(
      (await inspection.orderFlow(explicitRequest.orderFlowId))!.state,
    ).toMatchObject({
      revision: 5,
      stage: 'complete',
      attemptedPlacements: [
        'local_favorite',
        'modifier_upsell',
        'smart_cross_sell',
      ],
      nextEligiblePlacement: null,
      pendingRecommendation: null,
    });
  });

  it('records and replays telemetry for a customer-requested recommendation after complete', async () => {
    const { service, inspection, store, explicitRequest, explicit } =
      await completedCustomerRequestFixture();
    await publishRecommendationTurn(
      store,
      explicit.response.recommendationId,
      'customer-complete-explicit',
    );
    const projection = await inspection.recommendation(
      explicit.response.recommendationId,
    );
    const action = explicit.response.primaryOffer!.actions[0]!;
    const actionDigest = projection!.recommendation.actionDigest;
    const impression = parseRecommendationImpressionRequest({
      schemaVersion: 'kfc-recommendation-event-v1',
      eventId: 'recommendation-event-complete-explicit-impression',
      occurredAt: '2026-07-27T09:31:00Z',
      ...renderBindingForDecisionDigests(projection!.recommendation),
      renderedActions: [{ actionId: action.actionId, position: 1 }],
      cartRevision: explicitRequest.cartRevision,
      actionDigest,
    });
    const outcome = outcomeFor({
      eventId: 'recommendation-event-complete-explicit-ignored',
      eventType: 'ignored',
      actionId: null,
      cartRevision: explicitRequest.cartRevision,
    });

    await expect(
      service.recordImpression(explicit.response.recommendationId, impression),
    ).resolves.toMatchObject({ status: 'recorded' });
    await expect(
      service.recordOutcome(explicit.response.recommendationId, outcome),
    ).resolves.toMatchObject({ status: 'recorded' });
    await expect(
      service.recordOutcome(
        explicit.response.recommendationId,
        structuredClone(outcome),
      ),
    ).resolves.toMatchObject({ status: 'replay' });
    await expect(
      inspection.orderFlow(explicitRequest.orderFlowId),
    ).resolves.toMatchObject({
      state: {
        revision: 7,
        stage: 'complete',
        pendingRecommendation: null,
        shownActionIds: [action.actionId],
        recordedOutcomeEventIds: [outcome.eventId],
      },
    });
  });

  it('records selected then cart mutation telemetry after complete until a terminal outcome', async () => {
    const { service, inspection, explicitRequest, explicit } =
      await completedCustomerRequestFixture();
    const actionId = explicit.response.primaryOffer!.actions[0]!.actionId;
    const selected = outcomeFor({
      eventId: 'recommendation-event-complete-explicit-selected',
      eventType: 'selected',
      actionId,
      cartRevision: explicitRequest.cartRevision,
    });
    const mutation = outcomeFor({
      eventId: 'recommendation-event-complete-explicit-cart-succeeded',
      eventType: 'cart_mutation_succeeded',
      actionId,
      cartRevision: 'cart-revision-after-explicit-selection',
    });

    await expect(
      service.recordOutcome(explicit.response.recommendationId, selected),
    ).resolves.toMatchObject({ status: 'recorded' });
    await expect(
      service.recordOutcome(explicit.response.recommendationId, mutation),
    ).resolves.toMatchObject({ status: 'recorded' });
    await expect(
      inspection.orderFlow(explicitRequest.orderFlowId),
    ).resolves.toMatchObject({
      state: {
        revision: 7,
        stage: 'complete',
        pendingRecommendation: null,
        nextEligiblePlacement: null,
        recordedOutcomeEventIds: [selected.eventId, mutation.eventId],
      },
      eventCounts: {
        selected: 1,
        cart_mutation_succeeded: 1,
      },
    });

    await expect(
      service.recordOutcome(
        explicit.response.recommendationId,
        outcomeFor({
          eventId: 'recommendation-event-complete-explicit-checkout',
          eventType: 'checkout_completed',
          actionId: null,
          cartRevision: null,
        }),
      ),
    ).resolves.toMatchObject({ status: 'recorded' });
    await expect(
      service.recordOutcome(
        explicit.response.recommendationId,
        outcomeFor({
          eventId: 'recommendation-event-complete-explicit-after-terminal',
          eventType: 'cart_mutation_succeeded',
          actionId,
          cartRevision: 'cart-revision-after-terminal',
        }),
      ),
    ).resolves.toEqual({ status: 'stale_recommendation' });
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

  it('fingerprints omitted trusted defaults like explicit null and empty defaults', async () => {
    const engine = new RecordingEngine();
    const { service } = await application(engine);
    const request = requestFor({
      suffix: 'trusted-defaults',
      placement: 'local_favorite',
    });
    const first = await service.decide({ request });

    await expect(
      service.decide({
        request,
        trusted: {
          parentCartLineId: null,
          remainingBudgetVnd: null,
          verifiedCohorts: [],
          verifiedDietaryEvidence: null,
        },
      }),
    ).resolves.toEqual({
      status: 'replay',
      response:
        first.status === 'decided' ? first.response : (undefined as never),
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
    const store = new MemoryStore();
    const older = requestFor({
      suffix: 'tie-z',
      placement: 'local_favorite',
    });
    const newer = requestFor({
      suffix: 'tie-a',
      placement: 'local_favorite',
    });
    await store.putPackState(
      older.sessionId,
      await createPackStateEnvelope({
        packRef: kfcRecommendationPackStateDefinition.packRef,
        schemaVersion: kfcRecommendationPackStateDefinition.schemaVersion,
        state: {
          recommendationState: parseRecommendationState({
            ...initialRecommendationState(older.orderFlowId),
            revision: 4,
            stage: 'complete',
            attemptedPlacements: [
              'local_favorite',
              'modifier_upsell',
              'smart_cross_sell',
            ],
            nextEligiblePlacement: null,
          }),
        },
      }),
    );
    const { service, inspection } = await application(
      new RecordingEngine(),
      store,
    );
    await service.decide({
      request: older,
      requestKind: 'customer_requested',
    });
    await service.decide({
      request: newer,
      requestKind: 'customer_requested',
    });

    await expect(
      inspection.orderFlow(older.orderFlowId),
    ).resolves.toMatchObject({
      state: { revision: 6 },
      latestDecision: { requestId: newer.requestId },
    });
  });

  it('advances persisted decision chronology across session order flows under a fixed clock', async () => {
    const { sessionId, store, firstRequest, secondRequest } =
      await multiFlowSessionFixture(false);
    const events = await store.listRecommendationEvents({ sessionId });
    const recordedAt = [
      events.find(
        (event) =>
          event.requestId === firstRequest.requestId &&
          event.eventType === 'decision_requested',
      )!.recordedAt,
      events.find(
        (event) =>
          event.requestId === firstRequest.requestId &&
          event.eventType === 'decision_completed',
      )!.recordedAt,
      events.find(
        (event) =>
          event.requestId === secondRequest.requestId &&
          event.eventType === 'decision_requested',
      )!.recordedAt,
      events.find(
        (event) =>
          event.requestId === secondRequest.requestId &&
          event.eventType === 'decision_completed',
      )!.recordedAt,
    ];

    expect(recordedAt).toEqual([
      '2026-07-27T09:30:00Z',
      '2026-07-27T09:30:00.1Z',
      '2026-07-27T09:30:00.11Z',
      '2026-07-27T09:30:00.111Z',
    ]);
    expect(
      recordedAt
        .slice(1)
        .every(
          (instant, index) =>
            compareCanonicalUtcInstants(recordedAt[index]!, instant) === -1,
        ),
    ).toBe(true);
  });

  it('does not let a future client occurredAt move a later server decision time', async () => {
    const engine = new RecordingEngine();
    const store = new MemoryStore();
    const { service, inspection } = await application(engine, store);
    const sessionId = 'session-future-client-time';
    const firstRequest = parseRecommendationDecisionRequest({
      ...requestFor({
        suffix: 'future-client-first',
        placement: 'local_favorite',
      }),
      sessionId,
      orderFlowId: 'order-flow-future-client-first',
    });
    const first = await service.decide({
      request: firstRequest,
      trusted: { presentationCustomerId: 'customer-future-client-time' },
    });
    if (first.status !== 'decided') throw new Error('first decision expected');
    await publishRecommendationTurn(
      store,
      first.response.recommendationId,
      'customer-future-client-time',
    );
    const firstInspection = await inspection.recommendation(
      first.response.recommendationId,
    );
    const actionDigest = firstInspection!.recommendation.actionDigest;
    await expect(
      service.recordImpression(
        first.response.recommendationId,
        parseRecommendationImpressionRequest({
          schemaVersion: 'kfc-recommendation-event-v1',
          eventId: 'recommendation-event-future-client-time',
          occurredAt: '2099-01-01T00:00:00Z',
          ...renderBindingForDecisionDigests(firstInspection!.recommendation),
          renderedActions: first.response.primaryOffer!.actions.map(
            (action, index) => ({
              actionId: action.actionId,
              position: index + 1,
            }),
          ),
          cartRevision: firstRequest.cartRevision,
          actionDigest,
        }),
      ),
    ).resolves.toMatchObject({ status: 'recorded' });

    const secondRequest = parseRecommendationDecisionRequest({
      ...requestFor({
        suffix: 'future-client-second',
        placement: 'local_favorite',
      }),
      sessionId,
      orderFlowId: 'order-flow-future-client-second',
    });
    await store.putPackState(
      sessionId,
      await createPackStateEnvelope({
        packRef: kfcRecommendationPackStateDefinition.packRef,
        schemaVersion: kfcRecommendationPackStateDefinition.schemaVersion,
        state: {
          recommendationState: initialRecommendationState(
            secondRequest.orderFlowId,
          ),
        },
      }),
    );
    await service.decide({ request: secondRequest });

    const secondRequested = (
      await store.listRecommendationEvents({ sessionId })
    ).find(
      (event) =>
        event.requestId === secondRequest.requestId &&
        event.eventType === 'decision_requested',
    );
    expect(secondRequested?.recordedAt).toBe('2026-07-27T09:30:00.11Z');
  });

  it('selects the later revision-one session flow when recommendation IDs sort opposite insertion order', async () => {
    const { inspection, sessionId, secondRequest } =
      await multiFlowSessionFixture(false);

    await expect(inspection.session(sessionId)).resolves.toMatchObject({
      state: {
        orderFlowId: secondRequest.orderFlowId,
        revision: 1,
      },
      latestDecision: { requestId: secondRequest.requestId },
      correlations: { orderFlowId: secondRequest.orderFlowId },
    });
  });

  it('does not compare state revisions across session order flows when chronology ties', async () => {
    const { inspection, sessionId, secondRequest } =
      await multiFlowSessionFixture(true);

    await expect(inspection.session(sessionId)).resolves.toMatchObject({
      state: {
        orderFlowId: secondRequest.orderFlowId,
        revision: 1,
      },
      latestDecision: { requestId: secondRequest.requestId },
      correlations: { orderFlowId: secondRequest.orderFlowId },
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

  it('rejects an impression before its bound assistant attachment is committed', async () => {
    const { service, store } = await application();
    const request = requestFor({
      suffix: 'impression-without-publication',
      placement: 'local_favorite',
    });
    const decision = await service.decide({
      request,
      trusted: {
        presentationCustomerId: 'customer-impression-without-publication',
      },
    });
    if (decision.status !== 'decided') throw new Error('decision expected');
    const record = await store.getRecommendationDecision(
      decision.response.recommendationId,
    );
    if (!record) throw new Error('stored decision expected');

    await expect(
      service.recordImpression(
        decision.response.recommendationId,
        parseRecommendationImpressionRequest({
          schemaVersion: 'kfc-recommendation-event-v1',
          eventId: 'recommendation-event-impression-without-publication',
          occurredAt: '2026-07-27T09:10:00Z',
          assistantTurnId: record.renderBinding.assistantTurnId,
          attachmentId: record.renderBinding.attachmentId,
          renderedActions: record.renderBinding.renderedActions,
          cartRevision: record.renderBinding.cartRevision,
          actionDigest: record.renderBinding.actionDigest,
        }),
      ),
    ).resolves.toEqual({ status: 'render_binding_conflict' });
  });

  it('replays a distinct repeat impression without recording it twice', async () => {
    const { service, decision, impression, inspection } =
      await localEventFixture('impression-repeat-distinct');
    await service.recordImpression(
      decision.response.recommendationId,
      impression,
    );
    const repeat = parseRecommendationImpressionRequest({
      ...impression,
      eventId: 'recommendation-event-impression-repeat-distinct-second',
      occurredAt: '2026-07-27T09:10:00.1Z',
    });

    await expect(
      service.recordImpression(decision.response.recommendationId, repeat),
    ).resolves.toMatchObject({
      status: 'replay',
      event: {
        eventId: impression.eventId,
        eventType: 'impression_rendered',
      },
    });
    const afterRepeat = await inspection.recommendation(
      decision.response.recommendationId,
    );
    expect(afterRepeat?.state.revision).toBe(2);
    expect(
      afterRepeat?.events
        .filter((event) => event.eventType === 'impression_rendered')
        .map((event) => event.eventId),
    ).toEqual([impression.eventId]);
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

  it.each(['assistantTurnId', 'attachmentId'] as const)(
    'rejects a fresh impression whose %s does not match the server-owned render binding',
    async (field) => {
      const { service, decision, impression } = await localEventFixture(
        `impression-wrong-${field}`,
      );

      await expect(
        service.recordImpression(
          decision.response.recommendationId,
          parseRecommendationImpressionRequest({
            ...impression,
            eventId: `recommendation-event-wrong-${field}`,
            [field]: `wrong-${field}`,
          }),
        ),
      ).resolves.toEqual({ status: 'render_binding_conflict' });
    },
  );

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

  it.each([
    { eventType: 'selected', actionRequired: true },
    { eventType: 'explicitly_dismissed', actionRequired: false },
    { eventType: 'ignored', actionRequired: false },
    { eventType: 'superseded', actionRequired: false },
    { eventType: 'cart_mutation_succeeded', actionRequired: true },
    { eventType: 'cart_mutation_failed', actionRequired: true },
  ] as const)(
    'rejects null cart revision for $eventType outcomes',
    async ({ eventType, actionRequired }) => {
      const { service, decision } = await localEventFixture(
        `null-cart-${eventType}`,
      );
      const actionId = actionRequired
        ? decision.response.primaryOffer!.actions[0]!.actionId
        : null;

      await expect(
        service.recordOutcome(
          decision.response.recommendationId,
          outcomeFor({
            eventId: `recommendation-event-null-cart-${eventType}`,
            eventType,
            actionId,
            cartRevision: null,
          }),
        ),
      ).resolves.toEqual({ status: 'cart_revision_conflict' });
    },
  );

  it('uses the normalized recommendation ID for persistence lookup', async () => {
    const { service, decision, request } =
      await localEventFixture('normalized-id');

    await expect(
      service.recordOutcome(
        `  ${decision.response.recommendationId}  `,
        outcomeFor({
          eventId: 'recommendation-event-normalized-id',
          eventType: 'ignored',
          actionId: null,
          cartRevision: request.cartRevision,
        }),
      ),
    ).resolves.toMatchObject({ status: 'recorded' });
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
    const decided = await service.decide({
      request,
      trusted: { presentationCustomerId: 'customer-stale-event' },
    });
    if (decided.status !== 'decided') throw new Error('decision expected');
    await publishRecommendationTurn(
      eventStore,
      decided.response.recommendationId,
      'customer-stale-event',
    );
    const projection = await inspection.recommendation(
      decided.response.recommendationId,
    );
    eventStore.stale = true;
    const action = decided.response.primaryOffer!.actions[0]!;
    const actionDigest = projection!.recommendation.actionDigest;
    await expect(
      service.recordImpression(
        decided.response.recommendationId,
        parseRecommendationImpressionRequest({
          schemaVersion: 'kfc-recommendation-event-v1',
          eventId: 'recommendation-event-stale-impression',
          occurredAt: '2026-07-27T09:10:00Z',
          ...renderBindingForDecisionDigests(projection!.recommendation),
          renderedActions: [{ actionId: action.actionId, position: 1 }],
          cartRevision: request.cartRevision,
          actionDigest,
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
          excludedSellableItemIds: ['20751'],
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
    const redactedBindings =
      recommendation!.technical.eligibilityDecisions.flatMap(
        (decision) => decision.evidenceBindings,
      );
    expect(redactedBindings).toEqual(
      expect.arrayContaining([
        'redacted:verified-history',
        'redacted:completed-order',
        'redacted:dietary-evidence',
      ]),
    );
    for (const decision of recommendation!.technical.eligibilityDecisions) {
      const { digest, ...digestInput } = decision;
      expect(digest).toBe(await digestCommerceAction(digestInput));
    }
    for (const forbidden of [
      'demo-returning-linked',
      'synthetic-poc-order-001',
      'private-cohort',
      'private-dietary-evidence',
      'dietary-evidence:private-dietary-evidence',
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

  it('keeps exact shadow provenance only in protected recommendation inspection', async () => {
    const engine: RecommendationDecisionEngine = {
      async decide(context) {
        return {
          response: responseFor(context),
          technical: {
            ...technical(),
            shadowComparison: {
              status: 'succeeded',
              outputMode: 'learned_technical',
              modelRevision: 'hf-revision-0123456789abcdef',
              eligibleActionIds: ['product:20752'],
              baselineOrderingActionIds: ['product:20752'],
              activeTechnicalOrdering: 'learned',
              learnedOrdering: [
                {
                  actionId: 'product:20752',
                  calibratedProbability: 0.42,
                  expectedValueScore: 21_000,
                  modelArtifactId: 'smart_cross_sell-lightgbm-873cafdc6a6a0a9f',
                  calibrationId:
                    'smart_cross_sell-isotonic-calibration-9c9c55e026c5a193',
                  featureSchema: 'smart-cross-sell-feature-schema-v1',
                  featureContributions: [],
                },
              ],
              provenance: {
                modelRevision: 'hf-revision-0123456789abcdef',
                modelArtifactIds: [
                  'smart_cross_sell-lightgbm-873cafdc6a6a0a9f',
                ],
                calibrationIds: [
                  'smart_cross_sell-isotonic-calibration-9c9c55e026c5a193',
                ],
                featureSchema: 'smart-cross-sell-feature-schema-v1',
              },
            },
          },
        };
      },
    };
    const { service, inspection } = await application(engine);
    const result = await service.decide({
      request: requestFor({
        suffix: 'protected-shadow-provenance',
        placement: 'local_favorite',
      }),
    });
    if (result.status !== 'decided') throw new Error('decision expected');

    expect(JSON.stringify(result.response)).not.toMatch(
      /hf-revision|lightgbm|calibration-9c9c/u,
    );
    expect(result.response.versionBindings).toMatchObject({
      shadowModel: null,
      calibration: null,
    });
    await expect(
      inspection.recommendation(result.response.recommendationId),
    ).resolves.toMatchObject({
      technical: {
        shadowComparison: {
          status: 'succeeded',
          modelRevision: 'hf-revision-0123456789abcdef',
          provenance: {
            modelArtifactIds: ['smart_cross_sell-lightgbm-873cafdc6a6a0a9f'],
            calibrationIds: [
              'smart_cross_sell-isotonic-calibration-9c9c55e026c5a193',
            ],
            featureSchema: 'smart-cross-sell-feature-schema-v1',
          },
        },
      },
    });
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

  it('keeps the exact customer/turn/render binding server-only', async () => {
    const { service, inspection } = await application();
    const request = requestFor({
      suffix: 'presentation-binding',
      placement: 'local_favorite',
    });
    const decision = await service.decide({
      request,
      trusted: { presentationCustomerId: 'customer-presentation-1' },
    });
    if (decision.status !== 'decided') throw new Error('decision expected');

    const presentation = await service.presentationFor(
      decision.response.recommendationId,
      {
        sessionId: request.sessionId,
        customerId: 'customer-presentation-1',
      },
    );

    expect(presentation).toMatchObject({
      response: {
        recommendationId: decision.response.recommendationId,
        orderFlowId: request.orderFlowId,
      },
      binding: {
        recommendationId: decision.response.recommendationId,
        sessionId: request.sessionId,
        customerId: 'customer-presentation-1',
        cartRevision: request.cartRevision,
        renderedActions: [
          {
            actionId:
              decision.response.primaryOffer!.actions[0]!.actionId,
            position: 1,
          },
        ],
      },
    });
    expect(presentation?.binding.assistantTurnId).toMatch(
      /^recommendation-turn:/u,
    );
    expect(presentation?.binding.attachmentId).toMatch(
      /^recommendation-attachment:/u,
    );
    expect(presentation?.binding.actionDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(presentation?.binding.decisionDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(presentation?.binding.versionBindingDigest).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    await expect(
      service.presentationFor(decision.response.recommendationId, {
        sessionId: request.sessionId,
        customerId: 'forged-customer',
      }),
    ).resolves.toBeNull();
    expect(
      JSON.stringify(
        await inspection.recommendation(
          decision.response.recommendationId,
        ),
      ),
    ).not.toContain('customer-presentation-1');

    const actionId = decision.response.primaryOffer!.actions[0]!.actionId;
    await expect(
      service.resolveTrustedAction({
        recommendationId: decision.response.recommendationId,
        recommendationActionId: actionId,
        sessionId: request.sessionId,
        customerId: 'customer-presentation-1',
        cartRevision: request.cartRevision,
      }),
    ).resolves.toMatchObject({
      status: 'resolved',
      action: { actionId },
    });
    await expect(
      service.resolveTrustedAction({
        recommendationId: decision.response.recommendationId,
        recommendationActionId: actionId,
        sessionId: request.sessionId,
        customerId: 'customer-presentation-1',
        cartRevision: 'cart-revision-forged',
      }),
    ).resolves.toEqual({ status: 'cart_revision_conflict' });
    await expect(
      service.resolveTrustedAction({
        recommendationId: decision.response.recommendationId,
        recommendationActionId: 'recommendation-action-forged',
        sessionId: request.sessionId,
        customerId: 'customer-presentation-1',
        cartRevision: request.cartRevision,
      }),
    ).resolves.toEqual({ status: 'action_not_found' });

    await expect(
      service.recordOutcome(
        decision.response.recommendationId,
        parseRecommendationOutcomeRequest({
          schemaVersion: 'kfc-recommendation-event-v1',
          eventId: 'recommendation-event-presentation-dismissed',
          eventType: 'explicitly_dismissed',
          occurredAt: '2026-07-27T09:10:00Z',
          actor: 'customer',
          actionId: null,
          cartRevision: request.cartRevision,
          payload: {},
        }),
      ),
    ).resolves.toMatchObject({ status: 'recorded' });
    await expect(
      service.resolveTrustedAction({
        recommendationId: decision.response.recommendationId,
        recommendationActionId: actionId,
        sessionId: request.sessionId,
        customerId: 'customer-presentation-1',
        cartRevision: request.cartRevision,
      }),
    ).resolves.toEqual({ status: 'stale_recommendation' });
  });

  it('persists a silent decision without manufacturing rendered actions', async () => {
    const emptyEngine: RecommendationDecisionEngine = {
      async decide(context) {
        const recommended = responseFor(context);
        return {
          response: parseRecommendationDecisionResponse({
            ...recommended,
            status: 'empty',
            primaryOffer: null,
            displayFacts: [],
            reasonCodes: [],
            merchandisingEffects: [],
            counts: {
              potential: 0,
              eligible: 0,
              ineligible: 0,
              scored: 0,
              displayed: 0,
              complete: true,
            },
          }),
          technical: {
            ...technical(),
            emptyReason: 'no_eligible_candidates',
          },
        };
      },
    };
    const { service, store } = await application(emptyEngine);
    const request = requestFor({
      suffix: 'silent-render-binding',
      placement: 'local_favorite',
    });

    const result = await service.decide({ request });

    expect(result).toMatchObject({
      status: 'decided',
      response: { status: 'empty' },
    });
    const stored =
      result.status === 'decided' || result.status === 'replay'
        ? await store.getRecommendationDecision(
            result.response.recommendationId,
          )
        : undefined;
    expect(stored?.renderBinding.renderedActions).toEqual([]);
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
