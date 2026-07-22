import { fakeModel } from '@langchain/core/testing';
import type { BaseMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { Address, Cart } from '../../src/domain/types.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function recordedMessages(
  model: ReturnType<typeof fakeModel>,
): string {
  return model.calls
    .flatMap(({ messages }) => messages.map(({ text }) => text))
    .join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value);
}

function parsedMessage(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function publicationEvidence(
  messages: readonly BaseMessage[],
): Array<Record<string, unknown>> {
  for (const message of messages) {
    const parsed = parsedMessage(message.text);
    if (!parsed) continue;
    const envelope = parsed.publication;
    if (!isRecord(envelope) || !Array.isArray(envelope.evidence)) continue;
    return envelope.evidence.filter(isRecord);
  }
  throw new Error('captured_publication_evidence_missing');
}

function cart(): Cart {
  return {
    id: 'stategraph-invariant-cart',
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
  verifiedState: Record<string, unknown>,
): Promise<void> {
  await store.appendEvent(sessionId, 'graph:verified_state', {
    verifiedState,
  });
}

describe('maintained StateGraph catalog and fulfillment invariants', () => {
  it('keeps terminal and private state out of author publication without deleting durable state', async () => {
    const privateAddressMarker =
      'PRIVATE_ADDRESS_MARKER_54_CURRENT_STREET';
    const terminalOrderMarker = 'TERMINAL_ORDER_MARKER';
    const durableCart = cart();
    const model = fakeModel().respond(
      groundedResponseModelReply({
        customerText: 'How can I help?',
      }),
    );
    const store = new MemoryStore();
    const sessionId = 'kfc:stategraph-publication-boundary';
    await seedVerifiedState(store, sessionId, {
      cart: durableCart,
      address: {
        label: 'Private destination',
        line1: privateAddressMarker,
        district: 'District 3',
        city: 'Ho Chi Minh City',
      },
      order: {
        id: terminalOrderMarker,
        cart: durableCart,
        status: 'completed',
        paymentStatus: 'paid',
        assignedStoreId: 'terminal-store',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'stategraph-publication-boundary',
      channel: 'kfc',
      text: 'Hello.',
      externalMessageId: 'stategraph-publication-boundary-message',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
    });

    const authorPublication = recordedMessages(model);
    expect.soft(authorPublication).not.toContain(privateAddressMarker);
    expect.soft(authorPublication).not.toContain(terminalOrderMarker);
    expect(output.state.address?.line1).toBe(privateAddressMarker);
    expect(output.state.order?.id).toBe(terminalOrderMarker);
    expect(output.state.cart).toEqual(durableCart);
  });

  it('keeps ambiguous catalog discovery read-only until the model receives a customer selection', async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: {
          scope: 'filtered',
          query: 'combo gà cay',
          purpose: 'browse',
        },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'Please choose one of the verified options.',
      }));
    const clients = createMockClients(
      await loadGeneratedFixtures(process.cwd()),
    );
    const updateCart = vi.spyOn(clients.cart, 'updateCart');

    const output = await runAgentTurn({
      sessionId: 'kfc:stategraph-ambiguous-discovery',
      customerId: 'stategraph-ambiguous-discovery',
      channel: 'kfc',
      responseProfile: 'genui',
      text: 'Show me spicy combo choices.',
      externalMessageId: 'stategraph-ambiguous-discovery-message',
      clients,
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
    });

    expect(updateCart).not.toHaveBeenCalled();
    expect(output.state.cart).toBeUndefined();
    expect(output.state.toolTrace?.map(({ toolName }) => toolName)).toEqual([
      'searchMenu',
    ]);
    expect(output.genUi).toMatchObject({
      widgetKind: 'smartMenuPicker',
      data: {
        items: expect.any(Array),
      },
    });
    expect(
      (output.genUi?.data.items as unknown[] | undefined)?.length,
    ).toBeGreaterThan(1);
  });

  it('publishes current modifier evidence without stale order or catalog state', async () => {
    const staleOrderMarker = 'STALE_ORDER_MARKER';
    const staleCatalogMarker = 'STALE_CATALOG_MARKER';
    const durableCart = cart();
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: {
          scope: 'filtered',
          query: 'combo gà cay',
          purpose: 'browse',
        },
      }])
      .respondWithTools([{
        name: 'getModifierOptions',
        args: { code: '20751' },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'Please choose from the current verified options.',
      }));
    const store = new MemoryStore();
    const sessionId = 'kfc:stategraph-current-modifier-publication';
    await seedVerifiedState(store, sessionId, {
      cart: durableCart,
      order: {
        id: staleOrderMarker,
        cart: durableCart,
        status: 'completed',
        paymentStatus: 'paid',
        assignedStoreId: 'stale-store',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      menuSearchResults: [{
        code: 'stale-item',
        itemId: 'stale-item',
        productCode: 'stale-item',
        category: 'stale',
        name: staleCatalogMarker,
        description: staleCatalogMarker,
        priceVnd: 1,
        originalPriceVnd: null,
        available: true,
      }],
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'stategraph-current-modifier-publication',
      channel: 'kfc',
      text: 'Show current spicy-combo modifier choices.',
      externalMessageId: 'stategraph-current-modifier-message',
      clients: createMockClients(
        await loadGeneratedFixtures(process.cwd()),
      ),
      store,
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
    });

    const finalAuthorMessages = model.calls.at(-1)?.messages;
    if (!finalAuthorMessages) {
      throw new Error('final_author_messages_missing');
    }
    const finalAuthorPublication =
      finalAuthorMessages.map(({ text }) => text).join('\n');
    expect.soft(finalAuthorPublication).not.toContain(staleOrderMarker);
    expect.soft(finalAuthorPublication).not.toContain(staleCatalogMarker);
    const authorModifierEvidence = publicationEvidence(
      finalAuthorMessages,
    ).filter(({ evidenceId }) =>
      typeof evidenceId === 'string' &&
      evidenceId.startsWith('current:getModifierOptions:'),
    );
    expect(authorModifierEvidence).toHaveLength(1);
    expect(authorModifierEvidence[0]?.value).toMatchObject({
      itemCode: '20751',
      modifierGroups: expect.any(Array),
    });
    expect(output.state.menuModifierOptions).toMatchObject({
      itemCode: '20751',
      modifierGroups: expect.any(Array),
    });
    expect(output.state.order?.id).toBe(staleOrderMarker);
    expect(output.state.toolTrace?.map(({ toolName }) => toolName)).toEqual([
      'searchMenu',
      'getModifierOptions',
    ]);
  });

  it('quotes only the complete address authored by the model for the current turn', async () => {
    const currentAddress: Address = {
      label: 'Chung cư Sunrise City',
      line1:
        'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    };
    const model = fakeModel()
      .respondWithTools([{
        name: 'quoteFulfillment',
        args: {
          address: currentAddress,
          method: 'delivery',
        },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'The verified delivery step is ready.',
      }));
    const clients = createMockClients(createTestFixtures());
    const quoteFulfillment = vi.spyOn(
      clients.fulfillment,
      'quoteFulfillment',
    );
    const store = new MemoryStore();
    const sessionId = 'kfc:stategraph-current-address';
    await seedVerifiedState(store, sessionId, {
      cart: cart(),
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'stategraph-current-address',
      channel: 'kfc',
      responseProfile: 'genui',
      text: [
        currentAddress.line1,
        currentAddress.district,
        currentAddress.city,
      ].join(', '),
      externalMessageId: 'stategraph-current-address-message',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
    });

    expect(quoteFulfillment).toHaveBeenCalledOnce();
    expect(quoteFulfillment.mock.calls[0]?.[0]).toMatchObject({
      address: currentAddress,
      method: 'delivery',
      itemCodes: ['20751'],
    });
    expect(output.state.address).toEqual(currentAddress);
    expect(output.state.fulfillment).toMatchObject({
      method: 'delivery',
      disposition: 'delivery',
    });
    expect(output.state.order).toBeUndefined();
    expect(output.state.orderPreview).toBeUndefined();
    expect(output.state.toolTrace?.map(({ toolName }) => toolName)).toEqual([
      'quoteFulfillment',
    ]);
  });
});
