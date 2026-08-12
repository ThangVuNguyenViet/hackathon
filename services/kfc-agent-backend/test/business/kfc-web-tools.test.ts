import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { StructuredTool } from '@langchain/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { KfcAgentPack } from '../../src/businesses/kfc/pack.js';
import { persistKfcWebEvidenceAudit } from '../../src/businesses/kfc/applicationTurn.js';
import {
  createKfcWebTools,
  createKfcWebTurnBudget,
  type KfcWebToolReceipt,
} from '../../src/businesses/kfc/webTools.js';
import {
  KFC_WEB_ALLOWED_HOSTNAMES,
  KFC_WEB_INVENTORY_URLS,
} from '../../src/businesses/kfc/webPolicy.js';
import type {
  TinyFishClient,
  TinyFishFetchResult,
  TinyFishSearchResult,
} from '../../src/web/tinyFishClient.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import { toolNames } from '../../src/ordering/toolCatalog.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

const RETRIEVED_AT = '2026-08-12T05:00:00.000Z';
const INVENTORIED_URL = 'https://www.kfcvietnam.com.vn/privacy-policy';
const SEARCHED_URL = 'https://www.kfcvietnam.com.vn/news/kfc-viet-nam';

class ScriptedKfcWebModel extends BaseChatModel {
  readonly calls: Array<{ messages: BaseMessage[]; toolNames: string[] }>;
  private readonly outputs: BaseMessage[];
  private readonly shared: { index: number };
  private tools: StructuredTool[] = [];

  constructor(input: {
    readonly outputs: BaseMessage[];
    readonly calls?: Array<{ messages: BaseMessage[]; toolNames: string[] }>;
    readonly shared?: { index: number };
  }) {
    super({});
    this.outputs = input.outputs;
    this.calls = input.calls ?? [];
    this.shared = input.shared ?? { index: 0 };
  }

  override _llmType(): string {
    return 'scripted-kfc-web-model';
  }

  override bindTools(tools: StructuredTool[]): ScriptedKfcWebModel {
    const bound = new ScriptedKfcWebModel({
      outputs: this.outputs,
      calls: this.calls,
      shared: this.shared,
    });
    bound.tools = tools;
    return bound;
  }

  override async _generate(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.calls.push({
      messages: [...messages],
      toolNames: this.tools.map(({ name }) => name),
    });
    const message = this.outputs[this.shared.index++];
    if (!message) throw new Error('script_exhausted');
    return {
      generations: [
        {
          text: typeof message.content === 'string' ? message.content : '',
          message,
        },
      ],
      llmOutput: {},
    };
  }
}

function kfcState(): AgentGraphState {
  return {
    sessionId: 'kfc:web',
    customerId: 'customer-1',
    channel: 'kfc',
    latestUserMessage: 'Chính sách KFC là gì?',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
  };
}

async function kfcStore(): Promise<{ store: MemoryStore; turnId: string }> {
  const store = new MemoryStore();
  const turn = await store.appendTurn({
    sessionId: 'kfc:web',
    channel: 'kfc',
    role: 'user',
    text: 'Chính sách KFC là gì?',
    externalMessageId: 'web-user-1',
    externalUserId: 'customer-1',
    deliveryStatus: 'received',
    metadata: null,
  });
  return { store, turnId: turn.id };
}

function groundedPublication(input: {
  readonly evidenceId: string;
  readonly claimKinds: readonly string[];
  readonly customerText?: string;
}) {
  return {
    customerText: input.customerText ?? `Nguồn tham khảo: ${SEARCHED_URL}`,
    projectionDigest: 'a'.repeat(64),
    factualClaims: {
      evidenceReferences: [
        { evidenceId: input.evidenceId, claimKinds: input.claimKinds },
      ],
      disclosedLimitations: [],
      hasUnsupportedFactualClaim: false,
    },
    publicationDeclaration: {
      semanticRelevance: 'aligned',
      privateDataDisclosure: 'none',
      disclosureAuthorities: [],
      disclosesInternalMetadata: false,
    },
    selectedActionResponse: null,
  };
}

function harness(input?: {
  readonly searchResults?: readonly TinyFishSearchResult[];
  readonly fetchResult?: TinyFishFetchResult;
  readonly capabilityAllowed?: () => boolean;
  readonly budget?: ReturnType<typeof createKfcWebTurnBudget>;
}) {
  const search = vi.fn(
    async () =>
      input?.searchResults ?? [
        {
          sourceUrl: SEARCHED_URL,
          title: 'Tin KFC Việt Nam',
          snippet: 'Thông tin công khai từ KFC Việt Nam.',
          retrievedAt: RETRIEVED_AT,
        },
      ],
  );
  const fetch = vi.fn(
    async ({ url }: { url: string }) =>
      input?.fetchResult ?? {
        sourceUrl: url,
        finalUrl: url,
        title: 'Chính sách KFC Việt Nam',
        text: 'Nội dung chính sách công khai.',
        retrievedAt: RETRIEVED_AT,
      },
  );
  const receipts: KfcWebToolReceipt[] = [];
  const tools = createKfcWebTools({
    client: { search, fetch } as TinyFishClient,
    receipts,
    budget: input?.budget ?? createKfcWebTurnBudget(),
    isCapabilityAllowed: input?.capabilityAllowed ?? (() => true),
  });
  return { fetch, receipts, search, tools };
}

describe('KFC supplemental official-site web evidence tools', () => {
  it('owns a frozen exact first-party allowlist and small direct-fetch inventory', () => {
    expect(KFC_WEB_ALLOWED_HOSTNAMES).toEqual([
      'kfcvietnam.com.vn',
      'www.kfcvietnam.com.vn',
      'membership.kfcvietnam.com.vn',
    ]);
    expect(Object.isFrozen(KFC_WEB_ALLOWED_HOSTNAMES)).toBe(true);
    expect(KFC_WEB_INVENTORY_URLS).toContain(INVENTORIED_URL);
    expect(KFC_WEB_INVENTORY_URLS.length).toBeLessThanOrEqual(12);
  });

  it('ignores a caller attempt to expand the KFC direct-fetch inventory', async () => {
    const fetch = vi.fn(async ({ url }: { url: string }) => ({
      sourceUrl: url,
      finalUrl: url,
      title: 'Caller-injected page',
      text: 'This page must never become admitted by caller input.',
      retrievedAt: RETRIEVED_AT,
    }));
    const attemptedExpansion = {
      client: { search: vi.fn(), fetch } as TinyFishClient,
      inventoryUrls: [
        ...KFC_WEB_INVENTORY_URLS,
        'https://www.kfcvietnam.com.vn/not-in-inventory',
      ],
      receipts: [] as KfcWebToolReceipt[],
      budget: createKfcWebTurnBudget(),
      isCapabilityAllowed: () => true,
    };

    const tools = createKfcWebTools(attemptedExpansion);

    await expect(
      tools[1].invoke({
        url: 'https://www.kfcvietnam.com.vn/not-in-inventory',
      }),
    ).rejects.toThrow('kfc_web_url_not_admitted');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    'https://www.kfcvietnam.com.vn/newapi/menu',
    'https://www.kfcvietnam.com.vn/invoice/123',
    'https://www.kfcvietnam.com.vn/static/app.js',
    'https://www.kfcvietnam.com.vn/upload/menu.pdf',
    'https://www.kfcvietnam.com.vn/assets/logo.svg',
    'https://www.kfcvietnam.com.vn/images/chicken.jpg',
  ])(
    'rejects a blocked public-page path before direct fetch admission: %s',
    async (url) => {
      const currentTurn = harness();

      await expect(currentTurn.tools[1].invoke({ url })).rejects.toThrow(
        'kfc_web_path_not_allowed',
      );
      expect(currentTurn.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    'https://www.kfcvietnam.com.vn/newapi/menu',
    'https://www.kfcvietnam.com.vn/invoice/123',
    'https://www.kfcvietnam.com.vn/static/app.js',
    'https://www.kfcvietnam.com.vn/upload/menu.pdf',
    'https://www.kfcvietnam.com.vn/assets/logo.svg',
    'https://www.kfcvietnam.com.vn/images/chicken.jpg',
  ])('rejects a blocked same-host Search result: %s', async (sourceUrl) => {
    const currentTurn = harness({
      searchResults: [
        {
          sourceUrl,
          title: 'Unsafe endpoint',
          snippet: 'Must not be admitted for Fetch.',
          retrievedAt: RETRIEVED_AT,
        },
      ],
    });

    await expect(
      currentTurn.tools[0].invoke({ query: 'unsafe endpoint' }),
    ).rejects.toThrow('kfc_web_path_not_allowed');
    expect(currentTurn.receipts.at(-1)).toMatchObject({
      name: 'searchKfcWeb',
      status: 'error',
    });
  });

  it.each([
    ['source', 'https://www.kfcvietnam.com.vn/newapi/page'],
    ['final redirect', 'https://www.kfcvietnam.com.vn/static/page.html'],
    ['image redirect', 'https://www.kfcvietnam.com.vn/assets/banner.webp'],
  ])('rejects a blocked %s URL returned by Fetch', async (kind, blockedUrl) => {
    const currentTurn = harness({
      fetchResult: {
        sourceUrl: kind === 'source' ? blockedUrl : INVENTORIED_URL,
        finalUrl: kind === 'source' ? INVENTORIED_URL : blockedUrl,
        title: 'Unsafe fetched page',
        text: 'Must not cross the KFC evidence boundary.',
        retrievedAt: RETRIEVED_AT,
      },
    });

    await expect(
      currentTurn.tools[1].invoke({ url: INVENTORIED_URL }),
    ).rejects.toThrow('kfc_web_path_not_allowed');
  });

  it('keeps approved KFC public pages searchable and fetchable', async () => {
    const currentTurn = harness({
      searchResults: [
        {
          sourceUrl: `${SEARCHED_URL}?campaign=official`,
          title: 'Tin KFC Việt Nam',
          snippet: 'Trang nội dung công khai hợp lệ.',
          retrievedAt: RETRIEVED_AT,
        },
      ],
    });

    const searchResult = await currentTurn.tools[0].invoke({
      query: 'tin KFC',
    });
    expect(searchResult.results[0]?.sourceUrl).toBe(
      `${SEARCHED_URL}?campaign=official`,
    );
    await currentTurn.tools[1].invoke({ url: INVENTORIED_URL });
    expect(currentTurn.fetch).toHaveBeenCalledOnce();
  });

  it('searches in Vietnamese/Vietnam and returns compact cited evidence', async () => {
    const searchResults = Array.from({ length: 6 }, (_, index) => ({
      sourceUrl: `https://www.kfcvietnam.com.vn/news/${index}`,
      title: `Tin ${index}`,
      snippet: 'x'.repeat(1_200),
      retrievedAt: RETRIEVED_AT,
    }));
    const { receipts, search, tools } = harness({ searchResults });

    const result = await tools[0].invoke({ query: 'chính sách KFC' });

    expect(search).toHaveBeenCalledWith({
      query: 'chính sách KFC',
      includeDomains: KFC_WEB_ALLOWED_HOSTNAMES,
      language: 'vi',
      location: 'Việt Nam',
    });
    expect(result.results).toHaveLength(5);
    expect(result.results[0]?.snippet).toHaveLength(800);
    expect(result.citations).toEqual(
      searchResults.slice(0, 5).map(({ sourceUrl }) => sourceUrl),
    );
    expect(receipts).toEqual([
      expect.objectContaining({
        name: 'searchKfcWeb',
        status: 'success',
        evidenceMode: 'live_web',
        evidenceId: result.evidenceId,
        sourceUrls: result.citations,
      }),
    ]);
  });

  it('admits only inventoried or same-turn searched URLs', async () => {
    const unknown = harness();
    await expect(
      unknown.tools[1].invoke({
        url: 'https://www.kfcvietnam.com.vn/not-in-inventory',
      }),
    ).rejects.toThrow('kfc_web_url_not_admitted');
    expect(unknown.fetch).not.toHaveBeenCalled();

    const inventoried = harness();
    await inventoried.tools[1].invoke({ url: INVENTORIED_URL });
    expect(inventoried.fetch).toHaveBeenCalledWith({
      url: INVENTORIED_URL,
      allowedHostnames: KFC_WEB_ALLOWED_HOSTNAMES,
      perUrlTimeoutMs: 3_000,
    });

    const searched = harness();
    await searched.tools[0].invoke({ query: 'tin KFC' });
    await searched.tools[1].invoke({ url: SEARCHED_URL });
    expect(searched.fetch).toHaveBeenCalledOnce();

    const nextTurn = harness();
    await expect(
      nextTurn.tools[1].invoke({ url: SEARCHED_URL }),
    ).rejects.toThrow('kfc_web_url_not_admitted');
  });

  it('enforces one Search, two Fetch, and the shared 12-second deadline', async () => {
    let now = 0;
    const currentTurn = harness({
      budget: createKfcWebTurnBudget({ now: () => now }),
    });
    await currentTurn.tools[0].invoke({ query: 'tin KFC' });
    await expect(
      currentTurn.tools[0].invoke({ query: 'tin khác' }),
    ).rejects.toThrow('kfc_web_search_budget_exhausted');
    now = 4_000;
    await currentTurn.tools[1].invoke({ url: SEARCHED_URL });
    now = 8_000;
    await currentTurn.tools[1].invoke({ url: SEARCHED_URL });
    now = 8_001;
    await expect(
      currentTurn.tools[1].invoke({ url: SEARCHED_URL }),
    ).rejects.toThrow('kfc_web_fetch_budget_exhausted');

    const lateTurn = harness({
      budget: createKfcWebTurnBudget({ now: () => now }),
    });
    now = 20_002;
    await expect(
      lateTurn.tools[0].invoke({ query: 'too late' }),
    ).rejects.toThrow('kfc_web_time_budget_exhausted');
    expect(lateTurn.search).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'mismatched source',
      fetchResult: {
        sourceUrl: SEARCHED_URL,
        finalUrl: INVENTORIED_URL,
        title: 'wrong',
        text: 'must-not-become-visible',
        retrievedAt: RETRIEVED_AT,
      },
      error: 'kfc_web_source_url_mismatch',
    },
    {
      label: 'external redirect',
      fetchResult: {
        sourceUrl: INVENTORIED_URL,
        finalUrl: 'https://attacker.test/copied',
        title: 'wrong',
        text: 'must-not-become-visible',
        retrievedAt: RETRIEVED_AT,
      },
      error: 'web_url_host_not_allowed',
    },
    {
      label: 'oversized final URL',
      fetchResult: {
        sourceUrl: INVENTORIED_URL,
        finalUrl: `${INVENTORIED_URL}?q=${'x'.repeat(2_048)}`,
        title: 'wrong',
        text: 'must-not-become-visible',
        retrievedAt: RETRIEVED_AT,
      },
      error: 'web_url_too_long',
    },
  ])(
    'rejects $label from an injected client',
    async ({ error, fetchResult }) => {
      const { receipts, tools } = harness({ fetchResult });
      await expect(tools[1].invoke({ url: INVENTORIED_URL })).rejects.toThrow(
        error,
      );
      expect(receipts.at(-1)).toMatchObject({
        name: 'fetchKfcPage',
        status: 'error',
        evidenceMode: 'live_web',
      });
      expect(JSON.stringify(receipts)).not.toContain('must-not-become-visible');
    },
  );

  it('revalidates and bounds fetched output at the KFC boundary', async () => {
    const { receipts, tools } = harness({
      fetchResult: {
        sourceUrl: INVENTORIED_URL,
        finalUrl: INVENTORIED_URL,
        title: 'x'.repeat(500),
        text: 'y'.repeat(20_000),
        retrievedAt: RETRIEVED_AT,
      },
    });
    const result = await tools[1].invoke({ url: INVENTORIED_URL });
    expect(result.page.title).toHaveLength(300);
    expect(result.page.text).toHaveLength(8_000);
    expect(result.citations).toEqual([INVENTORIED_URL]);
    expect(JSON.stringify(receipts)).not.toContain('y'.repeat(1_000));
  });

  it('fails closed before TinyFish when the application does not authorize a forged hidden call', async () => {
    const { search, tools } = harness({ capabilityAllowed: () => false });
    await expect(tools[0].invoke({ query: 'forged' })).rejects.toThrow(
      'kfc_web_tool_not_authorized',
    );
    expect(search).not.toHaveBeenCalled();
  });

  it('runs Search and Fetch through the real KFC LangChain pack with cited web evidence only', async () => {
    const { store, turnId } = await kfcStore();
    const tinyFish = harness();
    const executeCommerce = vi.fn();
    const model = new ScriptedKfcWebModel({
      outputs: [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'search-web-1',
              name: 'searchKfcWeb',
              args: { query: 'chính sách KFC Việt Nam' },
              type: 'tool_call',
            },
          ],
        }),
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'fetch-web-1',
              name: 'fetchKfcPage',
              args: { url: SEARCHED_URL },
              type: 'tool_call',
            },
          ],
        }),
        new AIMessage(
          JSON.stringify(
            groundedPublication({
              evidenceId: 'web:fetchKfcPage:2',
              claimKinds: ['source', 'policy'],
            }),
          ),
        ),
      ],
    });
    const originalState = kfcState();
    const pack = new KfcAgentPack({
      model,
      store,
      loadState: async () => originalState,
      executeTool: executeCommerce,
      resolveActiveToolNames: () => [...toolNames],
      webEvidence: {
        client: { search: tinyFish.search, fetch: tinyFish.fetch },
        capability: 'enabled',
      },
    });

    const result = await pack.runTurn({
      sessionId: 'kfc:web',
      customerId: 'customer-1',
      channel: 'kfc',
      currentUserTurnId: turnId,
    });

    expect(result.responseText).toContain(SEARCHED_URL);
    expect(result.toolCalls).toEqual([
      expect.objectContaining({
        name: 'searchKfcWeb',
        evidenceId: 'web:searchKfcWeb:1',
        sourceUrls: [SEARCHED_URL],
      }),
      expect.objectContaining({
        name: 'fetchKfcPage',
        evidenceId: 'web:fetchKfcPage:2',
        sourceUrls: [SEARCHED_URL],
      }),
    ]);
    expect(model.calls[0]?.toolNames).toEqual([
      ...toolNames,
      'searchKfcWeb',
      'fetchKfcPage',
    ]);
    expect(executeCommerce).not.toHaveBeenCalled();
    expect(result.state).toEqual(kfcState());
  });

  it.each(['price', 'promotion', 'status', 'product', 'order_id'])(
    'rejects web evidence cited for the %s commerce claim kind',
    async (claimKind) => {
      const { store, turnId } = await kfcStore();
      const tinyFish = harness();
      const model = new ScriptedKfcWebModel({
        outputs: [
          new AIMessage({
            content: '',
            tool_calls: [
              {
                id: 'search-web-1',
                name: 'searchKfcWeb',
                args: { query: 'KFC' },
                type: 'tool_call',
              },
            ],
          }),
          new AIMessage(
            JSON.stringify(
              groundedPublication({
                evidenceId: 'web:searchKfcWeb:1',
                claimKinds: [claimKind],
              }),
            ),
          ),
        ],
      });
      const pack = new KfcAgentPack({
        model,
        store,
        loadState: async () => kfcState(),
        executeTool: vi.fn(),
        resolveActiveToolNames: () => [...toolNames],
        webEvidence: {
          client: { search: tinyFish.search, fetch: tinyFish.fetch },
          capability: 'enabled',
        },
      });

      await expect(
        pack.runTurn({
          sessionId: 'kfc:web',
          customerId: 'customer-1',
          channel: 'kfc',
          currentUserTurnId: turnId,
        }),
      ).rejects.toThrow('kfc_web_evidence_claim_invalid');
    },
  );

  it('requires an exact returned source URL in a web-grounded answer', async () => {
    const { store, turnId } = await kfcStore();
    const tinyFish = harness();
    const model = new ScriptedKfcWebModel({
      outputs: [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'search-web-1',
              name: 'searchKfcWeb',
              args: { query: 'KFC' },
              type: 'tool_call',
            },
          ],
        }),
        new AIMessage(
          JSON.stringify(
            groundedPublication({
              evidenceId: 'web:searchKfcWeb:1',
              claimKinds: ['source'],
              customerText: 'Theo trang chính thức của KFC.',
            }),
          ),
        ),
      ],
    });
    const pack = new KfcAgentPack({
      model,
      store,
      loadState: async () => kfcState(),
      executeTool: vi.fn(),
      resolveActiveToolNames: () => [...toolNames],
      webEvidence: {
        client: { search: tinyFish.search, fetch: tinyFish.fetch },
        capability: 'enabled',
      },
    });

    await expect(
      pack.runTurn({
        sessionId: 'kfc:web',
        customerId: 'customer-1',
        channel: 'kfc',
        currentUserTurnId: turnId,
      }),
    ).rejects.toThrow('kfc_web_citation_required');
  });

  it('rejects a forged hidden web call at execution when application policy exposes no tools', async () => {
    const { store, turnId } = await kfcStore();
    const tinyFish = harness();
    const model = new ScriptedKfcWebModel({
      outputs: [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'forged-web-1',
              name: 'searchKfcWeb',
              args: { query: 'forged' },
              type: 'tool_call',
            },
          ],
        }),
      ],
    });
    const pack = new KfcAgentPack({
      model,
      store,
      loadState: async () => kfcState(),
      executeTool: vi.fn(),
      resolveActiveToolNames: () => [],
      webEvidence: {
        client: { search: tinyFish.search, fetch: tinyFish.fetch },
        capability: 'enabled',
      },
    });

    await expect(
      pack.runTurn({
        sessionId: 'kfc:web',
        customerId: 'customer-1',
        channel: 'kfc',
        currentUserTurnId: turnId,
      }),
    ).rejects.toThrow('kfc_web_tool_not_authorized');
    expect(tinyFish.search).not.toHaveBeenCalled();
  });

  it('denies advertised and forged web calls when trusted web capability is explicitly disabled despite commerce tools', async () => {
    const { store, turnId } = await kfcStore();
    const tinyFish = harness();
    const model = new ScriptedKfcWebModel({
      outputs: [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'explicitly-denied-web',
              name: 'searchKfcWeb',
              args: { query: 'forged despite denial' },
              type: 'tool_call',
            },
          ],
        }),
      ],
    });
    const pack = new KfcAgentPack({
      model,
      store,
      loadState: async () => kfcState(),
      executeTool: vi.fn(),
      resolveActiveToolNames: () => [...toolNames],
      webEvidence: {
        client: { search: tinyFish.search, fetch: tinyFish.fetch },
        capability: 'disabled',
      },
    });

    await expect(
      pack.runTurn({
        sessionId: 'kfc:web',
        customerId: 'customer-1',
        channel: 'kfc',
        currentUserTurnId: turnId,
      }),
    ).rejects.toThrow('kfc_web_tool_not_authorized');
    expect(model.calls[0]?.toolNames).not.toContain('searchKfcWeb');
    expect(model.calls[0]?.toolNames).not.toContain('fetchKfcPage');
    expect(tinyFish.search).not.toHaveBeenCalled();
  });

  it('exposes and executes no web tool during selected-action presentation', async () => {
    const { store, turnId } = await kfcStore();
    const tinyFish = harness();
    const selectedActionResponse = {
      schemaVersion: 'kfc-selected-action-response-reference-v1' as const,
      actionDigest: 'b'.repeat(64),
      selection: {
        entityIds: ['combo-1'],
        verifiedRevision: 'c'.repeat(64),
      },
      effect: {
        effectId: 'present-combo-1',
        outcome: 'presentation_ready' as const,
        verifiedRevision: 'd'.repeat(64),
      },
      assertion: 'outcome_acknowledged' as const,
    };
    const model = new ScriptedKfcWebModel({
      outputs: [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'selected-action-forged-web',
              name: 'searchKfcWeb',
              args: { query: 'forged during presentation' },
              type: 'tool_call',
            },
          ],
        }),
      ],
    });
    const pack = new KfcAgentPack({
      model,
      store,
      loadState: async () => kfcState(),
      executeTool: vi.fn(),
      resolveActiveToolNames: () => [...toolNames],
      selectedActionResponse,
      webEvidence: {
        client: { search: tinyFish.search, fetch: tinyFish.fetch },
        capability: 'enabled',
      },
    });

    await expect(
      pack.runTurn({
        sessionId: 'kfc:web',
        customerId: 'customer-1',
        channel: 'kfc',
        currentUserTurnId: turnId,
      }),
    ).rejects.toThrow('kfc_web_tool_not_authorized');
    expect(model.calls[0]?.toolNames).not.toContain('searchKfcWeb');
    expect(model.calls[0]?.toolNames).not.toContain('fetchKfcPage');
    expect(tinyFish.search).not.toHaveBeenCalled();
  });

  it('persists only compact citation receipts in the KFC web evidence audit', async () => {
    const store = new MemoryStore();
    await persistKfcWebEvidenceAudit({
      store,
      sessionId: 'kfc:web-audit',
      receipts: [
        {
          id: 'web:fetchKfcPage:1',
          name: 'fetchKfcPage',
          effect: 'provider_read',
          status: 'success',
          evidenceMode: 'live_web',
          evidenceId: 'web:fetchKfcPage:1',
          sourceUrls: [INVENTORIED_URL],
          durationMs: 12,
        },
      ],
    });

    const events = await store.listEvents('kfc:web-audit');
    expect(events).toEqual([
      expect.objectContaining({
        sourceType: 'agent:web_evidence_trace',
        payload: {
          schemaVersion: 'business-tool-trace-v1',
          calls: [
            {
              name: 'fetchKfcPage',
              status: 'success',
              durationMs: 12,
              evidenceMode: 'live_web',
              sourceUrls: [INVENTORIED_URL],
            },
          ],
        },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('page body');
    expect(JSON.stringify(events)).not.toContain('tinyfish-secret');
  });

  it('starts the web deadline before canonical history and state setup', async () => {
    let now = 0;
    const { store, turnId } = await kfcStore();
    const tinyFish = harness();
    const model = new ScriptedKfcWebModel({
      outputs: [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'late-web-1',
              name: 'searchKfcWeb',
              args: { query: 'late' },
              type: 'tool_call',
            },
          ],
        }),
      ],
    });
    const pack = new KfcAgentPack({
      model,
      store,
      loadState: async () => {
        now = 9_000;
        return kfcState();
      },
      executeTool: vi.fn(),
      resolveActiveToolNames: () => [...toolNames],
      webEvidence: {
        client: { search: tinyFish.search, fetch: tinyFish.fetch },
        capability: 'enabled',
        now: () => now,
      },
    });

    await expect(
      pack.runTurn({
        sessionId: 'kfc:web',
        customerId: 'customer-1',
        channel: 'kfc',
        currentUserTurnId: turnId,
      }),
    ).rejects.toThrow('kfc_web_time_budget_exhausted');
    expect(tinyFish.search).not.toHaveBeenCalled();
  });
});
