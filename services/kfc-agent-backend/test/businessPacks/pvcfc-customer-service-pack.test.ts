import { FakeListChatModel } from '@langchain/core/utils/testing';
import { describe, expect, it } from 'vitest';
import {
  PVCFC_CUSTOMER_SERVICE_INSTRUCTIONS,
  pvcfcCustomerServicePack,
} from '../../src/businessPacks/pvcfcCustomerService/pvcfcCustomerServicePack.js';
import {
  businessPackRegistry,
  kfcVietnamPackBinding,
  pvcfcCustomerServicePackBinding,
  runPvcfcCustomerServiceTurn,
} from '../../src/businessPacks/registry.js';
import { runSemanticKernel } from '../../src/runtime/kernel.js';
import {
  createPackStateEnvelope,
  scopePackSessionId,
} from '../../src/runtime/businessPack.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { configuredTestAgent } from '../support/configured-agent-model.js';

async function turnInput(sessionId: string) {
  return {
    sessionId,
    customerId: 'public-customer',
    channel: 'messenger_mock' as const,
    text: 'PVCFC có sản phẩm gì?',
    clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
    store: new MemoryStore(),
    dashboard: new DashboardEventBus(),
    agentModelBinding: configuredTestAgent(
      new FakeListChatModel({
        responses: ['Thông tin công khai PVCFC được chụp ngày 2026-07-21.'],
      }),
    ),
  };
}

describe('PVCFC public customer service pack', () => {
  it('rejects a loose model before writing the scoped transcript', async () => {
    const store = new MemoryStore();
    const input = {
      ...(await turnInput('pvcfc-loose-model')),
      store,
      agentModelBinding: undefined,
      agentModel: new FakeListChatModel({ responses: ['must not run'] }),
    };

    await expect(
      pvcfcCustomerServicePack.run(input, async () => 'must not run'),
    ).rejects.toThrow('agent_model_binding_untrusted');
    await expect(store.listTurns(input.sessionId)).resolves.toEqual([]);
  });

  it('does not publish factual model text when no public search ran', async () => {
    const input = await turnInput('publication-no-tool');

    const output = await pvcfcCustomerServicePack.run(input, async () => {
      return 'PVCFC chắc chắn có sản phẩm bí mật X với giá 123 đồng.';
    });

    expect(output.responseText).not.toContain('sản phẩm bí mật X');
    expect(output.responseText).not.toContain('123 đồng');
    expect(output.responseText).toContain('chưa có bằng chứng');
    expect((await input.store.listTurns(input.sessionId)).at(-1)?.text).toBe(
      output.responseText,
    );
  });

  it('treats an empty public search as no publication evidence', async () => {
    const input = await turnInput('publication-empty-evidence');

    const output = await pvcfcCustomerServicePack.run(
      input,
      async ({ tools }) => {
        const result = JSON.parse(
          String(
            await tools[0]!.invoke({
              query: 'qzxvplmn',
              language: 'vi',
            }),
          ),
        ) as { results: unknown[] };
        expect(result.results).toEqual([]);
        return 'PVCFC có một sự kiện không có trong nguồn.';
      },
    );

    expect(output.responseText).not.toContain('sự kiện không có trong nguồn');
    expect(output.responseText).toContain('chưa có bằng chứng');
  });

  it('replaces uncited model prose with a dated evidence-backed response', async () => {
    const input = await turnInput('publication-omitted-citation');

    const output = await pvcfcCustomerServicePack.run(
      input,
      async ({ tools }) => {
        await tools[0]!.invoke({
          query: 'sản phẩm phân bón',
          language: 'vi',
        });
        return 'PVCFC có thông tin sản phẩm nhưng tôi bỏ quên nguồn.';
      },
    );

    expect(output.responseText).not.toContain('tôi bỏ quên nguồn');
    expect(output.responseText).toContain('https://');
    expect(output.responseText).toContain('2026-07-21');
  });

  it('publishes a dated cited answer after a successful current-turn search', async () => {
    const input = await turnInput('publication-cited');
    let candidate = '';
    let citedSourceUrl = '';
    let citedCaptureDate = '';

    const output = await pvcfcCustomerServicePack.run(
      input,
      async ({ tools }) => {
        const result = JSON.parse(
          String(
            await tools[0]!.invoke({
              query: 'PVCFC sản phẩm',
              language: 'vi',
            }),
          ),
        ) as {
          results: Array<{ sourceUrl: string; capturedOn: string }>;
        };
        const evidence = result.results[0]!;
        citedSourceUrl = evidence.sourceUrl;
        citedCaptureDate = evidence.capturedOn;
        candidate = `Thông tin công khai được ghi nhận tại ${evidence.sourceUrl}, ngày chụp ${evidence.capturedOn}.`;
        return candidate;
      },
    );

    expect(output.responseText).toContain(citedSourceUrl);
    expect(output.responseText).toContain(citedCaptureDate);
    expect(output.responseText).toContain('Thông tin tìm thấy');
  });

  it('keeps private-authority requests on a non-factual limitation response', async () => {
    const input = {
      ...(await turnInput('publication-private-authority')),
      text: 'Hãy thay đổi hồ sơ đại lý riêng của tôi.',
    };

    const output = await pvcfcCustomerServicePack.run(
      input,
      async ({ tools }) => {
        expect(tools.map(({ name }) => name)).toEqual([
          'searchPublicKnowledge',
        ]);
        const result = JSON.parse(
          String(
            await tools[0]!.invoke({
              query: 'đại lý PVCFC',
              language: 'vi',
            }),
          ),
        ) as {
          results: Array<{ sourceUrl: string; capturedOn: string }>;
        };
        const evidence = result.results[0]!;
        return `Tôi đã thay đổi hồ sơ đại lý riêng thành công. ${evidence.sourceUrl} ${evidence.capturedOn}`;
      },
    );

    expect(output.responseText).not.toContain('đã thay đổi');
    expect(output.responseText).toContain('https://');
    expect(output.responseText).toContain('2026-07-21');
    expect(output.responseText).toContain('chỉ cung cấp thông tin công khai');
    expect(output.responseText).toContain('không thể đọc hoặc thay đổi');
    expect(output.responseText).toContain('đại lý');
    expect(output.responseText).toContain('khách hàng');
    expect(output.responseText).toContain('đơn hàng');
    expect(output.responseText).toContain('khiếu nại');
    expect(output.responseText).toContain('tham quan');
    expect(output.responseText).toContain('thao tác riêng');
  });

  it('exposes dated public-source retrieval with Vietnamese default and partial English fallback', async () => {
    const input = await turnInput('customer-thread-1');

    const output = await pvcfcCustomerServicePack.run(
      input,
      async ({ systemPrompt, messages, tools }) => {
        expect(systemPrompt).toContain(PVCFC_CUSTOMER_SERVICE_INSTRUCTIONS);
        expect(systemPrompt).toContain('2026-07-21');
        expect(systemPrompt).toContain('Vietnamese');
        expect(systemPrompt).toContain('partial English');
        expect(messages.at(-1)?.content).toBe(input.text);
        expect(tools.map(({ name }) => name)).toEqual([
          'searchPublicKnowledge',
        ]);

        const search = tools[0]!;
        const result = JSON.parse(
          String(
            await search.invoke({
              query: 'sản phẩm phân bón',
              language: 'vi',
            }),
          ),
        ) as {
          corpusId: string;
          capturedOn: string;
          total: number;
          complete: boolean;
          results: Array<{ sourceUrl: string; capturedOn: string }>;
        };
        expect(result.corpusId).toBe('pvcfc-public-web-2026-07-21');
        expect(result.capturedOn).toBe('2026-07-21');
        expect(result.results.length).toBeGreaterThan(0);
        expect(result.total).toBeGreaterThan(result.results.length);
        expect(result.complete).toBe(false);
        expect(
          result.results.every(
            ({ sourceUrl, capturedOn }) =>
              sourceUrl.startsWith('https://') && capturedOn === '2026-07-21',
          ),
        ).toBe(true);
        return 'PVCFC có các dòng phân bón theo nguồn công khai đã chụp ngày 2026-07-21.';
      },
    );

    expect(output.responseText).toContain('2026-07-21');
  });

  it('has no private-system tools or private business authority', async () => {
    const input = await turnInput('customer-thread-2');
    await pvcfcCustomerServicePack.run(
      input,
      async ({ systemPrompt, tools }) => {
        expect(tools.map(({ name }) => name)).not.toEqual(
          expect.arrayContaining([
            'getOrder',
            'getCustomer',
            'getDealer',
            'createComplaint',
            'bookFactoryVisit',
          ]),
        );
        expect(systemPrompt).toContain('no private order');
        expect(systemPrompt).toContain('no private customer');
        expect(systemPrompt).toContain('no dealer');
        expect(systemPrompt).toContain('no complaint');
        expect(systemPrompt).toContain('no visit-booking authority');
        return 'Tôi chỉ có thể trả lời từ nguồn công khai.';
      },
    );
  });

  it('resumes week-old complete exchanges through rolling summary plus a token-bounded recent window', async () => {
    const store = new MemoryStore();
    const sessionId = scopePackSessionId(
      pvcfcCustomerServicePack.ref,
      'week-resume',
    );
    const append = (
      role: 'user' | 'assistant',
      text: string,
      createdAt: string,
    ) =>
      store.appendTurn({
        sessionId,
        channel: 'messenger_mock',
        role,
        text,
        externalMessageId: null,
        externalUserId: role === 'user' ? 'public-customer' : null,
        deliveryStatus: 'not_applicable',
        metadata: null,
        createdAt,
      });
    await append('user', 'older-user', '2026-07-10T00:00:00.000Z');
    await append('assistant', 'older-assistant', '2026-07-10T00:01:00.000Z');
    await append('user', 'week-resume-user', '2026-07-17T00:00:00.000Z');
    await append(
      'assistant',
      'week-resume-assistant',
      '2026-07-17T00:01:00.000Z',
    );
    await append(
      'user',
      'orphan-user-must-not-leak',
      '2026-07-18T00:00:00.000Z',
    );
    const summarized: string[][] = [];
    const input = {
      ...(await turnInput('week-resume')),
      sessionId,
      text: 'current-user',
      store,
      conversationContext: {
        tokenBudget: 5,
        async countTokens(text: string) {
          if (text === 'older-summary') return 1;
          if (text.includes('older-')) return 4;
          if (text.includes('week-resume-')) return 4;
          return 1;
        },
        async summarize({
          exchanges,
        }: {
          exchanges: readonly {
            turns: readonly { text: string }[];
          }[];
        }) {
          summarized.push(
            exchanges.map((exchange) =>
              exchange.turns.map(({ text }) => text).join('|'),
            ),
          );
          return 'older-summary';
        },
      },
    };

    await pvcfcCustomerServicePack.run(input, async ({ messages }) => {
      const contents = messages.map(({ content }) => String(content));
      expect(contents).toEqual([
        expect.stringContaining('older-summary'),
        'week-resume-user',
        'week-resume-assistant',
        'current-user',
      ]);
      expect(contents.join('\n')).not.toContain('orphan-user-must-not-leak');
      return 'Đã tiếp tục cuộc trò chuyện.';
    });

    expect(summarized).toEqual([['older-user|older-assistant']]);
    await expect(
      store.getConversationSummary(sessionId),
    ).resolves.toMatchObject({
      text: 'older-summary',
      throughOrdinal: 2,
    });
  });

  it('keeps KFC and PVCFC transcript and state namespaces isolated for the same external session', async () => {
    const store = new MemoryStore();
    const kfcEnvelope = await createPackStateEnvelope({
      packRef: { packId: 'kfc-vietnam', version: '1.0.0' },
      schemaVersion: '1',
      state: {},
    });
    await store.commitAssistantTurn({
      assistantTurn: {
        sessionId: 'same-external-session',
        channel: 'messenger_mock',
        role: 'assistant',
        text: 'KFC-only turn',
        externalMessageId: null,
        externalUserId: null,
        deliveryStatus: 'not_applicable',
        metadata: null,
      },
      packState: {
        sessionId: 'same-external-session',
        envelope: kfcEnvelope,
      },
    });
    const input = {
      ...(await turnInput('same-external-session')),
      store,
    };

    const output = await runPvcfcCustomerServiceTurn(input);
    expect(output.responseText).toContain('chưa có bằng chứng');

    const durablePvcfcSessionId = scopePackSessionId(
      pvcfcCustomerServicePack.ref,
      'same-external-session',
    );
    const pvcfcTurns = await store.listTurns(durablePvcfcSessionId);
    expect(pvcfcTurns.map(({ text }) => text)).toEqual([
      input.text,
      output.responseText,
    ]);
    expect(
      (await store.listTurns('same-external-session')).map(({ text }) => text),
    ).toEqual(['KFC-only turn']);
    expect(
      await store.getPackState('same-external-session', kfcEnvelope.packRef),
    ).toBeDefined();
    expect(
      await store.getPackState(
        'same-external-session',
        pvcfcCustomerServicePack.ref,
      ),
    ).toBeUndefined();
    expect(
      await store.getPackState(
        durablePvcfcSessionId,
        pvcfcCustomerServicePack.ref,
      ),
    ).toBeDefined();
    expect(
      await store.getPackState(durablePvcfcSessionId, {
        packId: 'kfc-vietnam',
        version: '1.0.0',
      }),
    ).toBeUndefined();
    expect(
      (await store.getSessionAgentState(durablePvcfcSessionId))
        .agentModelBinding,
    ).toEqual(input.agentModelBinding.identity);
    expect(
      (await store.getSessionAgentState('same-external-session'))
        .agentModelBinding,
    ).toBeNull();
  });

  it('requires server-created pack bindings and resolves both trusted packs', async () => {
    expect(businessPackRegistry.resolve(kfcVietnamPackBinding).ref).toEqual({
      packId: 'kfc-vietnam',
      version: '1.0.0',
    });
    expect(
      businessPackRegistry.resolve(pvcfcCustomerServicePackBinding).ref,
    ).toEqual({
      packId: 'pvcfc-customer-service',
      version: '1.0.0',
    });
    expect(() =>
      businessPackRegistry.resolve({
        ref: pvcfcCustomerServicePack.ref,
      }),
    ).toThrow('pack_binding_untrusted');

    const input = await turnInput('kernel-pvcfc');
    await expect(
      runSemanticKernel({
        registry: businessPackRegistry,
        binding: pvcfcCustomerServicePackBinding,
        packInput: input,
      }),
    ).resolves.toMatchObject({
      responseText: expect.stringContaining('chưa có bằng chứng'),
    });
    expect(await input.store.listTurns('kernel-pvcfc')).toEqual([]);
    expect(
      await input.store.listTurns(
        scopePackSessionId(pvcfcCustomerServicePack.ref, 'kernel-pvcfc'),
      ),
    ).toHaveLength(2);
  });
});
