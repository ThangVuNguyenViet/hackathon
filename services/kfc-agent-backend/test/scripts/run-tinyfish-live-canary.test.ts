import { describe, expect, it } from 'vitest';
import {
  TinyFishLiveCanaryError,
  runTinyFishLiveCanary,
} from '../../scripts/run-tinyfish-live-canary.js';
import type {
  TinyFishClient,
  TinyFishFetchResult,
  TinyFishSearchResult,
} from '../../src/web/tinyFishClient.js';

const API_KEY = 'tinyfish-secret-that-must-not-leak';
const SOURCE_URL = 'https://www.pvcfc.com.vn/san-pham-dich-vu';
const FETCHED_TEXT = 'Official PVCFC content that must not be logged.';
const RETRIEVED_AT = '2026-08-12T08:00:00.000Z';

function searchResult(): TinyFishSearchResult {
  return {
    sourceUrl: SOURCE_URL,
    title: 'Sản phẩm và dịch vụ',
    snippet: 'Thông tin chính thức từ PVCFC.',
    retrievedAt: RETRIEVED_AT,
  };
}

function fetchResult(
  overrides: Partial<TinyFishFetchResult> = {},
): TinyFishFetchResult {
  return {
    sourceUrl: SOURCE_URL,
    finalUrl: SOURCE_URL,
    title: 'Sản phẩm và dịch vụ',
    text: FETCHED_TEXT,
    retrievedAt: RETRIEVED_AT,
    ...overrides,
  };
}

function clientHarness(input?: {
  searchResults?: readonly TinyFishSearchResult[];
  fetched?: TinyFishFetchResult;
  error?: Error;
}) {
  const calls: Array<{ operation: 'search' | 'fetch'; input: unknown }> = [];
  const client: TinyFishClient = {
    async search(searchInput) {
      calls.push({ operation: 'search', input: searchInput });
      if (input?.error) throw input.error;
      return input?.searchResults ?? [searchResult()];
    },
    async fetch(fetchInput) {
      calls.push({ operation: 'fetch', input: fetchInput });
      if (input?.error) throw input.error;
      return input?.fetched ?? fetchResult();
    },
  };
  return { calls, client };
}

describe('TinyFish live qualification canary', () => {
  it('skips without touching TinyFish unless the explicit live gate and key are both present', async () => {
    const { calls, client } = clientHarness();
    const logs: string[] = [];
    let factoryCalls = 0;

    const disabled = await runTinyFishLiveCanary({
      env: { RUN_LIVE_TINYFISH: '0', TINYFISH_API_KEY: API_KEY },
      clientFactory: () => {
        factoryCalls += 1;
        return client;
      },
      writeLine: (line) => logs.push(line),
    });
    const missingKey = await runTinyFishLiveCanary({
      env: { RUN_LIVE_TINYFISH: '1' },
      clientFactory: () => {
        factoryCalls += 1;
        return client;
      },
      writeLine: (line) => logs.push(line),
    });

    expect(disabled).toEqual({
      status: 'skipped',
      reason: 'live_tinyfish_not_enabled',
    });
    expect(missingKey).toEqual({
      status: 'skipped',
      reason: 'tinyfish_api_key_missing',
    });
    expect(factoryCalls).toBe(0);
    expect(calls).toEqual([]);
    expect(logs).toEqual([
      '{"status":"skipped","reason":"live_tinyfish_not_enabled"}',
      '{"status":"skipped","reason":"tinyfish_api_key_missing"}',
    ]);
  });

  it('uses the injected key for exactly one approved-domain search and one allowlisted fetch', async () => {
    const { calls, client } = clientHarness();
    const logs: string[] = [];
    const clock = [100, 127, 200, 241];
    const observedKeys: string[] = [];

    const result = await runTinyFishLiveCanary({
      env: { RUN_LIVE_TINYFISH: '1', TINYFISH_API_KEY: API_KEY },
      clientFactory: (apiKey) => {
        observedKeys.push(apiKey);
        return client;
      },
      nowMs: () => clock.shift()!,
      writeLine: (line) => logs.push(line),
    });

    expect(observedKeys).toEqual([API_KEY]);
    expect(calls).toEqual([
      {
        operation: 'search',
        input: {
          query: 'sản phẩm dịch vụ PVCFC',
          includeDomains: ['www.pvcfc.com.vn'],
          language: 'vi',
          location: 'Việt Nam',
        },
      },
      {
        operation: 'fetch',
        input: {
          url: SOURCE_URL,
          allowedHostnames: [
            'pvcfc.com.vn',
            'www.pvcfc.com.vn',
            'shop.pvcfc.com.vn',
            'thamquannhamay.pvcfc.com.vn',
            'muavangthanglon.pvcfc.com.vn',
          ],
          perUrlTimeoutMs: 14_000,
        },
      },
    ]);
    expect(result).toEqual({
      status: 'passed',
      searchLatencyMs: 27,
      fetchLatencyMs: 41,
      contentSha256:
        'bd4c10ff2d7079ed532ed128b2725f49645aa30ac1f05751c93924a0e7bb7399',
    });
    expect(logs).toEqual([JSON.stringify(result)]);
    expect(logs.join(' ')).not.toContain(FETCHED_TEXT);
    expect(logs.join(' ')).not.toContain(API_KEY);
    expect(logs.join(' ')).not.toContain(SOURCE_URL);
  });

  it('fails closed when search returns no approved result or fetch redirects outside the PVCFC allowlist', async () => {
    const noResults = clientHarness({ searchResults: [] });
    await expect(
      runTinyFishLiveCanary({
        env: { RUN_LIVE_TINYFISH: '1', TINYFISH_API_KEY: API_KEY },
        clientFactory: () => noResults.client,
        writeLine: () => undefined,
      }),
    ).rejects.toMatchObject({
      code: 'tinyfish_live_canary_no_search_result',
      message: 'tinyfish_live_canary_no_search_result',
    });
    expect(noResults.calls).toHaveLength(1);

    const redirected = clientHarness({
      fetched: fetchResult({
        finalUrl: 'https://attacker.example/copied-pvcfc-page',
      }),
    });
    await expect(
      runTinyFishLiveCanary({
        env: { RUN_LIVE_TINYFISH: '1', TINYFISH_API_KEY: API_KEY },
        clientFactory: () => redirected.client,
        writeLine: () => undefined,
      }),
    ).rejects.toMatchObject({
      code: 'tinyfish_live_canary_failed',
      message: 'tinyfish_live_canary_failed',
    });
    expect(redirected.calls.map(({ operation }) => operation)).toEqual([
      'search',
      'fetch',
    ]);
  });

  it('normalizes provider failures without leaking fetched content, provider diagnostics, or the key', async () => {
    const diagnostic = `provider exposed ${API_KEY} beside ${FETCHED_TEXT}`;
    const { client } = clientHarness({ error: new Error(diagnostic) });
    const logs: string[] = [];

    const failure = await runTinyFishLiveCanary({
      env: { RUN_LIVE_TINYFISH: '1', TINYFISH_API_KEY: API_KEY },
      clientFactory: () => client,
      writeLine: (line) => logs.push(line),
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TinyFishLiveCanaryError);
    expect(failure).toMatchObject({
      code: 'tinyfish_live_canary_failed',
      message: 'tinyfish_live_canary_failed',
    });
    expect(JSON.stringify(failure)).not.toContain(API_KEY);
    expect(JSON.stringify(failure)).not.toContain(FETCHED_TEXT);
    expect(JSON.stringify(failure)).not.toContain('provider exposed');
    expect(logs).toEqual([]);
  });
});
