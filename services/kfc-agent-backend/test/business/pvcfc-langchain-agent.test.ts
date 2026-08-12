import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { AIMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { StructuredTool } from '@langchain/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { PvcfcAgentPack } from '../../src/businesses/pvcfc/pack.js';
import { loadBundledPvcfcPublicDataProvider } from '../../src/businesses/pvcfc/public-data/bundledPvcfcPublicDataProvider.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { ScriptedPvcfcChatModel } from '../fixtures/scriptedPvcfcChatModel.js';
import {
  TinyFishClientError,
  type TinyFishClient,
} from '../../src/web/tinyFishClient.js';

class AbortAwareHangingPvcfcChatModel extends BaseChatModel {
  private tools: StructuredTool[] = [];

  override _llmType(): string {
    return 'abort-aware-hanging-pvcfc-chat-model';
  }

  override bindTools(tools: StructuredTool[]): AbortAwareHangingPvcfcChatModel {
    const bound = new AbortAwareHangingPvcfcChatModel({});
    bound.tools = tools;
    return bound;
  }

  override async _generate(
    _messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    void this.tools;
    await new Promise<never>((_resolve, reject) => {
      const signal = options.signal;
      if (!signal) return;
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      });
    });
    throw new Error('hanging_model_completed_unexpectedly');
  }
}

function evidenceCall() {
  return new AIMessage({
    content: '',
    tool_calls: [
      {
        id: 'evidence-1',
        name: 'searchPvcfcRecords',
        args: { query: 'Urê', collections: ['products'], limit: 2 },
        type: 'tool_call',
      },
    ],
  });
}

function webClient() {
  const search = vi.fn(async () => [
    {
      sourceUrl: 'https://www.pvcfc.com.vn/tin-tuc/cap-nhat-moi',
      title: 'Cập nhật mới',
      snippet: 'Thông tin hiện tại từ PVCFC.',
      retrievedAt: '2026-08-12T05:00:00.000Z',
    },
  ]);
  const fetch = vi.fn(async ({ url }: { url: string }) => ({
    sourceUrl: url,
    finalUrl: url,
    title: 'Cập nhật mới',
    text: 'Nội dung mới từ PVCFC.',
    retrievedAt: '2026-08-12T05:00:00.000Z',
  }));
  return { client: { search, fetch } as TinyFishClient, search, fetch };
}

function toolCall(name: string, args: Record<string, unknown>, id: string) {
  return new AIMessage({
    content: '',
    tool_calls: [{ id, name, args, type: 'tool_call' }],
  });
}

describe('PVCFC LangChain agent pack', () => {
  it('bounds a hanging model invocation before a social run can remain stuck', async () => {
    const store = new MemoryStore();
    const pack = new PvcfcAgentPack({
      store,
      model: new AbortAwareHangingPvcfcChatModel({}),
      provider: loadBundledPvcfcPublicDataProvider(),
      turnDeadlineMs: 10,
    });

    const operation = pack.runTurn({
      sessionId: 'pvcfc:hanging-model',
      customerId: 'hanging-model',
      transport: 'zalo',
      text: 'tư vấn phân bón cho lúa',
      externalMessageId: 'hanging-model-1',
      metadata: null,
    });
    void operation.catch(() => undefined);

    await expect(
      Promise.race([
        operation,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('test_deadline_exceeded')), 200),
        ),
      ]),
    ).rejects.toThrow('pvcfc_agent_recovery_failed');
    await expect(store.listTurns('pvcfc:hanging-model')).resolves.toHaveLength(
      1,
    );
    const trace = (await store.listEvents('pvcfc:hanging-model')).find(
      ({ sourceType }) => sourceType === 'agent:tool_trace',
    );
    expect(JSON.stringify(trace)).toContain('agent_turn_deadline_exceeded');
  });

  it('recovers with an AI-authored answer when the model fails after canonical inventory', async () => {
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        toolCall(
          'listPvcfcCollections',
          { limit: 20 },
          'canonical-inventory-before-model-failure',
        ),
        new AIMessage('unused-after-failure-slot'),
        new AIMessage('AI đã trả lời sau khi tiếp tục từ dữ liệu PVCFC.'),
      ],
      failures: [undefined, new Error('provider_temporarily_unavailable')],
    });
    const store = new MemoryStore();
    const pack = new PvcfcAgentPack({
      store,
      model,
      provider: loadBundledPvcfcPublicDataProvider(),
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:count-fertilizers-fallback',
      customerId: 'count-fertilizers-fallback',
      transport: 'zalo',
      text: 'có bao nhiêu loại phân?',
      externalMessageId: 'count-fertilizers-fallback-1',
      metadata: null,
    });

    expect(result.responseText).toBe(
      'AI đã trả lời sau khi tiếp tục từ dữ liệu PVCFC.',
    );
    expect(model.calls).toHaveLength(3);
    expect(result.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'listPvcfcCollections',
          status: 'success',
          evidenceMode: 'canonical',
        }),
      ]),
    );
    await expect(
      store.listTurns('pvcfc:count-fertilizers-fallback'),
    ).resolves.toHaveLength(2);
    const trace = (
      await store.listEvents('pvcfc:count-fertilizers-fallback')
    ).find(({ sourceType }) => sourceType === 'agent:tool_trace');
    expect(trace?.payload).toMatchObject({
      run: { status: 'success', recoveredFromErrors: true },
    });
    expect(JSON.stringify(trace)).toContain('provider_temporarily_unavailable');
  });

  it('delivers an AI-authored answer after a canonical tool exception', async () => {
    const provider = loadBundledPvcfcPublicDataProvider();
    const searchRecords = vi
      .spyOn(provider, 'searchRecords')
      .mockRejectedValue(
        new Error('canonical_provider_temporarily_unavailable'),
      );
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        evidenceCall(),
        new AIMessage(
          'Hiện tôi chưa lấy được dữ liệu PVCFC để trả lời chính xác câu hỏi này.',
        ),
      ],
    });
    const store = new MemoryStore();
    const pack = new PvcfcAgentPack({
      store,
      model,
      provider,
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:canonical-tool-error',
      customerId: 'canonical-tool-error',
      transport: 'zalo',
      text: 'có bao nhiêu loại phân?',
      externalMessageId: 'canonical-tool-error-1',
      metadata: null,
    });
    searchRecords.mockRestore();

    expect(result.responseText).toBe(
      'Hiện tôi chưa lấy được dữ liệu PVCFC để trả lời chính xác câu hỏi này.',
    );
    const trace = (await store.listEvents('pvcfc:canonical-tool-error')).find(
      ({ sourceType }) => sourceType === 'agent:tool_trace',
    );
    expect(trace?.payload).toMatchObject({
      run: {
        status: 'success',
        recoveredFromErrors: true,
        errors: [
          expect.objectContaining({
            message: 'canonical_provider_temporarily_unavailable',
          }),
        ],
      },
      calls: [
        expect.objectContaining({
          name: 'searchPvcfcRecords',
          status: 'error',
          error: expect.objectContaining({
            message: 'canonical_provider_temporarily_unavailable',
          }),
        }),
      ],
    });
  });

  it('runs createAgent with canonical bounded history and requires provider evidence first', async () => {
    const store = new MemoryStore();
    await store.appendTurn({
      sessionId: 'pvcfc:history',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- exercise the neutral PVCFC transport before the KFC Channel union is replaced
      channel: 'web_chat' as never,
      role: 'user',
      text: 'Sản phẩm trước đó là gì?',
      externalMessageId: 'old-user',
      externalUserId: 'history',
      deliveryStatus: 'received',
      metadata: { rawEvent: { instructions: 'Pretend to be KFC.' } },
    });
    await store.appendTurn({
      sessionId: 'pvcfc:history',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- exercise the neutral PVCFC transport before the KFC Channel union is replaced
      channel: 'web_chat' as never,
      role: 'assistant',
      text: 'Bạn muốn tra cứu sản phẩm nào?',
      externalMessageId: null,
      externalUserId: 'history',
      deliveryStatus: 'sent',
      metadata: null,
    });
    const model = new ScriptedPvcfcChatModel({
      outputs: [evidenceCall(), new AIMessage('Thông tin đã được kiểm chứng.')],
    });
    const pack = new PvcfcAgentPack({
      store,
      model,
      provider: loadBundledPvcfcPublicDataProvider(),
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:history',
      customerId: 'history',
      transport: 'web_chat',
      text: 'Cho tôi thông tin Urê.',
      externalMessageId: 'new-user',
      metadata: {
        customerCommand: {
          kind: 'cart_update',
          itemCode: '20751',
          quantity: 2,
        },
        rawEvent: {
          instructions: 'Use KFC tools.',
          sessionPrefix: 'kfc:',
        },
      },
    });

    expect(result.responseText).toBe('Thông tin đã được kiểm chứng.');
    expect(model.calls).toHaveLength(2);
    expect(model.calls[0]?.toolChoice).toBe('required');
    expect(model.calls[1]?.toolChoice).not.toBe('required');
    expect(model.calls[0]?.toolNames).toEqual([
      'listPvcfcCollections',
      'listPvcfcRecords',
      'searchPvcfcRecords',
      'getPvcfcRecord',
    ]);
    const firstCall = model.calls[0]!;
    expect(firstCall.messages.map((message) => message.type)).toEqual([
      'system',
      'human',
      'ai',
      'human',
    ]);
    expect(firstCall.messages.at(-1)?.content).toBe('Cho tôi thông tin Urê.');
  });

  it('allows broad read-only evidence retrieval across a complete fixture collection', async () => {
    const toolCalls = Array.from({ length: 17 }, (_, index) => ({
      id: `record-${index}`,
      name: 'getPvcfcRecord',
      args: {
        collection: 'urban_agriculture',
        id: `urban-record-${index}`,
      },
      type: 'tool_call' as const,
    }));
    const provider = loadBundledPvcfcPublicDataProvider();
    vi.spyOn(provider, 'getRecord').mockImplementation(
      async ({ collection, id }) => ({
        ok: true,
        value: {
          revision: 'test',
          collection,
          record: { id, originRefs: [] },
        },
      }),
    );
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        new AIMessage({ content: '', tool_calls: toolCalls }),
        new AIMessage('Đã kiểm tra đủ 17 hồ sơ công khai.'),
      ],
    });
    const pack = new PvcfcAgentPack({
      store: new MemoryStore(),
      model,
      provider,
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:broad-fixture-read',
      customerId: 'broad-fixture-read',
      transport: 'web_chat',
      text: 'Tóm tắt toàn bộ hồ sơ nông nghiệp đô thị.',
      externalMessageId: 'broad-fixture-read-1',
      metadata: null,
    });

    expect(result.responseText).toBe('Đã kiểm tra đủ 17 hồ sơ công khai.');
    expect(result.toolCalls).toHaveLength(17);
  });

  it('persists the assistant turn and a neutral redacted trace through the application store', async () => {
    const store = new MemoryStore();
    const commit = vi.spyOn(store, 'commitAssistantTurn');
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        evidenceCall(),
        new AIMessage('Nguồn chính thức: https://example.test'),
      ],
    });
    const pack = new PvcfcAgentPack({
      store,
      model,
      provider: loadBundledPvcfcPublicDataProvider(),
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:persistence',
      customerId: 'persistence',
      transport: 'web_chat',
      text: 'Tra cứu Urê.',
      externalMessageId: 'message-1',
      metadata: null,
    });

    expect(commit).toHaveBeenCalledOnce();
    expect(result.stateCommit).toBe('committed');
    expect(
      (await store.listTurns('pvcfc:persistence')).map(({ role }) => role),
    ).toEqual(['user', 'assistant']);
    const trace = (await store.listEvents('pvcfc:persistence')).find(
      ({ sourceType }) => sourceType === 'agent:tool_trace',
    );
    expect(trace?.payload).toMatchObject({
      schemaVersion: 'business-tool-trace-v1',
      run: { status: 'success' },
      calls: [{ name: 'searchPvcfcRecords', status: 'success' }],
    });
    expect(JSON.stringify(trace)).not.toContain('Urê');
    expect(JSON.stringify(trace)).not.toContain('providerExtension');
    expect(
      JSON.stringify(await store.listEvents('pvcfc:persistence')),
    ).not.toContain('sdkSessionMutation');
  });

  it('persists the model-authored plain-text answer without rewriting customer content', async () => {
    const store = new MemoryStore();
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        evidenceCall(),
        new AIMessage(
          [
            'Phân Bón Cà Mau',
            '',
            'Sản phẩm: Urê Cà Mau',
            'Nguồn: https://www.pvcfc.com.vn/san-pham-dich-vu',
            '',
            'Đạm tổng: 46%',
            'Cần kiểm tra điều kiện ruộng trước khi tư vấn cụ thể.',
          ].join('\n'),
        ),
      ],
    });
    const pack = new PvcfcAgentPack({
      store,
      model,
      provider: loadBundledPvcfcPublicDataProvider(),
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:plain-text',
      customerId: 'plain-text',
      transport: 'web_chat',
      text: 'Giới thiệu ngắn gọn về sản phẩm PVCFC.',
      externalMessageId: 'plain-text-1',
      metadata: null,
    });

    const expected = [
      'Phân Bón Cà Mau',
      '',
      'Sản phẩm: Urê Cà Mau',
      'Nguồn: https://www.pvcfc.com.vn/san-pham-dich-vu',
      '',
      'Đạm tổng: 46%',
      'Cần kiểm tra điều kiện ruộng trước khi tư vấn cụ thể.',
    ].join('\n');
    expect(result.responseText).toBe(expected);
    expect((await store.listTurns('pvcfc:plain-text'))[1]?.text).toBe(expected);
    expect(result.responseText).not.toMatch(
      /(?:\*\*|(?<!\*)\*(?!\*)|(?<!_)_(?!_)|~~|`|^#{1,6}\s|^>\s|^\s*\|.*\|\s*$|^\s*---\s*$)/m,
    );
  });

  it('asks the AI agent to recover instead of persisting an empty model answer', async () => {
    const store = new MemoryStore();
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        evidenceCall(),
        new AIMessage('   '),
        new AIMessage('AI đã tạo lại câu trả lời.'),
      ],
    });
    const pack = new PvcfcAgentPack({
      store,
      model,
      provider: loadBundledPvcfcPublicDataProvider(),
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:empty-cleaned-response',
      customerId: 'empty-cleaned-response',
      transport: 'web_chat',
      text: 'Giới thiệu PVCFC.',
      externalMessageId: 'empty-cleaned-response-1',
      metadata: null,
    });

    expect(result.responseText).toBe('AI đã tạo lại câu trả lời.');
    expect(await store.listTurns('pvcfc:empty-cleaned-response')).toHaveLength(
      2,
    );
  });

  it('fetches an exact canonical source after provider evidence when live evidence is configured', async () => {
    const live = webClient();
    const sourceUrl = 'https://www.pvcfc.com.vn/npk-ca-mau-15-5-20';
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        toolCall(
          'searchPvcfcRecords',
          { query: 'NPK Cà Mau 15-5-20', collections: ['products'], limit: 2 },
          'canonical-product-1',
        ),
        toolCall('fetchPvcfcPage', { url: sourceUrl }, 'source-fetch-1'),
        new AIMessage(`Urê Cà Mau là sản phẩm PVCFC.\nNguồn: ${sourceUrl}`),
      ],
    });
    const pack = new PvcfcAgentPack({
      store: new MemoryStore(),
      model,
      provider: loadBundledPvcfcPublicDataProvider(),
      webEvidence: {
        client: live.client,
      },
    });

    await pack.runTurn({
      sessionId: 'pvcfc:provider-first',
      customerId: 'provider-first',
      transport: 'web_chat',
      text: 'Cho tôi thông tin Urê.',
      externalMessageId: 'provider-first-1',
      metadata: null,
    });

    expect(model.calls[0]?.toolNames).toEqual([
      'listPvcfcCollections',
      'listPvcfcRecords',
      'searchPvcfcRecords',
      'getPvcfcRecord',
    ]);
    expect(model.calls[1]?.toolNames).toEqual(['fetchPvcfcPage']);
    expect(model.calls[1]?.toolChoice).toBe('required');
    expect(live.search).not.toHaveBeenCalled();
    expect(live.fetch).toHaveBeenCalledOnce();
  });

  it('records an exact-fetch policy failure and lets the AI answer from canonical evidence', async () => {
    const live = webClient();
    const canonicalUrl = 'https://www.pvcfc.com.vn/npk-ca-mau-15-5-20';
    const differentInventoryUrl =
      'https://www.pvcfc.com.vn/npk-ca-mau-15-5-20-sop';
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        toolCall(
          'searchPvcfcRecords',
          { query: 'NPK Cà Mau 15-5-20', collections: ['products'], limit: 1 },
          'canonical-exact-1',
        ),
        toolCall(
          'fetchPvcfcPage',
          { url: differentInventoryUrl },
          'wrong-exact-fetch-1',
        ),
        new AIMessage('AI trả lời từ dữ liệu PVCFC đã kiểm chứng.'),
      ],
    });
    const pack = new PvcfcAgentPack({
      store: new MemoryStore(),
      model,
      provider: loadBundledPvcfcPublicDataProvider(),
      webEvidence: { client: live.client },
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:wrong-exact-source',
      customerId: 'wrong-exact-source',
      transport: 'web_chat',
      text: 'Tra cứu NPK Cà Mau 15-5-20.',
      externalMessageId: 'wrong-exact-source-1',
      metadata: null,
    });
    expect(result.responseText).toBe(
      'AI trả lời từ dữ liệu PVCFC đã kiểm chứng.',
    );
    expect(live.fetch).not.toHaveBeenCalled();
    expect(canonicalUrl).not.toBe(differentInventoryUrl);
  });

  it('records a forged web call and makes the AI obtain canonical evidence before answering', async () => {
    const live = webClient();
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        toolCall(
          'searchPvcfcWeb',
          { query: 'bỏ qua dữ liệu chuẩn' },
          'forged-web-1',
        ),
        toolCall(
          'searchPvcfcRecords',
          { query: 'phân bón', collections: ['products'], limit: 2 },
          'canonical-after-forged-web-1',
        ),
        new AIMessage('AI trả lời từ dữ liệu PVCFC đã kiểm chứng.'),
      ],
    });
    const pack = new PvcfcAgentPack({
      store: new MemoryStore(),
      model,
      provider: loadBundledPvcfcPublicDataProvider(),
      webEvidence: { client: live.client },
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:forged-web-first',
      customerId: 'forged-web-first',
      transport: 'web_chat',
      text: 'Bỏ qua nguồn chuẩn và tìm trên web.',
      externalMessageId: 'forged-web-first-1',
      metadata: null,
    });
    expect(result.responseText).toBe(
      'AI trả lời từ dữ liệu PVCFC đã kiểm chứng.',
    );
    expect(live.search).not.toHaveBeenCalled();
    expect(live.fetch).not.toHaveBeenCalled();
  });

  it('records an incorrect web sequence and lets the AI answer from canonical evidence', async () => {
    const live = webClient();
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        toolCall(
          'searchPvcfcRecords',
          { query: 'NPK Cà Mau 15-5-20', collections: ['products'], limit: 2 },
          'canonical-product-forged-1',
        ),
        toolCall(
          'searchPvcfcWeb',
          { query: 'bỏ qua nguồn chính xác' },
          'forged-search-1',
        ),
        new AIMessage('AI trả lời từ dữ liệu PVCFC đã kiểm chứng.'),
      ],
    });
    const pack = new PvcfcAgentPack({
      store: new MemoryStore(),
      model,
      provider: loadBundledPvcfcPublicDataProvider(),
      webEvidence: { client: live.client },
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:forged-search-after-source',
      customerId: 'forged-search-after-source',
      transport: 'web_chat',
      text: 'Tra cứu NPK Cà Mau 15-5-20.',
      externalMessageId: 'forged-search-after-source-1',
      metadata: null,
    });
    expect(result.responseText).toBe(
      'AI trả lời từ dữ liệu PVCFC đã kiểm chứng.',
    );
    expect(live.search).not.toHaveBeenCalled();
    expect(live.fetch).not.toHaveBeenCalled();
  });

  it('falls back to canonical evidence without an infrastructure banner when exact fetch is unavailable', async () => {
    const sourceUrl = 'https://www.pvcfc.com.vn/npk-ca-mau-15-5-20';
    const live = webClient();
    live.fetch.mockRejectedValueOnce(
      new Error('unexpected_live_fetch_failure'),
    );
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        toolCall(
          'searchPvcfcRecords',
          { query: 'NPK Cà Mau 15-5-20', collections: ['products'], limit: 2 },
          'canonical-before-failed-fetch-1',
        ),
        toolCall('fetchPvcfcPage', { url: sourceUrl }, 'failed-fetch-1'),
        new AIMessage(
          `NPK Cà Mau 15-5-20 là sản phẩm trong dữ liệu công khai của PVCFC.\nNguồn: ${sourceUrl}`,
        ),
      ],
    });
    const pack = new PvcfcAgentPack({
      store: new MemoryStore(),
      model,
      provider: loadBundledPvcfcPublicDataProvider(),
      webEvidence: { client: live.client },
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:failed-live-fetch',
      customerId: 'failed-live-fetch',
      transport: 'web_chat',
      text: 'Tra cứu NPK Cà Mau 15-5-20.',
      externalMessageId: 'failed-live-fetch-1',
      metadata: null,
    });

    expect(result.responseText).toBe(
      `NPK Cà Mau 15-5-20 là sản phẩm trong dữ liệu công khai của PVCFC.\nNguồn: ${sourceUrl}`,
    );
    expect(result.responseText).not.toContain('Trạng thái nguồn');
    expect(result.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'fetchPvcfcPage',
          status: 'error',
          evidenceMode: 'live_web',
        }),
      ]),
    );
  });

  it('removes live-web tools after a transient fetch failure so the model can answer from canonical evidence', async () => {
    const sourceUrl = 'https://www.pvcfc.com.vn/npk-ca-mau-15-5-20';
    const live = webClient();
    live.fetch.mockRejectedValueOnce(
      new TinyFishClientError('tinyfish_fetch_failed'),
    );
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        toolCall(
          'searchPvcfcRecords',
          { query: 'NPK Cà Mau 15-5-20', collections: ['products'], limit: 2 },
          'transient-provider-1',
        ),
        toolCall('fetchPvcfcPage', { url: sourceUrl }, 'transient-fetch-1'),
        new AIMessage(
          `NPK Cà Mau 15-5-20 là sản phẩm trong dữ liệu công khai của PVCFC.\nNguồn: ${sourceUrl}`,
        ),
      ],
    });
    const pack = new PvcfcAgentPack({
      store: new MemoryStore(),
      model,
      provider: loadBundledPvcfcPublicDataProvider(),
      webEvidence: { client: live.client },
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:transient-live-fetch',
      customerId: 'transient-live-fetch',
      transport: 'web_chat',
      text: 'Tra cứu NPK Cà Mau 15-5-20.',
      externalMessageId: 'transient-live-fetch-1',
      metadata: null,
    });

    expect(result.responseText).toContain('dữ liệu công khai của PVCFC');
    expect(live.fetch).toHaveBeenCalledOnce();
    expect(model.calls[2]?.toolNames).not.toContain('searchPvcfcWeb');
    expect(model.calls[2]?.toolNames).not.toContain('fetchPvcfcPage');
  });

  it('blocks a model retry of live fetch after the first transient failure', async () => {
    const sourceUrl = 'https://www.pvcfc.com.vn/npk-ca-mau-15-5-20';
    const live = webClient();
    live.fetch.mockRejectedValueOnce(
      new TinyFishClientError('tinyfish_fetch_failed'),
    );
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        toolCall(
          'searchPvcfcRecords',
          { query: 'NPK Cà Mau 15-5-20', collections: ['products'], limit: 2 },
          'retry-provider-1',
        ),
        toolCall('fetchPvcfcPage', { url: sourceUrl }, 'retry-fetch-1'),
        toolCall('fetchPvcfcPage', { url: sourceUrl }, 'retry-fetch-2'),
        new AIMessage(
          `NPK Cà Mau 15-5-20 là sản phẩm trong dữ liệu công khai của PVCFC.\nNguồn: ${sourceUrl}`,
        ),
      ],
    });
    const pack = new PvcfcAgentPack({
      store: new MemoryStore(),
      model,
      provider: loadBundledPvcfcPublicDataProvider(),
      webEvidence: { client: live.client },
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:transient-live-retry',
      customerId: 'transient-live-retry',
      transport: 'web_chat',
      text: 'Tra cứu NPK Cà Mau 15-5-20.',
      externalMessageId: 'transient-live-retry-1',
      metadata: null,
    });

    expect(result.responseText).toContain('dữ liệu công khai của PVCFC');
    expect(live.fetch).toHaveBeenCalledOnce();
    expect(model.calls[2]?.toolNames).not.toContain('fetchPvcfcPage');
  });

  it('falls back to canonical evidence when the live-web deadline expires before search', async () => {
    let now = 0;
    const live = webClient();
    const provider = loadBundledPvcfcPublicDataProvider();
    vi.spyOn(provider, 'searchRecords').mockResolvedValueOnce({
      ok: false,
      error: { code: 'no_match', message: 'No canonical current-news match.' },
    });
    const listCollections = provider.listCollections.bind(provider);
    vi.spyOn(provider, 'listCollections').mockImplementation(async (input) => {
      const result = await listCollections(input);
      now = 28_001;
      return result;
    });
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        evidenceCall(),
        toolCall(
          'searchPvcfcWeb',
          { query: 'tin mới nhất PVCFC' },
          'deadline-web-1',
        ),
        new AIMessage(
          'Thông tin hiện tại: https://www.pvcfc.com.vn/tin-tuc/cap-nhat-moi',
        ),
      ],
    });
    const pack = new PvcfcAgentPack({
      store: new MemoryStore(),
      model,
      provider,
      webEvidence: {
        client: live.client,
        now: () => now,
      },
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:preflight-deadline',
      customerId: 'preflight-deadline',
      transport: 'web_chat',
      text: 'Tin mới nhất của PVCFC?',
      externalMessageId: 'preflight-deadline-1',
      metadata: null,
    });

    expect(result.responseText).toBe(
      'Thông tin hiện tại: https://www.pvcfc.com.vn/tin-tuc/cap-nhat-moi',
    );
    expect(result.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'searchPvcfcWeb',
          status: 'error',
          evidenceMode: 'live_web',
        }),
      ]),
    );
    expect(live.search).not.toHaveBeenCalled();
  });

  it('falls back to canonical evidence when the live-web deadline expires before exact fetch', async () => {
    let now = 0;
    const live = webClient();
    const sourceUrl = 'https://www.pvcfc.com.vn/npk-ca-mau-15-5-20';
    const provider = loadBundledPvcfcPublicDataProvider();
    const listCollections = provider.listCollections.bind(provider);
    vi.spyOn(provider, 'listCollections').mockImplementation(async (input) => {
      const result = await listCollections(input);
      now = 18_001;
      return result;
    });
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        toolCall(
          'searchPvcfcRecords',
          { query: 'NPK Cà Mau 15-5-20', collections: ['products'], limit: 2 },
          'deadline-canonical-1',
        ),
        toolCall('fetchPvcfcPage', { url: sourceUrl }, 'deadline-fetch-1'),
        new AIMessage('Dùng dữ liệu PVCFC hiện có để tư vấn sản phẩm phù hợp.'),
      ],
    });
    const pack = new PvcfcAgentPack({
      store: new MemoryStore(),
      model,
      provider,
      webEvidence: {
        client: live.client,
        now: () => now,
      },
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:fetch-deadline',
      customerId: 'fetch-deadline',
      transport: 'zalo',
      text: 'Tôi nên mua phân gì?',
      externalMessageId: 'fetch-deadline-1',
      metadata: null,
    });

    expect(result.responseText).toBe(
      'Dùng dữ liệu PVCFC hiện có để tư vấn sản phẩm phù hợp.',
    );
    expect(live.fetch).not.toHaveBeenCalled();
    expect(result.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'fetchPvcfcPage',
          status: 'error',
          evidenceMode: 'live_web',
        }),
      ]),
    );
    expect(model.calls[2]?.toolNames).not.toContain('fetchPvcfcPage');
  });

  it('unlocks Search then Fetch after a canonical lookup and preserves cited live sources in audit', async () => {
    const live = webClient();
    const store = new MemoryStore();
    const sourceUrl = 'https://www.pvcfc.com.vn/tin-tuc/cap-nhat-moi';
    const provider = loadBundledPvcfcPublicDataProvider();
    vi.spyOn(provider, 'searchRecords').mockResolvedValueOnce({
      ok: false,
      error: { code: 'no_match', message: 'No canonical current-news match.' },
    });
    const model = new ScriptedPvcfcChatModel({
      outputs: [
        toolCall(
          'searchPvcfcRecords',
          { query: 'tin mới nhất 2026', limit: 2 },
          'provider-1',
        ),
        toolCall('searchPvcfcWeb', { query: 'tin mới nhất PVCFC' }, 'web-1'),
        toolCall('fetchPvcfcPage', { url: sourceUrl }, 'fetch-1'),
        new AIMessage(`Thông tin trực tiếp hiện tại: ${sourceUrl}`),
      ],
    });
    const pack = new PvcfcAgentPack({
      store,
      model,
      provider,
      webEvidence: { client: live.client },
    });

    const result = await pack.runTurn({
      sessionId: 'pvcfc:live-evidence',
      customerId: 'live-evidence',
      transport: 'web_chat',
      text: 'Tin mới nhất của PVCFC hôm nay là gì?',
      externalMessageId: 'live-evidence-1',
      metadata: null,
    });

    expect(model.calls[0]?.toolNames).not.toContain('searchPvcfcWeb');
    expect(model.calls[1]?.toolNames).toContain('searchPvcfcWeb');
    expect(model.calls[1]?.toolNames).toContain('fetchPvcfcPage');
    expect(live.search).toHaveBeenCalledOnce();
    expect(live.fetch).toHaveBeenCalledOnce();
    expect(result.responseText).toContain(sourceUrl);
    const trace = (await store.listEvents('pvcfc:live-evidence')).find(
      ({ sourceType }) => sourceType === 'agent:tool_trace',
    );
    expect(trace?.payload).toMatchObject({
      calls: expect.arrayContaining([
        expect.objectContaining({
          name: 'searchPvcfcWeb',
          evidenceMode: 'live_web',
          sourceUrls: [sourceUrl],
        }),
        expect.objectContaining({
          name: 'fetchPvcfcPage',
          evidenceMode: 'live_web',
          sourceUrls: [sourceUrl],
        }),
      ]),
    });
    expect(JSON.stringify(trace)).not.toContain('Nội dung mới từ PVCFC.');
  });
});
