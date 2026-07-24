import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { AIMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { tool } from 'langchain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createBusinessPackRegistry,
  createPackStateEnvelope,
  legacySessionIdOutsidePackNamespace,
  scopePackSessionId,
  type BusinessPack,
  type PackRef,
} from '../../src/runtime/businessPack.js';
import { runSemanticKernel } from '../../src/runtime/kernel.js';

interface FakeState {
  value: string;
}

const fakeRef: PackRef = {
  packId: 'test-pack',
  version: '1.0.0',
};

function fakePack(observation: {
  runCount: number;
}): BusinessPack<string, string, FakeState> {
  return {
    ref: fakeRef,
    stateSchemaVersion: '1',
    scopeInput: (input) => input,
    parseState(value) {
      const candidate = value as { value?: unknown };
      if (typeof candidate.value !== 'string') {
        throw new Error('invalid_fake_state');
      }
      return { value: candidate.value };
    },
    async run(input, invokeModel) {
      observation.runCount += 1;
      const response = await invokeModel({
        model: {} as BaseChatModel,
        systemPrompt: 'neutral test prompt',
        messages: [],
        tools: [],
      });
      return `${input}:${response}`;
    },
  };
}

describe('semantic kernel pack isolation', () => {
  it('keeps delimiter-bearing pack references distinct in the registry', () => {
    const leftRef = { packId: 'vendor', version: '1@x' };
    const rightRef = { packId: 'vendor@1', version: 'x' };
    const left = fakePack({ runCount: 0 });
    const right = fakePack({ runCount: 0 });
    const registry = createBusinessPackRegistry([
      { ...left, ref: leftRef },
      { ...right, ref: rightRef },
    ]);

    expect(registry.resolve(registry.createTrustedBinding(leftRef)).ref).toEqual(
      leftRef,
    );
    expect(
      registry.resolve(registry.createTrustedBinding(rightRef)).ref,
    ).toEqual(rightRef);
  });

  it('frames unrestricted pack session components without delimiter collisions', () => {
    const adversarialTriples = [
      [
        { packId: 'vendor', version: '1:x' },
        'y',
        { packId: 'vendor', version: '1' },
        'x:y',
      ],
      [
        { packId: 'a', version: 'b@c' },
        'd',
        { packId: 'a@b', version: 'c' },
        'd',
      ],
      [
        { packId: '供應商:@', version: '版本:"\\' },
        '會話:👩🏽‍💻',
        { packId: '供應商', version: '@版本:"\\' },
        '會話:👩🏽‍💻',
      ],
      [
        { packId: 'café', version: '1' },
        'é',
        { packId: 'cafe\u0301', version: '1' },
        'e\u0301',
      ],
    ] as const;

    for (const [leftRef, leftSession, rightRef, rightSession] of adversarialTriples) {
      const left = scopePackSessionId(leftRef, leftSession);
      const right = scopePackSessionId(rightRef, rightSession);
      expect(left).toMatch(/^pack:/u);
      expect(right).toMatch(/^pack:/u);
      expect(left).not.toBe(right);
      expect(JSON.parse(left.slice('pack:'.length))).toEqual([
        leftRef.packId,
        leftRef.version,
        leftSession,
      ]);
    }
  });

  it('applies pack-owned session scoping at the trusted kernel boundary', async () => {
    type SessionInput = { sessionId: string };
    const kfcRef = { packId: 'kfc-vietnam', version: '1.0.0' };
    const pvcfcRef = {
      packId: 'pvcfc-customer-service',
      version: '1.0.0',
    };
    const scopedPack = (
      ref: PackRef,
    ): BusinessPack<SessionInput, string, FakeState> & {
      scopeInput(input: SessionInput): SessionInput;
    } => ({
      ref,
      stateSchemaVersion: '1',
      parseState: (value) => value as FakeState,
      scopeInput(input) {
        return {
          ...input,
          sessionId:
            ref.packId === 'kfc-vietnam'
              ? legacySessionIdOutsidePackNamespace(input.sessionId)
              : scopePackSessionId(ref, input.sessionId),
        };
      },
      async run(input) {
        return input.sessionId;
      },
    });
    const registry = createBusinessPackRegistry([
      scopedPack(kfcRef),
      scopedPack(pvcfcRef),
    ]);

    const pvcfcExternalSession = 'shared';
    const craftedKfcExternalSession =
      'pack:pvcfc-customer-service@1.0.0:shared';
    await expect(
      runSemanticKernel({
        registry,
        binding: registry.createTrustedBinding(kfcRef),
        packInput: { sessionId: craftedKfcExternalSession },
      }),
    ).rejects.toThrow('business_pack_session_namespace_reserved');
    await expect(
      runSemanticKernel({
        registry,
        binding: registry.createTrustedBinding(pvcfcRef),
        packInput: { sessionId: pvcfcExternalSession },
      }),
    ).resolves.toBe(
      'pack:["pvcfc-customer-service","1.0.0","shared"]',
    );
  });

  it('runs createAgent with supplied callbacks inside the active invocation context', async () => {
    const observations: string[] = [];
    let active = false;
    const callbacks = [
      BaseCallbackHandler.fromMethods({
        handleChatModelStart() {
          observations.push(active ? 'model:active' : 'model:inactive');
        },
        handleToolStart() {
          observations.push(active ? 'tool:active' : 'tool:inactive');
        },
      }),
    ];
    const model = fakeModel()
      .respondWithTools([
        { name: 'echo', args: { value: 'callback proof' }, id: 'echo-1' },
      ])
      .respond(new AIMessage('callback proof complete'));
    const echo = tool(async ({ value }) => value, {
      name: 'echo',
      description: 'Returns the supplied value',
      schema: z.object({ value: z.string() }),
    });
    const pack: BusinessPack<string, string, FakeState> = {
      ref: fakeRef,
      stateSchemaVersion: '1',
      scopeInput: (input) => input,
      parseState(value) {
        return value as FakeState;
      },
      async run(_input, invokeModel) {
        return invokeModel({
          model,
          systemPrompt: 'Use echo once.',
          messages: [],
          tools: [echo],
          runtime: {
            callbacks,
            async runWithContext(operation) {
              active = true;
              try {
                return await operation();
              } finally {
                active = false;
              }
            },
          },
        });
      },
    };
    const registry = createBusinessPackRegistry([pack]);

    await expect(
      runSemanticKernel({
        registry,
        binding: registry.createTrustedBinding(fakeRef),
        packInput: 'input',
      }),
    ).resolves.toBe('callback proof complete');

    expect(observations).toContain('model:active');
    expect(observations).toContain('tool:active');
    expect(observations).not.toContain('model:inactive');
    expect(observations).not.toContain('tool:inactive');
  });

  it('rejects an untrusted binding before pack or model work', async () => {
    const observation = { runCount: 0 };
    const registry = createBusinessPackRegistry([fakePack(observation)]);

    await expect(
      runSemanticKernel({
        registry,
        binding: {
          ref: fakeRef,
        },
        packInput: 'input',
      }),
    ).rejects.toThrow('pack_binding_untrusted');
    expect(observation.runCount).toBe(0);
  });

  it('does not infer a pack from a foreign registry binding', async () => {
    const observation = { runCount: 0 };
    const pack = fakePack(observation);
    const trustedRegistry = createBusinessPackRegistry([pack]);
    const foreignRegistry = createBusinessPackRegistry([pack]);
    const foreignBinding = foreignRegistry.createTrustedBinding(fakeRef);

    await expect(
      runSemanticKernel({
        registry: trustedRegistry,
        binding: foreignBinding,
        packInput: 'input',
      }),
    ).rejects.toThrow('pack_binding_registry_mismatch');
    expect(observation.runCount).toBe(0);
  });

  it('rejects unknown pack refs while creating the server binding', () => {
    const registry = createBusinessPackRegistry([fakePack({ runCount: 0 })]);

    expect(() =>
      registry.createTrustedBinding({
        packId: 'missing-pack',
        version: '1.0.0',
      }),
    ).toThrow('business_pack_unknown');
  });

  it('rejects cross-pack state before parsing or running the bound pack', async () => {
    const observation = { runCount: 0 };
    let parseCount = 0;
    const pack = fakePack(observation);
    const registry = createBusinessPackRegistry([
      {
        ...pack,
        parseState(value) {
          parseCount += 1;
          return pack.parseState(value);
        },
      },
    ]);
    const binding = registry.createTrustedBinding(fakeRef);
    const stateEnvelope = await createPackStateEnvelope({
      packRef: { packId: 'other-pack', version: '1.0.0' },
      schemaVersion: '1',
      state: { value: 'foreign' },
    });

    await expect(
      runSemanticKernel({
        registry,
        binding,
        packInput: 'input',
        stateEnvelope,
      }),
    ).rejects.toThrow('pack_state_ref_mismatch');
    expect(parseCount).toBe(0);
    expect(observation.runCount).toBe(0);
  });
});
