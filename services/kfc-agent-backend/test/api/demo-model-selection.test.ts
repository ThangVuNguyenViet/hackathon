import { FakeListChatModel } from '@langchain/core/utils/testing';
import { describe, expect, it } from 'vitest';
import { resolveDemoAgentModelBinding } from '../../src/api/demoAgentModelSelection.js';
import { configuredTestAgent } from '../support/configured-agent-model.js';

const openAi = configuredTestAgent(
  new FakeListChatModel({ responses: ['openai'] }),
);
const qwen = configuredTestAgent(
  new FakeListChatModel({ responses: ['qwen'] }),
  'qwen3.7-max',
);

describe('demo model selection', () => {
  it('uses the default only when the request has no explicit candidate', () => {
    expect(
      resolveDemoAgentModelBinding({
        defaultBinding: openAi,
        candidates: { 'qwen3.7-max': qwen },
      }),
    ).toEqual({ ok: true, binding: openAi });
  });

  it('resolves an explicitly configured live candidate without fallback', () => {
    expect(
      resolveDemoAgentModelBinding({
        candidateId: 'qwen3.7-max',
        defaultBinding: openAi,
        candidates: { 'qwen3.7-max': qwen },
      }),
    ).toEqual({ ok: true, binding: qwen });
    expect(
      resolveDemoAgentModelBinding({
        candidateId: 'minimax-m3',
        defaultBinding: openAi,
        candidates: { 'qwen3.7-max': qwen },
      }),
    ).toEqual({
      ok: false,
      status: 503,
      errorCode: 'agent_candidate_unavailable',
    });
  });

  it('rejects identifiers outside the demo roster', () => {
    expect(
      resolveDemoAgentModelBinding({
        candidateId: 'untrusted-model',
        defaultBinding: openAi,
        candidates: { 'qwen3.7-max': qwen },
      }),
    ).toEqual({
      ok: false,
      status: 400,
      errorCode: 'invalid_agent_candidate',
    });
  });
});
