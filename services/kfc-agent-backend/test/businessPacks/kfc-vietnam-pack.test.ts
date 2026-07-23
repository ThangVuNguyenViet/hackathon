import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { describe, expect, it } from 'vitest';
import {
  KFC_AGENT_INSTRUCTIONS,
  kfcVietnamPack,
} from '../../src/businessPacks/kfcVietnam/kfcVietnamPack.js';
import { runAgentTurn } from '../../src/agent/kfcAgent.js';
import { buildVerifiedStateSnapshot } from '../../src/agent/verifiedState.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  createPackStateEnvelope,
  validatePackStateEnvelope,
} from '../../src/runtime/businessPack.js';

function toolOutputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'content' in value &&
    typeof value.content === 'string'
  ) {
    return value.content;
  }
  throw new Error('Unexpected tool output');
}

describe('KFC Vietnam business pack compatibility', () => {
  it('rejects correctly bound malformed KFC state and accepts a valid partial state', async () => {
    const malformed = await createPackStateEnvelope({
      packRef: kfcVietnamPack.ref,
      schemaVersion: kfcVietnamPack.stateSchemaVersion,
      state: { cart: 'corrupt' },
    });
    const valid = await createPackStateEnvelope({
      packRef: kfcVietnamPack.ref,
      schemaVersion: kfcVietnamPack.stateSchemaVersion,
      state: {
        cart: {
          id: 'cart-1',
          items: [],
          subtotalVnd: 0,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 0,
          voucherCode: null,
        },
      },
    });
    const unknownShape = await createPackStateEnvelope({
      packRef: kfcVietnamPack.ref,
      schemaVersion: kfcVietnamPack.stateSchemaVersion,
      state: { unrecognizedAuthority: {} },
    });

    await expect(
      validatePackStateEnvelope(malformed, {
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        parseState: kfcVietnamPack.parseState,
      }),
    ).rejects.toThrow('kfc_pack_state_invalid');
    await expect(
      validatePackStateEnvelope(valid, {
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        parseState: kfcVietnamPack.parseState,
      }),
    ).resolves.toEqual(valid.state);
    await expect(
      validatePackStateEnvelope(unknownShape, {
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        parseState: kfcVietnamPack.parseState,
      }),
    ).rejects.toThrow('kfc_pack_state_invalid');
  });

  it('preserves the KFC prompt, tools, verified-state snapshot, and final presentation', async () => {
    const store = new MemoryStore();
    const input = {
      sessionId: 'session-kfc-pack',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: 'Cho tôi xem thực đơn',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store,
      dashboard: new DashboardEventBus(),
      agentModel: {} as BaseChatModel,
    };

    const output = await kfcVietnamPack.run(
      input,
      async ({ model, systemPrompt, messages, tools }) => {
        expect(model).toBe(input.agentModel);
        expect(systemPrompt).toContain(KFC_AGENT_INSTRUCTIONS);
        expect(messages.at(-1)?.content).toBe(input.text);
        expect(tools.map((tool) => tool.name)).toContain('searchMenu');
        return 'Đây là thực đơn KFC.';
      },
    );

    expect(output.responseText).toBe('Đây là thực đơn KFC.');
    expect(output.presentation).toMatchObject({
      profile: 'genui',
      text: 'Đây là thực đơn KFC.',
    });
    expect(
      (await store.listTurns(input.sessionId)).map((turn) => turn.role),
    ).toEqual(['user', 'assistant']);
    expect(
      (await store.listEvents(input.sessionId)).map(
        (event) => event.sourceType,
      ),
    ).toContain('agent:verified_state');
    expect(
      (await store.listEvents(input.sessionId)).some((event) =>
        event.sourceType.startsWith('pack:'),
      ),
    ).toBe(false);
    expect(() =>
      kfcVietnamPack.parseState(buildVerifiedStateSnapshot(output.state)),
    ).not.toThrow();
  });

  it('keeps runAgentTurn as a compatibility facade over the in-process kernel', async () => {
    const store = new MemoryStore();
    const output = await runAgentTurn({
      sessionId: 'session-kfc-facade',
      customerId: 'customer-1',
      channel: 'messenger_mock',
      text: 'Xin chào',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store,
      dashboard: new DashboardEventBus(),
      agentModel: new FakeListChatModel({
        responses: ['Xin chào! Tôi có thể giúp gì cho bạn?'],
      }),
    });

    expect(output.responseText).toBe('Xin chào! Tôi có thể giúp gì cho bạn?');
    expect(output.presentation.profile).toBe('social');
    expect((await store.listTurns('session-kfc-facade')).at(-1)).toMatchObject({
      role: 'assistant',
      text: output.responseText,
    });
  });

  it('supports multiple complete menu reads and one authoritative batched cart update in the same tool loop', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const baseClients = createMockClients(fixtures);
    const cartCalls: Array<{
      priorCartId: string;
      changes: Array<{ itemCode: string; quantity: number }>;
    }> = [];
    const clients = {
      ...baseClients,
      cart: {
        ...baseClients.cart,
        async applyChanges(
          cart: Parameters<typeof baseClients.cart.applyChanges>[0],
          changes: Parameters<typeof baseClients.cart.applyChanges>[1],
          context: Parameters<typeof baseClients.cart.applyChanges>[2],
        ) {
          cartCalls.push({
            priorCartId: cart.id,
            changes: changes.map(({ itemCode, quantity }) => ({
              itemCode,
              quantity,
            })),
          });
          return baseClients.cart.applyChanges(cart, changes, context);
        },
      },
    };
    const store = new MemoryStore();
    const input = {
      sessionId: 'session-kfc-tool-lifecycle',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: 'Lập giúp tôi một giỏ hàng',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      agentModel: {} as BaseChatModel,
    };
    let authoritativeCart: unknown;

    const output = await kfcVietnamPack.run(input, async ({ tools }) => {
      const invoke = async (
        name: string,
        args: Record<string, unknown>,
        id: string,
      ) => {
        const selected = tools.find((candidate) => candidate.name === name);
        if (!selected) throw new Error(`Missing tool ${name}`);
        return JSON.parse(
          toolOutputText(
            await selected.invoke({
              type: 'tool_call',
              name,
              args,
              id,
            }),
          ),
        ) as Record<string, unknown>;
      };

      const firstSearch = await invoke(
        'searchMenu',
        {
          mode: 'search',
          queries: ['20751', '20752'],
          category: null,
          maxPriceVnd: null,
          partySize: null,
          modifierQueries: [],
        },
        'search-1',
      );
      const secondSearch = await invoke(
        'searchMenu',
        {
          mode: 'search',
          queries: ['gà'],
          category: null,
          maxPriceVnd: null,
          partySize: null,
          modifierQueries: ['không cay'],
        },
        'search-2',
      );
      const cartResult = await invoke(
        'updateCart',
        {
          changes: [
            { itemCode: '20751', quantity: 1, modifiers: [] },
            { itemCode: '20752', quantity: 2, modifiers: [] },
          ],
        },
        'cart-1',
      );
      authoritativeCart = cartResult.value as
        Record<string, unknown> | undefined;

      expect(firstSearch.value).toMatchObject({
        returned: 2,
        total: 2,
        complete: true,
      });
      expect(secondSearch.value).toMatchObject({
        complete: true,
      });
      expect(
        (secondSearch.value as { returned: number }).returned,
      ).toBeGreaterThan(0);
      return 'Đã cập nhật giỏ hàng.';
    });

    expect(cartCalls).toEqual([
      {
        priorCartId: 'cart_session-kfc-tool-lifecycle',
        changes: [
          { itemCode: '20751', quantity: 1 },
          { itemCode: '20752', quantity: 2 },
        ],
      },
    ]);
    expect(output.state.cart).toEqual(authoritativeCart);
    expect(
      Object.keys(output.state.verifiedCollections?.searchMenu ?? {}),
    ).toHaveLength(2);
    expect(() =>
      kfcVietnamPack.parseState(buildVerifiedStateSnapshot(output.state)),
    ).not.toThrow();
  });

  it('preserves an upstream incomplete menu collection in KFC verified state', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const baseClients = createMockClients(fixtures);
    const context = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 60_000,
    };
    const upstream = await baseClients.menu.searchMenu('', context);
    if (!upstream.ok || !upstream.value) {
      throw new Error('Expected fixture menu');
    }
    const partialCollection = {
      items: upstream.value.items.slice(0, 2),
      total: upstream.value.total,
      returned: 2,
      complete: false,
      scope: { scope: 'all' as const },
      cursor: 'menu-page-2',
    };
    const clients = {
      ...baseClients,
      menu: {
        ...baseClients.menu,
        async searchMenu() {
          return {
            ok: true as const,
            value: partialCollection,
            message: 'partial_menu',
          };
        },
      },
    };

    const output = await kfcVietnamPack.run(
      {
        sessionId: 'session-kfc-partial-menu',
        customerId: 'customer-1',
        channel: 'kfc',
        text: 'Cho tôi xem thực đơn',
        clients,
        store: new MemoryStore(),
        dashboard: new DashboardEventBus(),
        agentModel: {} as BaseChatModel,
      },
      async ({ tools }) => {
        const search = tools.find(
          (candidate) => candidate.name === 'searchMenu',
        );
        if (!search) throw new Error('Missing searchMenu');
        const result = JSON.parse(
          toolOutputText(
            await search.invoke({
              type: 'tool_call',
              name: 'searchMenu',
              args: {
                mode: 'full',
                queries: [],
                category: null,
                maxPriceVnd: null,
                partySize: null,
                modifierQueries: [],
              },
              id: 'partial-search',
            }),
          ),
        ) as {
          value: {
            total: number;
            returned: number;
            complete: boolean;
            cursor?: string;
          };
        };
        expect(result.value).toMatchObject({
          total: partialCollection.total,
          returned: 2,
          complete: false,
          cursor: 'menu-page-2',
        });
        return 'Đây là phần dữ liệu thực đơn hiện có.';
      },
    );

    expect(output.state.activeMenuCollection?.result).toMatchObject({
      total: partialCollection.total,
      returned: 2,
      complete: false,
      cursor: 'menu-page-2',
    });
    expect(() =>
      kfcVietnamPack.parseState(buildVerifiedStateSnapshot(output.state)),
    ).not.toThrow();
  });

  it('preserves the KFC empty-model-response error contract', async () => {
    await expect(
      runAgentTurn({
        sessionId: 'session-kfc-empty-response',
        customerId: 'customer-1',
        channel: 'messenger_mock',
        text: 'Xin chào',
        clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
        store: new MemoryStore(),
        dashboard: new DashboardEventBus(),
        agentModel: new FakeListChatModel({ responses: ['   '] }),
      }),
    ).rejects.toThrow('kfc_agent_model_response_empty');
  });
});
