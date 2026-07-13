import { describe, expect, it } from 'vitest';
import { smallTalkRouterEvalCases } from '../../src/evaluation/smallTalkRouterEvalCases.js';
import { OpenAISmallTalkRouter } from '../../src/llm/smallTalkRouter.js';

const liveRequested = process.env.RUN_LIVE_SMALL_TALK_ROUTER === '1';
const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
const openAiModel = process.env.OPENAI_SMALL_TALK_ROUTER_MODEL?.trim() || 'gpt-4.1-mini';
const openAiEvalTimeoutMs = Number(process.env.OPENAI_SMALL_TALK_ROUTER_EVAL_TIMEOUT_MS ?? '10000');

if (!Number.isInteger(openAiEvalTimeoutMs) || openAiEvalTimeoutMs < 1) {
  throw new Error('OPENAI_SMALL_TALK_ROUTER_EVAL_TIMEOUT_MS must be a positive integer');
}

if (liveRequested && !openAiApiKey) {
  describe('live OpenAI small-talk router evaluation', () => {
    it('requires OPENAI_API_KEY when RUN_LIVE_SMALL_TALK_ROUTER=1', () => {
      throw new Error('Set OPENAI_API_KEY before running npm run test:live:small-talk-router');
    });
  });
} else {
  const describeLive = liveRequested ? describe : describe.skip;

  describeLive('live OpenAI small-talk router evaluation', () => {
    it.each(smallTalkRouterEvalCases)('$id returns $expected', async (evaluationCase) => {
      const router = new OpenAISmallTalkRouter({
        apiKey: openAiApiKey ?? '',
        model: openAiModel,
        timeoutMs: openAiEvalTimeoutMs,
      });

      const result = await router.route({
        latestUserMessage: evaluationCase.text,
        channel: 'kfc',
        hasStructuredAction: false,
      });

      expect(result.decision).toBe(evaluationCase.expected);
      if (result.decision === 'handle_social') {
        expect(result.responseText.trim()).not.toBe('');
      }
    }, openAiEvalTimeoutMs + 2_000);
  });
}
