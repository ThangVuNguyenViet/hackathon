import { describe, expect, it, vi } from 'vitest';
import {
  createPvcfcWebTools,
  createPvcfcWebTurnBudget,
} from '../../src/businesses/pvcfc/webTools.js';
import { PVCFC_WEB_ALLOWED_HOSTNAMES } from '../../src/businesses/pvcfc/webPolicy.js';
import type {
  TinyFishClient,
  TinyFishFetchResult,
  TinyFishSearchResult,
} from '../../src/web/tinyFishClient.js';
import {
  createTinyFishClient,
  TinyFishClientError,
  type TinyFishSdkFactory,
} from '../../src/web/tinyFishClient.js';

const RETRIEVED_AT = '2026-08-12T05:00:00.000Z';
const INVENTORIED_URL =
  'https://www.pvcfc.com.vn/npk-ca-mau-20-20-15-npk-cua-su-thinh-vuong';
const SEARCHED_URL = 'https://www.pvcfc.com.vn/tin-tuc/gia-phan-bon-moi';

function harness(input?: {
  searchResults?: readonly TinyFishSearchResult[];
  fetchResult?: TinyFishFetchResult;
}) {
  const search = vi.fn(
    async () =>
      input?.searchResults ?? [
        {
          sourceUrl: SEARCHED_URL,
          title: 'Giá phân bón mới',
          snippet: 'Thông tin cập nhật từ PVCFC.',
          publishedDate: '2026-08-12',
          retrievedAt: RETRIEVED_AT,
        },
      ],
  );
  const fetch = vi.fn(
    async ({ url }: { url: string }) =>
      input?.fetchResult ?? {
        sourceUrl: url,
        finalUrl: url,
        title: 'Trang chính thức PVCFC',
        publishedDate: '2026-08-12',
        text: 'Nội dung hiện tại từ nguồn chính thức.',
        retrievedAt: RETRIEVED_AT,
      },
  );
  return {
    client: { search, fetch } as TinyFishClient,
    fetch,
    search,
  };
}

function toolsFor(
  input?: Parameters<typeof harness>[0],
  budget = createPvcfcWebTurnBudget(),
) {
  const tinyFish = harness(input);
  const receipts: Array<{
    name: string;
    status: 'success' | 'error';
    durationMs: number;
    sourceUrls?: readonly string[];
    evidenceMode?: 'canonical' | 'live_web';
  }> = [];
  const tools = createPvcfcWebTools({
    client: tinyFish.client,
    inventoryUrls: [INVENTORIED_URL],
    receipts,
    budget,
  });
  return { ...tinyFish, receipts, tools };
}

describe('PVCFC official-site web evidence tools', () => {
  it('owns an immutable exact first-party hostname allowlist', () => {
    expect(PVCFC_WEB_ALLOWED_HOSTNAMES).toEqual([
      'pvcfc.com.vn',
      'www.pvcfc.com.vn',
      'shop.pvcfc.com.vn',
      'thamquannhamay.pvcfc.com.vn',
      'muavangthanglon.pvcfc.com.vn',
    ]);
    expect(Object.isFrozen(PVCFC_WEB_ALLOWED_HOSTNAMES)).toBe(true);
  });

  it('searches with fixed Vietnamese defaults and returns at most compact official results', async () => {
    const results = Array.from({ length: 6 }, (_, index) => ({
      sourceUrl: `https://www.pvcfc.com.vn/tin-tuc/${index}`,
      title: `Tin ${index}`,
      snippet: 'Thông tin cập nhật từ PVCFC.',
      retrievedAt: RETRIEVED_AT,
    }));
    const { search, tools } = toolsFor({ searchResults: results });

    const result = await tools[0].invoke({ query: 'giá phân bón hôm nay' });

    expect(search).toHaveBeenCalledWith({
      query: 'giá phân bón hôm nay',
      includeDomains: PVCFC_WEB_ALLOWED_HOSTNAMES,
      language: 'vi',
      location: 'Việt Nam',
    });
    expect(result).toHaveLength(5);
    if (!Array.isArray(result)) return;
    expect(result[0]).toMatchObject({
      sourceUrl: 'https://www.pvcfc.com.vn/tin-tuc/0',
      retrievedAt: RETRIEVED_AT,
    });
  });

  it('rejects unknown direct URLs but accepts inventoried and same-turn searched URLs', async () => {
    const unknown = toolsFor();
    await expect(
      unknown.tools[1].invoke({
        url: 'https://www.pvcfc.com.vn/not-in-the-fixture-or-search',
      }),
    ).rejects.toThrow('pvcfc_web_url_not_admitted');
    expect(unknown.fetch).not.toHaveBeenCalled();

    const inventoried = toolsFor();
    await inventoried.tools[1].invoke({ url: INVENTORIED_URL });
    expect(inventoried.fetch).toHaveBeenCalledWith({
      url: INVENTORIED_URL,
      allowedHostnames: PVCFC_WEB_ALLOWED_HOSTNAMES,
      perUrlTimeoutMs: 14_000,
    });

    const searched = toolsFor();
    await searched.tools[0].invoke({ query: 'tin mới' });
    await searched.tools[1].invoke({ url: SEARCHED_URL });
    expect(searched.fetch).toHaveBeenCalledOnce();
  });

  it('does not admit a searched URL from a prior turn', async () => {
    const firstTurn = toolsFor();
    await firstTurn.tools[0].invoke({ query: 'tin mới' });

    const nextTurn = toolsFor();
    await expect(
      nextTurn.tools[1].invoke({ url: SEARCHED_URL }),
    ).rejects.toThrow('pvcfc_web_url_not_admitted');
    expect(nextTurn.fetch).not.toHaveBeenCalled();
  });

  it('allows repeated Search and Fetch calls within the turn budget', async () => {
    const { tools, search, fetch } = toolsFor();

    await tools[0].invoke({ query: 'tin mới' });
    await tools[0].invoke({ query: 'tin khác' });
    await tools[1].invoke({ url: SEARCHED_URL });
    await tools[1].invoke({ url: SEARCHED_URL });
    expect(search).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fails fast when a later web call cannot fit the shared 28-second deadline', async () => {
    let now = 0;
    const budget = createPvcfcWebTurnBudget({ now: () => now });
    const currentTurn = toolsFor(undefined, budget);

    now = 28_001;
    await expect(
      currentTurn.tools[0].invoke({ query: 'tin mới' }),
    ).rejects.toThrow('pvcfc_web_time_budget_exhausted');

    expect(currentTurn.search).not.toHaveBeenCalled();
    expect(currentTurn.fetch).not.toHaveBeenCalled();
  });

  it('keeps citations in compact receipts without page content', async () => {
    const longFinalUrl = `${INVENTORIED_URL}?detail=${'x'.repeat(1_900)}`;
    const { tools, receipts } = toolsFor({
      fetchResult: {
        sourceUrl: INVENTORIED_URL,
        finalUrl: longFinalUrl,
        title: 'Nguồn PVCFC',
        text: 'secret-page-body-that-must-not-enter-audit',
        retrievedAt: RETRIEVED_AT,
      },
    });

    await tools[1].invoke({ url: INVENTORIED_URL });

    expect(receipts).toEqual([
      expect.objectContaining({
        name: 'fetchPvcfcPage',
        status: 'success',
        evidenceMode: 'live_web',
        sourceUrls: [INVENTORIED_URL, expect.any(String)],
      }),
    ]);
    expect(receipts[0]?.sourceUrls?.[1]?.length).toBeLessThanOrEqual(2_048);
    expect(JSON.stringify(receipts)).not.toContain(
      'secret-page-body-that-must-not-enter-audit',
    );
  });

  it('rejects an overlong fetched source URL from an injected client', async () => {
    const overlongSourceUrl = `${INVENTORIED_URL}?detail=${'x'.repeat(2_048)}`;
    const { tools, receipts } = toolsFor({
      fetchResult: {
        sourceUrl: overlongSourceUrl,
        finalUrl: INVENTORIED_URL,
        title: 'Nguồn PVCFC',
        text: 'must-not-become-model-visible',
        retrievedAt: RETRIEVED_AT,
      },
    });

    const outcome = await tools[1].invoke({ url: INVENTORIED_URL }).then(
      () => 'resolved',
      (error: unknown) =>
        error instanceof Error ? error.message : 'unknown-error',
    );

    expect(outcome).toBe('web_url_too_long');
    expect(receipts).toEqual([
      expect.objectContaining({
        name: 'fetchPvcfcPage',
        status: 'error',
        evidenceMode: 'live_web',
      }),
    ]);
    expect(receipts[0]?.sourceUrls).toBeUndefined();
    expect(JSON.stringify(receipts)).not.toContain('must-not-become');
  });

  it('rejects an overlong fetched final URL from an injected client', async () => {
    const overlongFinalUrl = `${INVENTORIED_URL}?detail=${'x'.repeat(2_048)}`;
    const { tools, receipts } = toolsFor({
      fetchResult: {
        sourceUrl: INVENTORIED_URL,
        finalUrl: overlongFinalUrl,
        title: 'Nguồn PVCFC',
        text: 'must-not-become-model-visible',
        retrievedAt: RETRIEVED_AT,
      },
    });

    const outcome = await tools[1].invoke({ url: INVENTORIED_URL }).then(
      () => 'resolved',
      (error: unknown) =>
        error instanceof Error ? error.message : 'unknown-error',
    );

    expect(outcome).toBe('web_url_too_long');
    expect(receipts).toEqual([
      expect.objectContaining({
        name: 'fetchPvcfcPage',
        status: 'error',
        evidenceMode: 'live_web',
      }),
    ]);
    expect(receipts[0]?.sourceUrls).toBeUndefined();
    expect(JSON.stringify(receipts)).not.toContain('must-not-become');
  });

  it('rejects a fetched source URL that does not match the admitted request', async () => {
    const { tools, receipts } = toolsFor({
      fetchResult: {
        sourceUrl: SEARCHED_URL,
        finalUrl: INVENTORIED_URL,
        title: 'Wrong source binding',
        text: 'must-not-become-model-visible',
        retrievedAt: RETRIEVED_AT,
      },
    });

    const outcome = await tools[1].invoke({ url: INVENTORIED_URL }).then(
      () => 'resolved',
      (error: unknown) =>
        error instanceof Error ? error.message : 'unknown-error',
    );

    expect(outcome).toBe('pvcfc_web_source_url_mismatch');
    expect(receipts).toEqual([
      expect.objectContaining({
        name: 'fetchPvcfcPage',
        status: 'error',
        evidenceMode: 'live_web',
      }),
    ]);
    expect(receipts[0]?.sourceUrls).toBeUndefined();
    expect(JSON.stringify(receipts)).not.toContain('must-not-become');
  });

  it('bounds fetched page content again at the PVCFC tool boundary', async () => {
    const { tools } = toolsFor({
      fetchResult: {
        sourceUrl: INVENTORIED_URL,
        finalUrl: INVENTORIED_URL,
        title: 'Nguồn PVCFC',
        text: 'x'.repeat(20_000),
        retrievedAt: RETRIEVED_AT,
      },
    });

    const result = await tools[1].invoke({ url: INVENTORIED_URL });

    expect(result).toHaveProperty('text');
    if (!('text' in result)) return;
    expect(result.text).toHaveLength(8_000);
  });

  it('propagates adapter redirect rejection and records only a safe error receipt', async () => {
    const sdkFactory: TinyFishSdkFactory = () => ({
      search: { query: vi.fn(async () => ({ results: [] })) },
      fetch: {
        getContents: vi.fn(async () => ({
          results: [
            {
              url: INVENTORIED_URL,
              final_url: 'https://attacker.test/copied',
              title: 'Redirected',
              text: 'must not escape',
            },
          ],
          errors: [],
        })),
      },
    });
    const receipts: Array<{
      name: string;
      status: 'success' | 'error';
      durationMs: number;
      evidenceMode?: 'canonical' | 'live_web';
    }> = [];
    const tools = createPvcfcWebTools({
      client: createTinyFishClient({
        apiKey: 'test-secret',
        timeoutMs: 15_000,
        sdkFactory,
      }),
      inventoryUrls: [INVENTORIED_URL],
      receipts,
      budget: createPvcfcWebTurnBudget(),
    });

    await expect(tools[1].invoke({ url: INVENTORIED_URL })).rejects.toThrow(
      'web_url_host_not_allowed',
    );
    expect(receipts).toEqual([
      expect.objectContaining({
        name: 'fetchPvcfcPage',
        status: 'error',
        evidenceMode: 'live_web',
      }),
    ]);
    expect(JSON.stringify(receipts)).not.toContain('must not escape');
    expect(JSON.stringify(receipts)).not.toContain('test-secret');
  });

  it('degrades provider outages to a compact unavailable result', async () => {
    const tinyFish = harness();
    tinyFish.fetch.mockRejectedValueOnce(
      new TinyFishClientError('tinyfish_fetch_failed'),
    );
    const receipts: Parameters<typeof createPvcfcWebTools>[0]['receipts'] = [];
    const tools = createPvcfcWebTools({
      client: tinyFish.client,
      inventoryUrls: [INVENTORIED_URL],
      receipts,
      budget: createPvcfcWebTurnBudget(),
    });

    await expect(tools[1].invoke({ url: INVENTORIED_URL })).resolves.toEqual({
      available: false,
    });
    expect(receipts).toEqual([
      expect.objectContaining({
        name: 'fetchPvcfcPage',
        status: 'error',
        evidenceMode: 'live_web',
      }),
    ]);
  });
});
