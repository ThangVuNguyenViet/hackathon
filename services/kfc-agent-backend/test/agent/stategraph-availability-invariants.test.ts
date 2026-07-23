import type { ToolCall } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import type { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { ExternalClients } from '../../src/clients/interfaces.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { Address, Cart } from '../../src/domain/types.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import {
  agentToolArgumentSchemas,
} from '../../src/ordering/toolCatalog.js';
import type { ToolName } from '../../src/ordering/types.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import {
  controlledCustomerAccess,
} from '../fixtures/controlledCustomerAccess.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const primaryStoreId = 'KFCVN0002';
const alternateStoreId = 'KFCVN0318';

const primaryAddress: Address = {
  label: 'Primary destination',
  line1: 'Số 01, KP 1, P. Long Bình Tân',
  district: 'Biên Hòa',
  city: 'Đồng Nai',
};

const alternateAddress: Address = {
  label: 'Alternate destination',
  line1: '60 Đ. Phạm Văn Nghị, Tân Phong',
  district: 'Quận 7',
  city: 'Hồ Chí Minh',
};

function cart(): Cart {
  return {
    id: 'stategraph-availability-cart',
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

function pickupCapableClients(): ExternalClients {
  const fixtures = createTestFixtures();
  return createMockClients({
    ...fixtures,
    fulfillmentServiceAreas: [
      ...fixtures.fulfillmentServiceAreas,
      {
        serviceAreaId: 'bien-hoa-pickup-test',
        storeId: primaryStoreId,
        method: 'pickup',
        canonicalDistrict: 'Biên Hòa',
        canonicalCity: 'Đồng Nai',
        districts: ['Biên Hòa'],
        cities: ['Đồng Nai'],
        provenance: {
          sourceFile: 'stategraph-availability-invariants.test.ts',
          sourceApi: 'mock://fulfillment/service-areas/bien-hoa-pickup',
          fixtureMode: 'demo_mock_seed',
        },
      },
    ],
    fulfillmentQuotes: [
      ...fixtures.fulfillmentQuotes,
      {
        storeId: primaryStoreId,
        method: 'pickup',
        feeVnd: 0,
        etaMinutes: 15,
        provenance: {
          sourceFile: 'stategraph-availability-invariants.test.ts',
          sourceApi: 'mock://fulfillment/quote/KFCVN0002/pickup',
          fixtureMode: 'demo_mock_seed',
        },
      },
    ],
  });
}

function authoredToolCall<Name extends ToolName>(
  name: Name,
  args: z.input<(typeof agentToolArgumentSchemas)[Name]>,
): ToolCall {
  return {
    name,
    args: agentToolArgumentSchemas[name].parse(args),
  };
}

function availabilityAuthorityResult(
  providerRevision: string,
  itemCodes = ['20751'],
) {
  const observedAtMs = Date.now();
  return {
    ok: true as const,
    value: {
      availability: Object.fromEntries(
        itemCodes.map((itemCode) => [itemCode, true]),
      ),
      providerRevision,
      observedAt: new Date(observedAtMs).toISOString(),
      expiresAt: new Date(observedAtMs + 5 * 60_000).toISOString(),
    },
    message: 'ok',
    provenance: [{
      fixtureMode: 'provider_runtime' as const,
      sourceFile: 'stategraph-availability-invariants.test.ts',
      sourceApi: 'mock://inventory/availability',
    }],
  };
}

async function seedCheckout(
  store: MemoryStore,
  sessionId: string,
  input: {
    storeId: string;
    storeName: string;
    address: Address;
  },
): Promise<void> {
  await store.appendEvent(sessionId, 'graph:verified_state', {
    verifiedState: {
      cart: cart(),
      address: input.address,
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: input.storeId,
        storeName: input.storeName,
        feeVnd: 18_000,
        etaMinutes: 35,
        availability: {
          ok: true,
          checkedItemIds: ['20751'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: {
            fixtureMode: 'test_only',
            sourceFile: 'stategraph-availability-invariants.test.ts',
          },
        },
      },
      toolTrace: [],
    },
  });
}

async function runAuthoredTurn(input: {
  sessionId: string;
  customerId: string;
  externalMessageId: string;
  text: string;
  clients: ExternalClients;
  store: MemoryStore;
  checkpointer: MemorySaver;
  toolCall: ToolCall;
}) {
  const authorModel = fakeModel()
    .respondWithTools([input.toolCall])
    .respond(groundedResponseModelReply({
      customerText: 'What would you like to do next?',
    }));

  const output = await runAgentTurn({
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: 'kfc',
    responseProfile: 'genui',
    text: input.text,
    externalMessageId: input.externalMessageId,
    accessContext: controlledCustomerAccess({
      sessionId: input.sessionId,
      customerId: input.customerId,
    }),
    clients: input.clients,
    store: input.store,
    dashboard: new DashboardEventBus(),
    checkpointer: input.checkpointer,
    agentModel: authorModel,
  });

  return output;
}

describe('maintained StateGraph exact availability invariants', () => {
  it('fails preview closed without synthesizing an availability check', async () => {
    const sessionId = 'kfc:stategraph-availability-missing';
    const customerId = 'stategraph-availability-missing-customer';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const clients = createMockClients(createTestFixtures());
    const checkInventory = vi.spyOn(
      clients.inventory,
      'checkInventoryWithAuthority',
    );
    const previewOrder = vi.spyOn(clients.oms, 'previewOrder');
    await seedCheckout(store, sessionId, {
      storeId: primaryStoreId,
      storeName: 'KFC BIG C ĐỒNG NAI',
      address: primaryAddress,
    });

    const output = await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId: 'stategraph-availability-missing-message',
      text: 'Continue with the authored checkout action.',
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('previewOrder', {}),
    });

    const previewTrace = output.state.toolTrace
      ?.filter(({ toolName }) => toolName === 'previewOrder')
      .at(-1);
    expect.soft(checkInventory).not.toHaveBeenCalled();
    expect.soft(previewOrder).not.toHaveBeenCalled();
    expect.soft(output.state.orderPreview).toBeUndefined();
    expect.soft(output.state.order).toBeUndefined();
    expect.soft(previewTrace).toMatchObject({
      toolName: 'previewOrder',
      arguments: {},
      ok: false,
    });
    expect.soft(
      output.state.toolTrace?.some(
        ({ toolName }) => toolName === 'checkStoreAvailability',
      ),
    ).toBe(false);
  });

  it('advances preview only after the model authors an exact fresh availability check', async () => {
    const sessionId = 'kfc:stategraph-availability-fresh';
    const customerId = 'stategraph-availability-fresh-customer';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const clients = createMockClients(createTestFixtures());
    const checkInventory = vi.spyOn(
      clients.inventory,
      'checkInventoryWithAuthority',
    );
    const previewOrder = vi.spyOn(clients.oms, 'previewOrder');
    await seedCheckout(store, sessionId, {
      storeId: primaryStoreId,
      storeName: 'KFC BIG C ĐỒNG NAI',
      address: primaryAddress,
    });

    const checked = await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId: 'stategraph-availability-fresh-check',
      text: 'Run the authored availability action.',
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('checkStoreAvailability', {
        storeId: primaryStoreId,
        disposition: 'delivery',
      }),
    });

    expect.soft(checkInventory).toHaveBeenCalledOnce();
    expect.soft(checkInventory).toHaveBeenCalledWith(
      primaryStoreId,
      ['20751'],
      'delivery',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        deadlineAt: expect.any(Number),
      }),
    );
    expect.soft(previewOrder).not.toHaveBeenCalled();
    expect.soft(checked.state.orderPreview).toBeUndefined();
    expect.soft(
      checked.state.toolTrace
        ?.filter(
          ({ toolName }) => toolName === 'checkStoreAvailability',
        )
        .at(-1),
    ).toMatchObject({
      toolName: 'checkStoreAvailability',
      ok: true,
    });

    const previewed = await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId: 'stategraph-availability-fresh-preview',
      text: 'Continue with the authored checkout action.',
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('previewOrder', {}),
    });

    expect.soft(checkInventory).toHaveBeenCalledTimes(1);
    expect.soft(previewOrder).toHaveBeenCalledOnce();
    expect.soft(previewed.state.orderPreview).toMatchObject({
      status: 'previewed',
      assignedStoreId: primaryStoreId,
    });
    expect.soft(previewed.state.order).toBeUndefined();
  });

  it('rejects a prior observation after the inventory authority revision changes', async () => {
    const sessionId = 'kfc:stategraph-availability-provider-revision';
    const customerId =
      'stategraph-availability-provider-revision-customer';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const clients = createMockClients(createTestFixtures());
    let revision = 'inventory-revision-one';
    clients.inventory.checkInventoryWithAuthority = async (
      _storeId,
      itemCodes,
    ) => availabilityAuthorityResult(revision, itemCodes);
    clients.inventory.getAvailabilityRevision = async () => ({
      ok: true,
      value: revision,
      message: 'ok',
      provenance: [],
    });
    const previewOrder = vi.spyOn(clients.oms, 'previewOrder');
    await seedCheckout(store, sessionId, {
      storeId: primaryStoreId,
      storeName: 'KFC BIG C ĐỒNG NAI',
      address: primaryAddress,
    });

    await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId:
        'stategraph-availability-provider-revision-check',
      text: 'Run the authored availability action.',
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('checkStoreAvailability', {
        storeId: primaryStoreId,
        disposition: 'delivery',
      }),
    });
    revision = 'inventory-revision-two';

    const output = await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId:
        'stategraph-availability-provider-revision-preview',
      text: 'Continue with the authored checkout action.',
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('previewOrder', {}),
    });

    expect.soft(previewOrder).not.toHaveBeenCalled();
    expect.soft(output.state.orderPreview).toBeUndefined();
    expect.soft(
      output.state.toolTrace
        ?.filter(({ toolName }) => toolName === 'previewOrder')
        .at(-1),
    ).toMatchObject({
      toolName: 'previewOrder',
      ok: false,
    });
  });

  it('does not relabel availability rows when authority rotates during the check', async () => {
    const sessionId = 'kfc:stategraph-availability-inflight-revision';
    const customerId =
      'stategraph-availability-inflight-revision-customer';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const clients = createMockClients(createTestFixtures());
    let revision = 'inventory-revision-observed';
    clients.inventory.checkInventoryWithAuthority = async (
      _storeId,
      itemCodes,
    ) => {
      const observed = availabilityAuthorityResult(
        revision,
        itemCodes,
      );
      revision = 'inventory-revision-rotated';
      return observed;
    };
    clients.inventory.getAvailabilityRevision = async () => ({
      ok: true,
      value: revision,
      message: 'ok',
      provenance: [],
    });
    const previewOrder = vi.spyOn(clients.oms, 'previewOrder');
    await seedCheckout(store, sessionId, {
      storeId: primaryStoreId,
      storeName: 'KFC BIG C ĐỒNG NAI',
      address: primaryAddress,
    });

    const checked = await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId:
        'stategraph-availability-inflight-revision-check',
      text: 'Run the authored availability action.',
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('checkStoreAvailability', {
        storeId: primaryStoreId,
        disposition: 'delivery',
      }),
    });
    expect(
      checked.state.exactCartAvailabilityObservation
        ?.inventoryProviderRevision.revision,
    ).toBe('inventory-revision-observed');

    const output = await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId:
        'stategraph-availability-inflight-revision-preview',
      text: 'Continue with the authored checkout action.',
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('previewOrder', {}),
    });

    expect.soft(previewOrder).not.toHaveBeenCalled();
    expect.soft(output.state.orderPreview).toBeUndefined();
    expect.soft(
      output.state.toolTrace
        ?.filter(({ toolName }) => toolName === 'previewOrder')
        .at(-1),
    ).toMatchObject({
      toolName: 'previewOrder',
      ok: false,
    });
  });

  it('does not let an observation for one store authorize another store', async () => {
    const sessionId = 'kfc:stategraph-availability-stale-store';
    const customerId = 'stategraph-availability-stale-store-customer';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const clients = createMockClients(createTestFixtures());
    const checkInventory = vi.spyOn(
      clients.inventory,
      'checkInventoryWithAuthority',
    );
    const previewOrder = vi.spyOn(clients.oms, 'previewOrder');
    await seedCheckout(store, sessionId, {
      storeId: primaryStoreId,
      storeName: 'KFC BIG C ĐỒNG NAI',
      address: primaryAddress,
    });

    await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId: 'stategraph-availability-stale-check',
      text: 'Run the authored availability action.',
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('checkStoreAvailability', {
        storeId: primaryStoreId,
        disposition: 'delivery',
      }),
    });

    const requoted = await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId: 'stategraph-availability-stale-requote',
      text: [
        alternateAddress.line1,
        alternateAddress.district,
        alternateAddress.city,
      ].join(', '),
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('quoteFulfillment', {
        address: {
          ...alternateAddress,
          // The customer supplied the destination fields, not an invented
          // saved-address label.
          label: null,
        },
        method: 'delivery',
      }),
    });

    expect.soft(requoted.state.fulfillment).toMatchObject({
      storeId: alternateStoreId,
      disposition: 'delivery',
    });
    expect.soft(checkInventory).toHaveBeenCalledTimes(1);

    const output = await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId: 'stategraph-availability-stale-preview',
      text: 'Continue with the authored checkout action.',
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('previewOrder', {}),
    });

    const previewTrace = output.state.toolTrace
      ?.filter(({ toolName }) => toolName === 'previewOrder')
      .at(-1);
    expect.soft(checkInventory).toHaveBeenCalledTimes(1);
    expect.soft(previewOrder).not.toHaveBeenCalled();
    expect.soft(output.state.orderPreview).toBeUndefined();
    expect.soft(output.state.order).toBeUndefined();
    expect.soft(previewTrace).toMatchObject({
      toolName: 'previewOrder',
      arguments: {},
      ok: false,
    });
  });

  it('does not let an observation for one cart revision authorize a changed quantity', async () => {
    const sessionId = 'kfc:stategraph-availability-stale-cart';
    const customerId = 'stategraph-availability-stale-cart-customer';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const clients = createMockClients(createTestFixtures());
    const checkInventory = vi.spyOn(
      clients.inventory,
      'checkInventoryWithAuthority',
    );
    const previewOrder = vi.spyOn(clients.oms, 'previewOrder');
    await seedCheckout(store, sessionId, {
      storeId: primaryStoreId,
      storeName: 'KFC BIG C ĐỒNG NAI',
      address: primaryAddress,
    });

    await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId: 'stategraph-availability-stale-cart-check',
      text: 'Run the authored availability action.',
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('checkStoreAvailability', {
        storeId: primaryStoreId,
        disposition: 'delivery',
      }),
    });

    const updated = await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId: 'stategraph-availability-stale-cart-update',
      text: 'Set the current verified item quantity to 2.',
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('updateCart', {
        changes: [{
          itemCode: '20751',
          quantity: 2,
          modifiers: [],
        }],
      }),
    });

    expect.soft(updated.state.cart?.items).toEqual([
      expect.objectContaining({
        itemCode: '20751',
        quantity: 2,
      }),
    ]);
    expect.soft(updated.state.fulfillment).toBeUndefined();
    expect.soft(checkInventory).toHaveBeenCalledTimes(1);

    const requoted = await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId: 'stategraph-availability-stale-cart-requote',
      text: [
        primaryAddress.line1,
        primaryAddress.district,
        primaryAddress.city,
      ].join(', '),
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('quoteFulfillment', {
        address: primaryAddress,
        method: 'delivery',
      }),
    });

    expect.soft(requoted.state.cart?.items).toEqual([
      expect.objectContaining({
        itemCode: '20751',
        quantity: 2,
      }),
    ]);
    expect.soft(requoted.state.fulfillment).toMatchObject({
      storeId: primaryStoreId,
      disposition: 'delivery',
    });
    expect.soft(checkInventory).toHaveBeenCalledTimes(1);

    const output = await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId: 'stategraph-availability-stale-cart-preview',
      text: 'Continue with the authored checkout action.',
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('previewOrder', {}),
    });

    const previewTrace = output.state.toolTrace
      ?.filter(({ toolName }) => toolName === 'previewOrder')
      .at(-1);
    expect.soft(checkInventory).toHaveBeenCalledTimes(1);
    expect.soft(previewOrder).not.toHaveBeenCalled();
    expect.soft(output.state.orderPreview).toBeUndefined();
    expect.soft(output.state.order).toBeUndefined();
    expect.soft(previewTrace).toMatchObject({
      toolName: 'previewOrder',
      arguments: {},
      ok: false,
    });
  });

  it('does not let a delivery observation authorize pickup', async () => {
    const sessionId = 'kfc:stategraph-availability-stale-disposition';
    const customerId =
      'stategraph-availability-stale-disposition-customer';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const clients = pickupCapableClients();
    const checkInventory = vi.spyOn(
      clients.inventory,
      'checkInventoryWithAuthority',
    );
    const previewOrder = vi.spyOn(clients.oms, 'previewOrder');
    await seedCheckout(store, sessionId, {
      storeId: primaryStoreId,
      storeName: 'KFC BIG C ĐỒNG NAI',
      address: primaryAddress,
    });

    await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId:
        'stategraph-availability-stale-disposition-check',
      text: 'Run the authored delivery availability action.',
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('checkStoreAvailability', {
        storeId: primaryStoreId,
        disposition: 'delivery',
      }),
    });

    const requoted = await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId:
        'stategraph-availability-stale-disposition-requote',
      text: [
        'Pickup',
        primaryAddress.line1,
        primaryAddress.district,
        primaryAddress.city,
      ].join(', '),
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('quoteFulfillment', {
        address: primaryAddress,
        method: 'pickup',
      }),
    });

    expect.soft(requoted.state.fulfillment).toMatchObject({
      storeId: primaryStoreId,
      disposition: 'pickup',
      method: 'pickup',
    });
    expect.soft(checkInventory).toHaveBeenCalledTimes(1);

    const output = await runAuthoredTurn({
      sessionId,
      customerId,
      externalMessageId:
        'stategraph-availability-stale-disposition-preview',
      text: 'Continue with the authored checkout action.',
      clients,
      store,
      checkpointer,
      toolCall: authoredToolCall('previewOrder', {}),
    });

    const previewTrace = output.state.toolTrace
      ?.filter(({ toolName }) => toolName === 'previewOrder')
      .at(-1);
    expect.soft(checkInventory).toHaveBeenCalledTimes(1);
    expect.soft(previewOrder).not.toHaveBeenCalled();
    expect.soft(output.state.orderPreview).toBeUndefined();
    expect.soft(output.state.order).toBeUndefined();
    expect.soft(previewTrace).toMatchObject({
      toolName: 'previewOrder',
      arguments: {},
      ok: false,
    });
  });
});
