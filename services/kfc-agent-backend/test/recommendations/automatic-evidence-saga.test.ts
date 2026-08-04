import { describe, expect, it } from 'vitest';
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
  idempotencyKey: 'journey-1:opportunity-1:local_favorite',
  recommendationId: 'recommendation-1',
  requestId: 'request-1',
  orderingJourneyRef: 'journey-1',
  opportunityRef: 'opportunity-1',
  recommendationType: 'local_favorite' as const,
  contractDigest: 'a'.repeat(64),
  bundleDigest: null,
  outcome: { status: 'empty', emptyReason: 'no_qualified_model' },
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
        model: null,
      }),
    },
    evidence: saga,
    contractDigest: 'a'.repeat(64),
  });

  const response = await runtime.decide('local_favorite', {
    requestId: 'request-1',
    orderingJourneyRef: 'journey-1',
    opportunityRef: 'opportunity-1',
  });
  expect(response).toMatchObject({
    status: 'empty',
    emptyReason: 'no_qualified_model',
  });
  expect(ledger.decisions()[0]?.evidence.outcome).toEqual(response);
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
  await saga.commitEvent({
    idempotencyKey: 'event-1',
    recommendationId: decision.recommendationId,
    eventType: 'impression',
    payload: { channel: 'kiosk' },
  });
  // S3-first means even the conflicting attempt remains immutable evidence;
  // reconciliation will leave it uncommitted rather than rewrite history.
  expect(objects.objects()).toHaveLength(3);
  expect(ledger.events()).toHaveLength(1);
});

it('uses create-only S3 writes and verifies an existing object by digest', async () => {
  const puts: unknown[] = [];
  const store = new S3AutomaticEvidenceObjectStore({
    bucket: 'evidence-bucket',
    client: {
      putObject: async (input) => {
        puts.push(input);
      },
      headObject: async () => ({ metadata: { sha256: 'a'.repeat(64) } }),
      listObjects: async () => ({ keys: [] }),
      getObject: async () => ({ body: '' }),
    },
  });
  await store.putImmutable({
    key: 'automatic-recommendations/decision/a.json',
    digest: 'a'.repeat(64),
    body: '{}',
  });
  expect(puts[0]).toMatchObject({
    ifNoneMatch: '*',
    metadata: { sha256: 'a'.repeat(64) },
  });
});

it('commits a decision and its idempotency binding in one DynamoDB transaction', async () => {
  const transactions: Array<{ puts: readonly unknown[] }> = [];
  const ledger = new DynamoDbAutomaticRecommendationLedger({
    tableName: 'recommendation-ledger',
    client: {
      transactWrite: async (input) => {
        transactions.push(input);
      },
      getItem: async () => null,
      hasEvidence: async () => false,
    },
  });
  expect(
    await ledger.commitDecision({
      idempotencyKey: decision.idempotencyKey,
      evidenceKey: 'automatic-recommendations/decision/a.json',
      evidenceDigest: 'a'.repeat(64),
      evidence: decision,
    }),
  ).toBe('committed');
  expect(transactions).toHaveLength(1);
  expect(transactions[0]?.puts).toHaveLength(2);
  expect(transactions[0]?.puts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ condition: 'attribute_not_exists(pk)' }),
    ]),
  );
});
