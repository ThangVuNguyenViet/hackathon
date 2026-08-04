import { describe, expect, it } from 'vitest';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';
import {
  AutomaticEvidencePersistenceError,
  AutomaticRecommendationIdentityConflictError,
  InMemoryAutomaticEvidenceObjectStore,
  InMemoryAutomaticRecommendationLedger,
  createAutomaticEvidenceSaga,
  createAutomaticRecommendationServingRuntime,
} from '../../src/recommendations/serving/evidence-saga.js';
import {
  DynamoDbAutomaticRecommendationLedger,
  S3AutomaticEvidenceObjectStore,
} from '../../src/recommendations/serving/aws-evidence-adapters.js';

const decision = {
  idempotencyKey: 'request-1',
  recommendationId: 'recommendation-1',
  requestId: 'request-1',
  requestDigest: 'b'.repeat(64),
  contextDigest: 'f'.repeat(64),
  orderingJourneyRef: 'journey-1',
  opportunityRef: 'opportunity-1',
  recommendationType: 'local_favorite' as const,
  storeId: 'store-1',
  fulfilmentMode: 'pickup' as const,
  locale: 'vi-VN',
  cartId: 'cart-1',
  cartRevision: 'cart-revision-1',
  cartDigest: 'c'.repeat(64),
  catalogRevision: 'catalog-1',
  decisionTime: '2026-08-05T00:00:00.000Z',
  expiresAt: '2026-08-05T00:05:00.000Z',
  contractDigest: 'a'.repeat(64),
  response: { status: 'empty', emptyReason: 'no_qualified_model' },
  technical: {
    contextBindings: { source: 'trusted-test' },
    potentialCandidates: [],
    eligibilityDecisions: [],
    featureReconciliation: { candidateCount: 0 },
    scoresCalibration: null,
    composition: { displayed: 0 },
    modelReleaseProvenance: null,
    traceLocator: null,
  },
};

const event = {
  idempotencyKey: 'event-1',
  eventId: 'event-1',
  recommendationId: decision.recommendationId,
  orderingJourneyRef: decision.orderingJourneyRef,
  channel: 'kiosk' as const,
  eventType: 'impression' as const,
  actionId: null,
  renderedPosition: null,
  cartRevision: decision.cartRevision,
  payloadDigest: 'd'.repeat(64),
  occurredAt: '2026-08-05T00:01:00.000Z',
  receivedAt: '2026-08-05T00:01:01.000Z',
  payload: { channel: 'kiosk' },
};

const technicalEvidence = () => decision.technical;

it('writes immutable evidence before one transactional decision and idempotency record', async () => {
  const objects = new InMemoryAutomaticEvidenceObjectStore();
  const ledger = new InMemoryAutomaticRecommendationLedger();
  const saga = createAutomaticEvidenceSaga({
    objects,
    ledger,
    clock: () => new Date('2026-08-05T00:00:00.000Z'),
  });

  const first = await saga.commitDecision(decision);
  const second = await saga.commitDecision(decision);

  expect(second).toMatchObject({ status: first.status });
  expect(objects.objects()).toHaveLength(1);
  expect(ledger.decisions()).toHaveLength(1);
  expect(ledger.idempotencyRecords()).toHaveLength(1);
  expect(ledger.decisions()[0]).toMatchObject({
    evidenceKey: expect.any(String),
    evidenceDigest: expect.any(String),
    evidenceVersionId: expect.stringMatching(/^memory:/u),
    evidenceSizeBytes: expect.any(Number),
  });
});

it('replays the same evidence identity even when retry wall-clock time changes', async () => {
  const objects = new InMemoryAutomaticEvidenceObjectStore();
  const ledger = new InMemoryAutomaticRecommendationLedger();
  let now = new Date('2026-08-05T00:00:00.000Z');
  const saga = createAutomaticEvidenceSaga({
    objects,
    ledger,
    clock: () => now,
  });
  await saga.commitDecision(decision);
  now = new Date('2026-08-05T00:01:00.000Z');
  await expect(saga.commitDecision(decision)).resolves.toMatchObject({
    status: 'committed',
  });
  expect(objects.objects()).toHaveLength(1);
});

it('Main returns a no-qualified-model decision only after durable evidence commits', async () => {
  const objects = new InMemoryAutomaticEvidenceObjectStore();
  const ledger = new InMemoryAutomaticRecommendationLedger();
  const saga = createAutomaticEvidenceSaga({
    objects,
    ledger,
    clock: () => new Date('2026-08-05T00:00:00.000Z'),
  });
  const runtime = createAutomaticRecommendationServingRuntime({
    engine: {
      decide: async () => ({
        schemaVersion: 'kfc-automatic-recommendation-v1',
        requestId: 'request-1',
        recommendationId: 'recommendation-1',
        recommendationType: 'local_favorite',
        status: 'empty',
        emptyReason: 'no_qualified_model',
        cartRevision: 'cart-revision-1',
        catalogRevision: 'catalog-1',
        expiresAt: '2026-08-05T00:05:00.000Z',
        model: null,
        proposals: [],
        counts: { potential: 0, eligible: 0, scored: 0, displayed: 0 },
      }),
    },
    evidence: saga,
    contractDigest: 'a'.repeat(64),
    technicalEvidence,
  });

  const response = await runtime.decide('local_favorite', {
    schemaVersion: 'kfc-automatic-recommendation-v1',
    requestId: 'request-1',
    storeId: 'store-1',
    fulfilmentMode: 'pickup',
    locale: 'vi-VN',
    orderingJourneyRef: 'journey-1',
    opportunityRef: 'opportunity-1',
    cart: {
      cartId: 'cart-1',
      revision: 'cart-revision-1',
      subtotal: { amount: 0, currency: 'VND' },
      lines: [],
    },
  });
  expect(response).toMatchObject({
    status: 'empty',
    emptyReason: 'no_qualified_model',
  });
  expect(ledger.decisions()[0]?.evidence.response).toEqual(response);
});

it('replays the durable original response before invoking the engine again', async () => {
  const objects = new InMemoryAutomaticEvidenceObjectStore();
  const ledger = new InMemoryAutomaticRecommendationLedger();
  const saga = createAutomaticEvidenceSaga({
    objects,
    ledger,
    clock: () => new Date(),
  });
  let invocations = 0;
  const runtime = createAutomaticRecommendationServingRuntime({
    engine: {
      decide: async () => {
        invocations += 1;
        return {
          schemaVersion: 'kfc-automatic-recommendation-v1',
          requestId: 'request-1',
          recommendationId: `recommendation-${invocations}`,
          recommendationType: 'local_favorite',
          status: 'empty',
          emptyReason: 'no_qualified_model',
          cartRevision: 'cart-revision-1',
          catalogRevision: 'catalog-1',
          expiresAt: '2026-08-05T00:05:00.000Z',
          model: null,
          proposals: [],
          counts: { potential: 0, eligible: 0, scored: 0, displayed: 0 },
        };
      },
    },
    evidence: saga,
    contractDigest: 'a'.repeat(64),
    technicalEvidence,
  });
  const input = {
    schemaVersion: 'kfc-automatic-recommendation-v1',
    requestId: 'request-1',
    storeId: 'store-1',
    fulfilmentMode: 'pickup',
    locale: 'vi-VN',
    orderingJourneyRef: 'journey-1',
    opportunityRef: 'opportunity-1',
    cart: {
      cartId: 'cart-1',
      revision: 'cart-revision-1',
      subtotal: { amount: 0, currency: 'VND' },
      lines: [],
    },
  };
  const first = await runtime.decide('local_favorite', input);
  const replay = await runtime.decide('local_favorite', input);
  expect(replay).toEqual(first);
  expect(invocations).toBe(1);
  expect(objects.objects()).toHaveLength(1);
});

it('rejects a rebound request identity before scoring and coalesces concurrent duplicates', async () => {
  const objects = new InMemoryAutomaticEvidenceObjectStore();
  const ledger = new InMemoryAutomaticRecommendationLedger();
  const saga = createAutomaticEvidenceSaga({
    objects,
    ledger,
    clock: () => new Date(),
  });
  let invocations = 0;
  const runtime = createAutomaticRecommendationServingRuntime({
    engine: {
      decide: async () => {
        invocations += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          schemaVersion: 'kfc-automatic-recommendation-v1',
          requestId: 'request-1',
          recommendationId: 'recommendation-1',
          recommendationType: 'local_favorite',
          status: 'empty',
          emptyReason: 'no_qualified_model',
          cartRevision: 'cart-revision-1',
          catalogRevision: 'catalog-1',
          expiresAt: '2026-08-05T00:05:00.000Z',
          model: null,
          proposals: [],
          counts: { potential: 0, eligible: 0, scored: 0, displayed: 0 },
        };
      },
    },
    evidence: saga,
    contractDigest: 'a'.repeat(64),
    technicalEvidence,
  });
  const input = {
    schemaVersion: 'kfc-automatic-recommendation-v1',
    requestId: 'request-1',
    storeId: 'store-1',
    fulfilmentMode: 'pickup',
    locale: 'vi-VN',
    orderingJourneyRef: 'journey-1',
    opportunityRef: 'opportunity-1',
    cart: {
      cartId: 'cart-1',
      revision: 'cart-revision-1',
      subtotal: { amount: 0, currency: 'VND' },
      lines: [],
    },
  };
  await Promise.all([
    runtime.decide('local_favorite', input),
    runtime.decide('local_favorite', input),
  ]);
  expect(invocations).toBe(1);
  expect(objects.objects()).toHaveLength(1);
  await expect(
    runtime.decide('local_favorite', {
      ...input,
      cart: { ...input.cart, revision: 'cart-revision-2' },
    }),
  ).rejects.toBeInstanceOf(AutomaticRecommendationIdentityConflictError);
  expect(invocations).toBe(1);
});

it('releases an exact pending claim when the decision engine fails', async () => {
  const saga = createAutomaticEvidenceSaga({
    objects: new InMemoryAutomaticEvidenceObjectStore(),
    ledger: new InMemoryAutomaticRecommendationLedger(),
    clock: () => new Date(),
  });
  let invocations = 0;
  const runtime = createAutomaticRecommendationServingRuntime({
    engine: {
      decide: async () => {
        invocations += 1;
        throw new Error('engine unavailable');
      },
    },
    evidence: saga,
    contractDigest: 'a'.repeat(64),
    technicalEvidence,
  });
  const input = {
    schemaVersion: 'kfc-automatic-recommendation-v1',
    requestId: 'retry-after-engine-failure',
    storeId: 'store-1',
    fulfilmentMode: 'pickup',
    locale: 'vi-VN',
    orderingJourneyRef: 'journey-1',
    opportunityRef: 'opportunity-1',
    cart: {
      cartId: 'cart-1',
      revision: 'cart-revision-1',
      subtotal: { amount: 0, currency: 'VND' },
      lines: [],
    },
  };
  await expect(runtime.decide('local_favorite', input)).rejects.toThrow(
    'engine unavailable',
  );
  await expect(runtime.decide('local_favorite', input)).rejects.toThrow(
    'engine unavailable',
  );
  expect(invocations).toBe(2);
});

it('retains an immutable orphan when the transaction fails and reconciles it later', async () => {
  const objects = new InMemoryAutomaticEvidenceObjectStore();
  const ledger = new InMemoryAutomaticRecommendationLedger({
    failTransactions: 1,
  });
  const saga = createAutomaticEvidenceSaga({
    objects,
    ledger,
    clock: () => new Date('2026-08-05T00:00:00.000Z'),
  });

  await expect(saga.commitDecision(decision)).rejects.toBeInstanceOf(
    AutomaticEvidencePersistenceError,
  );
  expect(objects.objects()).toHaveLength(1);
  expect(ledger.decisions()).toHaveLength(0);
  expect(await saga.reconcileOrphans()).toEqual({
    inspected: 1,
    repaired: 1,
    failed: 0,
  });
  expect(ledger.decisions()).toHaveLength(1);
});

it('adopts an exact orphan after its crashed owner lease expires', async () => {
  class CrashLedger extends InMemoryAutomaticRecommendationLedger {
    override async releaseDecisionClaim() {
      // Simulates task loss: no cleanup executes after the immutable S3 write.
    }
  }
  const objects = new InMemoryAutomaticEvidenceObjectStore();
  const ledger = new CrashLedger({ failTransactions: 1 });
  let now = new Date(0);
  let owner = 0;
  const saga = createAutomaticEvidenceSaga({
    objects,
    ledger,
    clock: () => now,
    ownerToken: () => `owner-${owner++}`,
    claimLeaseMs: 10,
  });
  await expect(saga.commitDecision(decision)).rejects.toMatchObject({
    code: 'transaction_failed',
  });
  expect(objects.objects()).toHaveLength(1);
  now = new Date(11);
  await expect(saga.reconcileOrphans()).resolves.toEqual({
    inspected: 1,
    repaired: 1,
    failed: 0,
  });
  expect(ledger.decisions()).toHaveLength(1);
  expect(ledger.decisions()[0]).toMatchObject({
    evidenceVersionId: expect.stringMatching(/^memory:/u),
  });
});

it('rejects corrupted orphan bytes before a ledger transaction', async () => {
  const ledger = new InMemoryAutomaticRecommendationLedger();
  const saga = createAutomaticEvidenceSaga({
    objects: {
      putImmutable: async () => ({
        key: 'unused',
        versionId: 'unused',
        digest: 'a'.repeat(64),
        sizeBytes: 2,
      }),
      list: async () => [
        {
          key: `automatic-recommendations/decision/${'a'.repeat(64)}.json`,
          versionId: 'version-1',
          digest: 'a'.repeat(64),
          sizeBytes: 2,
          body: '{}',
        },
      ],
    },
    ledger,
    clock: () => new Date(),
  });
  expect(await saga.reconcileOrphans()).toEqual({
    inspected: 1,
    repaired: 0,
    failed: 1,
  });
  expect(ledger.decisions()).toHaveLength(0);
});

it('rejects evidence containing undefined before writing S3', async () => {
  const objects = new InMemoryAutomaticEvidenceObjectStore();
  const saga = createAutomaticEvidenceSaga({
    objects,
    ledger: new InMemoryAutomaticRecommendationLedger(),
    clock: () => new Date(),
  });
  const unsafeEvidence: unknown = {
    ...event,
    idempotencyKey: 'event-unsafe',
    eventId: 'event-unsafe',
    payload: { unsafe: undefined },
  };
  await expect(
    Reflect.apply(saga.commitEvent, saga, [unsafeEvidence]),
  ).rejects.toThrow();
  expect(objects.objects()).toHaveLength(0);
});

it('rejects incomplete execution evidence for empty and paused decisions before S3', async () => {
  const objects = new InMemoryAutomaticEvidenceObjectStore();
  const saga = createAutomaticEvidenceSaga({
    objects,
    ledger: new InMemoryAutomaticRecommendationLedger(),
    clock: () => new Date(),
  });
  for (const response of [
    { status: 'empty', emptyReason: 'no_qualified_model' },
    { status: 'paused', emptyReason: 'recommendation_serving_paused' },
  ]) {
    const malformed: unknown = {
      ...decision,
      idempotencyKey: `incomplete-${response.status}`,
      requestId: `incomplete-${response.status}`,
      response,
      technical: {
        contextBindings: {},
        featureReconciliation: {},
        scoresCalibration: null,
        composition: {},
        modelReleaseProvenance: null,
        traceLocator: null,
      },
    };
    await expect(
      Reflect.apply(saga.commitDecision, saga, [malformed]),
    ).rejects.toThrow();
  }
  expect(objects.objects()).toHaveLength(0);
});

it.each([
  ['empty', 'no_qualified_model'],
  ['paused', 'recommendation_serving_paused'],
] as const)(
  'persists engine execution evidence for %s decisions',
  async (status, emptyReason) => {
    const ledger = new InMemoryAutomaticRecommendationLedger();
    const saga = createAutomaticEvidenceSaga({
      objects: new InMemoryAutomaticEvidenceObjectStore(),
      ledger,
      clock: () => new Date(),
    });
    const execution = {
      ...decision.technical,
      potentialCandidates: [{ source: `engine-${status}` }],
      eligibilityDecisions: [{ code: `${status}-execution` }],
    };
    const runtime = createAutomaticRecommendationServingRuntime({
      engine: {
        decide: async () => ({
          schemaVersion: 'kfc-automatic-recommendation-v1',
          requestId: `request-${status}`,
          recommendationId: `recommendation-${status}`,
          recommendationType: 'local_favorite',
          status,
          emptyReason,
          cartRevision: 'cart-revision-1',
          catalogRevision: 'catalog-1',
          expiresAt: '2026-08-05T00:05:00.000Z',
          model: null,
          proposals: [],
          counts: { potential: 1, eligible: 0, scored: 0, displayed: 0 },
        }),
      },
      evidence: saga,
      contractDigest: 'a'.repeat(64),
      technicalEvidence: () => execution,
    });
    await runtime.decide('local_favorite', {
      schemaVersion: 'kfc-automatic-recommendation-v1',
      requestId: `request-${status}`,
      storeId: 'store-1',
      fulfilmentMode: 'pickup',
      locale: 'vi-VN',
      orderingJourneyRef: 'journey-1',
      opportunityRef: 'opportunity-1',
      cart: {
        cartId: 'cart-1',
        revision: 'cart-revision-1',
        subtotal: { amount: 0, currency: 'VND' },
        lines: [],
      },
    });
    expect(ledger.decisions()[0]?.evidence.technical).toEqual(execution);
  },
);

it('stores events S3-first and rejects an idempotency key rebound to different evidence', async () => {
  const objects = new InMemoryAutomaticEvidenceObjectStore();
  const ledger = new InMemoryAutomaticRecommendationLedger();
  const saga = createAutomaticEvidenceSaga({
    objects,
    ledger,
    clock: () => new Date('2026-08-05T00:00:00.000Z'),
  });
  await saga.commitDecision(decision);
  await expect(
    saga.commitDecision({
      ...decision,
      requestId: 'request-other',
      requestDigest: '9'.repeat(64),
    }),
  ).rejects.toBeInstanceOf(AutomaticRecommendationIdentityConflictError);
  await saga.commitEvent(event);
  // The rebound is rejected before S3, so only the decision and event exist.
  expect(objects.objects()).toHaveLength(2);
  expect(ledger.events()).toHaveLength(1);
});

it('replays events before S3 despite a fresh receipt time and coalesces concurrent duplicates', async () => {
  const objects = new InMemoryAutomaticEvidenceObjectStore();
  const ledger = new InMemoryAutomaticRecommendationLedger();
  const saga = createAutomaticEvidenceSaga({
    objects,
    ledger,
    clock: () => new Date(),
  });
  await Promise.all([saga.commitEvent(event), saga.commitEvent(event)]);
  await saga.commitEvent({ ...event, receivedAt: '2026-08-05T00:04:00.000Z' });
  expect(objects.objects()).toHaveLength(1);
  expect(ledger.events()).toHaveLength(1);
  expect(ledger.events()[0]?.evidence.receivedAt).toBe(event.receivedAt);
  await expect(
    saga.commitEvent({
      ...event,
      payloadDigest: 'e'.repeat(64),
    }),
  ).rejects.toBeInstanceOf(AutomaticRecommendationIdentityConflictError);
  expect(objects.objects()).toHaveLength(1);
});

it('uses create-only S3 writes and verifies an existing object by digest', async () => {
  const puts: PutObjectCommand[] = [];
  const store = new S3AutomaticEvidenceObjectStore({
    bucket: 'evidence-bucket',
    client: {
      send: async (command) => {
        if (command instanceof PutObjectCommand) {
          puts.push(command);
          return { VersionId: 'version-1' };
        }
        throw new Error('unexpected command');
      },
    },
  });
  const body = '{}';
  const digest = createHash('sha256').update(body).digest('hex');
  await store.putImmutable({
    key: `automatic-recommendations/decision/${digest}.json`,
    digest,
    sizeBytes: Buffer.byteLength(body),
    body,
  });
  expect(puts[0]?.input).toMatchObject({
    IfNoneMatch: '*',
    Metadata: { sha256: digest, sizebytes: '2' },
  });
});

it('commits a decision and its idempotency binding in one DynamoDB transaction', async () => {
  const transactions: TransactWriteCommand[] = [];
  const ledger = new DynamoDbAutomaticRecommendationLedger({
    tableName: 'recommendation-ledger',
    client: {
      send: async (command) => {
        if (command instanceof TransactWriteCommand) {
          transactions.push(command);
          return {};
        }
        throw new Error('unexpected command');
      },
    },
  });
  expect(
    await ledger.commitDecision({
      idempotencyKey: decision.idempotencyKey,
      evidenceKey: 'automatic-recommendations/decision/a.json',
      evidenceVersionId: 'version-1',
      evidenceDigest: 'a'.repeat(64),
      evidenceSizeBytes: 100,
      evidence: decision,
      ownerToken: 'owner-1',
      nowEpochMs: 10,
    }),
  ).toBe('committed');
  expect(transactions).toHaveLength(1);
  expect(transactions[0]?.input.TransactItems).toHaveLength(2);
  expect(transactions[0]?.input.TransactItems).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        Update: expect.objectContaining({
          ConditionExpression:
            '#state = :pending AND payloadDigest = :payloadDigest AND ownerToken = :ownerToken AND leaseExpiresAtEpochMs >= :nowEpochMs',
        }),
      }),
      expect.objectContaining({
        Put: expect.objectContaining({
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      }),
    ]),
  );
});

it('claims a Dynamo request identity before effects and makes other instances wait', async () => {
  let claimed = false;
  const ledger = new DynamoDbAutomaticRecommendationLedger({
    tableName: 'automatic-ledger',
    client: {
      send: async (command) => {
        if (command instanceof PutCommand) {
          if (!claimed) {
            claimed = true;
            return {};
          }
          const error = new Error('claimed');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
        if (command instanceof GetCommand) {
          return {
            Item: {
              state: 'pending',
              payloadDigest: decision.requestDigest,
              cartDigest: decision.cartDigest,
              contextDigest: decision.contextDigest,
            },
          };
        }
        throw new Error('unexpected command');
      },
    },
  });
  const claim = {
    idempotencyKey: decision.idempotencyKey,
    requestDigest: decision.requestDigest,
    cartDigest: decision.cartDigest,
    contextDigest: decision.contextDigest,
    ownerToken: 'owner-1',
    nowEpochMs: 10,
    leaseExpiresAtEpochMs: 110,
  };
  await expect(ledger.claimDecision(claim)).resolves.toBe('acquired');
  await expect(
    ledger.claimDecision({ ...claim, ownerToken: 'owner-2' }),
  ).resolves.toBe('pending');
  await expect(
    ledger.claimDecision({ ...claim, contextDigest: '8'.repeat(64) }),
  ).rejects.toBeInstanceOf(AutomaticRecommendationIdentityConflictError);
});

it('fences stale decision owners after deterministic lease takeover', async () => {
  const ledger = new InMemoryAutomaticRecommendationLedger();
  const binding = {
    idempotencyKey: decision.idempotencyKey,
    requestDigest: decision.requestDigest,
    cartDigest: decision.cartDigest,
    contextDigest: decision.contextDigest,
  };
  await expect(
    ledger.claimDecision({
      ...binding,
      ownerToken: 'owner-old',
      nowEpochMs: 0,
      leaseExpiresAtEpochMs: 100,
    }),
  ).resolves.toBe('acquired');
  await expect(
    ledger.claimDecision({
      ...binding,
      ownerToken: 'owner-new',
      nowEpochMs: 50,
      leaseExpiresAtEpochMs: 150,
    }),
  ).resolves.toBe('pending');
  await expect(
    ledger.claimDecision({
      ...binding,
      ownerToken: 'owner-new',
      nowEpochMs: 101,
      leaseExpiresAtEpochMs: 201,
    }),
  ).resolves.toBe('acquired');
  await ledger.releaseDecisionClaim({
    idempotencyKey: binding.idempotencyKey,
    requestDigest: binding.requestDigest,
    ownerToken: 'owner-old',
  });
  await expect(
    ledger.commitDecision({
      idempotencyKey: binding.idempotencyKey,
      evidenceKey: 'old',
      evidenceVersionId: 'old',
      evidenceDigest: '1'.repeat(64),
      evidenceSizeBytes: 1,
      evidence: decision,
      ownerToken: 'owner-old',
      nowEpochMs: 102,
    }),
  ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  await expect(
    ledger.commitDecision({
      idempotencyKey: binding.idempotencyKey,
      evidenceKey: 'new',
      evidenceVersionId: 'new',
      evidenceDigest: '2'.repeat(64),
      evidenceSizeBytes: 2,
      evidence: decision,
      ownerToken: 'owner-new',
      nowEpochMs: 102,
    }),
  ).resolves.toBe('committed');
});

it('fences stale event owners and stale release cannot delete a takeover', async () => {
  const ledger = new InMemoryAutomaticRecommendationLedger();
  const binding = {
    idempotencyKey: event.idempotencyKey,
    payloadDigest: event.payloadDigest,
  };
  await ledger.claimEvent({
    ...binding,
    ownerToken: 'event-old',
    nowEpochMs: 0,
    leaseExpiresAtEpochMs: 10,
  });
  await expect(
    ledger.claimEvent({
      ...binding,
      ownerToken: 'event-new',
      nowEpochMs: 11,
      leaseExpiresAtEpochMs: 111,
    }),
  ).resolves.toBe('acquired');
  await ledger.releaseEventClaim({ ...binding, ownerToken: 'event-old' });
  await expect(
    ledger.commitEvent({
      idempotencyKey: binding.idempotencyKey,
      evidenceKey: 'event-old',
      evidenceVersionId: 'old',
      evidenceDigest: '3'.repeat(64),
      evidenceSizeBytes: 3,
      evidence: event,
      ownerToken: 'event-old',
      nowEpochMs: 12,
    }),
  ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  await expect(
    ledger.commitEvent({
      idempotencyKey: binding.idempotencyKey,
      evidenceKey: 'event-new',
      evidenceVersionId: 'new',
      evidenceDigest: '4'.repeat(64),
      evidenceSizeBytes: 4,
      evidence: event,
      ownerToken: 'event-new',
      nowEpochMs: 12,
    }),
  ).resolves.toBe('committed');
});

it('Dynamo takeover and release conditions fence the exact lease owner', async () => {
  const updates: UpdateCommand[] = [];
  const deletes: DeleteCommand[] = [];
  const ledger = new DynamoDbAutomaticRecommendationLedger({
    tableName: 'automatic-ledger',
    client: {
      send: async (command) => {
        if (command instanceof PutCommand) {
          const error = new Error('exists');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
        if (command instanceof GetCommand)
          return {
            Item: {
              state: 'pending',
              payloadDigest: decision.requestDigest,
              cartDigest: decision.cartDigest,
              contextDigest: decision.contextDigest,
              ownerToken: 'owner-old',
              leaseExpiresAtEpochMs: 10,
            },
          };
        if (command instanceof UpdateCommand) {
          updates.push(command);
          return {};
        }
        if (command instanceof DeleteCommand) {
          deletes.push(command);
          return {};
        }
        throw new Error('unexpected command');
      },
    },
  });
  await expect(
    ledger.claimDecision({
      idempotencyKey: decision.idempotencyKey,
      requestDigest: decision.requestDigest,
      cartDigest: decision.cartDigest,
      contextDigest: decision.contextDigest,
      ownerToken: 'owner-new',
      nowEpochMs: 11,
      leaseExpiresAtEpochMs: 111,
    }),
  ).resolves.toBe('acquired');
  expect(updates[0]?.input).toMatchObject({
    ConditionExpression: expect.stringContaining('ownerToken = :previousOwner'),
    ExpressionAttributeValues: expect.objectContaining({
      ':previousOwner': 'owner-old',
      ':ownerToken': 'owner-new',
    }),
  });
  await ledger.releaseDecisionClaim({
    idempotencyKey: decision.idempotencyKey,
    requestDigest: decision.requestDigest,
    ownerToken: 'owner-old',
  });
  expect(deletes[0]?.input).toMatchObject({
    ConditionExpression: expect.stringContaining('ownerToken = :ownerToken'),
    ExpressionAttributeValues: expect.objectContaining({
      ':ownerToken': 'owner-old',
    }),
  });
});
