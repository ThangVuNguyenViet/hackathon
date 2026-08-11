import { describe, expect, it, vi } from 'vitest';
import {
  TinyFishClientError,
  createTinyFishClient,
  type TinyFishSdkFactory,
  type TinyFishSdkLike,
} from '../../src/web/tinyFishClient.js';

const SECRET = 'tf-secret-value-that-must-never-leak';
const RETRIEVED_AT = '2026-08-12T04:00:00.000Z';

function sdkHarness(input?: {
  searchResults?: readonly Record<string, unknown>[];
  fetchResult?: Record<string, unknown>;
}) {
  const searchQuery = vi.fn(async () => ({
    query: 'ignored-provider-echo',
    results: input?.searchResults ?? [],
    total_results: input?.searchResults?.length ?? 0,
    page: 1,
  }));
  const fetchGetContents = vi.fn(async () => ({
    results: input?.fetchResult ? [input.fetchResult] : [],
    errors: [],
  }));
  const sdk: TinyFishSdkLike = {
    search: { query: searchQuery },
    fetch: { getContents: fetchGetContents },
  };
  const factory = vi.fn<TinyFishSdkFactory>(() => sdk);

  return { factory, fetchGetContents, searchQuery };
}

function makeClient(factory: TinyFishSdkFactory) {
  return createTinyFishClient({
    apiKey: SECRET,
    timeoutMs: 8_000,
    sdkFactory: factory,
    now: () => new Date(RETRIEVED_AT),
  });
}

describe('bounded TinyFish evidence client', () => {
  it('requires an injected key and a short explicit timeout', () => {
    const { factory } = sdkHarness();

    expect(() =>
      createTinyFishClient({
        apiKey: '  ',
        timeoutMs: 8_000,
        sdkFactory: factory,
      }),
    ).toThrow('tinyfish_api_key_required');
    expect(() =>
      createTinyFishClient({
        apiKey: SECRET,
        timeoutMs: 0,
        sdkFactory: factory,
      }),
    ).toThrow('tinyfish_timeout_invalid');
    expect(() =>
      createTinyFishClient({
        apiKey: SECRET,
        timeoutMs: 30_000,
        sdkFactory: factory,
      }),
    ).toThrow('tinyfish_timeout_invalid');
    expect(factory).not.toHaveBeenCalled();
  });

  it('constructs the SDK with the injected key, explicit timeout, and zero retries', () => {
    const { factory } = sdkHarness();
    const client = makeClient(factory);

    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith({
      apiKey: SECRET,
      timeout: 8_000,
      maxRetries: 0,
    });
    expect(JSON.stringify(client)).not.toContain(SECRET);
  });

  it('passes Vietnamese search context, post-filters domains, and bounds compact evidence', async () => {
    const allowedResults = Array.from({ length: 6 }, (_, index) => ({
      position: index + 1,
      site_name: 'PVCFC',
      title: `${'Đạm Cà Mau '.repeat(40)}${index}`,
      snippet: `${'Thông tin tiếng Việt '.repeat(100)}${index}`,
      url: `https://official.example/news/${index}`,
      date: '2026-08-12',
    }));
    const { factory, searchQuery } = sdkHarness({
      searchResults: [
        allowedResults[0]!,
        {
          position: 2,
          site_name: 'Impostor',
          title: 'Should be removed',
          snippet: 'Outside caller allowlist',
          url: 'https://official.example.attacker.test/news',
        },
        ...allowedResults.slice(1),
      ],
    });

    const results = await makeClient(factory).search({
      query: 'giá phân bón hôm nay',
      includeDomains: ['OFFICIAL.EXAMPLE.'],
      language: 'vi',
      location: 'Việt Nam',
    });

    expect(searchQuery).toHaveBeenCalledWith({
      query: 'giá phân bón hôm nay',
      include_domains: 'official.example',
      language: 'vi',
      location: 'Việt Nam',
    });
    expect(results).toHaveLength(5);
    expect(results.map(({ sourceUrl }) => new URL(sourceUrl).hostname)).toEqual(
      [
        'official.example',
        'official.example',
        'official.example',
        'official.example',
        'official.example',
      ],
    );
    expect(results.map(({ sourceUrl }) => sourceUrl)).not.toContain(
      'https://official.example.attacker.test/news',
    );
    expect(results[0]).toMatchObject({
      sourceUrl: 'https://official.example/news/0',
      publishedDate: '2026-08-12',
      retrievedAt: RETRIEVED_AT,
    });
    expect(results[0]!.title.length).toBe(300);
    expect(results[0]!.snippet.length).toBe(800);
    expect(results[0]!.snippet).toContain('Thông tin tiếng Việt');
    expect(JSON.stringify(results)).not.toContain(SECRET);
  });

  it('revalidates an allowlisted fetch after provider redirects', async () => {
    const { factory } = sdkHarness({
      fetchResult: {
        url: 'https://official.example/news/1',
        final_url: 'https://attacker.test/copied-news',
        title: 'Redirected',
        description: null,
        language: 'vi',
        author: null,
        published_date: null,
        format: 'markdown',
        text: 'Untrusted redirect target',
      },
    });

    await expect(
      makeClient(factory).fetch({
        url: 'https://official.example/news/1',
        allowedHostnames: ['official.example'],
        perUrlTimeoutMs: 2_000,
      }),
    ).rejects.toThrow('web_url_host_not_allowed');
  });

  it('rejects a returned final URL on a non-default HTTPS port', async () => {
    const { factory } = sdkHarness({
      fetchResult: {
        url: 'https://official.example/news/1',
        final_url: 'https://official.example:444/copied-news',
        title: 'Redirected to an arbitrary service port',
        description: null,
        language: 'vi',
        author: null,
        published_date: null,
        format: 'markdown',
        text: 'Must not cross the admitted origin port boundary',
      },
    });

    await expect(
      makeClient(factory).fetch({
        url: 'https://official.example/news/1',
        allowedHostnames: ['official.example'],
        perUrlTimeoutMs: 2_000,
      }),
    ).rejects.toThrow('web_url_port_not_allowed');
  });

  it('fetches exactly one URL and returns bounded compact evidence', async () => {
    const { factory, fetchGetContents } = sdkHarness({
      fetchResult: {
        url: 'https://official.example/news/1',
        final_url: 'https://news.official.example/article/1',
        title: 'Current fertilizer market update',
        description: null,
        language: 'vi',
        author: 'PVCFC',
        published_date: '2026-08-11',
        format: 'markdown',
        text: 'x'.repeat(20_000),
      },
    });

    const result = await makeClient(factory).fetch({
      url: 'https://official.example/news/1',
      allowedHostnames: ['official.example', 'news.official.example'],
      perUrlTimeoutMs: 2_000,
    });

    expect(fetchGetContents).toHaveBeenCalledWith({
      urls: ['https://official.example/news/1'],
      format: 'markdown',
      per_url_timeout_ms: 2_000,
    });
    expect(result).toEqual({
      sourceUrl: 'https://official.example/news/1',
      finalUrl: 'https://news.official.example/article/1',
      title: 'Current fertilizer market update',
      publishedDate: '2026-08-11',
      text: 'x'.repeat(12_000),
      retrievedAt: RETRIEVED_AT,
    });
  });

  it('normalizes provider failures without leaking provider detail or the API key', async () => {
    const { factory, searchQuery } = sdkHarness();
    searchQuery.mockRejectedValueOnce(
      new Error(`upstream request included ${SECRET} and private diagnostics`),
    );

    const failure = await makeClient(factory)
      .search({
        query: 'current news',
        includeDomains: ['official.example'],
        language: 'vi',
        location: 'Việt Nam',
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TinyFishClientError);
    expect(failure).toMatchObject({
      code: 'tinyfish_search_failed',
      message: 'tinyfish_search_failed',
    });
    expect(JSON.stringify(failure)).not.toContain(SECRET);
    expect(String(failure)).not.toContain('private diagnostics');
  });
});
