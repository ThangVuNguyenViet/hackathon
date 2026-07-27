import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { buildServerOptionsFromEnv } from '../../src/api/serverOptions.js';
import { loadEnv } from '../../src/config/env.js';
import { digestCommerceAction } from '../../src/ordering/commerceDigest.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { parseRecommendationDecisionApplicationInput } from '../../src/recommendations/application/context-factory.js';
import { parseRecommendationDecisionRequest } from '../../src/recommendations/domain/schemas.js';
import worker, { type WorkerEnv } from '../../src/worker.js';
import { SqliteD1Database } from '../support/sqlite-d1.js';

const adminToken = 'recommendation-parity-admin';

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

type PairResponse = {
  fastify: { status: number; body: string };
  worker: { status: number; body: string };
};

describe.sequential('Fastify and Worker recommendation route parity', () => {
  const memory = new MemoryStore();
  const database = new SqliteD1Database();
  const env: WorkerEnv = {
    DB: database,
    KFC_DEMO_ADMIN_TOKEN: adminToken,
  };
  let server: FastifyInstance;

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-27T09:30:00Z'));
    server = buildServer({
      ...buildServerOptionsFromEnv(
        loadEnv({ KFC_DEMO_ADMIN_TOKEN: adminToken }),
      ),
      store: memory,
    });
  });

  afterAll(async () => {
    await server.close();
    database.close();
    vi.useRealTimers();
  });

  async function dispatch(input: {
    method: 'GET' | 'POST';
    path: string;
    payload?: unknown;
    headers?: Record<string, string>;
  }): Promise<PairResponse> {
    const headers = {
      ...(input.payload === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...input.headers,
    };
    const [fastifyResponse, workerResponse] = await Promise.all([
      server.inject({
        method: input.method,
        url: input.path,
        headers,
        ...(input.payload === undefined
          ? {}
          : { payload: JSON.stringify(input.payload) }),
      }),
      worker.fetch(
        new Request(`https://worker.example${input.path}`, {
          method: input.method,
          headers,
          ...(input.payload === undefined
            ? {}
            : { body: JSON.stringify(input.payload) }),
        }),
        env,
      ),
    ]);
    return {
      fastify: {
        status: fastifyResponse.statusCode,
        body: fastifyResponse.body,
      },
      worker: {
        status: workerResponse.status,
        body: await workerResponse.text(),
      },
    };
  }

  async function expectParity(input: Parameters<typeof dispatch>[0]) {
    const result = await dispatch(input);
    expect(result.worker).toEqual(result.fastify);
    return {
      status: result.fastify.status,
      body: JSON.parse(result.fastify.body) as Record<string, unknown>,
      raw: result.fastify.body,
    };
  }

  it('maps decision validation, success, replay, pending, and conflict statuses byte-for-byte', async () => {
    await expect(
      expectParity({
        method: 'POST',
        path: '/v1/recommendations/decide',
        payload: {},
      }),
    ).resolves.toEqual({
      status: 400,
      body: { errorCode: 'invalid_recommendation_request' },
      raw: '{"errorCode":"invalid_recommendation_request"}',
    });

    const request = decisionRequest('parity-decision');
    const decided = await expectParity({
      method: 'POST',
      path: '/v1/recommendations/decide',
      payload: request,
    });
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({
      requestId: request.requestId,
      status: 'recommended',
    });
    expect(decided.raw).not.toMatch(
      /"technical"|"customerHistory"|"eligibilityDecisions"/u,
    );

    const replay = await expectParity({
      method: 'POST',
      path: '/v1/recommendations/decide',
      payload: structuredClone(request),
    });
    expect(replay).toEqual(decided);

    const conflict = await expectParity({
      method: 'POST',
      path: '/v1/recommendations/decide',
      payload: {
        ...request,
        cart: {
          ...request.cart,
          subtotal: { amount: 1, currency: 'VND' },
        },
      },
    });
    expect(conflict).toMatchObject({
      status: 409,
      body: { errorCode: 'recommendation_idempotency_conflict' },
    });

    const pendingRequest = decisionRequest('parity-pending');
    const parsed = parseRecommendationDecisionApplicationInput({
      request: pendingRequest,
    });
    const requestFingerprint = await digestCommerceAction(parsed);
    const d1 = new D1Store(database);
    await Promise.all([
      memory.reserveRecommendationDecision({
        sessionId: pendingRequest.sessionId,
        idempotencyKey: pendingRequest.idempotencyKey,
        requestId: pendingRequest.requestId,
        requestFingerprint,
        ownerToken: 'memory-pending-owner',
        createdAt: '2026-07-27T09:00:00Z',
      }),
      d1.reserveRecommendationDecision({
        sessionId: pendingRequest.sessionId,
        idempotencyKey: pendingRequest.idempotencyKey,
        requestId: pendingRequest.requestId,
        requestFingerprint,
        ownerToken: 'd1-pending-owner',
        createdAt: '2026-07-27T09:00:00Z',
      }),
    ]);
    const pending = await expectParity({
      method: 'POST',
      path: '/v1/recommendations/decide',
      payload: pendingRequest,
    });
    expect(pending).toMatchObject({
      status: 425,
      body: { errorCode: 'recommendation_request_pending' },
    });
  });

  it('maps impression and outcome writes, dedupe, and rejection statuses byte-for-byte', async () => {
    const request = decisionRequest('parity-events');
    const decision = await expectParity({
      method: 'POST',
      path: '/v1/recommendations/decide',
      payload: request,
    });
    const recommendationId = String(decision.body.recommendationId);
    const inspection = await expectParity({
      method: 'GET',
      path: `/admin/recommendations/${encodeURIComponent(recommendationId)}/inspection`,
      headers: { 'x-kfc-demo-admin-token': adminToken },
    });
    const inspectionBody = inspection.body as {
      recommendation: { actionDigest: string };
    };
    const primaryOffer = decision.body.primaryOffer as {
      actions: Array<{ actionId: string }>;
    };
    const impression = {
      schemaVersion: 'kfc-recommendation-event-v1',
      eventId: 'recommendation-event-impression-parity-events',
      occurredAt: '2026-07-27T09:10:00Z',
      assistantTurnId: 'assistant-turn-parity-events',
      attachmentId: 'attachment-parity-events',
      renderedActions: primaryOffer.actions.map((action, index) => ({
        actionId: action.actionId,
        position: index + 1,
      })),
      cartRevision: request.cartRevision,
      actionDigest: inspectionBody.recommendation.actionDigest,
    };
    const impressionPath = `/v1/recommendations/${encodeURIComponent(recommendationId)}/impressions`;
    expect(
      await expectParity({
        method: 'POST',
        path: impressionPath,
        payload: impression,
      }),
    ).toMatchObject({ status: 201, body: { deduplicated: false } });
    expect(
      await expectParity({
        method: 'POST',
        path: impressionPath,
        payload: structuredClone(impression),
      }),
    ).toMatchObject({ status: 200, body: { deduplicated: true } });

    const outcome = outcomeFor('parity-events', request);
    const outcomePath = `/v1/recommendations/${encodeURIComponent(recommendationId)}/outcomes`;
    expect(
      await expectParity({
        method: 'POST',
        path: outcomePath,
        payload: outcome,
      }),
    ).toMatchObject({ status: 201, body: { deduplicated: false } });
    expect(
      await expectParity({
        method: 'POST',
        path: outcomePath,
        payload: structuredClone(outcome),
      }),
    ).toMatchObject({ status: 200, body: { deduplicated: true } });

    const invalid = await expectParity({
      method: 'POST',
      path: '/v1/recommendations/recommendation-missing/impressions',
      payload: {},
    });
    expect(invalid).toMatchObject({
      status: 400,
      body: { errorCode: 'invalid_recommendation_impression' },
    });

    const missing = await expectParity({
      method: 'POST',
      path: '/v1/recommendations/recommendation-missing/outcomes',
      payload: outcomeFor('parity-missing', decisionRequest('parity-missing')),
    });
    expect(missing).toMatchObject({
      status: 404,
      body: { errorCode: 'recommendation_not_found' },
    });

    const stale = await expectParity({
      method: 'POST',
      path: outcomePath,
      payload: outcomeFor('parity-events-stale', request),
    });
    expect(stale).toMatchObject({
      status: 409,
      body: { errorCode: 'stale_recommendation' },
    });
  });

  it('maps cart, render-binding, and event-id conflicts byte-for-byte', async () => {
    const cartRequest = decisionRequest('parity-cart');
    const cartDecision = await expectParity({
      method: 'POST',
      path: '/v1/recommendations/decide',
      payload: cartRequest,
    });
    const cartPath = `/v1/recommendations/${encodeURIComponent(String(cartDecision.body.recommendationId))}/outcomes`;
    expect(
      await expectParity({
        method: 'POST',
        path: cartPath,
        payload: {
          ...outcomeFor('parity-cart', cartRequest),
          cartRevision: 'wrong-cart-revision',
        },
      }),
    ).toMatchObject({
      status: 409,
      body: { errorCode: 'recommendation_cart_revision_conflict' },
    });

    const bindingRequest = decisionRequest('parity-binding');
    const bindingDecision = await expectParity({
      method: 'POST',
      path: '/v1/recommendations/decide',
      payload: bindingRequest,
    });
    const bindingPath = `/v1/recommendations/${encodeURIComponent(String(bindingDecision.body.recommendationId))}/outcomes`;
    expect(
      await expectParity({
        method: 'POST',
        path: bindingPath,
        payload: {
          ...outcomeFor('parity-binding', bindingRequest, 'selected'),
          actionId: 'product:not-offered',
        },
      }),
    ).toMatchObject({
      status: 409,
      body: { errorCode: 'recommendation_render_binding_conflict' },
    });

    const conflictRequest = decisionRequest('parity-event-conflict');
    const conflictDecision = await expectParity({
      method: 'POST',
      path: '/v1/recommendations/decide',
      payload: conflictRequest,
    });
    const conflictPath = `/v1/recommendations/${encodeURIComponent(String(conflictDecision.body.recommendationId))}/outcomes`;
    const conflictEvent = outcomeFor('parity-event-conflict', conflictRequest);
    expect(
      await expectParity({
        method: 'POST',
        path: conflictPath,
        payload: conflictEvent,
      }),
    ).toMatchObject({ status: 201 });
    expect(
      await expectParity({
        method: 'POST',
        path: conflictPath,
        payload: {
          ...conflictEvent,
          payload: { changed: true },
        },
      }),
    ).toMatchObject({
      status: 409,
      body: { errorCode: 'recommendation_event_conflict' },
    });
  });

  it('applies identical demo-admin authorization and returns identical protected projections', async () => {
    const request = decisionRequest('parity-admin');
    const decision = await expectParity({
      method: 'POST',
      path: '/v1/recommendations/decide',
      payload: request,
    });
    const recommendationId = String(decision.body.recommendationId);
    const inspectionPath = `/admin/recommendations/${encodeURIComponent(recommendationId)}/inspection`;
    const statePath = `/admin/recommendations/order-flows/${encodeURIComponent(request.orderFlowId)}/state`;

    expect(
      await expectParity({ method: 'GET', path: inspectionPath }),
    ).toMatchObject({
      status: 401,
      body: { errorCode: 'demo_admin_unauthorized' },
    });
    const noTokenServer = buildServer({
      ...buildServerOptionsFromEnv(loadEnv({})),
      store: new MemoryStore(),
    });
    try {
      for (const path of [inspectionPath, statePath]) {
        const [fastifyResponse, workerResponse] = await Promise.all([
          noTokenServer.inject({ method: 'GET', url: path }),
          worker.fetch(new Request(`https://worker.example${path}`), {
            ...env,
            KFC_DEMO_ADMIN_TOKEN: undefined,
          }),
        ]);
        expect({
          status: workerResponse.status,
          body: await workerResponse.text(),
        }).toEqual({
          status: fastifyResponse.statusCode,
          body: fastifyResponse.body,
        });
        expect(fastifyResponse.statusCode).toBe(503);
        expect(fastifyResponse.json()).toEqual({
          errorCode: 'demo_admin_token_not_configured',
        });
      }
    } finally {
      await noTokenServer.close();
    }
    const inspection = await expectParity({
      method: 'GET',
      path: inspectionPath,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(inspection).toMatchObject({
      status: 200,
      body: {
        schemaVersion: 'kfc-recommendation-inspection-v1',
        technical: {},
      },
    });
    expect(inspection.raw).not.toContain('history:verified:');
    expect(inspection.raw).not.toContain('completed-order:');

    const state = await expectParity({
      method: 'GET',
      path: statePath,
      headers: { 'x-kfc-demo-admin-token': adminToken },
    });
    expect(state).toMatchObject({
      status: 200,
      body: {
        schemaVersion: 'kfc-recommendation-order-flow-inspection-v1',
        state: { orderFlowId: request.orderFlowId },
      },
    });
  });
});
