import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { loadBundledPvcfcPublicDataProvider } from '../../src/businesses/pvcfc/public-data/bundledPvcfcPublicDataProvider.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { ScriptedPvcfcChatModel } from '../fixtures/scriptedPvcfcChatModel.js';

const CUSTOMER_PILLS = [
  'Tư vấn phân bón xuống giống',
  'Bón phân lúa theo giai đoạn',
  'Phân bón cho đất phèn mặn',
  'So sánh phân bón trước mua',
  'Chọn phân bón cho cây trồng',
  'Tìm đại lý phân bón',
] as const;

function evidenceTurn(id: string) {
  return new AIMessage({
    content: '',
    tool_calls: [
      {
        id,
        name: 'listPvcfcCollections',
        args: { limit: 2 },
        type: 'tool_call',
      },
    ],
  });
}

describe('PVCFC customer pill local role-play', () => {
  it('runs all six advisory intents through the same provider-first route', async () => {
    const store = new MemoryStore();
    const model = new ScriptedPvcfcChatModel({
      outputs: CUSTOMER_PILLS.flatMap((_, index) => [
        evidenceTurn(`pill-evidence-${index}`),
        new AIMessage(
          'Tôi sẽ tư vấn dựa trên cây trồng, điều kiện canh tác và thông tin sản phẩm công khai.',
        ),
      ]),
    });
    const server = buildServer({
      store,
      pvcfcAgentModel: model,
      pvcfcPublicDataProvider: loadBundledPvcfcPublicDataProvider(),
    });

    const responses = [] as Array<{
      responseText: string;
      assistantTurnId: string;
    }>;
    for (const [index, text] of CUSTOMER_PILLS.entries()) {
      const response = await server.inject({
        method: 'POST',
        url: '/chat/pvcfc/message',
        payload: {
          sessionId: 'pvcfc:customer-pill-roleplay',
          customerId: 'customer-pill-roleplay',
          clientMessageId: `customer-pill-${index}`,
          text,
        },
      });

      expect(response.statusCode, response.body).toBe(200);
      responses.push(response.json());
    }

    expect(responses).toHaveLength(CUSTOMER_PILLS.length);
    expect(model.calls).toHaveLength(CUSTOMER_PILLS.length * 2);
    expect(
      responses.every(
        ({ responseText }) =>
          responseText.length > 0 &&
          !/[#*_`]|\[[^\]]+\]\(https?:\/\//u.test(responseText),
      ),
    ).toBe(true);
    expect(await store.listTurns('pvcfc:customer-pill-roleplay')).toHaveLength(
      CUSTOMER_PILLS.length * 2,
    );
    expect(
      (await store.listEvents('pvcfc:customer-pill-roleplay')).every(
        ({ sourceType }) =>
          sourceType !== 'kfc:genui' && sourceType !== 'kfc:tool_trace',
      ),
    ).toBe(true);
  });
});
