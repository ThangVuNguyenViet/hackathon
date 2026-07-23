import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { describe, expect, it } from 'vitest';
import {
  createBusinessPackRegistry,
  createPackStateEnvelope,
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

function fakePack(observation: { runCount: number }): BusinessPack<
  string,
  string,
  FakeState
> {
  return {
    ref: fakeRef,
    stateSchemaVersion: '1',
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
