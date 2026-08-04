import {
  AutomaticEvidencePersistenceError,
  type AutomaticDecisionEvidence,
  type AutomaticEventEvidence,
  type AutomaticEvidenceObjectStore,
  type AutomaticRecommendationLedger,
  type ImmutableEvidenceObject,
} from './evidence-saga.js';

export interface S3EvidenceClient {
  putObject(input: {
    bucket: string;
    key: string;
    body: string;
    contentType: 'application/json';
    ifNoneMatch: '*';
    metadata: { sha256: string };
  }): Promise<void>;
  headObject(input: {
    bucket: string;
    key: string;
  }): Promise<{ metadata: Record<string, string | undefined> }>;
  listObjects(input: {
    bucket: string;
    prefix: string;
  }): Promise<{ keys: readonly string[] }>;
  getObject(input: { bucket: string; key: string }): Promise<{ body: string }>;
}

interface DynamoRecord {
  pk: string;
  sk: string;
  evidenceDigest: string;
  evidenceKey: string;
  payload: unknown;
}

export interface DynamoEvidenceClient {
  transactWrite(input: {
    puts: readonly {
      tableName: string;
      item: DynamoRecord;
      condition: 'attribute_not_exists(pk)';
    }[];
  }): Promise<void>;
  getItem(input: {
    tableName: string;
    pk: string;
    sk: string;
    consistentRead: true;
  }): Promise<DynamoRecord | null>;
  hasEvidence(input: {
    tableName: string;
    evidenceDigest: string;
  }): Promise<boolean>;
}

function transactionCanceled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'TransactionCanceledException'
  );
}

export class DynamoDbAutomaticRecommendationLedger implements AutomaticRecommendationLedger {
  constructor(
    private readonly options: {
      tableName: string;
      client: DynamoEvidenceClient;
    },
  ) {}

  private async commit<
    T extends AutomaticDecisionEvidence | AutomaticEventEvidence,
  >(
    kind: 'decision' | 'event',
    input: {
      idempotencyKey: string;
      evidenceKey: string;
      evidenceDigest: string;
      evidence: T;
    },
  ): Promise<'committed' | 'replayed'> {
    const binding: DynamoRecord = {
      pk: `IDEMPOTENCY#${kind}#${input.idempotencyKey}`,
      sk: 'BINDING',
      evidenceDigest: input.evidenceDigest,
      evidenceKey: input.evidenceKey,
      payload: { kind },
    };
    const durable: DynamoRecord = {
      pk: `RECOMMENDATION#${input.evidence.recommendationId}`,
      sk: kind === 'decision' ? 'DECISION' : `EVENT#${input.idempotencyKey}`,
      evidenceDigest: input.evidenceDigest,
      evidenceKey: input.evidenceKey,
      payload: input.evidence,
    };
    try {
      await this.options.client.transactWrite({
        puts: [binding, durable].map((item) => ({
          tableName: this.options.tableName,
          item,
          condition: 'attribute_not_exists(pk)' as const,
        })),
      });
      return 'committed';
    } catch (error) {
      if (!transactionCanceled(error)) throw error;
      const existing = await this.options.client.getItem({
        tableName: this.options.tableName,
        pk: binding.pk,
        sk: binding.sk,
        consistentRead: true,
      });
      if (existing?.evidenceDigest === input.evidenceDigest) return 'replayed';
      throw new AutomaticEvidencePersistenceError('idempotency_conflict', {
        cause: error,
      });
    }
  }

  commitDecision(input: {
    idempotencyKey: string;
    evidenceKey: string;
    evidenceDigest: string;
    evidence: AutomaticDecisionEvidence;
  }): Promise<'committed' | 'replayed'> {
    return this.commit('decision', input);
  }

  commitEvent(input: {
    idempotencyKey: string;
    evidenceKey: string;
    evidenceDigest: string;
    evidence: AutomaticEventEvidence;
  }): Promise<'committed' | 'replayed'> {
    return this.commit('event', input);
  }

  hasEvidence(digest: string): Promise<boolean> {
    return this.options.client.hasEvidence({
      tableName: this.options.tableName,
      evidenceDigest: digest,
    });
  }
}

function isPreconditionFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'PreconditionFailed'
  );
}

export class S3AutomaticEvidenceObjectStore implements AutomaticEvidenceObjectStore {
  constructor(
    private readonly options: { bucket: string; client: S3EvidenceClient },
  ) {}

  async putImmutable(object: ImmutableEvidenceObject): Promise<void> {
    try {
      await this.options.client.putObject({
        bucket: this.options.bucket,
        key: object.key,
        body: object.body,
        contentType: 'application/json',
        ifNoneMatch: '*',
        metadata: { sha256: object.digest },
      });
    } catch (error) {
      if (!isPreconditionFailure(error)) throw error;
      const existing = await this.options.client.headObject({
        bucket: this.options.bucket,
        key: object.key,
      });
      if (existing.metadata.sha256 !== object.digest) {
        throw new Error('immutable S3 evidence digest conflict');
      }
    }
  }

  async list(prefix: string): Promise<readonly ImmutableEvidenceObject[]> {
    const listed = await this.options.client.listObjects({
      bucket: this.options.bucket,
      prefix,
    });
    return Promise.all(
      listed.keys.map(async (key) => {
        const [head, value] = await Promise.all([
          this.options.client.headObject({ bucket: this.options.bucket, key }),
          this.options.client.getObject({ bucket: this.options.bucket, key }),
        ]);
        const digest = head.metadata.sha256;
        if (digest === undefined) {
          throw new Error('S3 evidence object has no digest metadata');
        }
        return { key, digest, body: value.body };
      }),
    );
  }
}
