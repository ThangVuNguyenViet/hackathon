import { describe, expect, it } from 'vitest';
import type { OpenAIClient } from '@kfc/openai-agents-runtime';
import { KfcDirectTurnService } from '../../src/agent/kfcDirectTurnService.js';
import { OpenAiKfcAgent } from '../../src/agent/openAiKfcAgent.js';
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

describe('KfcDirectTurnService', () => {
  it('shares durable SDK history and verified cart state across web and Messenger', async () => {
    const fixtures = createTestFixtures();
    const clients = createMockClients(fixtures);
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
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
      assistantMessage('Giỏ hàng vẫn còn món đã chọn.'),
    ];
    const openAiAgent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async (request: Record<string, unknown>) => {
            requests.push(structuredClone(request));
            const response = responses.shift();
            if (!response) throw new Error('unexpected model request');
            return response;
          },
        },
      // Minimal provider double for the SDK Runner boundary.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      } as unknown as OpenAIClient,
      model: 'gpt-4.1-mini',
    });
    const store = new MemoryStore();
    const service = new KfcDirectTurnService({
      store,
      openAiAgent,
      getFixtures: async () => fixtures,
      createClients: async () => clients,
      getAccessContext: async () => undefined,
    });

    await service.run({
      sessionId: 'kfc:shared-customer',
      customerId: 'shared-customer',
      channel: 'kfc',
      text: 'Thêm Combo Hợp Gu 99K',
      externalMessageId: 'web-1',
      metadata: null,
    });
    const messenger = await service.run({
      sessionId: 'kfc:shared-customer',
      customerId: 'shared-customer',
      channel: 'messenger',
      text: 'Giỏ của tôi còn gì?',
      externalMessageId: 'messenger-1',
      metadata: null,
      clients,
    });

    expect(requests[2]?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user' }),
        expect.objectContaining({ role: 'assistant' }),
        expect.objectContaining({
          role: 'user',
          content: 'Giỏ của tôi còn gì?',
        }),
      ]),
    );
    expect(requests[2]?.instructions).toContain('20751');
    expect(messenger.session.cart.items).toEqual([
      expect.objectContaining({ itemCode: '20751', quantity: 1 }),
    ]);
    await expect(store.listTurns('kfc:shared-customer')).resolves.toHaveLength(
      4,
    );
    const traceEvents = (await store.listEvents('kfc:shared-customer')).filter(
      (event) => event.sourceType === 'openai:tool_trace',
    );
    expect(traceEvents.at(-1)?.payload).toMatchObject({
      schemaVersion: 'openai-redacted-tool-trace-v1',
      run: {
        status: 'success',
        latencyMs: expect.any(Number),
        usage: {
          inputTokens: 4,
          outputTokens: 4,
          totalTokens: 8,
        },
      },
    });
    const auditJson = JSON.stringify(traceEvents);
    expect(auditJson).not.toContain('Giỏ của tôi còn gì');
    expect(auditJson).not.toContain('Thêm Combo Hợp Gu');
  });
});
