import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import { FakeStreamingChatModel } from '@langchain/core/utils/testing';
import { describe, expect, it, vi } from 'vitest';
import { resolveAgentModelProfile } from '../../src/config/agentModelProfile.js';
import { runModelCapabilityPreflight } from '../../src/config/modelCapabilityPreflight.js';

describe('runModelCapabilityPreflight', () => {
  it('checks ordinary invocation and a typed tool call through BaseChatModel', async () => {
    const model = new FakeStreamingChatModel({
      sleep: 0,
      responses: [new AIMessage('ordinary invocation works')],
      chunks: [
        new AIMessageChunk({
          content: '',
          tool_calls: [
            {
              name: 'confirm_model_capability',
              args: { capabilityToken: 'typed-tool-ok' },
              id: 'call_preflight',
              type: 'tool_call',
            },
          ],
        }),
      ],
    });

    await expect(
      runModelCapabilityPreflight({
        profile: resolveAgentModelProfile({
          candidateId: 'deepseek-v4-flash',
        }),
        model,
      }),
    ).resolves.toEqual({
      schemaVersion: 'agent-model-capability-preflight-v1',
      identity: {
        candidateId: 'deepseek-v4-flash',
        provider: 'opencode',
        model: 'deepseek-v4-flash',
        profile: 'opencode:deepseek-v4-flash:chat-completions',
        transport: 'openai_compatible_chat',
      },
      ordinaryInvocation: { passed: true },
      typedToolCall: { passed: true },
      passed: true,
    });
  });

  it('returns only sanitized failure codes and never logs model content or errors', async () => {
    const sensitive =
      'OPENCODE_API_KEY=do-not-leak customer-message=also-do-not-leak';
    const model = new FakeStreamingChatModel({
      sleep: 0,
      thrownErrorString: sensitive,
    });
    const consoleSpies = [
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    ];

    const result = await runModelCapabilityPreflight({
      profile: resolveAgentModelProfile({
        candidateId: 'qwen3.7-max',
      }),
      model,
    });

    expect(result).toEqual({
      schemaVersion: 'agent-model-capability-preflight-v1',
      identity: {
        candidateId: 'qwen3.7-max',
        provider: 'opencode',
        model: 'qwen3.7-max',
        profile: 'opencode:qwen3.7-max:anthropic-messages:thinking-disabled',
        transport: 'anthropic_messages',
      },
      ordinaryInvocation: {
        passed: false,
        failure: 'invocation_failed',
      },
      typedToolCall: {
        passed: false,
        failure: 'invocation_failed',
      },
      passed: false,
    });
    expect(JSON.stringify(result)).not.toContain(sensitive);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});
