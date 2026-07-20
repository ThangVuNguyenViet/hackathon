import { AIMessage } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import {
  modelPresentationContext,
} from '../../src/agent/agentPresentationContext.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { customerCommandFromVerifiedAction } from '../../src/domain/customerCommand.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseModelReply,
  groundedResponseVerifierModel,
} from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function menuModel(response: string) {
  return fakeModel()
    .respondWithTools([{
      name: 'searchMenu',
      args: { scope: 'filtered', query: 'combo' },
      id: 'profile-menu-search',
    }])
    .respond(groundedResponseModelReply({
      customerText: response,
      evidenceReferences: [{
        evidenceId: 'menu_search_results',
        claimKinds: ['product', 'price'],
      }],
    }));
}

function independentMenuVerifier() {
  const verifier = groundedResponseVerifierModel({
    evidenceReferences: [{
      evidenceId: 'menu_search_results',
      claimKinds: ['product', 'price'],
    }],
  });
  const verify = vi.fn();
  const model = fakeModel();
  vi.spyOn(model, 'withStructuredOutput').mockImplementation(
    (schema, config) => {
      const runnable = verifier.withStructuredOutput(schema, config);
      return RunnableLambda.from(async (
        raw: Parameters<typeof runnable.invoke>[0],
      ) => {
        verify(raw);
        return runnable.invoke(raw);
      });
    },
  );
  return { model, verify };
}

function recordedPrompts(model: ReturnType<typeof fakeModel>): string[] {
  return model.calls.map((call) =>
    call.messages.map((message) => message.text).join('\n'));
}

function normalizePresentationMode(prompt: string): string {
  return prompt
    .replaceAll('structured_companion', 'presentation_mode')
    .replaceAll('standalone_text', 'presentation_mode')
    // Publication authority is intentionally bound to each distinct session
    // and customer surface. Compare semantic prompt shape, not those exact
    // cryptographic identities.
    .replace(/[0-9a-f]{64}/gu, 'cryptographic_digest');
}

describe('response profile isolation', () => {
  it('keeps verified outcomes equivalent while presentations stay channel-specific', async () => {
    const fixtures = createTestFixtures();
    const kfcStore = new MemoryStore();
    const socialStore = new MemoryStore();
    const kfcModel = menuModel('Choose from the verified menu.');
    const socialModel = menuModel('Combo Hợp Gu 99K costs 99,000 VND.');
    const kfcVerifier = independentMenuVerifier();
    const socialVerifier = independentMenuVerifier();

    const kfc = await runAgentTurn({
      sessionId: 'kfc:profile-parity',
      customerId: 'profile-parity',
      channel: 'kfc',
      text: 'Show me a combo',
      externalMessageId: 'kfc-profile-message',
      clients: createMockClients(fixtures),
      store: kfcStore,
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: kfcModel,
      responseVerifierModel: kfcVerifier.model,
    });
    const social = await runAgentTurn({
      sessionId: 'messenger:profile-parity',
      customerId: 'profile-parity',
      channel: 'messenger',
      text: 'Show me a combo',
      externalMessageId: 'social-profile-message',
      clients: createMockClients(fixtures),
      store: socialStore,
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: socialModel,
      responseVerifierModel: socialVerifier.model,
    });

    expect(kfcVerifier.model).not.toBe(kfcModel);
    expect(socialVerifier.model).not.toBe(socialModel);
    expect(kfcVerifier.verify).toHaveBeenCalledTimes(1);
    expect(socialVerifier.verify).toHaveBeenCalledTimes(1);
    expect(kfc.state.menuSearchResults).toEqual(social.state.menuSearchResults);
    expect(kfc.state.toolTrace?.map((entry) => entry.toolName)).toEqual([
      'searchMenu',
    ]);
    expect(social.state.toolTrace?.map((entry) => entry.toolName)).toEqual([
      'searchMenu',
    ]);
    const kfcPrompts = recordedPrompts(kfcModel);
    const socialPrompts = recordedPrompts(socialModel);
    expect(kfcPrompts).toHaveLength(2);
    expect(socialPrompts).toHaveLength(2);
    expect(kfcPrompts.join('\n')).toContain(
      modelPresentationContext({ channel: 'kfc' }),
    );
    expect(socialPrompts.join('\n')).toContain(
      modelPresentationContext({ channel: 'messenger' }),
    );
    expect(kfcPrompts.map(normalizePresentationMode)).toEqual(
      socialPrompts.map(normalizePresentationMode),
    );
    expect(kfcPrompts.join('\n')).not.toContain('"channel"');
    expect(socialPrompts.join('\n')).not.toContain('"channel"');
    expect(kfc.presentation.profile).toBe('genui');
    expect(kfc.genUi?.widgetKind).toBe('smartMenuPicker');
    expect(social.presentation.profile).toBe('social');
    expect(social.genUi).toBeUndefined();
    expect(
      (await socialStore.listTurns('messenger:profile-parity')).at(-1)
        ?.metadata?.genUi,
    ).toBeUndefined();
  });

  it('rejects a session that attempts to cross response profiles', async () => {
    const store = new MemoryStore();
    await store.appendTurn({
      sessionId: 'shared-profile-session',
      channel: 'kfc',
      role: 'user',
      text: 'hello',
      externalMessageId: 'kfc-profile-1',
      externalUserId: 'customer',
      deliveryStatus: 'received',
      metadata: null,
    });
    const model = fakeModel().respond(new AIMessage('must not be used'));

    await expect(runAgentTurn({
      sessionId: 'shared-profile-session',
      customerId: 'customer',
      channel: 'messenger',
      text: 'hello again',
      externalMessageId: 'social-profile-2',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
    })).rejects.toThrow('session_response_profile_mismatch');
    expect(model.callCount).toBe(0);
  });

  it('normalizes trusted UI actions into channel-neutral commands', () => {
    expect(customerCommandFromVerifiedAction({
      actionId: 'add_items',
      payload: { items: [{ itemCode: '20751', quantity: 2 }] },
    })).toEqual({
      kind: 'cart_batch_update',
      items: [{ itemCode: '20751', quantity: 2 }],
    });
    expect(customerCommandFromVerifiedAction({
      actionId: 'customize_item:drink:large',
      payload: {
        itemCode: '20751',
        groupId: 'drink',
        modifierId: 'large',
      },
    })).toEqual({
      kind: 'modifier_selection',
      itemCode: '20751',
      groupId: 'drink',
      modifierId: 'large',
    });
    expect(customerCommandFromVerifiedAction({
      actionId: 'confirm_order',
    })).toEqual({ kind: 'confirm_order' });
  });
});
