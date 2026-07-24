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
            maxPriceVnd: null,
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
            maxPriceVnd: null,
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
            maxPriceVnd: null,
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
      '"instruction":"Retry with materially corrected or broader arguments',
    );
    const exhaustedToolMessage = model.calls[3]?.messages.at(-1);
    expect(exhaustedToolMessage?.content).toContain('"required":false');
    expect(exhaustedToolMessage?.content).toContain('"exhausted":true');
    expect(exhaustedToolMessage?.content).toContain(
      '"instruction":"Stop retrying and answer honestly from verified evidence.',
    );
  });
});
