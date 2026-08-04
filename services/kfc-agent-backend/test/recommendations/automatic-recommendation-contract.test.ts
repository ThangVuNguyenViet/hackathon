import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const contractModulePath =
  '../../src/recommendations/contracts/automatic-recommendation.js';

const commonRequest = {
  schemaVersion: 'kfc-automatic-recommendation-v1',
  requestId: 'request-contract-001',
  storeId: 'KFCVN0002',
  fulfilmentMode: 'pickup',
  locale: 'vi-VN',
  orderingJourneyRef: 'journey-contract-001',
  opportunityRef: 'opportunity-contract-001',
  cart: {
    cartId: 'cart-contract-001',
    revision: 'cart-revision-contract-001',
    subtotal: { amount: 0, currency: 'VND' },
    lines: [],
  },
} as const;

describe('automatic recommendation wire contract', () => {
  it('exposes four exact decision operations without a generic decide route', async () => {
    const contract = await import(contractModulePath);

    expect(contract.automaticRecommendationOperations).toEqual({
      local_favorite: '/v1/recommendations/local-favorites',
      for_you: '/v1/recommendations/for-you',
      modifier_upsell: '/v1/recommendations/modifier-upsells',
      smart_cross_sell: '/v1/recommendations/smart-cross-sells',
    });
  });

  it('binds canonical request and event identity digests to type and operation path', async () => {
    const { automaticRecommendationIdentityDigest } = await import(
      contractModulePath
    );
    const request = { cart: { revision: 'cart-1' }, storeId: 'KFCVN0002' };
    const reordered = { storeId: 'KFCVN0002', cart: { revision: 'cart-1' } };
    const input = {
      operationPath: '/v1/recommendations/local-favorites',
      identityType: 'local_favorite',
      payload: request,
    };
    expect(automaticRecommendationIdentityDigest(input)).toBe(
      automaticRecommendationIdentityDigest({ ...input, payload: reordered }),
    );
    expect(automaticRecommendationIdentityDigest(input)).not.toBe(
      automaticRecommendationIdentityDigest({
        ...input,
        identityType: 'smart_cross_sell',
      }),
    );
    expect(automaticRecommendationIdentityDigest(input)).not.toBe(
      automaticRecommendationIdentityDigest({
        ...input,
        operationPath: '/v1/recommendations/local-favorites/events',
      }),
    );
  });

  it('matches the published cross-runtime identity digest vector', async () => {
    const { automaticRecommendationIdentityDigest } = await import(
      contractModulePath
    );
    const manifest = await import(
      '../../../../contracts/automatic-recommendations/v1/contract-manifest.json',
      { with: { type: 'json' } }
    );
    const vector = manifest.default.identityDigestVector;

    expect(automaticRecommendationIdentityDigest(vector)).toBe(vector.sha256);
  });

  it('enforces each trusted type-specific request prerequisite', async () => {
    const { parseAutomaticRecommendationRequest } = await import(
      contractModulePath
    );

    expect(
      parseAutomaticRecommendationRequest('local_favorite', commonRequest),
    ).toMatchObject({
      orderingJourneyRef: 'journey-contract-001',
      opportunityRef: 'opportunity-contract-001',
    });
    expect(() =>
      parseAutomaticRecommendationRequest('for_you', commonRequest),
    ).toThrow();
    expect(() =>
      parseAutomaticRecommendationRequest('modifier_upsell', commonRequest),
    ).toThrow();
    expect(() =>
      parseAutomaticRecommendationRequest('smart_cross_sell', commonRequest),
    ).toThrow();

    expect(
      parseAutomaticRecommendationRequest('for_you', {
        ...commonRequest,
        verifiedCustomerRef: 'verified-customer-contract-001',
      }),
    ).toMatchObject({ verifiedCustomerRef: 'verified-customer-contract-001' });
    expect(
      parseAutomaticRecommendationRequest('modifier_upsell', {
        ...commonRequest,
        parentCartLineId: 'cart-line-contract-001',
      }),
    ).toMatchObject({ parentCartLineId: 'cart-line-contract-001' });
    expect(
      parseAutomaticRecommendationRequest('smart_cross_sell', {
        ...commonRequest,
        cart: {
          ...commonRequest.cart,
          subtotal: { amount: 89000, currency: 'VND' },
          lines: [
            {
              lineId: 'cart-line-contract-001',
              sellableItemId: '20732',
              quantity: 1,
              unitPrice: { amount: 89000, currency: 'VND' },
              modifiers: [],
            },
          ],
        },
      }),
    ).toMatchObject({
      cart: { lines: [{ lineId: 'cart-line-contract-001' }] },
    });
  });

  it('rejects client-authored scoring and authority fields', async () => {
    const { parseAutomaticRecommendationRequest } = await import(
      contractModulePath
    );

    for (const forbiddenField of [
      { candidates: [] },
      { features: {} },
      { modelRevision: 'client-model' },
      { threshold: 0 },
      { decisionTime: '2026-08-04T00:00:00Z' },
      { commerceSnapshotBindings: {} },
    ]) {
      expect(() =>
        parseAutomaticRecommendationRequest('local_favorite', {
          ...commonRequest,
          ...forbiddenField,
        }),
      ).toThrow();
    }
  });

  it('represents a governed pause without substituting fallback output', async () => {
    const { parseAutomaticRecommendationResponse } = await import(
      contractModulePath
    );

    const paused = parseAutomaticRecommendationResponse({
      schemaVersion: 'kfc-automatic-recommendation-v1',
      requestId: commonRequest.requestId,
      recommendationId: 'recommendation-contract-001',
      recommendationType: 'local_favorite',
      status: 'paused',
      emptyReason: 'recommendation_serving_paused',
      cartRevision: commonRequest.cart.revision,
      catalogRevision: 'catalog-revision-contract-001',
      expiresAt: '2026-08-04T13:30:00Z',
      model: null,
      proposals: [],
      counts: { potential: 0, eligible: 0, scored: 0, displayed: 0 },
    });

    expect(paused).toMatchObject({
      status: 'paused',
      model: null,
      proposals: [],
    });
    expect(() =>
      parseAutomaticRecommendationResponse({
        ...paused,
        fallbackSource: 'popularity',
      }),
    ).toThrow();
  });

  it('accepts rendered impressions and requires actions for selection outcomes', async () => {
    const {
      parseAutomaticRecommendationImpression,
      parseAutomaticRecommendationOutcome,
    } = await import(contractModulePath);

    const impression = {
      schemaVersion: 'kfc-automatic-recommendation-event-v1',
      eventId: 'event-impression-contract-001',
      channel: 'kiosk',
      occurredAt: '2026-08-04T13:00:00Z',
      orderingJourneyRef: 'journey-contract-001',
      opportunityRef: 'opportunity-contract-001',
      cartRevision: commonRequest.cart.revision,
      renderedActions: [{ actionId: 'product:20732', renderedPosition: 1 }],
    };
    expect(parseAutomaticRecommendationImpression(impression)).toMatchObject({
      renderedActions: [{ renderedPosition: 1 }],
    });

    expect(() =>
      parseAutomaticRecommendationOutcome({
        schemaVersion: 'kfc-automatic-recommendation-event-v1',
        eventId: 'event-outcome-contract-001',
        channel: 'kiosk',
        eventType: 'selected',
        occurredAt: '2026-08-04T13:01:00Z',
        orderingJourneyRef: 'journey-contract-001',
        opportunityRef: 'opportunity-contract-001',
        actionId: null,
        renderedPosition: 1,
        cartRevision: commonRequest.cart.revision,
      }),
    ).toThrow();

    expect(() =>
      parseAutomaticRecommendationOutcome({
        ...impression,
        eventId: 'event-outcome-contract-002',
        eventType: 'slate_dismissed',
        actionId: 'product:20732',
        renderedPosition: 1,
      }),
    ).toThrow();
  });

  it('accepts only eligible rows and reconciled bounded scorer output', async () => {
    const {
      parseAutomaticScorerRequest,
      parseAutomaticScorerResponse,
      reconcileAutomaticScorerResponse,
    } = await import(contractModulePath);
    const model = {
      bundleId: 'qualified-bundle-contract-001',
      bundleDigest:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      modelRevision: 'local-favorite-model-contract-001',
      calibratorRevision: 'local-favorite-calibrator-contract-001',
      featureSchemaDigest:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      thresholdRevision: 'local-favorite-threshold-contract-001',
      composerContractDigest:
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      qualificationRunId: 'qualification-run-contract-001',
      qualificationEvidenceDigest:
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    };

    const scorerRequest = {
      schemaVersion: 'kfc-automatic-scorer-v1',
      requestId: commonRequest.requestId,
      recommendationType: 'local_favorite',
      model,
      candidates: [
        {
          candidateId: 'product:20732',
          eligibility: 'eligible',
          priceImpactVnd: 89000,
          features: { priceImpactVnd: 89000, daypart: 'lunch' },
        },
      ],
    };
    expect(parseAutomaticScorerRequest(scorerRequest)).toMatchObject({
      candidates: [{ eligibility: 'eligible' }],
    });

    const scorerResponse = {
      schemaVersion: 'kfc-automatic-scorer-v1',
      requestId: commonRequest.requestId,
      model,
      scores: [
        {
          candidateId: 'product:20732',
          selectionProbability: 0.4,
          jointProbability: 0.3,
          explanationValues: { localDemand: 0.25, priceImpact: -0.1 },
        },
      ],
    };
    expect(parseAutomaticScorerResponse(scorerResponse)).toMatchObject({
      scores: [{ jointProbability: 0.3 }],
    });
    expect(
      reconcileAutomaticScorerResponse(scorerRequest, scorerResponse),
    ).toMatchObject({
      scores: [{ candidateId: 'product:20732' }],
    });
    const scorerVectorRequest = JSON.parse(
      await readFile(
        new URL(
          '../../../../contracts/automatic-recommendations/v1/examples/scorer-request.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const reorderedModelResponse = JSON.parse(
      await readFile(
        new URL(
          '../../../../contracts/automatic-recommendations/v1/examples/scorer-reordered-model-response.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    expect(
      reconcileAutomaticScorerResponse(
        scorerVectorRequest,
        reorderedModelResponse,
      ),
    ).toMatchObject({ scores: [{ candidateId: 'product:20732' }] });
    for (const invalidResponse of [
      { ...scorerResponse, requestId: 'different-request' },
      {
        ...scorerResponse,
        model: { ...model, modelRevision: 'different-model' },
      },
      { ...scorerResponse, scores: [] },
      {
        ...scorerResponse,
        scores: [...scorerResponse.scores, scorerResponse.scores[0]],
      },
      {
        ...scorerResponse,
        scores: [{ ...scorerResponse.scores[0], candidateId: 'extra-product' }],
      },
    ]) {
      expect(() =>
        reconcileAutomaticScorerResponse(scorerRequest, invalidResponse),
      ).toThrow();
    }

    expect(() =>
      parseAutomaticScorerResponse({
        schemaVersion: 'kfc-automatic-scorer-v1',
        requestId: commonRequest.requestId,
        model,
        scores: [
          {
            candidateId: 'product:20732',
            selectionProbability: 0.2,
            jointProbability: 0.3,
            explanationValues: {},
          },
        ],
      }),
    ).toThrow();
  });

  it('binds modifier actions to the requested parent cart line', async () => {
    const { validateAutomaticRecommendationBinding } = await import(
      contractModulePath
    );
    const root = new URL(
      '../../../../contracts/automatic-recommendations/v1/examples/',
      import.meta.url,
    );
    const request = JSON.parse(
      await readFile(new URL('modifier-upsell-request.json', root), 'utf8'),
    );
    const mismatchedResponse = JSON.parse(
      await readFile(
        new URL('adversarial/modifier-parent-mismatch-response.json', root),
        'utf8',
      ),
    );

    expect(() =>
      validateAutomaticRecommendationBinding(
        'modifier_upsell',
        request,
        mismatchedResponse,
      ),
    ).toThrow();
  });

  it('requires trusted journey and opportunity references without client ranking authority', async () => {
    const { parseAutomaticRecommendationRequest } = await import(
      contractModulePath
    );

    expect(() =>
      parseAutomaticRecommendationRequest('local_favorite', {
        ...commonRequest,
        orderingJourneyRef: undefined,
      }),
    ).toThrow();
  });
});
