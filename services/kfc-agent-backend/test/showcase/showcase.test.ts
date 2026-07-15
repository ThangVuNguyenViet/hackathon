import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  ShowcaseService,
  ShowcaseValidationError,
  type ShowcaseScenarioSource,
} from '../../src/showcase/showcase.js';

const scenario = {
  id: 'scenario-01',
  title: 'Order lunch',
  goal: 'Complete a small order',
  useCases: ['UC-01'],
  acceptanceCriteria: ['Wait for confirmation'],
  turns: [
    { index: 1, text: 'Cho mình một combo.', useCases: ['UC-01'] },
    { index: 3, text: 'Xác nhận.', useCases: ['UC-01'] },
  ],
};

describe('ShowcaseService', () => {
  it('promotes only a complete fixed-turn replay and preserves it after a failed attempt', async () => {
    const store = new MemoryStore();
    const source: ShowcaseScenarioSource = {
      async listScenarios() { return [scenario]; },
      async traceUrlForSession() { return 'https://smith.langchain.com/trace/example'; },
    };
    const service = new ShowcaseService({
      source,
      store,
      releaseSha: 'abc123',
      plannerModel: 'gpt-4.1',
      responseModel: 'gpt-4.1-nano',
    });
    const completeSession = 'kfc:showcase_scenario_01_text_complete';
    for (const [index, turn] of scenario.turns.entries()) {
      await store.appendTurn({
        sessionId: completeSession,
        channel: 'kfc',
        role: 'user',
        text: turn.text,
        externalMessageId: `user_${index}`,
        externalUserId: 'showcase_scenario_01_text_complete',
        deliveryStatus: 'received',
        metadata: { responseProfile: 'social' },
      });
      await store.appendTurn({
        sessionId: completeSession,
        channel: 'kfc',
        role: 'assistant',
        text: `AI ${index + 1}`,
        externalMessageId: null,
        externalUserId: 'showcase_scenario_01_text_complete',
        deliveryStatus: 'sent',
        metadata: { responseProfile: 'social' },
      });
    }

    const promoted = await service.complete({ scenarioId: scenario.id, mode: 'text', sessionId: completeSession });
    expect(promoted).toMatchObject({ releaseSha: 'abc123', langsmithTraceUrl: 'https://smith.langchain.com/trace/example' });

    const incompleteSession = 'kfc:showcase_scenario_01_text_incomplete';
    await store.appendTurn({
      sessionId: incompleteSession,
      channel: 'kfc',
      role: 'user',
      text: scenario.turns[0]!.text,
      externalMessageId: 'incomplete_1',
      externalUserId: 'showcase_scenario_01_text_incomplete',
      deliveryStatus: 'received',
      metadata: { responseProfile: 'social' },
    });
    await expect(service.complete({ scenarioId: scenario.id, mode: 'text', sessionId: incompleteSession }))
      .rejects.toEqual(expect.objectContaining<Partial<ShowcaseValidationError>>({ code: 'showcase_replay_incomplete' }));
    expect((await service.catalog()).scenarios[0]?.results.text?.sessionId).toBe(completeSession);
  });
});
