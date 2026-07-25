import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { runAgentTurn } from '../../src/agent/kfcAgent.js';
import {
  KFC_AGENT_INSTRUCTIONS,
  kfcVietnamPack,
} from '../../src/businessPacks/kfcVietnam/kfcVietnamPack.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { agentToolDescriptions } from '../../src/ordering/toolCatalog.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { configuredTestAgent } from '../support/configured-agent-model.js';

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

describe('portable Direct SDK behavior retained by the KFC LangChain pack', () => {
  it('keeps the enhanced searchMenu contract and portable evidence boundaries', () => {
    expect(agentToolDescriptions.searchMenu).toContain(
      'complete available menu',
    );
    expect(agentToolDescriptions.searchMenu).toContain('OR semantics');
    expect(agentToolDescriptions.searchMenu).toContain(
      'partySize only as catalog-backed ranking evidence',
    );
    expect(agentToolDescriptions.searchMenu).toContain(
      'retain modifierQueries',
    );
    expect(agentToolDescriptions.searchMenu).toContain(
      'does not prove that the product is absent',
    );
    expect(agentToolDescriptions.searchMenu).toContain(
      'queries empty for category-wide discovery',
    );
    expect(agentToolDescriptions.searchMenu).toContain(
      'never put a generic category request in queries',
    );
    expect(agentToolDescriptions.searchMenu).toContain(
      'omit category for an exact product query',
    );
    expect(agentToolDescriptions.searchMenu).toContain(
      'Always send all eight fields',
    );
    expect(agentToolDescriptions.searchMenu).toContain('minPriceVnd');
    expect(agentToolDescriptions.searchMenu).toContain(
      'maxPriceExclusiveVnd',
    );
    expect(agentToolDescriptions.searchMenu).toContain(
      'copy its exact returned customer-facing name',
    );

    expect(KFC_AGENT_INSTRUCTIONS).toContain(
      'Thiếu dữ liệu không chứng minh một điều là có hoặc không có',
    );
    expect(KFC_AGENT_INSTRUCTIONS).toContain(
      'Giữ từng thuộc tính gắn với đúng món, lựa chọn hoặc nhánh',
    );
    expect(KFC_AGENT_INSTRUCTIONS).toContain(
      'Không để lộ tên công cụ, đối số, schema, dữ liệu nhà cung cấp',
    );
    expect(KFC_AGENT_INSTRUCTIONS).toContain(
      'không lặp lại cùng đối số sau một lỗi có thể phục hồi',
    );
    expect(KFC_AGENT_INSTRUCTIONS).toContain(
      'Trả lời từng phần quan trọng trong yêu cầu mới nhất',
    );
    expect(KFC_AGENT_INSTRUCTIONS).toContain(
      'lần đọc thất bại ảnh hưởng đến câu trả lời',
    );
    expect(KFC_AGENT_INSTRUCTIONS).toContain(
      'preserve that exact product across later turns',
    );
    expect(KFC_AGENT_INSTRUCTIONS).toContain(
      'Treat a requested drink, side, or other extra as a separate add-on',
    );
    expect(KFC_AGENT_INSTRUCTIONS).toContain(
      'Do not substitute another product merely because a combined search is empty',
    );
    expect(KFC_AGENT_INSTRUCTIONS).toContain(
      'When a read result says recovery is required, make another corrected tool call before answering',
    );
    expect(KFC_AGENT_INSTRUCTIONS).toContain(
      'do not answer as if a dropped modifier requirement matched',
    );

    expect(agentToolDescriptions.getModifierOptions).toContain(
      'Do not transfer evidence between options, branches, or items',
    );
    expect(agentToolDescriptions.recommendAddOns).toContain(
      'does not prove that item is absent from the full menu',
    );
    expect(agentToolDescriptions.findStores).toContain(
      'does not verify delivery coverage, fee, ETA, or item serviceability',
    );
    expect(agentToolDescriptions.findStores).toContain(
      'does not prove that no KFC store exists',
    );
    expect(agentToolDescriptions.findStores).toContain(
      'Treat each returned row only as evidence for its own address',
    );
    expect(agentToolDescriptions.findStores).toContain(
      'do not prove either a matching store or exhaustive absence',
    );
    expect(agentToolDescriptions.findStores).toContain(
      'does not verify inventory or capacity',
    );
    expect(agentToolDescriptions.checkStoreAvailability).toContain(
      'does not verify delivery fee or ETA',
    );
    expect(agentToolDescriptions.listPaymentMethods).toContain(
      'exact supported methodId',
    );
    expect(agentToolDescriptions.handoff).toContain(
      'queued and awaiting a human',
    );
    expect(agentToolDescriptions.handoff).toContain(
      'does not mean a human accepted or joined',
    );
    expect(agentToolDescriptions.handoff).toContain(
      'preserve relevant customer consent and action-authority constraints',
    );
    expect(agentToolDescriptions.handoff).toContain(
      'Never use handoff merely because a cart proposal still needs GenUI confirmation',
    );
    expect(agentToolDescriptions.handoff).toContain(
      'prepare the verified proposal for customer confirmation instead',
    );
  });

  it('reuses one queued handoff and publishes only its verified boundary', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const baseClients = createMockClients(fixtures);
    const escalateToHuman = vi.fn(
      baseClients.handoff.escalateToHuman.bind(baseClients.handoff),
    );
    const clients = {
      ...baseClients,
      handoff: {
        ...baseClients.handoff,
        escalateToHuman,
      },
    };
    const store = new MemoryStore();
    const baseInput = {
      sessionId: 'session-kfc-direct-handoff-parity',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      clients,
      store,
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent({} as BaseChatModel),
      conversationContext: {
        tokenBudget: 8_192,
        countTokens: async (text: string) => Math.max(1, text.length),
      },
    };

    const output = await kfcVietnamPack.run(
      {
        ...baseInput,
        text: 'Cho tôi gặp nhân viên',
      },
      async ({ tools }) => {
        const handoff = tools.find((candidate) => candidate.name === 'handoff');
        if (!handoff) throw new Error('Missing handoff');
        const invoke = async (id: string) =>
          JSON.parse(
            toolOutputText(
              await handoff.invoke({
                type: 'tool_call',
                name: 'handoff',
                args: { reasons: ['customer_requested'] },
                id,
              }),
            ),
          ) as {
            ok: boolean;
            value: { escalationId: string };
        };
        const first = await invoke('handoff-1');
        const second = await invoke('handoff-2');
        expect(second.value.escalationId).toBe(first.value.escalationId);
        return 'Nhân viên đã tham gia và sẽ trả lời bạn trong vài phút.';
      },
    );

    expect(escalateToHuman).toHaveBeenCalledTimes(1);
    expect(output.responseText).toBe(
      'Yêu cầu gặp nhân viên của bạn đã được ghi nhận và đang chờ nhân viên tiếp nhận. Hiện chưa có thời gian phản hồi được xác minh.',
    );
    expect((await store.listTurns(baseInput.sessionId)).at(-1)?.text).toBe(
      output.responseText,
    );

    await kfcVietnamPack.run(
      {
        ...baseInput,
        text: 'Tình trạng hỗ trợ thế nào?',
      },
      async ({ systemPrompt }) => {
        expect(systemPrompt).toContain(
          '"humanSupport":{"status":"queued","description":"awaiting a human operator"',
        );
        expect(systemPrompt).not.toContain('escalationId');
        return 'Yêu cầu của bạn vẫn đang chờ nhân viên tiếp nhận.';
      },
    );
  });

  it('publishes the exact returned variant label instead of a reconstructed synonym', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());

    const output = await kfcVietnamPack.run(
      {
        sessionId: 'session-kfc-exact-variant-label',
        customerId: 'customer-1',
        channel: 'kfc',
        text: 'Tìm Pepsi không đường mã 41085',
        clients: createMockClients(fixtures),
        store: new MemoryStore(),
        dashboard: new DashboardEventBus(),
        agentModelBinding: configuredTestAgent({} as BaseChatModel),
      },
      async ({ tools }) => {
        const search = tools.find(
          (candidate) => candidate.name === 'searchMenu',
        );
        if (!search) throw new Error('Missing searchMenu');
        await search.invoke({
          type: 'tool_call',
          name: 'searchMenu',
          args: {
            mode: 'search',
            queries: ['41085'],
            category: null,
            minPriceVnd: null,
            maxPriceVnd: null,
            maxPriceExclusiveVnd: null,
            partySize: null,
            modifierQueries: [],
          },
          id: 'exact-variant-search',
        });
        return 'Mình tìm thấy Pepsi Không Đường (Lớn).';
      },
    );

    expect(output.responseText).toContain('Pepsi Không Đường (Đại)');
    expect(output.responseText).not.toContain('Pepsi Không Đường (Lớn)');
  });

  it('supplies materially changed recovery after an empty safe read', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const baseClients = createMockClients(fixtures);
    const context = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 60_000,
    };
    const existing = await baseClients.menu.searchMenu('', context);
    if (!existing.ok || !existing.value) {
      throw new Error('Expected fixture menu');
    }
    const existingMenu = existing.value;
    const clients = {
      ...baseClients,
      menu: {
        ...baseClients.menu,
        async searchMenu() {
          return {
            ok: true as const,
            value: {
              ...existingMenu,
              items: [],
              total: 0,
              returned: 0,
              complete: true,
              cursor: undefined,
              scope: existingMenu.scope,
            },
            message: 'No matching menu items',
          };
        },
      },
    };
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'searchMenu',
          args: {
            mode: 'search',
            queries: ['không tồn tại'],
            category: null,
            minPriceVnd: null,
            maxPriceVnd: null,
            maxPriceExclusiveVnd: null,
            partySize: null,
            modifierQueries: [],
          },
          id: 'empty-search',
        },
      ])
      .respondWithTools([
        {
          name: 'searchMenu',
          args: {
            mode: 'search',
            queries: ['vẫn không tồn tại'],
            category: null,
            minPriceVnd: null,
            maxPriceVnd: null,
            maxPriceExclusiveVnd: null,
            partySize: null,
            modifierQueries: [],
          },
          id: 'empty-search-2',
        },
      ])
      .respondWithTools([
        {
          name: 'searchMenu',
          args: {
            mode: 'full',
            queries: [],
            category: null,
            minPriceVnd: null,
            maxPriceVnd: null,
            maxPriceExclusiveVnd: null,
            partySize: null,
            modifierQueries: [],
          },
          id: 'empty-search-3',
        },
      ])
      .respond(new AIMessage('Không tìm thấy kết quả đã xác minh.'));

    await runAgentTurn({
      sessionId: 'session-kfc-empty-read-recovery',
      customerId: 'customer-1',
      channel: 'kfc',
      text: 'Tìm món không tồn tại',
      clients,
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent(model),
    });

    expect(model.callCount).toBe(4);
    const toolMessage = model.calls[1]?.messages.at(-1);
    expect(toolMessage?.content).toContain('"recovery"');
    expect(toolMessage?.content).toContain(
      '"instruction":"You must make another corrected read call before answering the customer. Retry searchMenu with materially corrected arguments',
    );
    expect(toolMessage?.content).toContain(
      'broaden only the product terms while retaining modifierQueries',
    );
    expect(toolMessage?.content).toContain(
      'An empty constrained result does not prove that the product is absent',
    );
    expect(toolMessage?.content).toContain(
      'For a category-wide request, use category with an empty queries array',
    );
    expect(toolMessage?.content).toContain(
      'An unconstrained exact-product search may verify that the product exists',
    );
    expect(toolMessage?.content).toContain(
      'You must make another corrected read call before answering the customer',
    );
    const exhaustedToolMessage = model.calls[3]?.messages.at(-1);
    expect(exhaustedToolMessage?.content).toContain('"required":false');
    expect(exhaustedToolMessage?.content).toContain('"exhausted":true');
    expect(exhaustedToolMessage?.content).toContain(
      '"instruction":"Stop retrying and answer honestly from verified evidence.',
    );
  });
});
