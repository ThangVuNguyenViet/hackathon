import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { createRouteHandlers } from '../../src/api/routeHandlers.js';
import { digestCommerceAction } from '../../src/ordering/commerceDigest.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import type {
  AppendRecommendationEventInput,
  AppendRecommendationEventResult,
  CommitRecommendationDecisionInput,
  CommitRecommendationDecisionResult,
} from '../../src/recommendations/persistence/repository.js';
import { parseRecommendationDecisionApplicationInput } from '../../src/recommendations/application/context-factory.js';
import { parseRecommendationDecisionRequest } from '../../src/recommendations/domain/schemas.js';
import { renderBindingForDecisionDigests } from '../../src/recommendations/persistence/types.js';
import { buildDeterministicRecommendationServerOptions } from '../support/recommendationSanity.js';
import type {
  AgentTraceSpan,
  AgentTraceSpanInput,
  AgentTracer,
} from '../../src/observability/agentTracing.js';

const noOpTraceSpan: AgentTraceSpan = {
  async startSpan(_input: AgentTraceSpanInput) {
    return noOpTraceSpan;
  },
  async end() {},
  async fail() {},
};

const adminToken = 'recommendation-admin-token';
const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function snapshotBinding(name: string, suffix: string) {
  return {
    snapshotId: `${name}-snapshot-${suffix}`,
    digest: name.at(0)!.repeat(64),
    sourceRevision: `${name}-revision-${suffix}`,
    observedAt: '2026-07-27T08:00:00Z',
    effectiveAt: '2026-07-27T08:00:00Z',
    expiresAt: '2026-07-27T10:00:00Z',
    complete: true,
    commerceEnvironment: 'kfc-vietnam-demo',
    provenance: { source: 'test', reference: `${name}-${suffix}` },
  };
}

function decisionRequest(suffix: string) {
  const cartRevision = `cart-revision-${suffix}`;
  return parseRecommendationDecisionRequest({
    schemaVersion: 'kfc-recommendation-v1',
    requestId: `rec-request-${suffix}`,
    idempotencyKey: `rec-idempotency-${suffix}`,
    orderFlowId: `order-flow-${suffix}`,
    sessionId: `session-${suffix}`,
    placement: 'local_favorite',
    verifiedCustomerRef: null,
    storeId: 'KFCVN0002',
    fulfilmentMode: 'pickup',
    decisionTime: '2026-07-27T09:00:00Z',
    cart: {
      cartId: `cart-${suffix}`,
      revision: cartRevision,
      subtotal: { amount: 0, currency: 'VND' },
      lines: [],
    },
    cartRevision,
    commerceSnapshotBindings: {
      catalog: snapshotBinding('a-catalog', suffix),
      modifierGraph: snapshotBinding('b-modifier', suffix),
      store: snapshotBinding('c-store', suffix),
      availability: snapshotBinding('d-availability', suffix),
      promotion: snapshotBinding('e-promotion', suffix),
    },
    eligibilityPolicyVersion: 'kfc-recommendation-policy-v1',
    experimentProfile: {
      profileId: `experiment-${suffix}`,
      outputMode: 'baseline',
    },
  });
}

function forYouRequest(suffix: string) {
  return parseRecommendationDecisionRequest({
    ...decisionRequest(suffix),
    placement: 'for_you',
    verifiedCustomerRef: 'demo-returning-linked',
  });
}

function configuredOptions(store: MemoryStore = new MemoryStore()) {
  return {
    ...buildDeterministicRecommendationServerOptions({
      KFC_DEMO_ADMIN_TOKEN: adminToken,
    }),
    store,
  };
}

function configuredServer(store: MemoryStore = new MemoryStore()) {
  const server = buildServer(configuredOptions(store));
  servers.push(server);
  return server;
}

function unconfiguredServer(store: MemoryStore = new MemoryStore()) {
  const server = buildServer({ store, demoAdminToken: adminToken });
  servers.push(server);
  return server;
}

async function decide(
  server: FastifyInstance,
  suffix: string,
  request = decisionRequest(suffix),
) {
  const response = await server.inject({
    method: 'POST',
    url: '/v1/recommendations/decide',
    payload: request,
  });
  expect(response.statusCode).toBe(200);
  return {
    request,
    response: response.json<{
      recommendationId: string;
      primaryOffer: {
        actions: Array<{ actionId: string }>;
      };
    }>(),
    raw: response.body,
  };
}

async function inspection(server: FastifyInstance, recommendationId: string) {
  const response = await server.inject({
    method: 'GET',
    url: `/admin/recommendations/${encodeURIComponent(recommendationId)}/inspection`,
    headers: { 'x-kfc-demo-admin-token': adminToken },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{
    recommendation: { requestFingerprint: string; actionDigest: string };
    technical: unknown;
  }>();
}

function impressionFor(
  suffix: string,
  request: ReturnType<typeof decisionRequest>,
  decision: Awaited<ReturnType<typeof decide>>['response'],
  digests: { requestFingerprint: string; actionDigest: string },
) {
  return {
    schemaVersion: 'kfc-recommendation-event-v1',
    eventId: `recommendation-event-impression-${suffix}`,
    occurredAt: '2026-07-27T09:10:00Z',
    ...renderBindingForDecisionDigests(digests),
    renderedActions: decision.primaryOffer.actions.map((action, index) => ({
      actionId: action.actionId,
      position: index + 1,
    })),
    cartRevision: request.cartRevision,
    actionDigest: digests.actionDigest,
  };
}

function outcomeFor(
  suffix: string,
  request: ReturnType<typeof decisionRequest>,
  eventType = 'ignored',
) {
  return {
    schemaVersion: 'kfc-recommendation-event-v1',
    eventId: `recommendation-event-outcome-${suffix}`,
    eventType,
    occurredAt: '2026-07-27T09:11:00Z',
    actor: 'customer',
    actionId: null,
    cartRevision: request.cartRevision,
    payload: {},
  };
}

describe('recommendation Fastify routes', () => {
  it('completes a recommendation response when trace export fails', async () => {
    let flushCount = 0;
    const tracer: AgentTracer = {
      async startTurn() {
        return noOpTraceSpan;
      },
      async flush() {
        flushCount += 1;
        throw new Error('private trace transport failure');
      },
    };
    const server = buildServer({
      ...configuredOptions(),
      agentTracer: tracer,
    });
    servers.push(server);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/recommendations/decide',
      payload: decisionRequest('trace-export-failure'),
    });

    expect(response.statusCode).toBe(200);
    expect(flushCount).toBe(1);
  });

  it('returns exact 503 errors for every unconfigured recommendation route', async () => {
    const server = unconfiguredServer();
    const requests = [
      server.inject({
        method: 'POST',
        url: '/v1/recommendations/decide',
        payload: {},
      }),
      server.inject({
        method: 'POST',
        url: '/v1/recommendations/recommendation-missing/impressions',
        payload: {},
      }),
      server.inject({
        method: 'POST',
        url: '/v1/recommendations/recommendation-missing/outcomes',
        payload: {},
      }),
      server.inject({
        method: 'GET',
        url: '/admin/recommendations/recommendation-missing/inspection',
        headers: { 'x-kfc-demo-admin-token': adminToken },
      }),
      server.inject({
        method: 'GET',
        url: '/admin/recommendations/order-flows/order-flow-missing/state',
        headers: { 'x-kfc-demo-admin-token': adminToken },
      }),
    ];

    for (const response of await Promise.all(requests)) {
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        errorCode: 'recommendation_service_not_configured',
      });
    }
  });

  it('creates recommendation services exactly once after resolving the store', () => {
    const store = new MemoryStore();
    const base = configuredOptions(store).recommendations;
    expect(base).toBeDefined();
    let calls = 0;

    const handlers = createRouteHandlers({
      store,
      recommendations: {
        create(resolvedStore) {
          calls += 1;
          expect(resolvedStore).toBe(store);
          return base!.create(resolvedStore);
        },
      },
    });

    expect(handlers.store).toBe(store);
    expect(calls).toBe(1);
  });

  it('does not construct recommendation services for a store without the durable port', async () => {
    const store = new MemoryStore();
    const conversationOnlyStore = new Proxy(store, {
      get(target, property, receiver) {
        if (property === 'getRecommendationDecision') return undefined;
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const base = configuredOptions(store).recommendations;
    expect(base).toBeDefined();
    let calls = 0;
    const server = buildServer({
      store: conversationOnlyStore,
      recommendations: {
        create(resolvedStore) {
          calls += 1;
          return base!.create(resolvedStore);
        },
      },
    });
    servers.push(server);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/recommendations/decide',
      payload: decisionRequest('missing-durable-port'),
    });

    expect(calls).toBe(0);
    expect([response.statusCode, response.json()]).toEqual([
      503,
      { errorCode: 'recommendation_service_not_configured' },
    ]);
  });

  it('allows the demo-admin token header in CORS preflight', async () => {
    const response = await configuredServer().inject({
      method: 'OPTIONS',
      url: '/admin/recommendations/recommendation-any/inspection',
      headers: {
        origin: 'https://admin.example',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'X-KFC-Demo-Admin-Token',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(
      response.headers['access-control-allow-headers']?.split(','),
    ).toContain('X-KFC-Demo-Admin-Token');
  });

  it('leaves body transport errors unchanged on unrelated routes', async () => {
    const server = configuredServer();
    const malformed = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });
    const unsupported = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      headers: { 'content-type': 'application/xml' },
      payload: '<message />',
    });
    const empty = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });

    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({
      code: 'FST_ERR_CTP_INVALID_JSON_BODY',
      error: 'Bad Request',
    });
    expect(unsupported.statusCode).toBe(415);
    expect(unsupported.json()).toMatchObject({
      code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE',
      error: 'Unsupported Media Type',
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toMatchObject({
      code: 'FST_ERR_CTP_EMPTY_JSON_BODY',
      error: 'Bad Request',
    });
    expect(malformed.body).not.toContain('invalid_recommendation_');
    expect(unsupported.body).not.toContain('invalid_recommendation_');
    expect(empty.body).not.toContain('invalid_recommendation_');
  });

  it('returns only the canonical decision envelope and replays it byte-for-byte', async () => {
    const server = configuredServer();
    const request = forYouRequest('canonical-replay');
    const first = await server.inject({
      method: 'POST',
      url: '/v1/recommendations/decide',
      payload: request,
    });
    const replay = await server.inject({
      method: 'POST',
      url: '/v1/recommendations/decide',
      payload: structuredClone(request),
    });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.body).toBe(first.body);
    const body = first.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      schemaVersion: 'kfc-recommendation-v1',
      requestId: request.requestId,
      orderFlowId: request.orderFlowId,
      status: 'recommended',
    });
    expect(JSON.stringify(body)).not.toMatch(
      /"technical"|"customerHistory"|"eligibilityDecisions"|"potentialCandidates"|"eligiblePrePolicyRanking"/u,
    );
  });

  it('maps invalid, pending, idempotency-conflict, and state-conflict decisions', async () => {
    const invalid = await configuredServer().inject({
      method: 'POST',
      url: '/v1/recommendations/decide',
      payload: {},
    });
    expect([invalid.statusCode, invalid.json()]).toEqual([
      400,
      { errorCode: 'invalid_recommendation_request' },
    ]);

    const conflictServer = configuredServer();
    const conflictRequest = decisionRequest('decision-conflict');
    expect(
      (
        await conflictServer.inject({
          method: 'POST',
          url: '/v1/recommendations/decide',
          payload: conflictRequest,
        })
      ).statusCode,
    ).toBe(200);
    const conflict = await conflictServer.inject({
      method: 'POST',
      url: '/v1/recommendations/decide',
      payload: {
        ...conflictRequest,
        cart: {
          ...conflictRequest.cart,
          subtotal: { amount: 1, currency: 'VND' },
        },
      },
    });
    expect([conflict.statusCode, conflict.json()]).toEqual([
      409,
      { errorCode: 'recommendation_idempotency_conflict' },
    ]);

    const pendingStore = new MemoryStore();
    const pendingRequest = decisionRequest('decision-pending');
    const parsed = parseRecommendationDecisionApplicationInput({
      request: pendingRequest,
    });
    await pendingStore.reserveRecommendationDecision({
      sessionId: pendingRequest.sessionId,
      idempotencyKey: pendingRequest.idempotencyKey,
      requestId: pendingRequest.requestId,
      requestFingerprint: await digestCommerceAction(parsed),
      ownerToken: 'pending-owner-token',
      createdAt: '2026-07-27T09:00:00Z',
    });
    const pending = await configuredServer(pendingStore).inject({
      method: 'POST',
      url: '/v1/recommendations/decide',
      payload: pendingRequest,
    });
    expect([pending.statusCode, pending.json()]).toEqual([
      425,
      { errorCode: 'recommendation_request_pending' },
    ]);

    class StaleDecisionStore extends MemoryStore {
      override async commitRecommendationDecision(
        _input: CommitRecommendationDecisionInput,
      ): Promise<CommitRecommendationDecisionResult> {
        return { status: 'stale' };
      }
    }
    const stateConflict = await configuredServer(
      new StaleDecisionStore(),
    ).inject({
      method: 'POST',
      url: '/v1/recommendations/decide',
      payload: decisionRequest('decision-state-conflict'),
    });
    expect([stateConflict.statusCode, stateConflict.json()]).toEqual([
      409,
      { errorCode: 'recommendation_state_conflict' },
    ]);
  });

  it('rejects unpublished impressions and client-authored outcomes', async () => {
    const server = configuredServer();
    const impressionDecision = await decide(server, 'impression-dedupe');
    const impressionInspection = await inspection(
      server,
      impressionDecision.response.recommendationId,
    );
    const impression = impressionFor(
      'impression-dedupe',
      impressionDecision.request,
      impressionDecision.response,
      impressionInspection.recommendation,
    );
    const firstImpression = await server.inject({
      method: 'POST',
      url: `/v1/recommendations/${encodeURIComponent(impressionDecision.response.recommendationId)}/impressions`,
      payload: impression,
    });
    const replayedImpression = await server.inject({
      method: 'POST',
      url: `/v1/recommendations/${encodeURIComponent(impressionDecision.response.recommendationId)}/impressions`,
      payload: structuredClone(impression),
    });
    expect([firstImpression.statusCode, firstImpression.json()]).toEqual([
      409,
      { errorCode: 'recommendation_render_binding_conflict' },
    ]);
    expect([replayedImpression.statusCode, replayedImpression.json()]).toEqual([
      409,
      { errorCode: 'recommendation_render_binding_conflict' },
    ]);

    const outcomeDecision = await decide(server, 'outcome-dedupe');
    const outcome = outcomeFor('outcome-dedupe', outcomeDecision.request);
    const firstOutcome = await server.inject({
      method: 'POST',
      url: `/v1/recommendations/${encodeURIComponent(outcomeDecision.response.recommendationId)}/outcomes`,
      payload: outcome,
    });
    const replayedOutcome = await server.inject({
      method: 'POST',
      url: `/v1/recommendations/${encodeURIComponent(outcomeDecision.response.recommendationId)}/outcomes`,
      payload: structuredClone(outcome),
    });
    expect([firstOutcome.statusCode, firstOutcome.json()]).toEqual([
      403,
      { errorCode: 'untrusted_recommendation_outcome' },
    ]);
    expect([replayedOutcome.statusCode, replayedOutcome.json()]).toEqual([
      403,
      { errorCode: 'untrusted_recommendation_outcome' },
    ]);
    expect(JSON.stringify(firstOutcome.json())).not.toMatch(
      /"technical"|"customerHistory"|"eligibilityDecisions"/u,
    );
  });

  it('rejects a client-authored outcome without advancing recommendation state', async () => {
    const server = configuredServer();
    const decision = await decide(server, 'untrusted-outcome');
    const response = await server.inject({
      method: 'POST',
      url: `/v1/recommendations/${encodeURIComponent(decision.response.recommendationId)}/outcomes`,
      payload: outcomeFor('untrusted-outcome', decision.request),
    });

    expect([response.statusCode, response.json()]).toEqual([
      403,
      { errorCode: 'untrusted_recommendation_outcome' },
    ]);
    const inspection = await server.inject({
      method: 'GET',
      url: `/admin/recommendations/${encodeURIComponent(decision.response.recommendationId)}/inspection`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(inspection.json()).toMatchObject({
      state: {
        pendingRecommendation: {
          recommendationId: decision.response.recommendationId,
        },
      },
    });
  });

  it('maps every impression and outcome rejection without leaking technical evidence', async () => {
    const server = configuredServer();
    const invalidImpression = await server.inject({
      method: 'POST',
      url: '/v1/recommendations/recommendation-missing/impressions',
      payload: {},
    });
    const invalidOutcome = await server.inject({
      method: 'POST',
      url: '/v1/recommendations/recommendation-missing/outcomes',
      payload: {},
    });
    expect([invalidImpression.statusCode, invalidImpression.json()]).toEqual([
      400,
      { errorCode: 'invalid_recommendation_impression' },
    ]);
    expect([invalidOutcome.statusCode, invalidOutcome.json()]).toEqual([
      400,
      { errorCode: 'invalid_recommendation_outcome' },
    ]);

    const missingOutcome = await server.inject({
      method: 'POST',
      url: '/v1/recommendations/recommendation-missing/outcomes',
      payload: outcomeFor('missing', decisionRequest('missing')),
    });
    expect([missingOutcome.statusCode, missingOutcome.json()]).toEqual([
      403,
      { errorCode: 'untrusted_recommendation_outcome' },
    ]);

    const cartDecision = await decide(server, 'wrong-cart');
    const wrongCart = await server.inject({
      method: 'POST',
      url: `/v1/recommendations/${encodeURIComponent(cartDecision.response.recommendationId)}/outcomes`,
      payload: {
        ...outcomeFor('wrong-cart', cartDecision.request),
        cartRevision: 'wrong-cart-revision',
      },
    });
    expect([wrongCart.statusCode, wrongCart.json()]).toEqual([
      403,
      { errorCode: 'untrusted_recommendation_outcome' },
    ]);

    const bindingDecision = await decide(server, 'wrong-binding');
    const wrongBinding = await server.inject({
      method: 'POST',
      url: `/v1/recommendations/${encodeURIComponent(bindingDecision.response.recommendationId)}/outcomes`,
      payload: {
        ...outcomeFor('wrong-binding', bindingDecision.request, 'selected'),
        actionId: 'product:not-offered',
      },
    });
    expect([wrongBinding.statusCode, wrongBinding.json()]).toEqual([
      403,
      { errorCode: 'untrusted_recommendation_outcome' },
    ]);

    const staleDecision = await decide(server, 'stale');
    const staleUrl = `/v1/recommendations/${encodeURIComponent(staleDecision.response.recommendationId)}/outcomes`;
    expect(
      (
        await server.inject({
          method: 'POST',
          url: staleUrl,
          payload: outcomeFor('stale-first', staleDecision.request),
        })
      ).statusCode,
    ).toBe(403);
    const stale = await server.inject({
      method: 'POST',
      url: staleUrl,
      payload: outcomeFor('stale-second', staleDecision.request),
    });
    expect([stale.statusCode, stale.json()]).toEqual([
      403,
      { errorCode: 'untrusted_recommendation_outcome' },
    ]);

    const eventConflictDecision = await decide(server, 'event-conflict');
    const eventConflictUrl = `/v1/recommendations/${encodeURIComponent(eventConflictDecision.response.recommendationId)}/outcomes`;
    const event = outcomeFor('event-conflict', eventConflictDecision.request);
    expect(
      (
        await server.inject({
          method: 'POST',
          url: eventConflictUrl,
          payload: event,
        })
      ).statusCode,
    ).toBe(403);
    const eventConflict = await server.inject({
      method: 'POST',
      url: eventConflictUrl,
      payload: { ...event, payload: { changed: true } },
    });
    expect([eventConflict.statusCode, eventConflict.json()]).toEqual([
      403,
      { errorCode: 'untrusted_recommendation_outcome' },
    ]);
  });

  it('rejects an untrusted outcome before stale event persistence', async () => {
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
    const store = new StaleEventStore();
    const server = configuredServer(store);
    const decision = await decide(server, 'event-state-conflict');
    store.stale = true;

    const response = await server.inject({
      method: 'POST',
      url: `/v1/recommendations/${encodeURIComponent(decision.response.recommendationId)}/outcomes`,
      payload: outcomeFor('event-state-conflict', decision.request),
    });

    expect([response.statusCode, response.json()]).toEqual([
      403,
      { errorCode: 'untrusted_recommendation_outcome' },
    ]);
  });

  it('protects inspection reads and exposes redacted technical/state projections only to admins', async () => {
    const server = configuredServer();
    const decision = await decide(server, 'admin', forYouRequest('admin'));
    const inspectionUrl = `/admin/recommendations/${encodeURIComponent(decision.response.recommendationId)}/inspection`;
    const unauthorized = await server.inject({
      method: 'GET',
      url: inspectionUrl,
    });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await server.inject({
      method: 'GET',
      url: inspectionUrl,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toMatchObject({
      schemaVersion: 'kfc-recommendation-inspection-v1',
      recommendation: {
        response: { recommendationId: decision.response.recommendationId },
      },
      technical: {},
    });
    expect(authorized.body).toContain('redacted:verified-history');
    expect(authorized.body).toContain('redacted:completed-order');
    expect(authorized.body).not.toContain('history:verified:');
    expect(authorized.body).not.toContain('completed-order:');

    const state = await server.inject({
      method: 'GET',
      url: `/admin/recommendations/order-flows/${encodeURIComponent(decision.request.orderFlowId)}/state`,
      headers: { 'x-kfc-demo-admin-token': adminToken },
    });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({
      schemaVersion: 'kfc-recommendation-order-flow-inspection-v1',
      state: { orderFlowId: decision.request.orderFlowId },
      latestDecision: {
        recommendationId: decision.response.recommendationId,
      },
      events: [
        {
          eventType: 'decision_requested',
          requestId: decision.request.requestId,
        },
        {
          eventType: 'decision_completed',
          recommendationId: decision.response.recommendationId,
          requestId: decision.request.requestId,
        },
      ],
    });
  });
});
