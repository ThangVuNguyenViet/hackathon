import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { buildServerOptionsFromEnv } from '../../src/api/serverOptions.js';
import type { LifecycleInstance } from '../../src/commerce/lifecycleProvider.js';
import { loadEnv } from '../../src/config/env.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { parseRecommendationDecisionRequest } from '../../src/recommendations/domain/schemas.js';

const adminToken = 'recommendation-proof-admin-token';
const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function lifecycleProof(): { instance: LifecycleInstance; audit: unknown[] } {
  return {
    instance: {
      instanceId: 'lifecycle-instance',
      environment: 'sandbox',
      scenarioDefinitionVersion: 'scenario-v1',
      releaseId: 'release-v1',
      catalogObservationId: 'catalog-v1',
      catalogHash: 'a'.repeat(64),
      customerBinding: 'customer-proof',
      sessionBinding: 'kfc:customer-proof',
      paymentPolicy: 'prepaid',
      fulfillmentPolicy: 'pickup',
      logicalTime: 1,
      expiresAt: 2,
      revision: 1,
      state: { payment: null, order: null, delivery: null },
      sealedAt: null,
      resetFrom: null,
    },
    audit: [
      {
        revision: 1,
        eventId: 'lifecycle-created',
        eventType: 'created',
        outcome: 'committed',
        priorRevision: null,
        createdAt: '2026-07-27T09:00:00Z',
      },
    ],
  };
}

async function configuredServer() {
  const store = new MemoryStore();
  const sessionId = 'kfc:customer-proof';
  await store.appendTurn({
    sessionId,
    channel: 'kfc',
    role: 'user',
    text: 'I would like a meal.',
    externalMessageId: null,
    externalUserId: 'customer-proof',
    deliveryStatus: 'sent',
    metadata: null,
  });
  const server = buildServer({
    ...buildServerOptionsFromEnv(loadEnv({ KFC_DEMO_ADMIN_TOKEN: adminToken })),
    store,
    lifecycle: {
      environment: 'sandbox',
      controls: {
        create: async () => {
          throw new Error('not used by proof-envelope test');
        },
        get: async () => {
          throw new Error('not used by proof-envelope test');
        },
        transition: async () => {
          throw new Error('not used by proof-envelope test');
        },
      },
      createInput: async () => {
        throw new Error('not used by proof-envelope test');
      },
      binding: async () => {
        throw new Error('not used by proof-envelope test');
      },
      proofForSession: async () => lifecycleProof(),
    },
  });
  servers.push(server);
  return { server, sessionId };
}

function snapshotBinding(name: string) {
  return {
    snapshotId: `${name}-snapshot-proof`,
    digest: name.at(0)!.repeat(64),
    sourceRevision: `${name}-revision-proof`,
    observedAt: '2026-07-27T08:00:00Z',
    effectiveAt: '2026-07-27T08:00:00Z',
    expiresAt: '2026-07-27T10:00:00Z',
    complete: true,
    commerceEnvironment: 'kfc-vietnam-demo',
    provenance: { source: 'test', reference: `${name}-proof` },
  };
}

function decisionRequest(sessionId: string) {
  return parseRecommendationDecisionRequest({
    schemaVersion: 'kfc-recommendation-v1',
    requestId: 'proof-request',
    idempotencyKey: 'proof-idempotency',
    orderFlowId: 'proof-order-flow',
    sessionId,
    placement: 'for_you',
    verifiedCustomerRef: 'demo-returning-linked',
    storeId: 'KFCVN0002',
    fulfilmentMode: 'pickup',
    decisionTime: '2026-07-27T09:00:00Z',
    cart: {
      cartId: 'proof-cart',
      revision: 'proof-cart-revision',
      subtotal: { amount: 0, currency: 'VND' },
      lines: [],
    },
    cartRevision: 'proof-cart-revision',
    commerceSnapshotBindings: {
      catalog: snapshotBinding('a-catalog'),
      modifierGraph: snapshotBinding('b-modifier'),
      store: snapshotBinding('c-store'),
      availability: snapshotBinding('d-availability'),
      promotion: snapshotBinding('e-promotion'),
    },
    eligibilityPolicyVersion: 'kfc-recommendation-policy-v1',
    experimentProfile: {
      profileId: 'proof-experiment',
      outputMode: 'baseline',
    },
  });
}

async function proofEnvelope(server: FastifyInstance, sessionId: string) {
  const response = await server.inject({
    method: 'GET',
    url: `/admin/proof/kfc/sessions/${encodeURIComponent(sessionId)}/envelope`,
    headers: { 'x-kfc-demo-admin-token': adminToken },
  });
  expect(response.statusCode).toBe(200);
  return response;
}

describe('KFC recommendation proof envelope', () => {
  it('returns an explicit empty recommendation projection without making an otherwise complete KFC proof incomplete', async () => {
    const { server, sessionId } = await configuredServer();

    const response = await server.inject({
      method: 'GET',
      url: `/admin/proof/kfc/sessions/${encodeURIComponent(sessionId)}/envelope`,
      headers: { 'x-kfc-demo-admin-token': adminToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      complete: true,
      missing: [],
      recommendations: {
        state: null,
        latestDecision: null,
        pendingAction: null,
        correlations: {
          orderFlowId: null,
          recommendationId: null,
          requestId: null,
          traceRef: null,
        },
        eventCounts: {},
      },
    });
  });

  it('composes the redacted recommendation state through decision, impression, and selection transitions', async () => {
    const { server, sessionId } = await configuredServer();
    const request = decisionRequest(sessionId);
    const decisionResponse = await server.inject({
      method: 'POST',
      url: '/v1/recommendations/decide',
      payload: request,
    });
    expect(decisionResponse.statusCode).toBe(200);
    const decision = decisionResponse.json<{
      recommendationId: string;
      traceRef: string;
      primaryOffer: { actions: Array<{ actionId: string }> };
    }>();

    const afterDecision = await proofEnvelope(server, sessionId);
    expect(afterDecision.json()).toMatchObject({
      recommendations: {
        state: { orderFlowId: request.orderFlowId },
        latestDecision: {
          recommendationId: decision.recommendationId,
          requestId: request.requestId,
          placement: request.placement,
          traceRef: decision.traceRef,
        },
        pendingAction: {
          recommendationId: decision.recommendationId,
          requestId: request.requestId,
        },
        correlations: {
          orderFlowId: request.orderFlowId,
          recommendationId: decision.recommendationId,
          requestId: request.requestId,
          traceRef: decision.traceRef,
        },
        eventCounts: { decision_completed: 1 },
      },
    });

    const inspectionResponse = await server.inject({
      method: 'GET',
      url: `/admin/recommendations/${encodeURIComponent(decision.recommendationId)}/inspection`,
      headers: { 'x-kfc-demo-admin-token': adminToken },
    });
    expect(inspectionResponse.statusCode).toBe(200);
    const inspection = inspectionResponse.json<{ recommendation: { actionDigest: string } }>();
    const impressionResponse = await server.inject({
      method: 'POST',
      url: `/v1/recommendations/${encodeURIComponent(decision.recommendationId)}/impressions`,
      payload: {
        schemaVersion: 'kfc-recommendation-event-v1',
        eventId: 'proof-impression',
        occurredAt: '2026-07-27T09:10:00Z',
        assistantTurnId: 'proof-assistant-turn',
        attachmentId: 'proof-attachment',
        renderedActions: decision.primaryOffer.actions.map((action, index) => ({
          actionId: action.actionId,
          position: index + 1,
        })),
        cartRevision: request.cartRevision,
        actionDigest: inspection.recommendation.actionDigest,
      },
    });
    expect(impressionResponse.statusCode).toBe(201);
    expect((await proofEnvelope(server, sessionId)).json()).toMatchObject({
      recommendations: {
        eventCounts: { decision_completed: 1, impression_rendered: 1 },
      },
    });

    const outcomeResponse = await server.inject({
      method: 'POST',
      url: `/v1/recommendations/${encodeURIComponent(decision.recommendationId)}/outcomes`,
      payload: {
        schemaVersion: 'kfc-recommendation-event-v1',
        eventId: 'proof-selected',
        eventType: 'selected',
        occurredAt: '2026-07-27T09:11:00Z',
        actor: 'customer',
        actionId: decision.primaryOffer.actions[0]!.actionId,
        cartRevision: request.cartRevision,
        payload: {},
      },
    });
    expect(outcomeResponse.statusCode).toBe(201);
    const afterSelection = await proofEnvelope(server, sessionId);
    expect(afterSelection.json()).toMatchObject({
      recommendations: {
        state: { orderFlowId: request.orderFlowId },
        pendingAction: {
          recommendationId: decision.recommendationId,
          requestId: request.requestId,
        },
        eventCounts: {
          decision_completed: 1,
          impression_rendered: 1,
          selected: 1,
        },
      },
    });
    expect(afterSelection.body).not.toContain('history:verified:');
    expect(afterSelection.body).not.toContain('demo-returning-linked');
    expect(afterSelection.body).not.toContain('displayFacts');
    expect(afterSelection.body).not.toContain('eligibilityDecisions');
    expect(afterSelection.body).not.toContain('technical');
  });

  it('keeps the registered envelope route behind existing demo-admin authorization', async () => {
    const { server, sessionId } = await configuredServer();

    const response = await server.inject({
      method: 'GET',
      url: `/admin/proof/kfc/sessions/${encodeURIComponent(sessionId)}/envelope`,
    });

    expect([response.statusCode, response.json()]).toEqual([
      401,
      { errorCode: 'demo_admin_unauthorized' },
    ]);
  });
});
