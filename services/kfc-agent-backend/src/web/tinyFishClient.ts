import { TinyFish, type ClientOptions } from '@tiny-fish/sdk';
import {
  BusinessWebEvidenceError,
  boundEvidenceText,
  normalizeAllowedHostnames,
  optionalBoundedEvidenceText,
  validateBusinessWebUrl,
} from './businessWebEvidence.js';

const MAX_ADAPTER_TIMEOUT_MS = 15_000;
const MAX_SEARCH_RESULTS = 5;
const MAX_TITLE_LENGTH = 300;
const MAX_SNIPPET_LENGTH = 800;
const MAX_FETCH_TEXT_LENGTH = 12_000;
const MAX_PUBLISHED_DATE_LENGTH = 64;

interface TinyFishSdkSearchInput {
  readonly query: string;
  readonly include_domains: string;
  readonly language: string;
  readonly location: string;
}

interface TinyFishSdkFetchInput {
  readonly urls: [string];
  readonly format: 'markdown';
  readonly per_url_timeout_ms: number;
}

export interface TinyFishSdkLike {
  readonly search: {
    query(input: TinyFishSdkSearchInput): Promise<unknown>;
  };
  readonly fetch: {
    getContents(input: TinyFishSdkFetchInput): Promise<unknown>;
  };
}

export type TinyFishSdkFactory = (options: ClientOptions) => TinyFishSdkLike;

export interface TinyFishSearchResult {
  readonly sourceUrl: string;
  readonly title: string;
  readonly snippet: string;
  readonly publishedDate?: string;
  readonly retrievedAt: string;
}

export interface TinyFishFetchResult {
  readonly sourceUrl: string;
  readonly finalUrl: string;
  readonly title: string;
  readonly publishedDate?: string;
  readonly text: string;
  readonly retrievedAt: string;
}

export interface TinyFishClient {
  search(input: {
    query: string;
    includeDomains: readonly string[];
    language: string;
    location: string;
  }): Promise<readonly TinyFishSearchResult[]>;
  fetch(input: {
    url: string;
    allowedHostnames: readonly string[];
    perUrlTimeoutMs: number;
  }): Promise<TinyFishFetchResult>;
}

export class TinyFishClientError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'TinyFishClientError';
    this.code = code;
  }
}

interface UnknownRecord {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultSdkFactory(options: ClientOptions): TinyFishSdkLike {
  const sdk = new TinyFish(options);
  return {
    search: {
      query: (input) => sdk.search.query(input),
    },
    fetch: {
      getContents: (input) => sdk.fetch.getContents(input),
    },
  };
}

function validateTimeout(timeoutMs: number): void {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_ADAPTER_TIMEOUT_MS
  ) {
    throw new TinyFishClientError('tinyfish_timeout_invalid');
  }
}

function requiredBoundedText(
  value: string,
  code: string,
  maximumLength: number,
): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maximumLength) {
    throw new TinyFishClientError(code);
  }
  return trimmed;
}

function asResults(response: unknown): readonly unknown[] {
  if (!isRecord(response) || !Array.isArray(response['results'])) {
    throw new TinyFishClientError('tinyfish_response_invalid');
  }
  return response['results'];
}

function normalizeSearchResult(
  value: unknown,
  allowedHostnames: readonly string[],
  retrievedAt: string,
): TinyFishSearchResult | undefined {
  if (!isRecord(value) || typeof value['url'] !== 'string') {
    return undefined;
  }
  let sourceUrl: string;
  try {
    sourceUrl = validateBusinessWebUrl(value['url'], allowedHostnames);
  } catch (error) {
    if (error instanceof BusinessWebEvidenceError) {
      return undefined;
    }
    throw error;
  }

  const publishedDate = optionalBoundedEvidenceText(
    value['date'],
    MAX_PUBLISHED_DATE_LENGTH,
  );
  return {
    sourceUrl,
    title: boundEvidenceText(value['title'], MAX_TITLE_LENGTH),
    snippet: boundEvidenceText(value['snippet'], MAX_SNIPPET_LENGTH),
    ...(publishedDate === undefined ? {} : { publishedDate }),
    retrievedAt,
  };
}

function normalizeFetchResult(input: {
  response: unknown;
  sourceUrl: string;
  allowedHostnames: readonly string[];
  retrievedAt: string;
}): TinyFishFetchResult {
  if (!isRecord(input.response)) {
    throw new TinyFishClientError('tinyfish_fetch_failed');
  }
  if (
    !Array.isArray(input.response['results']) ||
    input.response['results'].length !== 1 ||
    (Array.isArray(input.response['errors']) &&
      input.response['errors'].length > 0)
  ) {
    throw new TinyFishClientError('tinyfish_fetch_failed');
  }
  const result = input.response['results'][0];
  if (!isRecord(result)) {
    throw new TinyFishClientError('tinyfish_fetch_failed');
  }

  const finalUrlCandidate =
    typeof result['final_url'] === 'string' && result['final_url'].length > 0
      ? result['final_url']
      : input.sourceUrl;
  const finalUrl = validateBusinessWebUrl(
    finalUrlCandidate,
    input.allowedHostnames,
  );
  const publishedDate = optionalBoundedEvidenceText(
    result['published_date'],
    MAX_PUBLISHED_DATE_LENGTH,
  );
  return {
    sourceUrl: input.sourceUrl,
    finalUrl,
    title: boundEvidenceText(result['title'], MAX_TITLE_LENGTH),
    ...(publishedDate === undefined ? {} : { publishedDate }),
    text: boundEvidenceText(result['text'], MAX_FETCH_TEXT_LENGTH),
    retrievedAt: input.retrievedAt,
  };
}

export function createTinyFishClient(input: {
  apiKey: string;
  timeoutMs: number;
  sdkFactory?: TinyFishSdkFactory;
  now?: () => Date;
}): TinyFishClient {
  const apiKey = input.apiKey.trim();
  if (apiKey.length === 0) {
    throw new TinyFishClientError('tinyfish_api_key_required');
  }
  validateTimeout(input.timeoutMs);

  const sdk = (input.sdkFactory ?? defaultSdkFactory)({
    apiKey,
    timeout: input.timeoutMs,
    maxRetries: 0,
  });
  const now = input.now ?? (() => new Date());

  return {
    async search(searchInput) {
      const query = requiredBoundedText(
        searchInput.query,
        'tinyfish_search_query_invalid',
        500,
      );
      const language = requiredBoundedText(
        searchInput.language,
        'tinyfish_search_language_invalid',
        64,
      );
      const location = requiredBoundedText(
        searchInput.location,
        'tinyfish_search_location_invalid',
        128,
      );
      const allowedHostnames = normalizeAllowedHostnames(
        searchInput.includeDomains,
      );
      let response: unknown;
      try {
        response = await sdk.search.query({
          query,
          include_domains: allowedHostnames.join(','),
          language,
          location,
        });
      } catch {
        throw new TinyFishClientError('tinyfish_search_failed');
      }

      const retrievedAt = now().toISOString();
      const results: TinyFishSearchResult[] = [];
      for (const candidate of asResults(response)) {
        const normalized = normalizeSearchResult(
          candidate,
          allowedHostnames,
          retrievedAt,
        );
        if (normalized !== undefined) {
          results.push(normalized);
        }
        if (results.length === MAX_SEARCH_RESULTS) {
          break;
        }
      }
      return results;
    },

    async fetch(fetchInput) {
      validateTimeout(fetchInput.perUrlTimeoutMs);
      if (fetchInput.perUrlTimeoutMs > input.timeoutMs) {
        throw new TinyFishClientError('tinyfish_fetch_timeout_invalid');
      }
      const allowedHostnames = normalizeAllowedHostnames(
        fetchInput.allowedHostnames,
      );
      const sourceUrl = validateBusinessWebUrl(
        fetchInput.url,
        allowedHostnames,
      );
      let response: unknown;
      try {
        response = await sdk.fetch.getContents({
          urls: [sourceUrl],
          format: 'markdown',
          per_url_timeout_ms: fetchInput.perUrlTimeoutMs,
        });
      } catch {
        throw new TinyFishClientError('tinyfish_fetch_failed');
      }
      return normalizeFetchResult({
        response,
        sourceUrl,
        allowedHostnames,
        retrievedAt: now().toISOString(),
      });
    },
  };
}
