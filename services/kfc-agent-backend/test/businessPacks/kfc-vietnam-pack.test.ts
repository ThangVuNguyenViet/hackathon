import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { describe, expect, it } from 'vitest';
import {
  KFC_AGENT_INSTRUCTIONS,
  kfcVietnamPack,
} from '../../src/businessPacks/kfcVietnam/kfcVietnamPack.js';
import { runAgentTurn } from '../../src/agent/kfcAgent.js';
import { buildVerifiedStateSnapshot } from '../../src/agent/verifiedState.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  createPackStateEnvelope,
  validatePackStateEnvelope,
} from '../../src/runtime/businessPack.js';

describe('KFC Vietnam business pack compatibility', () => {
  it('rejects correctly bound malformed KFC state and accepts a valid partial state', async () => {
    const malformed = await createPackStateEnvelope({
      packRef: kfcVietnamPack.ref,
      schemaVersion: kfcVietnamPack.stateSchemaVersion,
      state: { cart: 'corrupt' },
    });
    const valid = await createPackStateEnvelope({
      packRef: kfcVietnamPack.ref,
      schemaVersion: kfcVietnamPack.stateSchemaVersion,
      state: {
        cart: {
          id: 'cart-1',
          items: [],
          subtotalVnd: 0,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 0,
          voucherCode: null,
        },
      },
    });
    const unknownShape = await createPackStateEnvelope({
      packRef: kfcVietnamPack.ref,
      schemaVersion: kfcVietnamPack.stateSchemaVersion,
      state: { unrecognizedAuthority: {} },
    });

    await expect(
      validatePackStateEnvelope(malformed, {
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        parseState: kfcVietnamPack.parseState,
      }),
    ).rejects.toThrow('kfc_pack_state_invalid');
    await expect(
      validatePackStateEnvelope(valid, {
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        parseState: kfcVietnamPack.parseState,
      }),
    ).resolves.toEqual(valid.state);
    await expect(
      validatePackStateEnvelope(unknownShape, {
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        parseState: kfcVietnamPack.parseState,
      }),
    ).rejects.toThrow('kfc_pack_state_invalid');
  });

  it('preserves the KFC prompt, tools, verified-state snapshot, and final presentation', async () => {
    const store = new MemoryStore();
    const input = {
      sessionId: 'session-kfc-pack',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: 'Cho tôi xem thực đơn',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store,
      dashboard: new DashboardEventBus(),
      agentModel: {} as BaseChatModel,
    };

    const output = await kfcVietnamPack.run(
      input,
      async ({ model, systemPrompt, messages, tools }) => {
        expect(model).toBe(input.agentModel);
        expect(systemPrompt).toContain(KFC_AGENT_INSTRUCTIONS);
        expect(messages.at(-1)?.content).toBe(input.text);
        expect(tools.map((tool) => tool.name)).toContain('searchMenu');
        return 'Đây là thực đơn KFC.';
      },
    );

    expect(output.responseText).toBe('Đây là thực đơn KFC.');
    expect(output.presentation).toMatchObject({
      profile: 'genui',
      text: 'Đây là thực đơn KFC.',
    });
    expect((await store.listTurns(input.sessionId)).map((turn) => turn.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(
      (await store.listEvents(input.sessionId)).map((event) => event.sourceType),
    ).toContain('agent:verified_state');
    expect(
      (await store.listEvents(input.sessionId)).some((event) =>
        event.sourceType.startsWith('pack:'),
      ),
    ).toBe(false);
    expect(() =>
      kfcVietnamPack.parseState(buildVerifiedStateSnapshot(output.state)),
    ).not.toThrow();
  });

  it('keeps runAgentTurn as a compatibility facade over the in-process kernel', async () => {
    const store = new MemoryStore();
    const output = await runAgentTurn({
      sessionId: 'session-kfc-facade',
      customerId: 'customer-1',
      channel: 'messenger_mock',
      text: 'Xin chào',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store,
      dashboard: new DashboardEventBus(),
      agentModel: new FakeListChatModel({
        responses: ['Xin chào! Tôi có thể giúp gì cho bạn?'],
      }),
    });

    expect(output.responseText).toBe('Xin chào! Tôi có thể giúp gì cho bạn?');
    expect(output.presentation.profile).toBe('social');
    expect((await store.listTurns('session-kfc-facade')).at(-1)).toMatchObject({
      role: 'assistant',
      text: output.responseText,
    });
  });

  it('preserves the KFC empty-model-response error contract', async () => {
    await expect(
      runAgentTurn({
        sessionId: 'session-kfc-empty-response',
        customerId: 'customer-1',
        channel: 'messenger_mock',
        text: 'Xin chào',
        clients: createMockClients(
          await loadGeneratedFixtures(process.cwd()),
        ),
        store: new MemoryStore(),
        dashboard: new DashboardEventBus(),
        agentModel: new FakeListChatModel({ responses: ['   '] }),
      }),
    ).rejects.toThrow('kfc_agent_model_response_empty');
  });
});
