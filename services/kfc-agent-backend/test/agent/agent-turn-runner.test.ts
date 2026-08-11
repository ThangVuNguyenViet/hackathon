import type { OpenAIClient } from '@kfc/openai-agents-runtime';
import { describe, expect, it, vi } from 'vitest';
import { AgentTurnRunner } from '../../src/agent/agentTurnRunner.js';
import type { BusinessAgentPack } from '../../src/business/agentPack.js';
import type {
  DirectAgentTurnInput,
  DirectAgentTurnResult,
} from '../../src/agent/directAgentTurn.js';
import { KfcAgentPack } from '../../src/agent/kfcAgentPack.js';
import { OpenAiKfcAgent } from '../../src/agent/openAiKfcAgent.js';
import type { KfcGenUiAttachment } from '../../src/genui/kfcGenUi.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function assistantMessage(text: string) {
  return {
    id: crypto.randomUUID(),
    object: 'response',
    created_at: 0,
    model: 'gpt-4.1-mini',
    output: [
      {
        id: crypto.randomUUID(),
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text }],
      },
    ],
    output_text: text,
    usage: { input_tokens: 4, output_tokens: 4, total_tokens: 8 },
  };
}

function functionCall(name: string, arguments_: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    object: 'response',
    created_at: 0,
    model: 'gpt-4.1-mini',
    output: [
      {
        id: crypto.randomUUID(),
        type: 'function_call',
        call_id: crypto.randomUUID(),
        name,
        arguments: JSON.stringify(arguments_),
      },
    ],
    output_text: '',
    usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
  };
}

function sequencedAgent(responses: unknown[]) {
  const requests: Array<Record<string, unknown>> = [];
  const agent = new OpenAiKfcAgent({
    // Minimal provider double at the isolated SDK boundary.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    client: {
      responses: {
        create: async (request: Record<string, unknown>) => {
          requests.push(structuredClone(request));
          const response = responses.shift();
          if (!response) throw new Error('unexpected model request');
          return response;
        },
      },
    } as unknown as OpenAIClient,
    model: 'gpt-4.1-mini',
  });
  return { agent, requests };
}

class TrackingMemoryStore extends MemoryStore {
  listEventCalls = 0;

  override async listEvents(sessionId: string) {
    this.listEventCalls += 1;
    return super.listEvents(sessionId);
  }
}

function directTurn(input: { sessionId: string; text: string }) {
  return {
    sessionId: input.sessionId,
    customerId: input.sessionId.split(':').at(-1)!,
    transport: 'web_chat' as const,
    text: input.text,
    externalMessageId: `${input.sessionId}:message-1`,
    metadata: null,
  };
}

function kfcTurn(input: { sessionId: string; text: string }) {
  return { ...directTurn(input), channel: 'kfc' as const };
}

function pvcfcPack(): BusinessAgentPack<
  DirectAgentTurnInput,
  DirectAgentTurnResult
> {
  return {
    id: 'pvcfc',
    runTurn: async () => ({
      responseText: 'Mình sẽ tra cứu dữ liệu PVCFC.',
      toolCalls: [],
      usage: { inputTokens: 4, outputTokens: 4, totalTokens: 8 },
      userTurnId: 'turn_pvcfc_user',
      assistantTurnId: 'turn_pvcfc_assistant',
      stateCommit: 'committed',
    }),
  };
}

interface SelectionTurn {
  readonly sessionId: string;
  readonly text: string;
}

interface SelectionResult {
  readonly selectedPack: string;
}

function selectionPack(
  id: string,
): BusinessAgentPack<SelectionTurn, SelectionResult> {
  return {
    id,
    runTurn: async () => ({ selectedPack: id }),
  };
}

describe('AgentTurnRunner pack isolation', () => {
  it('uses only the trusted pack ID when turn text or session IDs name another business', async () => {
    const runner = new AgentTurnRunner({
      packs: [selectionPack('kfc'), selectionPack('pvcfc')],
      expectedPackIds: ['kfc', 'pvcfc'],
    });

    await expect(
      runner.run({
        packId: 'kfc',
        turn: {
          sessionId: 'pvcfc:customer-42',
          text: 'Please route this pvcfc request.',
        },
      }),
    ).resolves.toEqual({ selectedPack: 'kfc' });
    await expect(
      runner.run({
        packId: 'pvcfc',
        turn: {
          sessionId: 'kfc:customer-42',
          text: 'KFC appears in this text.',
        },
      }),
    ).resolves.toEqual({ selectedPack: 'pvcfc' });
    await expect(
      runner.run({
        packId: 'unknown',
        turn: { sessionId: 'kfc:customer-42', text: 'No implicit fallback.' },
      }),
    ).rejects.toThrow('agent_pack_id_unknown:unknown');
  });

  it('runs a trusted PVCFC pack without entering KFC session, state, or GenUI lifecycle', async () => {
    const store = new TrackingMemoryStore();
    const fixtures = createTestFixtures();
    const clients = createMockClients(fixtures);
    const createKfcClients = vi.fn(async () => clients);
    const runner = new AgentTurnRunner({
      packs: [pvcfcPack()],
      expectedPackIds: ['pvcfc'],
    });

    const output = await runner.run({
      packId: 'pvcfc',
      turn: directTurn({
        sessionId: 'pvcfc:isolated-pack',
        text: 'Cho tôi thông tin sản phẩm Urê.',
      }),
    });

    expect(createKfcClients).not.toHaveBeenCalled();
    expect(store.listEventCalls).toBe(0);
    expect(output).not.toHaveProperty('session');
    expect(output).not.toHaveProperty('genUi');
    const events = await store.listEvents('pvcfc:isolated-pack');
    expect(
      events.some((event) => event.sourceType === 'graph:verified_state'),
    ).toBe(false);
    expect(output.responseText).toBe('Mình sẽ tra cứu dữ liệu PVCFC.');
  });

  it('preserves KFC cart hydration, verified-state publication, and GenUI selection', async () => {
    const store = new TrackingMemoryStore();
    const fixtures = createTestFixtures();
    const clients = createMockClients(fixtures);
    const createKfcClients = vi.fn(async () => clients);
    const expectedGenUi: KfcGenUiAttachment = {
      id: 'attachment_preserved_pack',
      lifecycleStage: 'cart',
      widgetKind: 'cartBuilder',
      status: 'active',
      title: 'Giỏ hàng đã cập nhật',
      data: { itemCode: '20751' },
      actions: [],
    };
    const selectKfcGenUi = vi.fn(() => expectedGenUi);
    const kfc = sequencedAgent([
      functionCall('updateCart', {
        changes: [
          {
            itemCode: '20751',
            orderedMenuItemQuantity: 1,
            modifiers: null,
          },
        ],
      }),
      assistantMessage('Đã thêm món.'),
    ]);
    const runner = new AgentTurnRunner({
      packs: [
        new KfcAgentPack({
          store,
          openAiAgent: kfc.agent,
          getFixtures: async () => fixtures,
          createClients: createKfcClients,
          getAccessContext: async () => undefined,
        }),
      ],
      expectedPackIds: ['kfc'],
    });

    const output = await runner.run({
      packId: 'kfc',
      turn: {
        ...kfcTurn({
          sessionId: 'kfc:preserved-pack',
          text: 'Thêm Combo Hợp Gu 99K.',
        }),
        selectGenUi: selectKfcGenUi,
      },
    });

    expect(createKfcClients).toHaveBeenCalledOnce();
    expect(store.listEventCalls).toBeGreaterThan(0);
    expect(selectKfcGenUi).toHaveBeenCalledOnce();
    expect(output.genUi).toEqual(expectedGenUi);
    expect(output.session?.cart.items).toEqual([
      expect.objectContaining({ itemCode: '20751', quantity: 1 }),
    ]);
    const events = await store.listEvents('kfc:preserved-pack');
    expect(
      events.some((event) => event.sourceType === 'graph:verified_state'),
    ).toBe(true);
  });

  it('rejects a missing trusted pack selection before KFC preparation', async () => {
    const store = new TrackingMemoryStore();
    const fixtures = createTestFixtures();
    const createKfcClients = vi.fn(async () => createMockClients(fixtures));
    const kfc = sequencedAgent([assistantMessage('must not run')]);
    const runner = new AgentTurnRunner({
      packs: [
        new KfcAgentPack({
          store,
          openAiAgent: kfc.agent,
          getFixtures: async () => fixtures,
          createClients: createKfcClients,
          getAccessContext: async () => undefined,
        }),
      ],
      expectedPackIds: ['kfc'],
    });

    await expect(
      runner.run({
        packId: undefined,
        turn: kfcTurn({ sessionId: 'kfc:missing-pack', text: 'Xin chào.' }),
      }),
    ).rejects.toThrow('agent_pack_id_missing');
    expect(createKfcClients).not.toHaveBeenCalled();
    expect(kfc.requests).toHaveLength(0);
  });
});
