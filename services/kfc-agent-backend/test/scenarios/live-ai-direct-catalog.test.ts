import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { OpenAIToolPlanner } from '../../src/llm/toolPlanner.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

const liveRequested = process.env.RUN_LIVE_AI_SCENARIOS === '1';
const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
const openAiModel = process.env.OPENAI_TOOL_PLANNER_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini';

if (liveRequested && !openAiApiKey) {
  describe('live OpenAI direct catalog streaming', () => {
    it('requires OPENAI_API_KEY when RUN_LIVE_AI_SCENARIOS=1', () => {
      throw new Error('Set OPENAI_API_KEY before running the live direct-catalog test');
    });
  });
} else {
  const describeLive = liveRequested ? describe : describe.skip;

  describeLive('live OpenAI direct catalog streaming', () => {
    const servers: Array<ReturnType<typeof buildServer>> = [];
    afterEach(async () => Promise.all(servers.splice(0).map((server) => server.close())));

    it('serves a fixture-backed Pepsi picker through the Pages streaming route', async () => {
      const store = new MemoryStore();
      const deferred: Array<() => Promise<void>> = [];
      const server = buildServer({
        store,
        defer: (task) => deferred.push(task),
        toolPlanner: new OpenAIToolPlanner({ apiKey: openAiApiKey ?? '', model: openAiModel }),
      });
      servers.push(server);

      const started = await server.inject({
        method: 'POST',
        url: '/chat/kfc/runs',
        payload: {
          schemaVersion: 1,
          sessionId: 'kfc:live_streaming_pepsi',
          customerId: 'live_streaming_pepsi',
          clientMessageId: `live_streaming_pepsi_${Date.now()}`,
          input: { kind: 'text', text: 'tôi muốn pepsi' },
        },
      });
      expect(started.statusCode).toBe(202);

      await deferred[0]!();

      const turns = await store.listTurns('kfc:live_streaming_pepsi');
      const assistant = turns.find((turn) => turn.role === 'assistant');
      expect(assistant?.text).not.toContain('cần thêm thông tin');
      expect(assistant?.metadata?.genUi?.widgetKind).toBe('smartMenuPicker');
      expect((assistant?.metadata?.genUi?.data.items as Array<{ name: string }>).slice(0, 3).every(
        (item) => item.name.toLowerCase().startsWith('pepsi'),
      )).toBe(true);
    }, 120_000);

    it('selects the displayed first spicy combo instead of a newly searched candidate', async () => {
      const store = new MemoryStore();
      const sessionId = 'kfc:live_presented_spicy_combo';
      await store.appendEvent(sessionId, 'graph:verified_state', {
        verifiedState: {
          cart: {
            id: 'cart_live_presented_spicy_combo',
            items: [{
              itemCode: '20694',
              name: 'Combo Cơm Gà Rán Solo',
              quantity: 1,
              unitPriceVnd: 56_000,
            }],
            subtotalVnd: 56_000,
            discountVnd: 0,
            deliveryFeeVnd: 0,
            totalVnd: 56_000,
            voucherCode: null,
          },
          menuSearchResults: [{
            code: '20711',
            itemId: '20711',
            productCode: 'GAKHUAYDAO-2',
            category: 'Ưu Đãi',
            name: 'Combo Gà Rôm Rả 245k',
            description: 'Fixture-backed displayed combo',
            priceVnd: 245_000,
            originalPriceVnd: null,
            imageUrl: null,
            available: true,
            hasModifiers: true,
          }],
          toolTrace: [],
        },
      });
      const deferred: Array<() => Promise<void>> = [];
      const server = buildServer({
        store,
        defer: (task) => deferred.push(task),
        toolPlanner: new OpenAIToolPlanner({ apiKey: openAiApiKey ?? '', model: openAiModel }),
      });
      servers.push(server);
      const send = async (text: string, suffix: string) => {
        const started = await server.inject({
          method: 'POST',
          url: '/chat/kfc/runs',
          payload: {
            schemaVersion: 1,
            sessionId,
            customerId: 'live_presented_spicy_combo',
            clientMessageId: `live_presented_spicy_combo_${suffix}_${Date.now()}`,
            input: { kind: 'text', text },
          },
        });
        expect(started.statusCode).toBe(202);
        await deferred.shift()!();
      };

      await send('Lấy combo đầu tiên, gà cay nha', 'select');
      const snapshots = (await store.listEvents(sessionId)).filter((event) => event.sourceType === 'graph:verified_state');
      const verifiedState = (snapshots.at(-1)?.payload as { verifiedState?: {
        cart?: { items?: Array<{ itemCode: string; modifiers?: Array<{ modifierName: string }> }> };
      } }).verifiedState;
      expect(verifiedState?.cart?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          itemCode: '20711',
          modifiers: expect.arrayContaining([
            expect.objectContaining({ modifierName: 'Gà Giòn Cay' }),
          ]),
        }),
      ]));
    }, 180_000);
  });
}
