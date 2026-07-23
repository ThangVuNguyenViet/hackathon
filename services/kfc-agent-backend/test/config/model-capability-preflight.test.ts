import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import { FakeStreamingChatModel } from '@langchain/core/utils/testing';
import { describe, expect, it, vi } from 'vitest';
import { resolveAgentModelProfile } from '../../src/config/agentModelProfile.js';
import {
  checkModelCapabilities,
  runModelCapabilityPreflight,
  type ConfiguredAgentModelBinding,
} from '../../src/config/modelCapabilityPreflight.js';

describe('model capability preflight', () => {
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
      checkModelCapabilities(model),
    ).resolves.toEqual({
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

    const result = await checkModelCapabilities(model);

    expect(result).toEqual({
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

  it('rejects an untrusted identity and model pairing before invocation', async () => {
    const model = new FakeStreamingChatModel({
      sleep: 0,
      responses: [new AIMessage('must not be invoked')],
    });
    const forgedBinding = {
      identity: resolveAgentModelProfile({
        candidateId: 'deepseek-v4-flash',
      }),
      model,
    } as unknown as ConfiguredAgentModelBinding;

    await expect(runModelCapabilityPreflight(forgedBinding)).rejects.toThrow(
      'Untrusted configured agent model binding',
    );
  });
});
