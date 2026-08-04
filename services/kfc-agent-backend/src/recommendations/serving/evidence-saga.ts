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
  claimDecision(input: {
    idempotencyKey: string;
    requestDigest: string;
    cartDigest: string;
    contextDigest: string;
  }): Promise<'acquired' | 'pending' | 'replayed'>;
  claimEvent(input: {
    idempotencyKey: string;
    payloadDigest: string;
  }): Promise<'acquired' | 'pending' | 'replayed'>;
  releaseDecisionClaim(
    idempotencyKey: string,
    requestDigest: string,
  ): Promise<void>;
  releaseEventClaim(
    idempotencyKey: string,
    payloadDigest: string,
  ): Promise<void>;
  readDecision(
    idempotencyKey: string,
  ): Promise<AutomaticDecisionEvidence | null>;
  readEvent(idempotencyKey: string): Promise<AutomaticEventEvidence | null>;
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

export class AutomaticRecommendationIdentityConflictError extends Error {
  readonly retryable = false;

  constructor() {
    super('automatic recommendation identity conflict');
    this.name = 'AutomaticRecommendationIdentityConflictError';
  }
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
  const eventFlights = new Map<
    string,
    { payloadDigest: string; promise: Promise<unknown> }
  >();
  async function waitForEvent(idempotencyKey: string) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const event = await ledger.readEvent(idempotencyKey);
      if (event !== null) return event;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new AutomaticEvidencePersistenceError('transaction_failed');
  }
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
      if (envelope.kind === 'decision') {
        await ledger
          .releaseDecisionClaim(
            envelope.payload.idempotencyKey,
            envelope.payload.requestDigest,
          )
          .catch(() => undefined);
      } else {
        await ledger
          .releaseEventClaim(
            envelope.payload.idempotencyKey,
            envelope.payload.payloadDigest,
          )
          .catch(() => undefined);
      }
      if (error instanceof AutomaticEvidencePersistenceError) throw error;
      throw new AutomaticEvidencePersistenceError('transaction_failed', {
        cause: error,
      });
    }
  }

  return {
    claimDecision: (input: {
      idempotencyKey: string;
      requestDigest: string;
      cartDigest: string;
      contextDigest: string;
    }) => ledger.claimDecision(input),
    releaseDecisionClaim: (idempotencyKey: string, requestDigest: string) =>
      ledger.releaseDecisionClaim(idempotencyKey, requestDigest),
    readDecision: (idempotencyKey: string) =>
      ledger.readDecision(idempotencyKey),
    async commitDecision(value: AutomaticDecisionEvidence) {
      const parsed = parseAutomaticDecisionEvidence(value);
      const claim = await ledger.claimDecision(parsed);
      if (claim === 'replayed') return { status: 'committed' as const };
      if (claim === 'pending') {
        throw new AutomaticEvidencePersistenceError('transaction_failed');
      }
      return persist({
        schemaVersion: 'kfc-automatic-evidence-v1',
        kind: 'decision',
        payload: parsed,
      });
    },
    commitClaimedDecision(value: AutomaticDecisionEvidence) {
      return persist({
        schemaVersion: 'kfc-automatic-evidence-v1',
        kind: 'decision',
        payload: parseAutomaticDecisionEvidence(value),
      });
    },
    async commitEvent(value: AutomaticEventEvidence) {
      const parsed = parseAutomaticEventEvidence(value);
      const existing = await ledger.readEvent(parsed.idempotencyKey);
      if (existing !== null) {
        if (existing.payloadDigest !== parsed.payloadDigest) {
          throw new AutomaticRecommendationIdentityConflictError();
        }
        return { status: 'committed' as const };
      }
      const flight = eventFlights.get(parsed.idempotencyKey);
      if (flight !== undefined) {
        if (flight.payloadDigest !== parsed.payloadDigest) {
          throw new AutomaticRecommendationIdentityConflictError();
        }
        return flight.promise;
      }
      const claim = await ledger.claimEvent(parsed);
      if (claim === 'replayed') return { status: 'committed' as const };
      if (claim === 'pending') {
        const winner = await waitForEvent(parsed.idempotencyKey);
        if (winner.payloadDigest !== parsed.payloadDigest) {
          throw new AutomaticRecommendationIdentityConflictError();
        }
        return { status: 'committed' as const };
      }
      const promise = persist({
        schemaVersion: 'kfc-automatic-evidence-v1',
        kind: 'event',
        payload: parsed,
      });
      eventFlights.set(parsed.idempotencyKey, {
        payloadDigest: parsed.payloadDigest,
        promise,
      });
      try {
        return await promise;
      } finally {
        if (eventFlights.get(parsed.idempotencyKey)?.promise === promise) {
          eventFlights.delete(parsed.idempotencyKey);
        }
      }
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
            const claim = await ledger.claimDecision({
              idempotencyKey: envelope.payload.idempotencyKey,
              requestDigest: envelope.payload.requestDigest,
              cartDigest: envelope.payload.cartDigest,
              contextDigest: envelope.payload.contextDigest,
            });
            if (claim !== 'acquired') continue;
            await ledger.commitDecision({
              idempotencyKey: envelope.payload.idempotencyKey,
              evidenceKey: object.key,
              evidenceVersionId: object.versionId,
              evidenceDigest: object.digest,
              evidenceSizeBytes: object.sizeBytes,
              evidence: envelope.payload,
            });
          } else {
            const claim = await ledger.claimEvent({
              idempotencyKey: envelope.payload.idempotencyKey,
              payloadDigest: envelope.payload.payloadDigest,
            });
            if (claim !== 'acquired') continue;
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
  private readonly decisionClaims = new Map<
    string,
    { requestDigest: string; cartDigest: string; contextDigest: string }
  >();
  private readonly eventClaims = new Map<string, string>();
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
    const result = this.commit(this.decisionState, input);
    this.decisionClaims.delete(input.idempotencyKey);
    return result;
  }

  async commitEvent(input: {
    idempotencyKey: string;
    evidenceKey: string;
    evidenceVersionId: string;
    evidenceDigest: string;
    evidenceSizeBytes: number;
    evidence: AutomaticEventEvidence;
  }): Promise<'committed' | 'replayed'> {
    const result = this.commit(this.eventState, input);
    this.eventClaims.delete(input.idempotencyKey);
    return result;
  }

  async claimDecision(input: {
    idempotencyKey: string;
    requestDigest: string;
    cartDigest: string;
    contextDigest: string;
  }): Promise<'acquired' | 'pending' | 'replayed'> {
    const durable = this.decisionState.get(input.idempotencyKey)?.evidence;
    if (durable !== undefined) {
      if (
        durable.requestDigest !== input.requestDigest ||
        durable.cartDigest !== input.cartDigest ||
        durable.contextDigest !== input.contextDigest
      )
        throw new AutomaticRecommendationIdentityConflictError();
      return 'replayed';
    }
    const claim = this.decisionClaims.get(input.idempotencyKey);
    if (claim !== undefined) {
      if (
        claim.requestDigest !== input.requestDigest ||
        claim.cartDigest !== input.cartDigest ||
        claim.contextDigest !== input.contextDigest
      )
        throw new AutomaticRecommendationIdentityConflictError();
      return 'pending';
    }
    this.decisionClaims.set(input.idempotencyKey, input);
    return 'acquired';
  }

  async claimEvent(input: {
    idempotencyKey: string;
    payloadDigest: string;
  }): Promise<'acquired' | 'pending' | 'replayed'> {
    const durable = this.eventState.get(input.idempotencyKey)?.evidence;
    if (durable !== undefined) {
      if (durable.payloadDigest !== input.payloadDigest) {
        throw new AutomaticRecommendationIdentityConflictError();
      }
      return 'replayed';
    }
    const claim = this.eventClaims.get(input.idempotencyKey);
    if (claim !== undefined) {
      if (claim !== input.payloadDigest) {
        throw new AutomaticRecommendationIdentityConflictError();
      }
      return 'pending';
    }
    this.eventClaims.set(input.idempotencyKey, input.payloadDigest);
    return 'acquired';
  }

  async releaseDecisionClaim(idempotencyKey: string, requestDigest: string) {
    if (
      this.decisionClaims.get(idempotencyKey)?.requestDigest === requestDigest
    ) {
      this.decisionClaims.delete(idempotencyKey);
    }
  }

  async releaseEventClaim(idempotencyKey: string, payloadDigest: string) {
    if (this.eventClaims.get(idempotencyKey) === payloadDigest) {
      this.eventClaims.delete(idempotencyKey);
    }
  }

  async readDecision(idempotencyKey: string) {
    return this.decisionState.get(idempotencyKey)?.evidence ?? null;
  }

  async readEvent(idempotencyKey: string) {
    return this.eventState.get(idempotencyKey)?.evidence ?? null;
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
    commitClaimedDecision(value: AutomaticDecisionEvidence): Promise<unknown>;
    claimDecision(input: {
      idempotencyKey: string;
      requestDigest: string;
      cartDigest: string;
      contextDigest: string;
    }): Promise<'acquired' | 'pending' | 'replayed'>;
    releaseDecisionClaim(
      idempotencyKey: string,
      requestDigest: string,
    ): Promise<void>;
    readDecision(
      idempotencyKey: string,
    ): Promise<AutomaticDecisionEvidence | null>;
  };
  contractDigest: string;
  clock?: () => Date;
  technicalEvidence: (input: {
    request: ReturnType<typeof parseAutomaticRecommendationRequest>;
    response: ReturnType<typeof parseAutomaticRecommendationResponse>;
  }) => AutomaticDecisionEvidence['technical'];
}) {
  const flights = new Map<
    string,
    {
      requestDigest: string;
      promise: Promise<ReturnType<typeof parseAutomaticRecommendationResponse>>;
    }
  >();
  return {
    async decide(
      recommendationType: AutomaticDecisionEvidence['recommendationType'],
      request: unknown,
    ) {
      const binding = parseAutomaticRecommendationRequest(
        recommendationType,
        request,
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
      const contextDigest = automaticRecommendationIdentityDigest({
        operationPath: `${operationPath}/context`,
        identityType: 'trusted-context-binding',
        payload: {
          storeId: binding.storeId,
          fulfilmentMode: binding.fulfilmentMode,
          locale: binding.locale,
          orderingJourneyRef: binding.orderingJourneyRef,
          opportunityRef: binding.opportunityRef,
          ...('verifiedCustomerRef' in binding
            ? { verifiedCustomerRef: binding.verifiedCustomerRef }
            : {}),
          ...('parentCartLineId' in binding
            ? { parentCartLineId: binding.parentCartLineId }
            : {}),
        },
      });
      const durable = await evidence.readDecision(binding.requestId);
      if (durable !== null) {
        if (
          durable.requestDigest !== requestDigest ||
          durable.cartDigest !== cartDigest ||
          durable.contextDigest !== contextDigest ||
          durable.recommendationType !== recommendationType
        ) {
          throw new AutomaticRecommendationIdentityConflictError();
        }
        return parseAutomaticRecommendationResponse(durable.response);
      }
      const flight = flights.get(binding.requestId);
      if (flight !== undefined) {
        if (flight.requestDigest !== requestDigest) {
          throw new AutomaticRecommendationIdentityConflictError();
        }
        return flight.promise;
      }
      const claim = await evidence.claimDecision({
        idempotencyKey: binding.requestId,
        requestDigest,
        cartDigest,
        contextDigest,
      });
      if (claim !== 'acquired') {
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const winner = await evidence.readDecision(binding.requestId);
          if (winner !== null) {
            if (
              winner.requestDigest !== requestDigest ||
              winner.cartDigest !== cartDigest ||
              winner.contextDigest !== contextDigest
            )
              throw new AutomaticRecommendationIdentityConflictError();
            return parseAutomaticRecommendationResponse(winner.response);
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new AutomaticEvidencePersistenceError('transaction_failed');
      }
      const promise = (async () => {
        try {
          const response = parseAutomaticRecommendationResponse(
            await engine.decide(recommendationType, binding),
          );
          await evidence.commitClaimedDecision({
            idempotencyKey: binding.requestId,
            recommendationId: response.recommendationId,
            requestId: binding.requestId,
            requestDigest,
            contextDigest,
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
            technical: technicalEvidence({ request: binding, response }),
          });
          return response;
        } catch (error) {
          await evidence
            .releaseDecisionClaim(binding.requestId, requestDigest)
            .catch(() => undefined);
          throw error;
        }
      })();
      flights.set(binding.requestId, { requestDigest, promise });
      try {
        return await promise;
      } finally {
        if (flights.get(binding.requestId)?.promise === promise) {
          flights.delete(binding.requestId);
        }
      }
    },
  };
}
