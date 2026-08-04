import { createHash } from 'node:crypto';

export interface AutomaticDecisionEvidence {
  idempotencyKey: string;
  recommendationId: string;
  requestId: string;
  orderingJourneyRef: string;
  opportunityRef: string;
  recommendationType:
    'local_favorite' | 'for_you' | 'modifier_upsell' | 'smart_cross_sell';
  contractDigest: string;
  bundleDigest: string | null;
  outcome: unknown;
}

export interface AutomaticEventEvidence {
  idempotencyKey: string;
  recommendationId: string;
  eventType: 'impression' | 'selected' | 'checkout' | 'removed';
  payload: unknown;
}

type EvidenceEnvelope =
  | {
      schemaVersion: 'kfc-automatic-evidence-v1';
      kind: 'decision';
      payload: AutomaticDecisionEvidence;
    }
  | {
      schemaVersion: 'kfc-automatic-evidence-v1';
      kind: 'event';
      payload: AutomaticEventEvidence;
    };

export interface ImmutableEvidenceObject {
  key: string;
  digest: string;
  body: string;
}

export interface AutomaticEvidenceObjectStore {
  putImmutable(object: ImmutableEvidenceObject): Promise<void>;
  list(prefix: string): Promise<readonly ImmutableEvidenceObject[]>;
}

export interface AutomaticRecommendationLedger {
  commitDecision(input: {
    idempotencyKey: string;
    evidenceKey: string;
    evidenceDigest: string;
    evidence: AutomaticDecisionEvidence;
  }): Promise<'committed' | 'replayed'>;
  commitEvent(input: {
    idempotencyKey: string;
    evidenceKey: string;
    evidenceDigest: string;
    evidence: AutomaticEventEvidence;
  }): Promise<'committed' | 'replayed'>;
  hasEvidence(digest: string): Promise<boolean>;
}

export class AutomaticEvidencePersistenceError extends Error {
  readonly retryable = true;

  constructor(
    readonly code:
      | 'immutable_evidence_failed'
      | 'transaction_failed'
      | 'idempotency_conflict',
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'AutomaticEvidencePersistenceError';
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRecommendationType(
  value: unknown,
): value is AutomaticDecisionEvidence['recommendationType'] {
  return (
    value === 'local_favorite' ||
    value === 'for_you' ||
    value === 'modifier_upsell' ||
    value === 'smart_cross_sell'
  );
}

function isEventType(
  value: unknown,
): value is AutomaticEventEvidence['eventType'] {
  return (
    value === 'impression' ||
    value === 'selected' ||
    value === 'checkout' ||
    value === 'removed'
  );
}

function parseEvidenceEnvelope(body: string): EvidenceEnvelope {
  const value: unknown = JSON.parse(body);
  if (
    !isRecord(value) ||
    value.schemaVersion !== 'kfc-automatic-evidence-v1' ||
    !isRecord(value.payload) ||
    typeof value.payload.idempotencyKey !== 'string' ||
    typeof value.payload.recommendationId !== 'string'
  ) {
    throw new Error('invalid automatic evidence envelope');
  }
  if (value.kind === 'decision') {
    const payload = value.payload;
    const idempotencyKey = payload.idempotencyKey;
    const recommendationId = payload.recommendationId;
    const recommendationType = payload.recommendationType;
    if (
      typeof idempotencyKey !== 'string' ||
      typeof recommendationId !== 'string' ||
      typeof payload.requestId !== 'string' ||
      typeof payload.orderingJourneyRef !== 'string' ||
      typeof payload.opportunityRef !== 'string' ||
      !isRecommendationType(recommendationType) ||
      typeof payload.contractDigest !== 'string' ||
      (payload.bundleDigest !== null &&
        typeof payload.bundleDigest !== 'string')
    ) {
      throw new Error('invalid automatic decision evidence');
    }
    return {
      schemaVersion: 'kfc-automatic-evidence-v1',
      kind: 'decision',
      payload: {
        idempotencyKey,
        recommendationId,
        requestId: payload.requestId,
        orderingJourneyRef: payload.orderingJourneyRef,
        opportunityRef: payload.opportunityRef,
        recommendationType,
        contractDigest: payload.contractDigest,
        bundleDigest: payload.bundleDigest,
        outcome: payload.outcome,
      },
    };
  }
  if (value.kind !== 'event' || !isEventType(value.payload.eventType)) {
    throw new Error('invalid automatic event evidence');
  }
  return {
    schemaVersion: 'kfc-automatic-evidence-v1',
    kind: 'event',
    payload: {
      idempotencyKey: value.payload.idempotencyKey,
      recommendationId: value.payload.recommendationId,
      eventType: value.payload.eventType,
      payload: value.payload.payload,
    },
  };
}

function objectFor(envelope: EvidenceEnvelope): ImmutableEvidenceObject {
  const body = canonicalJson(envelope);
  const digest = createHash('sha256').update(body).digest('hex');
  return {
    key: `automatic-recommendations/${envelope.kind}/${digest}.json`,
    digest,
    body,
  };
}

export function createAutomaticEvidenceSaga({
  objects,
  ledger,
}: {
  objects: AutomaticEvidenceObjectStore;
  ledger: AutomaticRecommendationLedger;
  clock: () => Date;
}) {
  async function persist(envelope: EvidenceEnvelope) {
    const object = objectFor(envelope);
    try {
      await objects.putImmutable(object);
    } catch (error) {
      throw new AutomaticEvidencePersistenceError('immutable_evidence_failed', {
        cause: error,
      });
    }
    try {
      const status =
        envelope.kind === 'decision'
          ? await ledger.commitDecision({
              idempotencyKey: envelope.payload.idempotencyKey,
              evidenceKey: object.key,
              evidenceDigest: object.digest,
              evidence: envelope.payload,
            })
          : await ledger.commitEvent({
              idempotencyKey: envelope.payload.idempotencyKey,
              evidenceKey: object.key,
              evidenceDigest: object.digest,
              evidence: envelope.payload,
            });
      return {
        status: status === 'replayed' ? 'committed' : status,
        evidenceKey: object.key,
        evidenceDigest: object.digest,
      };
    } catch (error) {
      if (error instanceof AutomaticEvidencePersistenceError) throw error;
      throw new AutomaticEvidencePersistenceError('transaction_failed', {
        cause: error,
      });
    }
  }

  return {
    commitDecision: (value: AutomaticDecisionEvidence) =>
      persist({
        schemaVersion: 'kfc-automatic-evidence-v1',
        kind: 'decision',
        payload: value,
      }),
    commitEvent: (value: AutomaticEventEvidence) =>
      persist({
        schemaVersion: 'kfc-automatic-evidence-v1',
        kind: 'event',
        payload: value,
      }),
    async reconcileOrphans() {
      const stored = await objects.list('automatic-recommendations/');
      let repaired = 0;
      let failed = 0;
      for (const object of stored) {
        if (await ledger.hasEvidence(object.digest)) continue;
        try {
          const envelope = parseEvidenceEnvelope(object.body);
          if (envelope.kind === 'decision') {
            await ledger.commitDecision({
              idempotencyKey: envelope.payload.idempotencyKey,
              evidenceKey: object.key,
              evidenceDigest: object.digest,
              evidence: envelope.payload,
            });
          } else {
            await ledger.commitEvent({
              idempotencyKey: envelope.payload.idempotencyKey,
              evidenceKey: object.key,
              evidenceDigest: object.digest,
              evidence: envelope.payload,
            });
          }
          repaired += 1;
        } catch {
          failed += 1;
        }
      }
      return { inspected: stored.length, repaired, failed };
    },
  };
}

export class InMemoryAutomaticEvidenceObjectStore implements AutomaticEvidenceObjectStore {
  private readonly state = new Map<string, ImmutableEvidenceObject>();

  async putImmutable(object: ImmutableEvidenceObject): Promise<void> {
    const existing = this.state.get(object.key);
    if (existing !== undefined && existing.body !== object.body) {
      throw new Error('immutable object conflict');
    }
    this.state.set(object.key, object);
  }

  async list(prefix: string): Promise<readonly ImmutableEvidenceObject[]> {
    return [...this.state.values()].filter(({ key }) => key.startsWith(prefix));
  }

  objects(): readonly ImmutableEvidenceObject[] {
    return [...this.state.values()];
  }
}

interface LedgerRecord<T> {
  evidenceDigest: string;
  evidenceKey: string;
  evidence: T;
}

export class InMemoryAutomaticRecommendationLedger implements AutomaticRecommendationLedger {
  private readonly decisionState = new Map<
    string,
    LedgerRecord<AutomaticDecisionEvidence>
  >();
  private readonly eventState = new Map<
    string,
    LedgerRecord<AutomaticEventEvidence>
  >();
  private failures: number;

  constructor({ failTransactions = 0 }: { failTransactions?: number } = {}) {
    this.failures = failTransactions;
  }

  private failIfRequested() {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('injected transaction failure');
    }
  }

  private commit<T>(
    state: Map<string, LedgerRecord<T>>,
    input: {
      idempotencyKey: string;
      evidenceKey: string;
      evidenceDigest: string;
      evidence: T;
    },
  ): 'committed' | 'replayed' {
    this.failIfRequested();
    const existing = state.get(input.idempotencyKey);
    if (existing !== undefined) {
      if (existing.evidenceDigest !== input.evidenceDigest) {
        throw new AutomaticEvidencePersistenceError('idempotency_conflict');
      }
      return 'replayed';
    }
    state.set(input.idempotencyKey, input);
    return 'committed';
  }

  async commitDecision(input: {
    idempotencyKey: string;
    evidenceKey: string;
    evidenceDigest: string;
    evidence: AutomaticDecisionEvidence;
  }): Promise<'committed' | 'replayed'> {
    return this.commit(this.decisionState, input);
  }

  async commitEvent(input: {
    idempotencyKey: string;
    evidenceKey: string;
    evidenceDigest: string;
    evidence: AutomaticEventEvidence;
  }): Promise<'committed' | 'replayed'> {
    return this.commit(this.eventState, input);
  }

  async hasEvidence(digest: string): Promise<boolean> {
    return [...this.decisionState.values(), ...this.eventState.values()].some(
      ({ evidenceDigest }) => evidenceDigest === digest,
    );
  }

  decisions() {
    return [...this.decisionState.values()];
  }

  events() {
    return [...this.eventState.values()];
  }

  idempotencyRecords() {
    return [...this.decisionState.keys(), ...this.eventState.keys()];
  }
}

export function createAutomaticRecommendationServingRuntime({
  engine,
  evidence,
  contractDigest,
}: {
  engine: {
    decide(
      type: AutomaticDecisionEvidence['recommendationType'],
      request: unknown,
    ): Promise<unknown>;
  };
  evidence: {
    commitDecision(value: AutomaticDecisionEvidence): Promise<unknown>;
  };
  contractDigest: string;
}) {
  return {
    async decide(
      recommendationType: AutomaticDecisionEvidence['recommendationType'],
      request: unknown,
    ) {
      if (!isRecord(request)) {
        throw new Error('automatic recommendation request must be an object');
      }
      const binding = request;
      const requestId = binding.requestId;
      const orderingJourneyRef = binding.orderingJourneyRef;
      const opportunityRef = binding.opportunityRef;
      if (typeof requestId !== 'string' || requestId.length === 0) {
        throw new Error('automatic recommendation requestId is required');
      }
      if (
        typeof orderingJourneyRef !== 'string' ||
        orderingJourneyRef.length === 0
      ) {
        throw new Error(
          'automatic recommendation orderingJourneyRef is required',
        );
      }
      if (typeof opportunityRef !== 'string' || opportunityRef.length === 0) {
        throw new Error('automatic recommendation opportunityRef is required');
      }
      const response = await engine.decide(recommendationType, request);
      if (!isRecord(response)) {
        throw new Error('automatic recommendation response must be an object');
      }
      const responseValue = response;
      if (
        typeof responseValue.recommendationId !== 'string' ||
        responseValue.recommendationId.length === 0
      ) {
        throw new Error(
          'automatic recommendation response identity is missing',
        );
      }
      const model = responseValue.model;
      const bundleDigest =
        model !== null &&
        isRecord(model) &&
        'bundleDigest' in model &&
        typeof model.bundleDigest === 'string'
          ? model.bundleDigest
          : null;
      await evidence.commitDecision({
        idempotencyKey: `${orderingJourneyRef}:${opportunityRef}:${recommendationType}`,
        recommendationId: responseValue.recommendationId,
        requestId,
        orderingJourneyRef,
        opportunityRef,
        recommendationType,
        contractDigest,
        bundleDigest,
        outcome: response,
      });
      return response;
    },
  };
}
