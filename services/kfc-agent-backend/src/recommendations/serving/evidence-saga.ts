import { createHash } from 'node:crypto';
import {
  parseAutomaticDecisionEvidence,
  parseAutomaticEventEvidence,
  parseJsonValue,
  type AutomaticDecisionEvidence,
  type AutomaticEventEvidence,
} from './evidence-contracts.js';
import {
  automaticRecommendationIdentityDigest,
  parseAutomaticRecommendationRequest,
} from '../contracts/automatic-recommendation.js';
import { parseAutomaticRecommendationResponse } from '../contracts/automatic-recommendation-response.js';

export type {
  AutomaticDecisionEvidence,
  AutomaticEventEvidence,
} from './evidence-contracts.js';

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
  sizeBytes: number;
  body: string;
}

export interface DurableEvidencePointer {
  key: string;
  versionId: string;
  digest: string;
  sizeBytes: number;
}

export interface StoredEvidenceObject extends DurableEvidencePointer {
  body: string;
}

export interface AutomaticEvidenceObjectStore {
  putImmutable(
    object: ImmutableEvidenceObject,
  ): Promise<DurableEvidencePointer>;
  list(prefix: string): Promise<readonly StoredEvidenceObject[]>;
}

export interface AutomaticRecommendationLedger {
  commitDecision(input: {
    idempotencyKey: string;
    evidenceKey: string;
    evidenceVersionId: string;
    evidenceDigest: string;
    evidenceSizeBytes: number;
    evidence: AutomaticDecisionEvidence;
  }): Promise<'committed' | 'replayed'>;
  commitEvent(input: {
    idempotencyKey: string;
    evidenceKey: string;
    evidenceVersionId: string;
    evidenceDigest: string;
    evidenceSizeBytes: number;
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
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON rejects non-finite numbers');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  throw new TypeError('Canonical JSON supports JSON values only');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseEvidenceEnvelope(body: string): EvidenceEnvelope {
  const value: unknown = JSON.parse(body);
  if (
    !isRecord(value) ||
    value.schemaVersion !== 'kfc-automatic-evidence-v1' ||
    !('payload' in value)
  ) {
    throw new Error('invalid automatic evidence envelope');
  }
  if (value.kind === 'decision') {
    return {
      schemaVersion: 'kfc-automatic-evidence-v1',
      kind: 'decision',
      payload: parseAutomaticDecisionEvidence(value.payload),
    };
  }
  if (value.kind !== 'event') {
    throw new Error('invalid automatic event evidence');
  }
  return {
    schemaVersion: 'kfc-automatic-evidence-v1',
    kind: 'event',
    payload: parseAutomaticEventEvidence(value.payload),
  };
}

function objectFor(envelope: EvidenceEnvelope): ImmutableEvidenceObject {
  const body = canonicalJson(envelope);
  const digest = createHash('sha256').update(body).digest('hex');
  return {
    key: `automatic-recommendations/${envelope.kind}/${digest}.json`,
    digest,
    sizeBytes: Buffer.byteLength(body),
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
    let pointer: DurableEvidencePointer;
    try {
      pointer = await objects.putImmutable(object);
      if (
        pointer.key !== object.key ||
        pointer.digest !== object.digest ||
        pointer.sizeBytes !== object.sizeBytes ||
        pointer.versionId.length === 0
      ) {
        throw new Error(
          'immutable evidence pointer does not match written bytes',
        );
      }
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
              evidenceVersionId: pointer.versionId,
              evidenceDigest: object.digest,
              evidenceSizeBytes: object.sizeBytes,
              evidence: envelope.payload,
            })
          : await ledger.commitEvent({
              idempotencyKey: envelope.payload.idempotencyKey,
              evidenceKey: object.key,
              evidenceVersionId: pointer.versionId,
              evidenceDigest: object.digest,
              evidenceSizeBytes: object.sizeBytes,
              evidence: envelope.payload,
            });
      return {
        status: status === 'replayed' ? 'committed' : status,
        evidenceKey: object.key,
        evidenceVersionId: pointer.versionId,
        evidenceDigest: object.digest,
        evidenceSizeBytes: object.sizeBytes,
      };
    } catch (error) {
      if (error instanceof AutomaticEvidencePersistenceError) throw error;
      throw new AutomaticEvidencePersistenceError('transaction_failed', {
        cause: error,
      });
    }
  }

  return {
    async commitDecision(value: AutomaticDecisionEvidence) {
      return persist({
        schemaVersion: 'kfc-automatic-evidence-v1',
        kind: 'decision',
        payload: parseAutomaticDecisionEvidence(value),
      });
    },
    async commitEvent(value: AutomaticEventEvidence) {
      return persist({
        schemaVersion: 'kfc-automatic-evidence-v1',
        kind: 'event',
        payload: parseAutomaticEventEvidence(value),
      });
    },
    async reconcileOrphans() {
      const stored = await objects.list('automatic-recommendations/');
      let repaired = 0;
      let failed = 0;
      for (const object of stored) {
        if (await ledger.hasEvidence(object.digest)) continue;
        try {
          const actualDigest = createHash('sha256')
            .update(object.body)
            .digest('hex');
          const expectedKey = `automatic-recommendations/${object.key.includes('/decision/') ? 'decision' : 'event'}/${object.digest}.json`;
          if (
            object.versionId.length === 0 ||
            object.sizeBytes !== Buffer.byteLength(object.body) ||
            actualDigest !== object.digest ||
            object.key !== expectedKey
          ) {
            throw new Error('orphan evidence pointer verification failed');
          }
          const envelope = parseEvidenceEnvelope(object.body);
          if (envelope.kind === 'decision') {
            await ledger.commitDecision({
              idempotencyKey: envelope.payload.idempotencyKey,
              evidenceKey: object.key,
              evidenceVersionId: object.versionId,
              evidenceDigest: object.digest,
              evidenceSizeBytes: object.sizeBytes,
              evidence: envelope.payload,
            });
          } else {
            await ledger.commitEvent({
              idempotencyKey: envelope.payload.idempotencyKey,
              evidenceKey: object.key,
              evidenceVersionId: object.versionId,
              evidenceDigest: object.digest,
              evidenceSizeBytes: object.sizeBytes,
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

  async putImmutable(
    object: ImmutableEvidenceObject,
  ): Promise<DurableEvidencePointer> {
    const existing = this.state.get(object.key);
    if (existing !== undefined && existing.body !== object.body) {
      throw new Error('immutable object conflict');
    }
    this.state.set(object.key, object);
    return {
      key: object.key,
      versionId: `memory:${object.digest}`,
      digest: object.digest,
      sizeBytes: object.sizeBytes,
    };
  }

  async list(prefix: string): Promise<readonly StoredEvidenceObject[]> {
    return [...this.state.values()]
      .filter(({ key }) => key.startsWith(prefix))
      .map((object) => ({
        ...object,
        versionId: `memory:${object.digest}`,
      }));
  }

  objects(): readonly ImmutableEvidenceObject[] {
    return [...this.state.values()];
  }
}

interface LedgerRecord<T> {
  evidenceDigest: string;
  evidenceKey: string;
  evidenceVersionId: string;
  evidenceSizeBytes: number;
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
      evidenceVersionId: string;
      evidenceDigest: string;
      evidenceSizeBytes: number;
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
    evidenceVersionId: string;
    evidenceDigest: string;
    evidenceSizeBytes: number;
    evidence: AutomaticDecisionEvidence;
  }): Promise<'committed' | 'replayed'> {
    return this.commit(this.decisionState, input);
  }

  async commitEvent(input: {
    idempotencyKey: string;
    evidenceKey: string;
    evidenceVersionId: string;
    evidenceDigest: string;
    evidenceSizeBytes: number;
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
  clock = () => new Date(),
  technicalEvidence,
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
  clock?: () => Date;
  technicalEvidence?: (input: {
    request: ReturnType<typeof parseAutomaticRecommendationRequest>;
    response: ReturnType<typeof parseAutomaticRecommendationResponse>;
  }) => AutomaticDecisionEvidence['technical'];
}) {
  return {
    async decide(
      recommendationType: AutomaticDecisionEvidence['recommendationType'],
      request: unknown,
    ) {
      const binding = parseAutomaticRecommendationRequest(
        recommendationType,
        request,
      );
      const response = parseAutomaticRecommendationResponse(
        await engine.decide(recommendationType, binding),
      );
      const operationPath = {
        local_favorite: '/v1/recommendations/local-favorites',
        for_you: '/v1/recommendations/for-you',
        modifier_upsell: '/v1/recommendations/modifier-upsells',
        smart_cross_sell: '/v1/recommendations/smart-cross-sells',
      }[recommendationType];
      const requestDigest = automaticRecommendationIdentityDigest({
        operationPath,
        identityType: recommendationType,
        payload: binding,
      });
      const cartDigest = automaticRecommendationIdentityDigest({
        operationPath: `${operationPath}/cart`,
        identityType: 'cart',
        payload: binding.cart,
      });
      const fallbackTechnical: AutomaticDecisionEvidence['technical'] = {
        contextBindings: {
          orderingJourneyRef: binding.orderingJourneyRef,
          opportunityRef: binding.opportunityRef,
          storeId: binding.storeId,
          fulfilmentMode: binding.fulfilmentMode,
          locale: binding.locale,
          cartRevision: binding.cart.revision,
        },
        potentialCandidates: [],
        eligibilityDecisions: [],
        featureReconciliation: {
          eligible: response.counts.eligible,
          scored: response.counts.scored,
        },
        scoresCalibration: parseJsonValue(response.model),
        composition: {
          displayed: response.counts.displayed,
          status: response.status,
          emptyReason: response.emptyReason,
        },
        modelReleaseProvenance: parseJsonValue(response.model),
        traceLocator: null,
      };
      if (
        response.status === 'recommended' &&
        technicalEvidence === undefined
      ) {
        throw new TypeError(
          'recommended decisions require complete technical evidence',
        );
      }
      await evidence.commitDecision({
        idempotencyKey: binding.requestId,
        recommendationId: response.recommendationId,
        requestId: binding.requestId,
        requestDigest,
        orderingJourneyRef: binding.orderingJourneyRef,
        opportunityRef: binding.opportunityRef,
        recommendationType,
        storeId: binding.storeId,
        fulfilmentMode: binding.fulfilmentMode,
        locale: binding.locale,
        cartId: binding.cart.cartId,
        cartRevision: binding.cart.revision,
        cartDigest,
        catalogRevision: response.catalogRevision,
        decisionTime: clock().toISOString(),
        expiresAt: response.expiresAt,
        contractDigest,
        response: parseJsonValue(response),
        technical:
          technicalEvidence?.({ request: binding, response }) ??
          fallbackTechnical,
      });
      return response;
    },
  };
}
