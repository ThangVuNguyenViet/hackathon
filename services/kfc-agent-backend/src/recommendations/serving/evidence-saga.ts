import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import {
  parseAutomaticDecisionEvidence,
  parseAutomaticEventEvidence,
  type AutomaticDecisionEvidence,
  type AutomaticEventEvidence,
} from './evidence-contracts.js';

export type {
  AutomaticDecisionEvidence,
  AutomaticEventEvidence,
} from './evidence-contracts.js';
export { createAutomaticRecommendationServingRuntime } from './decision-runtime.js';

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
  inspectRecommendation?(input: {
    recommendationId: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    decision: AutomaticDecisionEvidence | null;
    events: readonly AutomaticEventEvidence[];
    pointers: readonly DurableEvidencePointer[];
    nextCursor: string | null;
  }>;
  claimDecision(input: {
    idempotencyKey: string;
    requestDigest: string;
    cartDigest: string;
    contextDigest: string;
    ownerToken: string;
    nowEpochMs: number;
    leaseExpiresAtEpochMs: number;
  }): Promise<'acquired' | 'pending' | 'replayed'>;
  claimEvent(input: {
    idempotencyKey: string;
    payloadDigest: string;
    ownerToken: string;
    nowEpochMs: number;
    leaseExpiresAtEpochMs: number;
  }): Promise<'acquired' | 'pending' | 'replayed'>;
  renewDecisionClaim(input: {
    idempotencyKey: string;
    requestDigest: string;
    ownerToken: string;
    nowEpochMs: number;
    leaseExpiresAtEpochMs: number;
  }): Promise<void>;
  renewEventClaim(input: {
    idempotencyKey: string;
    payloadDigest: string;
    ownerToken: string;
    nowEpochMs: number;
    leaseExpiresAtEpochMs: number;
  }): Promise<void>;
  releaseDecisionClaim(input: {
    idempotencyKey: string;
    requestDigest: string;
    ownerToken: string;
  }): Promise<void>;
  releaseEventClaim(input: {
    idempotencyKey: string;
    payloadDigest: string;
    ownerToken: string;
  }): Promise<void>;
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
    ownerToken: string;
    nowEpochMs: number;
  }): Promise<'committed' | 'replayed'>;
  commitEvent(input: {
    idempotencyKey: string;
    evidenceKey: string;
    evidenceVersionId: string;
    evidenceDigest: string;
    evidenceSizeBytes: number;
    evidence: AutomaticEventEvidence;
    ownerToken: string;
    nowEpochMs: number;
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
  clock,
  ownerToken = randomUUID,
  claimLeaseMs = 30_000,
}: {
  objects: AutomaticEvidenceObjectStore;
  ledger: AutomaticRecommendationLedger;
  clock: () => Date;
  ownerToken?: () => string;
  claimLeaseMs?: number;
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
  async function persist(envelope: EvidenceEnvelope, claimOwner: string) {
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
    const renewNowEpochMs = clock().getTime();
    if (envelope.kind === 'decision') {
      await ledger.renewDecisionClaim({
        idempotencyKey: envelope.payload.idempotencyKey,
        requestDigest: envelope.payload.requestDigest,
        ownerToken: claimOwner,
        nowEpochMs: renewNowEpochMs,
        leaseExpiresAtEpochMs: renewNowEpochMs + claimLeaseMs,
      });
    } else {
      await ledger.renewEventClaim({
        idempotencyKey: envelope.payload.idempotencyKey,
        payloadDigest: envelope.payload.payloadDigest,
        ownerToken: claimOwner,
        nowEpochMs: renewNowEpochMs,
        leaseExpiresAtEpochMs: renewNowEpochMs + claimLeaseMs,
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
              ownerToken: claimOwner,
              nowEpochMs: clock().getTime(),
            })
          : await ledger.commitEvent({
              idempotencyKey: envelope.payload.idempotencyKey,
              evidenceKey: object.key,
              evidenceVersionId: pointer.versionId,
              evidenceDigest: object.digest,
              evidenceSizeBytes: object.sizeBytes,
              evidence: envelope.payload,
              ownerToken: claimOwner,
              nowEpochMs: clock().getTime(),
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
    async claimDecision(input: {
      idempotencyKey: string;
      requestDigest: string;
      cartDigest: string;
      contextDigest: string;
    }) {
      const token = ownerToken();
      const nowEpochMs = clock().getTime();
      const status = await ledger.claimDecision({
        ...input,
        ownerToken: token,
        nowEpochMs,
        leaseExpiresAtEpochMs: nowEpochMs + claimLeaseMs,
      });
      return { status, ownerToken: token };
    },
    releaseDecisionClaim: (input: {
      idempotencyKey: string;
      requestDigest: string;
      ownerToken: string;
    }) => ledger.releaseDecisionClaim(input),
    readDecision: (idempotencyKey: string) =>
      ledger.readDecision(idempotencyKey),
    async commitDecision(value: AutomaticDecisionEvidence) {
      const parsed = parseAutomaticDecisionEvidence(value);
      const token = ownerToken();
      const nowEpochMs = clock().getTime();
      const claim = await ledger.claimDecision({
        ...parsed,
        ownerToken: token,
        nowEpochMs,
        leaseExpiresAtEpochMs: nowEpochMs + claimLeaseMs,
      });
      if (claim === 'replayed') return { status: 'committed' as const };
      if (claim === 'pending') {
        throw new AutomaticEvidencePersistenceError('transaction_failed');
      }
      try {
        return await persist(
          {
            schemaVersion: 'kfc-automatic-evidence-v1',
            kind: 'decision',
            payload: parsed,
          },
          token,
        );
      } catch (error) {
        await ledger.releaseDecisionClaim({
          idempotencyKey: parsed.idempotencyKey,
          requestDigest: parsed.requestDigest,
          ownerToken: token,
        });
        throw error;
      }
    },
    commitClaimedDecision(value: AutomaticDecisionEvidence, token: string) {
      return persist(
        {
          schemaVersion: 'kfc-automatic-evidence-v1',
          kind: 'decision',
          payload: parseAutomaticDecisionEvidence(value),
        },
        token,
      );
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
      const token = ownerToken();
      const nowEpochMs = clock().getTime();
      const claim = await ledger.claimEvent({
        ...parsed,
        ownerToken: token,
        nowEpochMs,
        leaseExpiresAtEpochMs: nowEpochMs + claimLeaseMs,
      });
      if (claim === 'replayed') return { status: 'committed' as const };
      if (claim === 'pending') {
        const winner = await waitForEvent(parsed.idempotencyKey);
        if (winner.payloadDigest !== parsed.payloadDigest) {
          throw new AutomaticRecommendationIdentityConflictError();
        }
        return { status: 'committed' as const };
      }
      const promise = persist(
        {
          schemaVersion: 'kfc-automatic-evidence-v1',
          kind: 'event',
          payload: parsed,
        },
        token,
      );
      eventFlights.set(parsed.idempotencyKey, {
        payloadDigest: parsed.payloadDigest,
        promise,
      });
      try {
        return await promise;
      } catch (error) {
        await ledger.releaseEventClaim({
          idempotencyKey: parsed.idempotencyKey,
          payloadDigest: parsed.payloadDigest,
          ownerToken: token,
        });
        throw error;
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
            const token = ownerToken();
            const nowEpochMs = clock().getTime();
            const claim = await ledger.claimDecision({
              idempotencyKey: envelope.payload.idempotencyKey,
              requestDigest: envelope.payload.requestDigest,
              cartDigest: envelope.payload.cartDigest,
              contextDigest: envelope.payload.contextDigest,
              ownerToken: token,
              nowEpochMs,
              leaseExpiresAtEpochMs: nowEpochMs + claimLeaseMs,
            });
            if (claim !== 'acquired') continue;
            await ledger.commitDecision({
              idempotencyKey: envelope.payload.idempotencyKey,
              evidenceKey: object.key,
              evidenceVersionId: object.versionId,
              evidenceDigest: object.digest,
              evidenceSizeBytes: object.sizeBytes,
              evidence: envelope.payload,
              ownerToken: token,
              nowEpochMs,
            });
          } else {
            const token = ownerToken();
            const nowEpochMs = clock().getTime();
            const claim = await ledger.claimEvent({
              idempotencyKey: envelope.payload.idempotencyKey,
              payloadDigest: envelope.payload.payloadDigest,
              ownerToken: token,
              nowEpochMs,
              leaseExpiresAtEpochMs: nowEpochMs + claimLeaseMs,
            });
            if (claim !== 'acquired') continue;
            await ledger.commitEvent({
              idempotencyKey: envelope.payload.idempotencyKey,
              evidenceKey: object.key,
              evidenceVersionId: object.versionId,
              evidenceDigest: object.digest,
              evidenceSizeBytes: object.sizeBytes,
              evidence: envelope.payload,
              ownerToken: token,
              nowEpochMs,
            });
          }
          repaired += 1;
        } catch {
          failed += 1;
        }
      }
      return { inspected: stored.length, repaired, failed };
    },
    async inspect(recommendationId: string, limit = 25, cursor?: string) {
      if (ledger.inspectRecommendation === undefined) {
        throw new Error('bounded recommendation inspection is unavailable');
      }
      const inspected = await ledger.inspectRecommendation({
        recommendationId,
        limit,
        cursor,
      });
      if (inspected.decision === null) {
        throw new Error('recommendation evidence was not found');
      }
      const payload = inspected.decision;
      const response = isRecord(payload.response) ? payload.response : {};
      return {
        schemaVersion: 'kfc-automatic-inspection-v1' as const,
        recommendationId,
        requestDigest: payload.requestDigest,
        cartDigest: payload.cartDigest,
        model: response.model ?? null,
        candidateEvidence: payload.technical.eligibilityDecisions,
        persistenceEvidence: {
          pointers: inspected.pointers.map((pointer) => ({
            key: pointer.key,
            versionId: pointer.versionId,
            digest: pointer.digest,
          })),
          eventCount: inspected.events.length,
          nextCursor: inspected.nextCursor,
        },
      };
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
    {
      requestDigest: string;
      cartDigest: string;
      contextDigest: string;
      ownerToken: string;
      leaseExpiresAtEpochMs: number;
    }
  >();
  private readonly eventClaims = new Map<
    string,
    { payloadDigest: string; ownerToken: string; leaseExpiresAtEpochMs: number }
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
      ownerToken: string;
      nowEpochMs: number;
      claim: { ownerToken: string; leaseExpiresAtEpochMs: number } | undefined;
    },
  ): 'committed' | 'replayed' {
    this.failIfRequested();
    if (
      input.claim === undefined ||
      input.claim.ownerToken !== input.ownerToken ||
      input.claim.leaseExpiresAtEpochMs < input.nowEpochMs
    ) {
      throw new AutomaticEvidencePersistenceError('idempotency_conflict');
    }
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
    ownerToken: string;
    nowEpochMs: number;
  }): Promise<'committed' | 'replayed'> {
    const result = this.commit(this.decisionState, {
      ...input,
      claim: this.decisionClaims.get(input.idempotencyKey),
    });
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
    ownerToken: string;
    nowEpochMs: number;
  }): Promise<'committed' | 'replayed'> {
    const result = this.commit(this.eventState, {
      ...input,
      claim: this.eventClaims.get(input.idempotencyKey),
    });
    this.eventClaims.delete(input.idempotencyKey);
    return result;
  }

  async claimDecision(input: {
    idempotencyKey: string;
    requestDigest: string;
    cartDigest: string;
    contextDigest: string;
    ownerToken: string;
    nowEpochMs: number;
    leaseExpiresAtEpochMs: number;
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
      if (claim.leaseExpiresAtEpochMs > input.nowEpochMs) return 'pending';
      this.decisionClaims.set(input.idempotencyKey, input);
      return 'acquired';
    }
    this.decisionClaims.set(input.idempotencyKey, input);
    return 'acquired';
  }

  async claimEvent(input: {
    idempotencyKey: string;
    payloadDigest: string;
    ownerToken: string;
    nowEpochMs: number;
    leaseExpiresAtEpochMs: number;
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
      if (claim.payloadDigest !== input.payloadDigest) {
        throw new AutomaticRecommendationIdentityConflictError();
      }
      if (claim.leaseExpiresAtEpochMs > input.nowEpochMs) return 'pending';
      this.eventClaims.set(input.idempotencyKey, input);
      return 'acquired';
    }
    this.eventClaims.set(input.idempotencyKey, input);
    return 'acquired';
  }

  async renewDecisionClaim(input: {
    idempotencyKey: string;
    requestDigest: string;
    ownerToken: string;
    nowEpochMs: number;
    leaseExpiresAtEpochMs: number;
  }) {
    const claim = this.decisionClaims.get(input.idempotencyKey);
    if (
      claim?.requestDigest !== input.requestDigest ||
      claim.ownerToken !== input.ownerToken ||
      claim.leaseExpiresAtEpochMs < input.nowEpochMs
    )
      throw new AutomaticEvidencePersistenceError('idempotency_conflict');
    this.decisionClaims.set(input.idempotencyKey, { ...claim, ...input });
  }

  async renewEventClaim(input: {
    idempotencyKey: string;
    payloadDigest: string;
    ownerToken: string;
    nowEpochMs: number;
    leaseExpiresAtEpochMs: number;
  }) {
    const claim = this.eventClaims.get(input.idempotencyKey);
    if (
      claim?.payloadDigest !== input.payloadDigest ||
      claim.ownerToken !== input.ownerToken ||
      claim.leaseExpiresAtEpochMs < input.nowEpochMs
    )
      throw new AutomaticEvidencePersistenceError('idempotency_conflict');
    this.eventClaims.set(input.idempotencyKey, { ...claim, ...input });
  }

  async releaseDecisionClaim(input: {
    idempotencyKey: string;
    requestDigest: string;
    ownerToken: string;
  }) {
    const claim = this.decisionClaims.get(input.idempotencyKey);
    if (
      claim?.requestDigest === input.requestDigest &&
      claim.ownerToken === input.ownerToken
    ) {
      this.decisionClaims.delete(input.idempotencyKey);
    }
  }

  async releaseEventClaim(input: {
    idempotencyKey: string;
    payloadDigest: string;
    ownerToken: string;
  }) {
    const claim = this.eventClaims.get(input.idempotencyKey);
    if (
      claim?.payloadDigest === input.payloadDigest &&
      claim.ownerToken === input.ownerToken
    ) {
      this.eventClaims.delete(input.idempotencyKey);
    }
  }

  async readDecision(idempotencyKey: string) {
    return this.decisionState.get(idempotencyKey)?.evidence ?? null;
  }

  async readEvent(idempotencyKey: string) {
    return this.eventState.get(idempotencyKey)?.evidence ?? null;
  }

  async inspectRecommendation(input: {
    recommendationId: string;
    limit: number;
    cursor?: string;
  }) {
    const decision = [...this.decisionState.values()].find(
      ({ evidence }) => evidence.recommendationId === input.recommendationId,
    );
    const sorted = [...this.eventState.entries()]
      .filter(
        ([, value]) =>
          value.evidence.recommendationId === input.recommendationId,
      )
      .sort(([left], [right]) => left.localeCompare(right));
    const start =
      input.cursor === undefined
        ? 0
        : Math.max(
            0,
            sorted.findIndex(
              ([id]) =>
                id === Buffer.from(input.cursor!, 'base64url').toString('utf8'),
            ) + 1,
          );
    const page = sorted.slice(
      start,
      start + Math.max(1, Math.min(100, input.limit)),
    );
    const values = page.map(([, value]) => value);
    const pointer = (value: LedgerRecord<unknown>): DurableEvidencePointer => ({
      key: value.evidenceKey,
      versionId: value.evidenceVersionId,
      digest: value.evidenceDigest,
      sizeBytes: value.evidenceSizeBytes,
    });
    const hasMore = start + page.length < sorted.length;
    return {
      decision: decision?.evidence ?? null,
      events: values.map(({ evidence }) => evidence),
      pointers: [
        ...(decision === undefined ? [] : [pointer(decision)]),
        ...values.map(pointer),
      ],
      nextCursor:
        hasMore && page.length > 0
          ? Buffer.from(page[page.length - 1]![0]).toString('base64url')
          : null,
    };
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
