import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import {
  createProtectedLiveAiFetch,
  protectedLiveAiModelManifest,
} from '../../src/evaluation/protectedLiveAiModel.js';
import { OpenAIToolPlanner } from '../../src/llm/toolPlanner.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

const liveRequested = process.env.RUN_LIVE_AI_SCENARIOS === '1';
const openAiApiKey = process.env.OPENAI_API_KEY?.trim();

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
        toolPlanner: new OpenAIToolPlanner({
          apiKey: openAiApiKey ?? '',
          model: protectedLiveAiModelManifest.model,
          fetchImpl: createProtectedLiveAiFetch(),
        }),
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
      const events = await store.listEvents('kfc:live_streaming_pepsi');
      const assistant = turns.find((turn) => turn.role === 'assistant');
      expect(assistant?.text).not.toContain('cần thêm thông tin');
      expect(assistant?.metadata?.genUi?.widgetKind, JSON.stringify({ turns, events })).toBe('smartMenuPicker');
      const items = assistant?.metadata?.genUi?.data.items as Array<{ name: string }>;
      expect(items.slice(0, 3).every(
        (item) => item.name.toLowerCase().startsWith('pepsi'),
      ), JSON.stringify({ items, turns, events })).toBe(true);
    }, 120_000);
  });
}
