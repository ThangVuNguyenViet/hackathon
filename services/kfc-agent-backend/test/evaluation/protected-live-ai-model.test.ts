import { describe, expect, it, vi } from 'vitest';
import {
  assertProtectedLiveAiRequestModel,
  createProtectedLiveAiFetch,
  protectedLiveAiModelManifest,
} from '../../src/evaluation/protectedLiveAiModel.js';

describe('protected live AI model contract', () => {
  it('pins every protected component to one immutable OpenAI model', () => {
    expect(protectedLiveAiModelManifest).toEqual({
      schemaVersion: 1,
      provider: 'openai',
      model: 'gpt-4.1-mini',
      components: ['router', 'planner', 'responseComposer', 'evaluationJudge'],
    });
    expect(Object.isFrozen(protectedLiveAiModelManifest)).toBe(true);
    expect(Object.isFrozen(protectedLiveAiModelManifest.components)).toBe(true);
  });

  it('rejects a request before dispatch when its actual model differs', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const protectedFetch = createProtectedLiveAiFetch(fetchImpl);

    await expect(protectedFetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4.1-nano' }),
    })).rejects.toThrow(
      'Protected live AI request must use gpt-4.1-mini; received gpt-4.1-nano',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('records the verified provider and model for proof metadata', () => {
    expect(assertProtectedLiveAiRequestModel({
      body: JSON.stringify({ model: 'gpt-4.1-mini' }),
    })).toEqual({
      provider: 'openai',
      model: 'gpt-4.1-mini',
    });
  });
});
