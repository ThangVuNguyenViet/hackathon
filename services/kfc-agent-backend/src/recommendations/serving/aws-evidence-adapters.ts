import {
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  GetCommand,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';
import {
  AutomaticEvidencePersistenceError,
  AutomaticRecommendationIdentityConflictError,
  type AutomaticDecisionEvidence,
  type AutomaticEventEvidence,
  type AutomaticEvidenceObjectStore,
  type AutomaticRecommendationLedger,
  type DurableEvidencePointer,
  type ImmutableEvidenceObject,
  type StoredEvidenceObject,
} from './evidence-saga.js';
import {
  parseAutomaticDecisionEvidence,
  parseAutomaticEventEvidence,
} from './evidence-contracts.js';

interface AwsCommandClient {
  send(command: object): Promise<unknown>;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AWS response must be an object');
  }
  return Object.fromEntries(Object.entries(value));
}

function awsErrorName(error: unknown): string | null {
  return error instanceof Error ? error.name : null;
}

async function bodyBytes(value: unknown): Promise<Uint8Array> {
  if (
    value !== null &&
    typeof value === 'object' &&
    'transformToByteArray' in value &&
    typeof value.transformToByteArray === 'function'
  ) {
    return value.transformToByteArray();
  }
  throw new Error('S3 response body cannot be read');
}

export class S3AutomaticEvidenceObjectStore implements AutomaticEvidenceObjectStore {
  constructor(
    private readonly options: { bucket: string; client: AwsCommandClient },
  ) {}

  private async readExact(
    key: string,
    versionId: string,
  ): Promise<StoredEvidenceObject> {
    const response = record(
      await this.options.client.send(
        new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          VersionId: versionId,
        }),
      ),
    );
    const bytes = await bodyBytes(response.Body);
    const body = Buffer.from(bytes).toString('utf8');
    const metadata = record(response.Metadata ?? {});
    const digest = createHash('sha256').update(bytes).digest('hex');
    const sizeBytes = bytes.byteLength;
    if (
      response.VersionId !== versionId ||
      metadata.sha256 !== digest ||
      Number(metadata.sizebytes) !== sizeBytes ||
      response.ContentLength !== sizeBytes
    ) {
      throw new Error('versioned S3 evidence bytes do not match metadata');
    }
    return { key, versionId, digest, sizeBytes, body };
  }

  async putImmutable(
    object: ImmutableEvidenceObject,
  ): Promise<DurableEvidencePointer> {
    const actualDigest = createHash('sha256').update(object.body).digest('hex');
    if (
      actualDigest !== object.digest ||
      Buffer.byteLength(object.body) !== object.sizeBytes ||
      !object.key.endsWith(`/${object.digest}.json`)
    ) {
      throw new Error('S3 evidence input does not match content address');
    }
    try {
      const response = record(
        await this.options.client.send(
          new PutObjectCommand({
            Bucket: this.options.bucket,
            Key: object.key,
            Body: object.body,
            ContentType: 'application/json',
            IfNoneMatch: '*',
            Metadata: {
              sha256: object.digest,
              sizebytes: String(object.sizeBytes),
            },
          }),
        ),
      );
      if (
        typeof response.VersionId !== 'string' ||
        response.VersionId.length === 0
      ) {
        throw new Error('versioned S3 write returned no version ID');
      }
      return {
        key: object.key,
        versionId: response.VersionId,
        digest: object.digest,
        sizeBytes: object.sizeBytes,
      };
    } catch (error) {
      if (awsErrorName(error) !== 'PreconditionFailed') throw error;
      const versions = await this.versions(object.key);
      if (versions.length !== 1) {
        throw new Error('immutable S3 key has conflicting versions');
      }
      const existing = await this.readExact(object.key, versions[0]);
      if (
        existing.digest !== object.digest ||
        existing.sizeBytes !== object.sizeBytes ||
        existing.body !== object.body
      ) {
        throw new Error('immutable S3 evidence content conflict');
      }
      return existing;
    }
  }

  private async versions(
    exactKey?: string,
    prefix?: string,
  ): Promise<string[]> {
    const versions: string[] = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    do {
      const response = record(
        await this.options.client.send(
          new ListObjectVersionsCommand({
            Bucket: this.options.bucket,
            Prefix: exactKey ?? prefix,
            KeyMarker: keyMarker,
            VersionIdMarker: versionIdMarker,
          }),
        ),
      );
      const entries = Array.isArray(response.Versions) ? response.Versions : [];
      for (const value of entries) {
        const entry = record(value);
        if (
          typeof entry.Key === 'string' &&
          typeof entry.VersionId === 'string' &&
          (exactKey === undefined || entry.Key === exactKey)
        ) {
          versions.push(`${entry.Key}\0${entry.VersionId}`);
        }
      }
      keyMarker =
        response.IsTruncated === true &&
        typeof response.NextKeyMarker === 'string'
          ? response.NextKeyMarker
          : undefined;
      versionIdMarker =
        keyMarker !== undefined &&
        typeof response.NextVersionIdMarker === 'string'
          ? response.NextVersionIdMarker
          : undefined;
    } while (keyMarker !== undefined);
    return exactKey === undefined
      ? versions
      : versions.map((value) => value.split('\0')[1] ?? '');
  }

  async list(prefix: string): Promise<readonly StoredEvidenceObject[]> {
    const versions = await this.versions(undefined, prefix);
    return Promise.all(
      versions.map((binding) => {
        const [key, versionId] = binding.split('\0');
        if (key === undefined || versionId === undefined) {
          throw new Error('invalid S3 object version binding');
        }
        return this.readExact(key, versionId);
      }),
    );
  }
}

interface LedgerInput<T> {
  idempotencyKey: string;
  evidenceKey: string;
  evidenceVersionId: string;
  evidenceDigest: string;
  evidenceSizeBytes: number;
  evidence: T;
}

export class DynamoDbAutomaticRecommendationLedger implements AutomaticRecommendationLedger {
  constructor(
    private readonly options: { tableName: string; client: AwsCommandClient },
  ) {}

  private async claim(
    kind: 'decision' | 'event',
    input: {
      idempotencyKey: string;
      payloadDigest: string;
      cartDigest?: string;
      contextDigest?: string;
    },
  ): Promise<'acquired' | 'pending' | 'replayed'> {
    const key = {
      pk: `IDEMPOTENCY#${kind}#${input.idempotencyKey}`,
      sk: 'BINDING',
    };
    try {
      await this.options.client.send(
        new PutCommand({
          TableName: this.options.tableName,
          Item: {
            ...key,
            kind,
            state: 'pending',
            payloadDigest: input.payloadDigest,
            ...(input.cartDigest ? { cartDigest: input.cartDigest } : {}),
            ...(input.contextDigest
              ? { contextDigest: input.contextDigest }
              : {}),
          },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
      return 'acquired';
    } catch (error) {
      if (awsErrorName(error) !== 'ConditionalCheckFailedException')
        throw error;
      const existing = await this.readBinding(kind, input.idempotencyKey);
      if (
        existing === null ||
        existing.payloadDigest !== input.payloadDigest ||
        (input.cartDigest !== undefined &&
          existing.cartDigest !== input.cartDigest) ||
        (input.contextDigest !== undefined &&
          existing.contextDigest !== input.contextDigest)
      ) {
        throw new AutomaticRecommendationIdentityConflictError();
      }
      return existing.state === 'committed' ? 'replayed' : 'pending';
    }
  }

  claimDecision(input: {
    idempotencyKey: string;
    requestDigest: string;
    cartDigest: string;
    contextDigest: string;
  }) {
    return this.claim('decision', {
      idempotencyKey: input.idempotencyKey,
      payloadDigest: input.requestDigest,
      cartDigest: input.cartDigest,
      contextDigest: input.contextDigest,
    });
  }

  claimEvent(input: { idempotencyKey: string; payloadDigest: string }) {
    return this.claim('event', input);
  }

  private async releaseClaim(
    kind: 'decision' | 'event',
    idempotencyKey: string,
    payloadDigest: string,
  ) {
    try {
      await this.options.client.send(
        new DeleteCommand({
          TableName: this.options.tableName,
          Key: {
            pk: `IDEMPOTENCY#${kind}#${idempotencyKey}`,
            sk: 'BINDING',
          },
          ConditionExpression:
            '#state = :pending AND payloadDigest = :payloadDigest',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: {
            ':pending': 'pending',
            ':payloadDigest': payloadDigest,
          },
        }),
      );
    } catch (error) {
      if (awsErrorName(error) !== 'ConditionalCheckFailedException')
        throw error;
    }
  }

  releaseDecisionClaim(idempotencyKey: string, requestDigest: string) {
    return this.releaseClaim('decision', idempotencyKey, requestDigest);
  }

  releaseEventClaim(idempotencyKey: string, payloadDigest: string) {
    return this.releaseClaim('event', idempotencyKey, payloadDigest);
  }

  private async commit<
    T extends AutomaticDecisionEvidence | AutomaticEventEvidence,
  >(
    kind: 'decision' | 'event',
    input: LedgerInput<T>,
  ): Promise<'committed' | 'replayed'> {
    const bindingKey = `IDEMPOTENCY#${kind}#${input.idempotencyKey}`;
    const pointer = {
      evidenceKey: input.evidenceKey,
      evidenceVersionId: input.evidenceVersionId,
      evidenceDigest: input.evidenceDigest,
      evidenceSizeBytes: input.evidenceSizeBytes,
    };
    const payloadDigest =
      'requestDigest' in input.evidence
        ? input.evidence.requestDigest
        : input.evidence.payloadDigest;
    const durable = {
      pk: `RECOMMENDATION#${input.evidence.recommendationId}`,
      sk: kind === 'decision' ? 'DECISION' : `EVENT#${input.idempotencyKey}`,
      kind,
      ...pointer,
      ...input.evidence,
    };
    try {
      await this.options.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.options.tableName,
                Key: { pk: bindingKey, sk: 'BINDING' },
                ConditionExpression:
                  '#state = :pending AND payloadDigest = :payloadDigest',
                UpdateExpression:
                  'SET #state = :committed, evidenceKey = :evidenceKey, evidenceVersionId = :evidenceVersionId, evidenceDigest = :evidenceDigest, evidenceSizeBytes = :evidenceSizeBytes, recommendationId = :recommendationId',
                ExpressionAttributeNames: { '#state': 'state' },
                ExpressionAttributeValues: {
                  ':pending': 'pending',
                  ':committed': 'committed',
                  ':payloadDigest': payloadDigest,
                  ':evidenceKey': pointer.evidenceKey,
                  ':evidenceVersionId': pointer.evidenceVersionId,
                  ':evidenceDigest': pointer.evidenceDigest,
                  ':evidenceSizeBytes': pointer.evidenceSizeBytes,
                  ':recommendationId': input.evidence.recommendationId,
                },
              },
            },
            {
              Put: {
                TableName: this.options.tableName,
                Item: durable,
                ConditionExpression: 'attribute_not_exists(pk)',
              },
            },
          ],
        }),
      );
      return 'committed';
    } catch (error) {
      if (awsErrorName(error) !== 'TransactionCanceledException') throw error;
      const response = record(
        await this.options.client.send(
          new GetCommand({
            TableName: this.options.tableName,
            Key: { pk: bindingKey, sk: 'BINDING' },
            ConsistentRead: true,
          }),
        ),
      );
      const existing = record(response.Item ?? {});
      if (
        existing.evidenceKey === pointer.evidenceKey &&
        existing.evidenceVersionId === pointer.evidenceVersionId &&
        existing.evidenceDigest === pointer.evidenceDigest &&
        existing.evidenceSizeBytes === pointer.evidenceSizeBytes &&
        existing.payloadDigest === payloadDigest
      ) {
        return 'replayed';
      }
      throw new AutomaticEvidencePersistenceError('idempotency_conflict', {
        cause: error,
      });
    }
  }

  commitDecision(
    input: LedgerInput<AutomaticDecisionEvidence>,
  ): Promise<'committed' | 'replayed'> {
    return this.commit('decision', input);
  }

  commitEvent(
    input: LedgerInput<AutomaticEventEvidence>,
  ): Promise<'committed' | 'replayed'> {
    return this.commit('event', input);
  }

  private async readBinding(
    kind: 'decision' | 'event',
    idempotencyKey: string,
  ) {
    const response = record(
      await this.options.client.send(
        new GetCommand({
          TableName: this.options.tableName,
          Key: {
            pk: `IDEMPOTENCY#${kind}#${idempotencyKey}`,
            sk: 'BINDING',
          },
          ConsistentRead: true,
        }),
      ),
    );
    return response.Item === undefined ? null : record(response.Item);
  }

  async readDecision(idempotencyKey: string) {
    const binding = await this.readBinding('decision', idempotencyKey);
    if (binding === null || typeof binding.recommendationId !== 'string') {
      return null;
    }
    const response = record(
      await this.options.client.send(
        new GetCommand({
          TableName: this.options.tableName,
          Key: {
            pk: `RECOMMENDATION#${binding.recommendationId}`,
            sk: 'DECISION',
          },
          ConsistentRead: true,
        }),
      ),
    );
    return response.Item === undefined
      ? null
      : parseAutomaticDecisionEvidence(response.Item);
  }

  async readEvent(idempotencyKey: string) {
    const binding = await this.readBinding('event', idempotencyKey);
    if (binding === null || typeof binding.recommendationId !== 'string') {
      return null;
    }
    const response = record(
      await this.options.client.send(
        new GetCommand({
          TableName: this.options.tableName,
          Key: {
            pk: `RECOMMENDATION#${binding.recommendationId}`,
            sk: `EVENT#${idempotencyKey}`,
          },
          ConsistentRead: true,
        }),
      ),
    );
    return response.Item === undefined
      ? null
      : parseAutomaticEventEvidence(response.Item);
  }

  async hasEvidence(digest: string): Promise<boolean> {
    const response = record(
      await this.options.client.send(
        new QueryCommand({
          TableName: this.options.tableName,
          IndexName: 'evidenceDigest-index',
          KeyConditionExpression: 'evidenceDigest = :digest',
          ExpressionAttributeValues: { ':digest': digest },
          Select: 'COUNT',
          Limit: 1,
          ConsistentRead: false,
        }),
      ),
    );
    return typeof response.Count === 'number' && response.Count > 0;
  }
}
