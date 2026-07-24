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
import { createPackStateEnvelope } from '../../src/runtime/businessPack.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

async function turnInput(sessionId: string) {
  return {
    sessionId,
    customerId: 'public-customer',
    channel: 'messenger_mock' as const,
    text: 'PVCFC có sản phẩm gì?',
    clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
    store: new MemoryStore(),
    dashboard: new DashboardEventBus(),
    agentModel: new FakeListChatModel({
      responses: ['Thông tin công khai PVCFC được chụp ngày 2026-07-21.'],
    }),
  };
}

describe('PVCFC public customer service pack', () => {
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
    expect(output.responseText).toContain('2026-07-21');

    const pvcfcTurns = await store.listTurns(
      'pvcfc-customer-service@1.0.0:same-external-session',
    );
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
        'pvcfc-customer-service@1.0.0:same-external-session',
        pvcfcCustomerServicePack.ref,
      ),
    ).toBeDefined();
    expect(
      await store.getPackState(
        'pvcfc-customer-service@1.0.0:same-external-session',
        { packId: 'kfc-vietnam', version: '1.0.0' },
      ),
    ).toBeUndefined();
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
      responseText: expect.stringContaining('2026-07-21'),
    });
    expect(await input.store.listTurns('kernel-pvcfc')).toEqual([]);
    expect(
      await input.store.listTurns('pvcfc-customer-service@1.0.0:kernel-pvcfc'),
    ).toHaveLength(2);
  });
});
