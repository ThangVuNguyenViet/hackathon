import {
  AIMessage,
  isSystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import {
  GROUNDED_RESPONSE_TOOL_NAME,
} from '../../src/agent/responseGrounding.js';
import {
  selectedActionResponseReferenceSchema,
  type SelectedActionResponseReference,
} from '../../src/agent/selectedActionResponseAuthority.js';
import {
  STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID,
} from '../../src/agent/structuredCustomerAction.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import {
  createTrustedCustomerActionEnvelope,
} from '../../src/domain/customerCommand.js';
import type { Address, Cart } from '../../src/domain/types.js';
import { kfcGenUiVerifiedStateRevision } from '../../src/genui/kfcGenUi.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseClaims,
  groundedResponseModelReply,
  groundedResponseVerifierModel,
  selectedActionSemanticAttestation,
} from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function cart(): Cart {
  return {
    id: 'legacy-boundary-cart',
    items: [{
      itemCode: '20751',
      name: 'Verified item',
      quantity: 1,
      unitPriceVnd: 99_000,
    }],
    subtotalVnd: 99_000,
    discountVnd: 0,
    deliveryFeeVnd: 0,
    totalVnd: 99_000,
    voucherCode: null,
  };
}

async function seedVerifiedState(
  store: MemoryStore,
  sessionId: string,
  verifiedState: Partial<AgentGraphState>,
): Promise<void> {
  await store.appendEvent(sessionId, 'graph:verified_state', {
    verifiedState,
  });
}

function structuredActionReference(
  messages: BaseMessage[],
): SelectedActionResponseReference {
  const authorityMessage = messages.find(
    (message) =>
      isSystemMessage(message) &&
      message.id === STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID,
  );
  if (!authorityMessage || typeof authorityMessage.content !== 'string') {
    throw new Error('structured_action_reference_message_missing');
  }
  const parsed: unknown = JSON.parse(authorityMessage.content);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('selectedActionResponse' in parsed)
  ) {
    throw new Error('structured_action_reference_message_invalid');
  }
  return selectedActionResponseReferenceSchema.parse(
    parsed.selectedActionResponse,
  );
}

function structuredGroundedResponse(
  messages: BaseMessage[],
  customerText: string,
): AIMessage {
  return groundedResponseModelReply({
      customerText,
      selectedActionResponse: structuredActionReference(messages),
    })(messages);
}

describe('maintained StateGraph legacy boundaries', () => {
  it('presents a missing-address decision for trusted start_fulfillment without semantic planning or commerce tools', async () => {
    const baseModel = fakeModel();
    const verifierOutput: Record<string, unknown> =
      groundedResponseClaims();
    const planningModel = fakeModel().respond(
      new AIMessage('planning must not run'),
    );
    const responseModel = fakeModel().respond((messages) => {
      const reference = structuredActionReference(messages);
      verifierOutput.selectedActionAttestation =
        selectedActionSemanticAttestation(reference);
      return structuredGroundedResponse(
        messages,
        'Please enter a delivery address.',
      );
    });
    vi.spyOn(baseModel, 'bindTools').mockImplementation((tools) => {
      const names = (tools as Array<{ name?: string }>).flatMap(
        ({ name }) => name ? [name] : [],
      );
      return (
        names.length === 1 &&
        names[0] === GROUNDED_RESPONSE_TOOL_NAME
          ? responseModel
          : planningModel
      ) as ReturnType<NonNullable<typeof baseModel.bindTools>>;
    });
    const sessionId = 'stategraph-missing-address-boundary';
    const customerId = 'missing-address-customer';
    const store = new MemoryStore();
    const verifiedState = { cart: cart(), toolTrace: [] };
    await seedVerifiedState(store, sessionId, verifiedState);
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'user',
      text: 'Continue to delivery',
      externalMessageId: 'missing-address-message',
      externalUserId: customerId,
      deliveryStatus: 'received',
      metadata: null,
    });

    const output = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      responseProfile: 'genui',
      text: 'Continue to delivery',
      externalMessageId: 'missing-address-message',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: baseModel,
      responseVerifierModel: groundedResponseVerifierModel(verifierOutput),
      trustedCustomerAction: createTrustedCustomerActionEnvelope({
        source: 'kfc_genui_action',
        assistantTurnId: 'missing-address-assistant-turn',
        attachmentId: 'missing-address-cart',
        actionDigest: 'a'.repeat(64),
        verifiedRevision:
          kfcGenUiVerifiedStateRevision(verifiedState),
        lifecycle: 'one_shot',
        command: { kind: 'start_fulfillment' },
      }),
    });

    expect(planningModel.callCount).toBe(0);
    expect(responseModel.callCount).toBe(1);
    expect(output.state.cart).toEqual(verifiedState.cart);
    expect(output.state.address).toBeUndefined();
    expect(output.state.addressDraft).toBeUndefined();
    expect(output.state.fulfillment).toBeUndefined();
    expect(output.state.order).toBeUndefined();
    expect(output.state.orderPreview).toBeUndefined();
    expect(output.state.toolTrace).toEqual([]);
    expect(output.genUi).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: {
        address: null,
        addressStatus: 'missing',
        fulfillment: null,
      },
      actions: [{
        id: 'submit_address',
        intent: 'primary',
      }],
    });
  });

  it('fails closed when a complete fulfillment address mixes an old street with a partial new district', async () => {
    const previousAddress: Address = {
      label: 'Previous address',
      line1: '123 Previous Street',
      district: 'District 5',
      city: 'Ho Chi Minh City',
    };
    const partialNewAddress = {
      district: 'District 3',
      city: 'Ho Chi Minh City',
    };
    const model = fakeModel()
      .respondWithTools([{
        name: 'quoteFulfillment',
        args: {
          address: {
            label: null,
            line1: previousAddress.line1,
            district: 'District 3',
            city: 'Ho Chi Minh City',
          },
          method: 'delivery',
        },
      }])
      .respond(groundedResponseModelReply({
        customerText:
          'Please provide a street or building for the new district.',
      }));
    const clients = createMockClients(createTestFixtures());
    const quoteFulfillment = vi.spyOn(
      clients.fulfillment,
      'quoteFulfillment',
    );
    const sessionId = 'stategraph-partial-address-boundary';
    const store = new MemoryStore();
    await seedVerifiedState(store, sessionId, {
      cart: cart(),
      address: previousAddress,
      addressDraft: partialNewAddress,
      toolTrace: [],
    });

    await expect(runAgentTurn({
      sessionId,
      customerId: 'partial-address-customer',
      channel: 'kfc',
      responseProfile: 'genui',
      text: 'Deliver to District 3',
      externalMessageId: 'partial-address-message',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
      responseVerifierModel: groundedResponseVerifierModel(),
    })).rejects.toThrow('agent_address_authority_mismatch');

    expect(model.callCount).toBe(1);
    expect(quoteFulfillment).not.toHaveBeenCalled();
    const events = await store.listEvents(sessionId);
    expect(events).toContainEqual(expect.objectContaining({
      sourceType: 'agent:failed_closed',
      payload: expect.objectContaining({
        errorCode: 'agent_address_authority_mismatch',
      }),
    }));
    expect(events.filter(
      ({ sourceType }) => sourceType === 'graph:verified_state',
    )).toHaveLength(1);
    expect(events).not.toContainEqual(expect.objectContaining({
      sourceType: 'tool:executed',
    }));
  });

  it('keeps operator cart state while the customer handoff projection exposes no cart or product fields', async () => {
    const currentCart = cart();
    const handoff = {
      escalationId: 'handoff-operator-cart',
      reasons: ['abnormal_large_order'],
    };
    const claims = groundedResponseClaims({
      evidenceReferences: [{
        evidenceId: 'handoff',
        claimKinds: ['status'],
      }],
    });
    const model = fakeModel().respond(
      groundedResponseModelReply({
        customerText: 'Your support request is queued.',
        ...claims,
      }),
    );
    const sessionId = 'stategraph-handoff-projection-boundary';
    const store = new MemoryStore();
    await seedVerifiedState(store, sessionId, {
      cart: currentCart,
      handoff,
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'handoff-projection-customer',
      channel: 'kfc',
      responseProfile: 'genui',
      text: 'I need more help',
      externalMessageId: 'handoff-projection-message',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
      responseVerifierModel: groundedResponseVerifierModel(claims),
    });

    expect(output.state.cart).toEqual(currentCart);
    expect(output.state.handoff).toEqual(handoff);
    expect(output.genUi).toMatchObject({
      widgetKind: 'supportHandoff',
      data: {
        handoff,
        reasons: ['abnormal_large_order'],
        handoffStatus: 'queued',
      },
    });
    expect(output.genUi?.data).not.toHaveProperty('cart');
    expect(output.genUi?.data).not.toHaveProperty('items');
    expect(output.genUi?.data).not.toHaveProperty('product');
  });
});
