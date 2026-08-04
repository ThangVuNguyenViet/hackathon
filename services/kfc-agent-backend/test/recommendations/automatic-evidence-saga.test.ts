import { describe, expect, it } from 'vitest';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';
import {
  AutomaticEvidencePersistenceError,
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

  expect(second).toEqual(first);
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
  let minute = 0;
  const saga = createAutomaticEvidenceSaga({
    objects,
    ledger,
    clock: () => new Date(`2026-08-05T00:0${minute++}:00.000Z`),
  });
  await saga.commitDecision(decision);
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
    saga.commitDecision({ ...decision, requestId: 'request-other' }),
  ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  await saga.commitEvent(event);
  // S3-first means even the conflicting attempt remains immutable evidence;
  // reconciliation will leave it uncommitted rather than rewrite history.
  expect(objects.objects()).toHaveLength(3);
  expect(ledger.events()).toHaveLength(1);
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
    }),
  ).toBe('committed');
  expect(transactions).toHaveLength(1);
  expect(transactions[0]?.input.TransactItems).toHaveLength(2);
  expect(transactions[0]?.input.TransactItems).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        Put: expect.objectContaining({
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      }),
    ]),
  );
});
