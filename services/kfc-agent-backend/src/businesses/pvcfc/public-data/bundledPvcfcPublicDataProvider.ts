import { createHash } from 'node:crypto';
import bundledPublicData from '../../../../fixtures/generated/pvcfc-public-data.json' with { type: 'json' };
import {
  parsePvcfcPublicDataBundle,
  type PvcfcPublicDataBundle,
  type PvcfcPublicDataCollection,
} from './pvcfcPublicDataBundle.js';
import type {
  PvcfcCollectionPage,
  PvcfcGetRecordRequest,
  PvcfcListCollectionsRequest,
  PvcfcListRecordsRequest,
  PvcfcPublicDataError,
  PvcfcPublicDataProvider,
  PvcfcPublicDataResult,
  PvcfcPublicRecord,
  PvcfcRecordResult,
  PvcfcRecordLocator,
  PvcfcRecordLocatorPage,
  PvcfcSearchHit,
  PvcfcSearchPage,
  PvcfcSearchRecordsRequest,
} from './pvcfcPublicDataProvider.js';

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const MAX_QUERY_LENGTH = 500;
const MAX_INDEXED_TEXT_LENGTH = 32_000;
const MAX_TITLE_LENGTH = 160;
const MAX_SUMMARY_LENGTH = 240;

interface CursorPayload {
  readonly version: 1;
  readonly revision: string;
  readonly operation: 'collections' | 'records' | 'search';
  readonly signature: string;
  readonly offset: number;
}

interface SearchDocument {
  readonly collection: string;
  readonly record: PvcfcPublicRecord;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly normalizedText: string;
  readonly sourceUrl: string;
}

type InitializedProvider =
  | {
      readonly ok: true;
      readonly bundle: PvcfcPublicDataBundle;
      readonly collections: ReadonlyMap<string, PvcfcPublicDataCollection>;
      readonly records: ReadonlyMap<
        string,
        ReadonlyMap<string, PvcfcPublicRecord>
      >;
      readonly documents: readonly SearchDocument[];
    }
  | { readonly ok: false; readonly error: PvcfcPublicDataError };

function error<T>(
  code: PvcfcPublicDataError['code'],
  message: string,
): PvcfcPublicDataResult<T> {
  return { ok: false, error: { code, message } };
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/đ/gu, 'd')
    .replace(/Đ/gu, 'D')
    .toLocaleLowerCase('vi')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function collectSearchableStrings(value: unknown, output: string[]): void {
  if (output.join(' ').length >= MAX_INDEXED_TEXT_LENGTH) return;
  if (typeof value === 'string') {
    if (!/^https?:\/\//iu.test(value)) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectSearchableStrings(child, output);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'provenance' || key === 'originRefs') continue;
    output.push(key);
    collectSearchableStrings(child, output);
  }
}

function titleFor(record: PvcfcPublicRecord): string {
  const candidate =
    typeof record.name === 'string'
      ? record.name
      : typeof record.title === 'string'
        ? record.title
        : record.id;
  return candidate.slice(0, MAX_TITLE_LENGTH);
}

function summaryFor(record: PvcfcPublicRecord): string {
  const candidate = [
    record.summary,
    record.scope,
    record.description,
    record.category,
  ].find((value): value is string => typeof value === 'string');
  return (candidate ?? '').slice(0, MAX_SUMMARY_LENGTH);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sourceUrlFor(record: PvcfcPublicRecord): string {
  const provenance = record.provenance;
  if (!isUnknownRecord(provenance)) return '';
  const sourceUrl = provenance.sourceUrl;
  return typeof sourceUrl === 'string' ? sourceUrl : '';
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requestSignature(value: unknown): string {
  return hash(JSON.stringify(value));
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(value: string): CursorPayload | undefined {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as unknown;
    if (!isUnknownRecord(parsed)) return undefined;
    if (
      parsed.version !== 1 ||
      (parsed.operation !== 'collections' &&
        parsed.operation !== 'records' &&
        parsed.operation !== 'search') ||
      typeof parsed.revision !== 'string' ||
      typeof parsed.signature !== 'string' ||
      typeof parsed.offset !== 'number' ||
      !Number.isSafeInteger(parsed.offset) ||
      parsed.offset < 0
    ) {
      return undefined;
    }
    return {
      version: 1,
      revision: parsed.revision,
      operation: parsed.operation,
      signature: parsed.signature,
      offset: parsed.offset,
    };
  } catch {
    return undefined;
  }
}

function cursorOffset(
  cursorValue: string | undefined,
  bundle: PvcfcPublicDataBundle,
  operation: CursorPayload['operation'],
  signature: string,
): PvcfcPublicDataResult<number> {
  if (cursorValue === undefined) return { ok: true, value: 0 };
  const cursor = decodeCursor(cursorValue);
  if (cursor === undefined || cursor.operation !== operation) {
    return error('invalid_request', 'The pagination cursor is invalid.');
  }
  if (cursor.revision !== bundle.revision) {
    return error(
      'cursor_stale',
      'The public-data revision changed; restart pagination.',
    );
  }
  if (cursor.signature !== signature) {
    return error(
      'invalid_request',
      'The pagination cursor does not match this request.',
    );
  }
  return { ok: true, value: cursor.offset };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value))
    return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function scoreDocument(
  document: SearchDocument,
  normalizedQuery: string,
  queryTokens: readonly string[],
): number {
  let score = 0;
  if (document.normalizedTitle === normalizedQuery) score += 100;
  else if (document.normalizedTitle.startsWith(normalizedQuery)) score += 50;
  else if (document.normalizedTitle.includes(normalizedQuery)) score += 30;
  if (document.normalizedText.includes(normalizedQuery)) score += 20;
  const titleTokens = document.normalizedTitle.split(' ');
  for (const token of queryTokens) {
    if (titleTokens.includes(token)) score += 8;
    else if (document.normalizedTitle.includes(token)) score += 4;
    if (document.normalizedText.includes(token)) score += 2;
  }
  return score;
}

class BundledPvcfcPublicDataProvider implements PvcfcPublicDataProvider {
  readonly #source: () => unknown;
  #initialized: InitializedProvider | undefined;

  constructor(source: () => unknown) {
    this.#source = source;
  }

  async listCollections(
    request: PvcfcListCollectionsRequest = {},
  ): Promise<PvcfcPublicDataResult<PvcfcCollectionPage>> {
    const initialized = this.#initialize();
    if (!initialized.ok) return initialized;
    const limit = boundedLimit(request.limit);
    const signature = requestSignature({ operation: 'collections', limit });
    const offset = cursorOffset(
      request.cursor,
      initialized.bundle,
      'collections',
      signature,
    );
    if (!offset.ok) return offset;

    const summaries = initialized.bundle.collections.map((collection) => ({
      name: collection.name,
      access: collection.access,
      count: collection.count,
    }));
    const collections = summaries.slice(offset.value, offset.value + limit);
    const nextOffset = offset.value + collections.length;
    return {
      ok: true,
      value: deepFreeze({
        revision: initialized.bundle.revision,
        capturedAt: initialized.bundle.capturedAt,
        organization: initialized.bundle.organization,
        collections,
        ...(nextOffset < summaries.length
          ? {
              nextCursor: encodeCursor({
                version: 1,
                revision: initialized.bundle.revision,
                operation: 'collections',
                signature,
                offset: nextOffset,
              }),
            }
          : {}),
      }),
    };
  }

  async listRecords(
    request: PvcfcListRecordsRequest,
  ): Promise<PvcfcPublicDataResult<PvcfcRecordLocatorPage>> {
    const initialized = this.#initialize();
    if (!initialized.ok) return initialized;
    const collection = initialized.collections.get(request.collection);
    if (collection === undefined) {
      return error(
        'invalid_request',
        'The requested collection does not exist.',
      );
    }
    const limit = boundedLimit(request.limit);
    const signature = requestSignature({
      operation: 'records',
      collection: request.collection,
      limit,
    });
    const offset = cursorOffset(
      request.cursor,
      initialized.bundle,
      'records',
      signature,
    );
    if (!offset.ok) return offset;
    if (offset.value >= collection.records.length) {
      return error('no_match', 'No public-data records matched the request.');
    }

    const page = collection.records.slice(offset.value, offset.value + limit);
    const records: PvcfcRecordLocator[] = page.map((record) => ({
      collection: collection.name,
      id: record.id,
      title: titleFor(record),
      sourceUrl: sourceUrlFor(record),
    }));
    const nextOffset = offset.value + records.length;
    return {
      ok: true,
      value: deepFreeze({
        revision: initialized.bundle.revision,
        collection: collection.name,
        records,
        ...(nextOffset < collection.records.length
          ? {
              nextCursor: encodeCursor({
                version: 1,
                revision: initialized.bundle.revision,
                operation: 'records',
                signature,
                offset: nextOffset,
              }),
            }
          : {}),
      }),
    };
  }

  async searchRecords(
    request: PvcfcSearchRecordsRequest,
  ): Promise<PvcfcPublicDataResult<PvcfcSearchPage>> {
    const initialized = this.#initialize();
    if (!initialized.ok) return initialized;
    const normalizedQuery = normalizeSearchText(
      request.query.slice(0, MAX_QUERY_LENGTH),
    );
    if (normalizedQuery.length === 0) {
      return error('invalid_request', 'A non-empty search query is required.');
    }

    const requestedCollections = request.collections
      ? [...new Set(request.collections)].sort()
      : undefined;
    if (
      requestedCollections?.some(
        (collection) => !initialized.collections.has(collection),
      )
    ) {
      return error(
        'invalid_request',
        'One or more requested collections do not exist.',
      );
    }
    const limit = boundedLimit(request.limit);
    const signature = requestSignature({
      operation: 'search',
      query: normalizedQuery,
      collections: requestedCollections ?? null,
      limit,
    });
    const offset = cursorOffset(
      request.cursor,
      initialized.bundle,
      'search',
      signature,
    );
    if (!offset.ok) return offset;

    const allowed = requestedCollections
      ? new Set(requestedCollections)
      : undefined;
    const queryTokens = [...new Set(normalizedQuery.split(' '))].filter(
      (token) => token.length >= 2,
    );
    const ranked = initialized.documents
      .filter(
        (document) => allowed === undefined || allowed.has(document.collection),
      )
      .map((document) => ({
        document,
        score: scoreDocument(document, normalizedQuery, queryTokens),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.document.collection.localeCompare(right.document.collection) ||
          left.document.record.id.localeCompare(right.document.record.id),
      );
    if (ranked.length === 0 || offset.value >= ranked.length) {
      return error('no_match', 'No public-data records matched the request.');
    }

    const page = ranked.slice(offset.value, offset.value + limit);
    const hits: PvcfcSearchHit[] = page.map(({ document }) => ({
      collection: document.collection,
      id: document.record.id,
      title: document.title,
      summary: summaryFor(document.record),
      sourceUrl: document.sourceUrl,
    }));
    const nextOffset = offset.value + hits.length;
    return {
      ok: true,
      value: deepFreeze({
        revision: initialized.bundle.revision,
        hits,
        ...(nextOffset < ranked.length
          ? {
              nextCursor: encodeCursor({
                version: 1,
                revision: initialized.bundle.revision,
                operation: 'search',
                signature,
                offset: nextOffset,
              }),
            }
          : {}),
      }),
    };
  }

  async getRecord(
    request: PvcfcGetRecordRequest,
  ): Promise<PvcfcPublicDataResult<PvcfcRecordResult>> {
    const initialized = this.#initialize();
    if (!initialized.ok) return initialized;
    const records = initialized.records.get(request.collection);
    if (records === undefined) {
      return error(
        'invalid_request',
        'The requested collection does not exist.',
      );
    }
    if (request.id.trim().length === 0) {
      return error('invalid_request', 'A non-empty record id is required.');
    }
    const record = records.get(request.id);
    if (record === undefined) {
      return error('no_match', 'No public-data record matched the request.');
    }
    return {
      ok: true,
      value: deepFreeze({
        revision: initialized.bundle.revision,
        collection: request.collection,
        record,
      }),
    };
  }

  #initialize(): InitializedProvider {
    if (this.#initialized !== undefined) return this.#initialized;
    let input: unknown;
    try {
      input = this.#source();
    } catch {
      this.#initialized = {
        ok: false,
        error: {
          code: 'provider_unavailable',
          message: 'PVCFC public data is currently unavailable.',
        },
      };
      return this.#initialized;
    }

    let bundle: PvcfcPublicDataBundle;
    try {
      bundle = deepFreeze(parsePvcfcPublicDataBundle(input));
    } catch {
      this.#initialized = {
        ok: false,
        error: {
          code: 'provider_invalid',
          message: 'PVCFC public data is invalid.',
        },
      };
      return this.#initialized;
    }

    const collections = new Map(
      bundle.collections.map((collection) => [collection.name, collection]),
    );
    const records = new Map(
      bundle.collections.map((collection) => [
        collection.name,
        new Map(collection.records.map((record) => [record.id, record])),
      ]),
    );
    const documents: SearchDocument[] = [];
    for (const collection of bundle.collections) {
      if (collection.access !== 'searchable') continue;
      for (const record of collection.records) {
        const strings: string[] = [];
        collectSearchableStrings(record, strings);
        const title = titleFor(record);
        documents.push({
          collection: collection.name,
          record,
          title,
          normalizedTitle: normalizeSearchText(title),
          normalizedText: normalizeSearchText(
            strings.join(' ').slice(0, MAX_INDEXED_TEXT_LENGTH),
          ),
          sourceUrl: sourceUrlFor(record),
        });
      }
    }
    this.#initialized = {
      ok: true,
      bundle,
      collections,
      records,
      documents: Object.freeze(documents),
    };
    return this.#initialized;
  }
}

export function createPvcfcPublicDataProvider(
  source: () => unknown,
): PvcfcPublicDataProvider {
  return new BundledPvcfcPublicDataProvider(source);
}

let provider: PvcfcPublicDataProvider | undefined;

export function loadBundledPvcfcPublicDataProvider(): PvcfcPublicDataProvider {
  provider ??= createPvcfcPublicDataProvider(() => bundledPublicData);
  return provider;
}
