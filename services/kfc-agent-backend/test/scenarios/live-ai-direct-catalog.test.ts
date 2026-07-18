import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { OpenAIToolPlanner } from '../../src/llm/toolPlanner.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestResponseComposer } from '../fixtures/testResponseComposer.js';

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

    it('handles a fixture-backed Pepsi browse request without mutating the cart', async () => {
      const store = new MemoryStore();
      const deferred: Array<() => Promise<void>> = [];
      const server = buildServer({
        store,
        defer: (task) => deferred.push(task),
        toolPlanner: new OpenAIToolPlanner({ apiKey: openAiApiKey ?? '', model: openAiModel }),
        responseComposer: createTestResponseComposer('Bạn muốn chọn loại Pepsi nào?', true),
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
          input: { kind: 'text', text: 'Tìm trong thực đơn các loại Pepsi để tôi xem, không thêm món nào.' },
        },
      });
      expect(started.statusCode).toBe(202);

      await deferred[0]!();

      const turns = await store.listTurns('kfc:live_streaming_pepsi');
      const events = await store.listEvents('kfc:live_streaming_pepsi');
      const assistant = turns.find((turn) => turn.role === 'assistant');
      expect(assistant, JSON.stringify({ turns, events })).toBeDefined();
      expect(assistant!.text).not.toContain('cần thêm thông tin');
      const toolPlan = events.find((event) => event.sourceType === 'llm:tool_plan');
      const proposedCalls = toolPlan?.payload.proposedCalls as Array<{ toolName: string }> | undefined;
      expect(proposedCalls?.some((call) => call.toolName === 'updateCart')).toBe(false);

      const genUi = assistant!.metadata?.genUi;
      if (genUi) {
        expect(genUi.widgetKind, JSON.stringify({ turns, events })).toBe('smartMenuPicker');
        const items = genUi.data.items as Array<{ name: string }>;
        expect(items.slice(0, 3).every(
          (item) => item.name.toLowerCase().startsWith('pepsi'),
        ), JSON.stringify({ items, turns, events })).toBe(true);
      } else {
        expect(assistant!.text.toLowerCase()).toContain('pepsi');
      }
    }, 120_000);
  });
}
