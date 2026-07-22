import { describe, expect, it, vi } from 'vitest';
import {
  buildCurrentTurnResponseEvidence,
  buildModelPublicationBundle,
  checkpointSafeToolEvidenceReceipt,
  issueModelPublicationAuthority,
  isIssuedModelPublicationBundle,
  modelPublicationAuthorizedScopes,
  privateDisclosureEvidenceIds,
  rehydrateCheckpointSafeCurrentTurnEvidence,
  validateModelPublicationReference,
  type CurrentTurnResponseEvidence,
  type ModelPublicationAuthority,
} from '../../src/agent/modelPublicationProjection.js';
import { traceReceiptIsRecoverable } from '../../src/agent/agentPublicationRuntime.js';
import type { GraphExecutedToolResult } from '../../src/agent/graphExecutedToolResult.js';
import type {
  Address,
  Cart,
  CustomerAccessContext,
  MenuItem,
  Order,
} from '../../src/domain/types.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import { stateRevision } from '../../src/graph/turnSupport.js';
import type { PendingToolCall } from '../../src/agent/singleAgentRuntime.js';
import type { ToolTraceEntry } from '../../src/ordering/types.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';
import { executePublicationTool } from './model-publication-test-runtime.js';

function cart(id = 'cart-current'): Cart {
  return {
    id,
    items: [
      {
        itemCode: 'item-1',
        name: 'Chicken',
        quantity: 1,
        unitPriceVnd: 50_000,
      },
    ],
    subtotalVnd: 50_000,
    discountVnd: 0,
    deliveryFeeVnd: 10_000,
    totalVnd: 60_000,
    voucherCode: null,
  };
}

function menuItem(name = 'Current menu item'): MenuItem {
  return {
    code: 'item-1',
    category: 'Chicken',
    categoryId: 'test-chicken',
    name,
    description: 'Current catalog description',
    priceVnd: 50_000,
    originalPriceVnd: null,
    imageUrl: 'https://example.com/item.png',
    available: true,
  };
}

function address(overrides: Partial<Address> = {}): Address {
  return {
    label: 'Home',
    line1: 'PRIVATE OLD LINE 1',
    district: 'District 1',
    city: 'Ho Chi Minh City',
    ...overrides,
  };
}

function order(status: Order['status'], orderCart = cart()): Order {
  return {
    id: 'order-private-history',
    cart: orderCart,
    status,
    paymentStatus: 'paid',
    assignedStoreId: 'store-1',
    createdAt: '2026-07-20T00:00:00.000Z',
    posTicketId: 'INTERNAL-POS-TICKET',
    commerceOrderId: 'INTERNAL-COMMERCE-ID',
    omsOrderId: 'INTERNAL-OMS-ID',
    commerceOutcome: 'INTERNAL-OUTCOME',
    commerceCustomerStatus: 'INTERNAL-CUSTOMER-STATUS',
    commerceEnvironment: 'production',
  };
}

function state(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  const latestUserMessage =
    overrides.latestUserMessage ?? 'Show the current order';
  const base: AgentGraphState = {
    sessionId: 'publication-session',
    customerId: 'publication-customer',
    channel: 'kfc',
    latestUserMessage,
    recentTurns: [
      {
        id: 'publication-turn',
        sessionId: 'publication-session',
        channel: 'kfc',
        role: 'user',
        text: latestUserMessage,
        externalMessageId: 'publication-message',
        externalUserId: 'publication-user',
        deliveryStatus: 'received',
        metadata: null,
        createdAt: '2026-07-20T00:00:00.000Z',
      },
    ],
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
  };
  return {
    ...base,
    ...overrides,
    recentTurns: overrides.recentTurns ?? base.recentTurns,
  };
}

function accessContext(
  scopes: CustomerAccessContext['authorizedScopes'] = [
    'customer:read',
    'membership:read',
    'membership:write',
    'order:read',
    'order:write',
    'payment:read',
    'payment:write',
  ],
): CustomerAccessContext {
  return {
    tenantScope: 'kfc-vn',
    customerSurface: 'kfc-app-chat',
    sessionRef: 'publication-session',
    surfaceSubjectRef: 'not-applicable',
    kfcSubjectRef: 'publication-customer',
    authenticationState: 'authenticated',
    membershipState: 'member',
    channelAccountLinkState: 'not-applicable',
    subjectBindingState: 'verified',
    authenticationEvidence: {
      state: 'verified',
      method: 'test',
      issuer: 'test',
      audience: 'test',
      authenticatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-07-20T00:00:00.000Z',
      evidenceRef: 'auth-evidence',
    },
    authorizedScopes: scopes,
  };
}

async function authority(
  durable: AgentGraphState,
  currentAccess = accessContext(),
): Promise<ModelPublicationAuthority> {
  const currentUserTurn = durable.recentTurns?.at(-1);
  if (!currentUserTurn) throw new Error('current user turn missing');
  return issueModelPublicationAuthority({
    state: durable,
    currentUserTurn,
    accessContext: currentAccess,
  });
}

async function responseEvidence(input: {
  durable: AgentGraphState;
  publicationAuthority: ModelPublicationAuthority;
  call: PendingToolCall;
  currentAccess?: CustomerAccessContext;
  clientOptions?: Parameters<typeof executePublicationTool>[0]['clientOptions'];
  fixtures?: Parameters<typeof executePublicationTool>[0]['fixtures'];
}) {
  const execution = await executePublicationTool({
    authority: input.publicationAuthority,
    state: input.durable,
    accessContext:
      input.currentAccess ??
      accessContext(
        modelPublicationAuthorizedScopes(input.publicationAuthority),
      ),
    call: input.call,
    clientOptions: input.clientOptions,
    fixtures: input.fixtures,
  });
  return buildCurrentTurnResponseEvidence({
    authority: input.publicationAuthority,
    execution,
  });
}

async function bundle(durable: AgentGraphState) {
  return buildModelPublicationBundle({
    state: durable,
    authority: await authority(durable),
  });
}

function privateHistoryState(
  status: 'completed' | 'cancelled',
): AgentGraphState {
  const historicalCart = cart('terminal-cart');
  return state({
    cart: historicalCart,
    order: order(status, historicalCart),
    address: address(),
    fulfillment: {
      method: 'delivery',
      disposition: 'delivery',
      storeId: 'store-1',
      storeName: 'Store 1',
      feeVnd: 10_000,
      etaMinutes: 25,
      availability: {
        ok: true,
        checkedItemIds: ['item-1'],
        unavailableItemIds: [],
        blockedTimeslotItemIds: [],
        source: {
          fixtureMode: 'provider_runtime',
          sourceFile: 'INTERNAL-FULFILLMENT-SOURCE',
        },
      },
    },
    paymentAttempt: {
      method: 'private-payment-method',
      status: 'paid',
      paymentUrl: 'https://private.example/payment-token',
    },
    selectedPaymentMethod: {
      methodId: 'private-payment-method',
      collectionKey: 'private-collection-key',
      collectionRevision: 'private-collection-revision',
      providerRevision: 'private-provider-revision',
    },
    invoiceRequest: {
      companyName: 'PRIVATE COMPANY',
      taxCode: 'PRIVATE TAX',
      email: 'private@example.com',
    },
    customerContext: {
      savedAddresses: [address()],
      recentOrders: [order('completed', historicalCart)],
      favorites: [
        {
          code: 'private-favorite',
          category: 'private',
          categoryId: 'private-category',
          name: 'PRIVATE FAVORITE',
          description: 'private',
          priceVnd: 1,
          originalPriceVnd: null,
          imageUrl: 'https://example.com/private.png',
          available: true,
        },
      ],
      loyaltyPoints: 12_345,
    },
    retrievedEvidence: [
      {
        eventId: 'private-event',
        timestamp: '2026-07-20T00:00:00.000Z',
        sourceType: 'private-history',
        confidence: 1,
        payload: { secret: 'PRIVATE-RETRIEVED-EVIDENCE' },
      },
    ],
  });
}

function privateActiveState(): AgentGraphState {
  const activeCart = cart('active-private-cart');
  const menuKey = 'menu:public-active';
  const membershipKey = 'membership:private-active';
  const fixtureReward = createTestFixtures().membershipRewardOffers[0];
  if (!fixtureReward) throw new Error('membership reward fixture missing');
  const verifiedCollections: NonNullable<
    AgentGraphState['verifiedCollections']
  > = {
    searchMenu: {
      [menuKey]: {
        key: menuKey,
        revision: 'menu-revision',
        providerRevision: 'menu-provider-revision',
        result: {
          items: [menuItem('PUBLIC ACTIVE MENU')],
          total: 1,
          returned: 1,
          complete: true,
          scope: { scope: 'all' },
        },
      },
    },
    listMembershipRewards: {
      [membershipKey]: {
        key: membershipKey,
        revision: 'membership-revision',
        providerRevision: 'membership-provider-revision',
        result: {
          items: [
            {
              ...fixtureReward,
              rewardId: 'PRIVATE REWARD ID',
              name: 'PRIVATE MEMBER REWARD',
            },
          ],
          total: 1,
          returned: 1,
          complete: true,
          scope: { scope: 'all' },
        },
      },
    },
  };
  return state({
    cart: activeCart,
    order: order('created', activeCart),
    address: address({ line1: 'PRIVATE ACTIVE ADDRESS' }),
    addressDraft: {
      label: 'PRIVATE ACTIVE DRAFT',
      line1: 'PRIVATE ACTIVE DRAFT LINE',
      district: 'District 1',
      city: 'Ho Chi Minh City',
    },
    fulfillment: {
      method: 'delivery',
      disposition: 'delivery',
      storeId: 'private-store',
      storeName: 'PRIVATE ACTIVE STORE',
      feeVnd: 10_000,
      etaMinutes: 25,
      availability: {
        ok: true,
        checkedItemIds: ['item-1'],
        unavailableItemIds: [],
        blockedTimeslotItemIds: [],
        source: {
          fixtureMode: 'provider_runtime',
          sourceFile: 'PRIVATE ACTIVE FULFILLMENT SOURCE',
        },
      },
    },
    paymentAttempt: {
      method: 'PRIVATE ACTIVE PAYMENT',
      status: 'pending',
      paymentUrl: 'https://private.example/payment',
    },
    selectedPaymentMethod: {
      methodId: 'PRIVATE ACTIVE METHOD',
      collectionKey: 'private-payment-collection',
      collectionRevision: 'private-payment-revision',
      providerRevision: 'private-provider-revision',
    },
    invoiceRequest: {
      companyName: 'PRIVATE ACTIVE COMPANY',
      taxCode: 'PRIVATE ACTIVE TAX',
      email: 'private-active@example.com',
    },
    activeCollectionKeys: {
      searchMenu: menuKey,
      listMembershipRewards: membershipKey,
    },
    verifiedCollections,
  });
}

describe('model publication projection', () => {
  it('publishes public catalog and cart state without authentication', async () => {
    const durable = privateActiveState();
    const currentUserTurn = durable.recentTurns?.at(-1);
    if (!currentUserTurn) throw new Error('current user turn missing');
    const publicationAuthority = await issueModelPublicationAuthority({
      state: durable,
      currentUserTurn,
    });
    const publication = await buildModelPublicationBundle({
      state: durable,
      authority: publicationAuthority,
    });
    const serialized = JSON.stringify(publication);

    expect(publicationAuthority.privateAccess).toEqual({ state: 'none' });
    expect(publication.modelState.cart).toBeDefined();
    expect(serialized).toContain('PUBLIC ACTIVE MENU');
    expect(serialized).not.toContain('PRIVATE ACTIVE');
    expect(serialized).not.toContain('PRIVATE MEMBER REWARD');
    expect(publication.lifecycle).toMatchObject({
      order: 'none',
      address: 'none',
      fulfillment: 'none',
      payment: 'none',
    });
    expect(privateDisclosureEvidenceIds(publication)).toEqual([]);
  });

  it('publishes current public tool evidence under a base turn authority', async () => {
    const durable = state();
    const currentUserTurn = durable.recentTurns?.at(-1);
    if (!currentUserTurn) throw new Error('current user turn missing');
    const publicationAuthority = await issueModelPublicationAuthority({
      state: durable,
      currentUserTurn,
    });
    const execution = await executePublicationTool({
      authority: publicationAuthority,
      state: durable,
      call: {
        id: 'anonymous-public-menu',
        toolName: 'searchMenu',
        arguments: { scope: 'all', query: null },
      },
    });
    const evidence = await buildCurrentTurnResponseEvidence({
      authority: publicationAuthority,
      execution,
    });
    if (!evidence) throw new Error('public current evidence missing');
    const publication = await buildModelPublicationBundle({
      state: durable,
      authority: publicationAuthority,
      currentTurnEvidence: [evidence],
    });

    expect(evidence.privateData).toBe(false);
    expect(
      publication.evidence.find(
        (entry) => entry.evidenceId === evidence.evidenceId,
      )?.publicationAuthority,
    ).toBe('current_turn_execution');
    expect(privateDisclosureEvidenceIds(publication)).toEqual([]);
  });

  it('scope-filters every persisted private field and collection', async () => {
    const durable = privateActiveState();
    const currentUserTurn = durable.recentTurns?.at(-1);
    if (!currentUserTurn) throw new Error('current user turn missing');
    const currentAccess = accessContext(['customer:read']);
    const publicationAuthority = await issueModelPublicationAuthority({
      state: durable,
      currentUserTurn,
      accessContext: currentAccess,
    });
    const publication = await buildModelPublicationBundle({
      state: durable,
      authority: publicationAuthority,
    });
    const serialized = JSON.stringify(publication);

    expect(serialized).toContain('PRIVATE ACTIVE DRAFT LINE');
    expect(serialized).toContain('PUBLIC ACTIVE MENU');
    expect(serialized).not.toContain('order-private-history');
    expect(serialized).not.toContain('PRIVATE ACTIVE PAYMENT');
    expect(serialized).not.toContain('PRIVATE ACTIVE METHOD');
    expect(serialized).not.toContain('PRIVATE ACTIVE COMPANY');
    expect(serialized).not.toContain('PRIVATE MEMBER REWARD');
    expect(publication.lifecycle).toMatchObject({
      order: 'none',
      address: 'superseded_by_draft',
      fulfillment: 'superseded_by_draft',
      payment: 'none',
    });
    expect(privateDisclosureEvidenceIds(publication)).toEqual([
      'address_draft',
    ]);
  });

  it.each(['completed', 'cancelled'] as const)(
    'hides %s order history and tied private state without deleting it',
    async (status) => {
      const durable = privateHistoryState(status);

      const publication = await bundle(durable);
      const serialized = JSON.stringify(publication);

      expect(publication.lifecycle).toMatchObject({
        order: 'terminal_hidden',
        cart: 'terminal_history_hidden',
        address: 'history_hidden',
        fulfillment: 'history_hidden',
        payment: 'history_hidden',
        customerHistory: 'hidden',
      });
      expect(publication.modelState).not.toHaveProperty('order');
      expect(publication.modelState).not.toHaveProperty('cart');
      expect(publication.modelState).not.toHaveProperty('address');
      expect(publication.modelState).not.toHaveProperty('fulfillment');
      expect(publication.modelState).not.toHaveProperty('paymentAttempt');
      expect(publication.modelState).not.toHaveProperty('customerContext');
      expect(serialized).not.toContain('PRIVATE OLD LINE 1');
      expect(serialized).not.toContain('PRIVATE FAVORITE');
      expect(serialized).not.toContain('PRIVATE-RETRIEVED-EVIDENCE');
      expect(serialized).not.toContain('private.example/payment-token');
      expect(serialized).not.toContain('PRIVATE-OLD-ORDER-ID');
      expect(durable.order?.status).toBe(status);
      expect(durable.customerContext?.savedAddresses[0]?.line1).toBe(
        'PRIVATE OLD LINE 1',
      );
    },
  );

  it('retains an active order and only public lifecycle fields', async () => {
    const activeOrder = order('preparing');
    activeOrder.paymentStatus = 'pending';
    const durable = state({
      cart: activeOrder.cart,
      order: activeOrder,
      address: address({ line1: 'CURRENT LINE 1' }),
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'store-1',
        storeName: 'Store 1',
        feeVnd: 10_000,
        etaMinutes: 25,
        availability: {
          ok: true,
          checkedItemIds: ['item-1'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: {
            fixtureMode: 'provider_runtime',
            sourceFile: 'INTERNAL-SOURCE-FILE',
          },
        },
      },
      paymentAttempt: {
        orderId: activeOrder.id,
        method: 'method-1',
        status: 'pending',
        paymentUrl: 'https://private.example/payment-token',
      },
    });
    const publication = await bundle(durable);

    expect(publication.lifecycle).toMatchObject({
      order: 'active',
      cart: 'active',
      address: 'active',
      fulfillment: 'active',
      payment: 'active',
    });
    expect(publication.modelState.order).toMatchObject({
      id: activeOrder.id,
      status: 'preparing',
      paymentStatus: 'pending',
    });
    expect(publication.modelState.paymentAttempt).toEqual({
      method: 'method-1',
      status: 'pending',
    });
    expect(JSON.stringify(publication)).not.toContain('INTERNAL-POS-TICKET');
    expect(JSON.stringify(publication)).not.toContain('INTERNAL-SOURCE-FILE');
    expect(JSON.stringify(publication)).not.toContain('payment-token');
  });

  it('hides submitted order and payment history behind a distinct active cart', async () => {
    const submittedOrder = order('preparing');
    submittedOrder.paymentStatus = 'pending';
    const activeCart = cart('new-active-cart');
    activeCart.items = [
      {
        ...activeCart.items[0]!,
        itemCode: 'item-new-checkout',
        name: 'New checkout item',
      },
    ];
    const durable = state({
      cart: activeCart,
      order: submittedOrder,
      paymentAttempt: {
        orderId: submittedOrder.id,
        method: 'method-history',
        status: 'pending',
        paymentUrl: 'https://private.example/history-token',
      },
    });

    const publication = await bundle(durable);

    expect(publication.lifecycle).toMatchObject({
      order: 'submitted_history_hidden',
      cart: 'active',
      payment: 'history_hidden',
    });
    expect(publication.modelState.cart?.id).toBe(activeCart.id);
    expect(publication.modelState).not.toHaveProperty('order');
    expect(publication.modelState).not.toHaveProperty('paymentAttempt');
    expect(JSON.stringify(publication)).not.toContain(submittedOrder.id);
    expect(JSON.stringify(publication)).not.toContain('history-token');
    expect(durable.order).toBe(submittedOrder);
    expect(durable.paymentAttempt?.method).toBe('method-history');
  });

  it('does not publish an unbound payment attempt for an active order', async () => {
    const activeOrder = order('preparing');
    activeOrder.paymentStatus = 'pending';
    const publication = await bundle(
      state({
        cart: activeOrder.cart,
        order: activeOrder,
        paymentAttempt: {
          method: 'legacy-unbound-method',
          status: 'pending',
          paymentUrl: 'https://private.example/unbound-token',
        },
      }),
    );

    expect(publication.modelState).not.toHaveProperty('paymentAttempt');
    expect(publication.lifecycle.payment).toBe('none');
    expect(JSON.stringify(publication)).not.toContain('unbound-token');
  });

  it('retains a structurally distinct active cart beside terminal history', async () => {
    const terminalCart = cart('terminal-cart');
    const activeCart = cart('new-cart');
    const publication = await bundle(
      state({
        cart: activeCart,
        order: order('completed', terminalCart),
        address: address(),
        fulfillment: {
          method: 'delivery',
          disposition: 'delivery',
          storeId: 'terminal-history-store',
          storeName: 'Terminal History Store',
          feeVnd: 10_000,
          etaMinutes: 25,
          availability: {
            ok: true,
            checkedItemIds: ['item-1'],
            unavailableItemIds: [],
            blockedTimeslotItemIds: [],
            source: {
              fixtureMode: 'provider_runtime',
              sourceFile: 'terminal-history-source',
            },
          },
        },
      }),
    );

    expect(publication.lifecycle).toMatchObject({
      order: 'terminal_hidden',
      cart: 'active',
    });
    expect(publication.modelState.cart?.id).toBe('new-cart');
    expect(publication.modelState).not.toHaveProperty('order');
    expect(publication.modelState).not.toHaveProperty('address');
    expect(publication.modelState).not.toHaveProperty('fulfillment');
    expect(JSON.stringify(publication)).not.toContain('PRIVATE OLD LINE 1');
    expect(JSON.stringify(publication)).not.toContain('terminal-history-store');
  });

  it('hides prior address and fulfillment when a partial draft changes location', async () => {
    const durable = state({
      cart: cart(),
      address: address(),
      addressDraft: {
        district: 'District 7',
        city: 'Ho Chi Minh City',
      },
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'old-store',
        storeName: 'Old Store',
        feeVnd: 20_000,
        etaMinutes: 40,
        availability: {
          ok: true,
          checkedItemIds: ['item-1'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: {
            fixtureMode: 'provider_runtime',
            sourceFile: 'old-source',
          },
        },
      },
    });

    const publication = await bundle(durable);

    expect(publication.lifecycle.address).toBe('superseded_by_draft');
    expect(publication.lifecycle.fulfillment).toBe('superseded_by_draft');
    expect(publication.modelState.addressDraft).toEqual({
      district: 'District 7',
      city: 'Ho Chi Minh City',
    });
    expect(publication.modelState).not.toHaveProperty('address');
    expect(publication.modelState).not.toHaveProperty('fulfillment');
    expect(JSON.stringify(publication)).not.toContain('PRIVATE OLD LINE 1');
    expect(durable.address?.line1).toBe('PRIVATE OLD LINE 1');
  });

  it('also supersedes a prior address when only line1 changes', async () => {
    const durable = state({
      cart: cart(),
      address: address(),
      addressDraft: {
        line1: 'NEW CURRENT LINE 1',
        district: 'District 1',
        city: 'Ho Chi Minh City',
      },
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'old-store',
        storeName: 'Old Store',
        feeVnd: 20_000,
        etaMinutes: 40,
        availability: {
          ok: true,
          checkedItemIds: ['item-1'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: {
            fixtureMode: 'provider_runtime',
            sourceFile: 'old-source',
          },
        },
      },
    });

    const publication = await bundle(durable);

    expect(publication.lifecycle.address).toBe('superseded_by_draft');
    expect(publication.lifecycle.fulfillment).toBe('superseded_by_draft');
    expect(publication.modelState.addressDraft).toMatchObject({
      line1: 'NEW CURRENT LINE 1',
      district: 'District 1',
    });
    expect(JSON.stringify(publication)).not.toContain('PRIVATE OLD LINE 1');
    expect(JSON.stringify(publication)).not.toContain('old-store');
  });

  it('omits stale detail fields unless reissued as current-turn evidence', async () => {
    const durable = state({
      menuItemDetail: menuItem('STALE MENU DETAIL'),
      menuModifierOptions: {
        name: 'STALE MODIFIER DETAIL',
      } as AgentGraphState['menuModifierOptions'],
      promotionOffers: [
        {
          offerName: 'STALE PROMOTION OFFER',
        },
      ] as AgentGraphState['promotionOffers'],
      promotionContext: {
        matchedOfferIds: ['STALE-PROMOTION-CONTEXT'],
        caveats: ['STALE PROMOTION CAVEAT'],
      },
      contentEvidence: [
        {
          kind: 'policy',
          title: 'STALE POLICY',
          snippet: 'STALE CONTENT EVIDENCE',
          sourceUrl: 'https://example.com/stale',
          sourceFile: 'stale',
        },
      ],
    });
    const publicationAuthority = await authority(durable);
    const withoutCurrentEvidence = await buildModelPublicationBundle({
      state: durable,
      authority: publicationAuthority,
    });
    const staleSerialized = JSON.stringify(withoutCurrentEvidence);
    expect(staleSerialized).not.toContain('STALE MENU DETAIL');
    expect(staleSerialized).not.toContain('STALE MODIFIER DETAIL');
    expect(staleSerialized).not.toContain('STALE PROMOTION OFFER');
    expect(staleSerialized).not.toContain('STALE-PROMOTION-CONTEXT');
    expect(staleSerialized).not.toContain('STALE CONTENT EVIDENCE');

    const fixtures = createTestFixtures();
    fixtures.menuItems = fixtures.menuItems.map((item, index) =>
      index === 0 ? { ...item, name: 'CURRENT MENU DETAIL' } : item,
    );
    const currentEvidence = await responseEvidence({
      durable,
      publicationAuthority,
      call: {
        id: 'tool-call-current-menu-detail',
        toolName: 'searchMenu',
        arguments: { scope: 'all', query: null },
      },
      fixtures,
    });
    if (!currentEvidence) throw new Error('current evidence missing');
    const withCurrentEvidence = await buildModelPublicationBundle({
      state: durable,
      authority: publicationAuthority,
      currentTurnEvidence: [currentEvidence],
    });
    expect(JSON.stringify(withCurrentEvidence)).toContain(
      'CURRENT MENU DETAIL',
    );
    expect(privateDisclosureEvidenceIds(withCurrentEvidence)).toEqual([]);
  });

  it('publishes an active typed collection without reviving stale raw fields', async () => {
    const collectionKey = 'menu:all';
    const durable = state({
      menuSearchResults: [menuItem('STALE RAW MENU RESULT')],
      menuItemDetail: menuItem('STALE RAW DETAIL'),
      activeCollectionKeys: { searchMenu: collectionKey },
      verifiedCollections: {
        searchMenu: {
          [collectionKey]: {
            key: collectionKey,
            revision: 'internal-revision',
            providerRevision: 'internal-provider-revision',
            result: {
              items: [menuItem('ACTIVE TYPED MENU ITEM')],
              total: 1,
              returned: 1,
              complete: true,
              scope: { scope: 'all' },
            },
          },
        },
      },
    });

    const publication = await bundle(durable);
    const serialized = JSON.stringify(publication);

    expect(serialized).toContain('ACTIVE TYPED MENU ITEM');
    expect(serialized).toContain('test-chicken');
    expect(serialized).not.toContain('STALE RAW MENU RESULT');
    expect(serialized).not.toContain('STALE RAW DETAIL');
    expect(serialized).not.toContain('internal-revision');
    expect(serialized).not.toContain('internal-provider-revision');
    expect(
      publication.evidence.find(
        (entry) => entry.evidenceId === 'active_collection:searchMenu',
      ),
    ).toMatchObject({
      claimKinds: ['product', 'modifier', 'price', 'source', 'status'],
      requiredLimitations: [],
    });
    expect(publication.evidence).not.toContainEqual(
      expect.objectContaining({ evidenceId: 'active_collections' }),
    );
  });

  it('uses structural state rather than customer-text classification', async () => {
    const menu = await bundle(
      state({
        cart: cart(),
        latestUserMessage: 'Show every menu item',
      }),
    );
    const complaint = await bundle(
      state({
        cart: cart(),
        latestUserMessage: 'I need help with a complaint',
      }),
    );

    expect(menu.modelState).toEqual(complaint.modelState);
    expect(menu.lifecycle.cart).toBe('active');
    expect(complaint.lifecycle.cart).toBe('active');
    expect(menu.projectionDigest).not.toBe(complaint.projectionDigest);
    expect(menu.lifecycle.currentUserMessageDigest).not.toBe(
      complaint.lifecycle.currentUserMessageDigest,
    );
  });

  it('rejects an authority replayed across sessions with the same text and turn id', async () => {
    const original = state();
    const originalAuthority = await authority(original);
    const originalTurn = original.recentTurns?.at(-1);
    if (!originalTurn) throw new Error('current turn missing');
    const other = state({
      sessionId: 'other-session',
      customerId: 'other-customer',
      recentTurns: [
        {
          ...originalTurn,
          sessionId: 'other-session',
        },
      ],
    });

    await expect(
      buildModelPublicationBundle({
        state: other,
        authority: originalAuthority,
      }),
    ).rejects.toThrow('model_publication_authority_invalid');
  });

  it('binds exact issued bundle identity and stops private publication at auth expiry', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime('2026-07-20T00:00:00.000Z');
      const durable = privateActiveState();
      const currentUserTurn = durable.recentTurns?.at(-1);
      if (!currentUserTurn) throw new Error('current user turn missing');
      const currentAccess = accessContext();
      if (currentAccess.authenticationEvidence.state !== 'verified') {
        throw new Error('verified authentication evidence missing');
      }
      currentAccess.authenticationEvidence.expiresAt =
        '2026-07-20T00:01:00.000Z';
      const publicationAuthority = await issueModelPublicationAuthority({
        state: durable,
        currentUserTurn,
        accessContext: currentAccess,
      });
      const publication = await buildModelPublicationBundle({
        state: durable,
        authority: publicationAuthority,
      });

      expect(isIssuedModelPublicationBundle(publication)).toBe(true);
      expect(JSON.stringify(publication)).toContain('PRIVATE MEMBER REWARD');
      expect(privateDisclosureEvidenceIds(publication)).toContain(
        'active_collection:listMembershipRewards',
      );
      expect(
        validateModelPublicationReference({
          bundle: publication,
          projectionDigest: publication.projectionDigest,
        }),
      ).toBe(true);
      expect(
        validateModelPublicationReference({
          bundle: structuredClone(publication),
          projectionDigest: publication.projectionDigest,
        }),
      ).toBe(false);
      expect(
        validateModelPublicationReference({
          bundle: publication,
          projectionDigest: '0'.repeat(64),
        }),
      ).toBe(false);

      vi.setSystemTime('2026-07-20T00:02:00.000Z');
      expect(isIssuedModelPublicationBundle(publication)).toBe(false);
      expect(
        validateModelPublicationReference({
          bundle: publication,
          projectionDigest: publication.projectionDigest,
        }),
      ).toBe(false);

      const expiredAuthority = await issueModelPublicationAuthority({
        state: durable,
        currentUserTurn,
        accessContext: currentAccess,
      });
      const publicOnly = await buildModelPublicationBundle({
        state: durable,
        authority: expiredAuthority,
      });
      expect(expiredAuthority.privateAccess).toEqual({ state: 'none' });
      expect(JSON.stringify(publicOnly)).not.toContain('PRIVATE ACTIVE');
      expect(privateDisclosureEvidenceIds(publicOnly)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects spread and descriptor-copied authority capabilities', async () => {
    const durable = state();
    const genuine = await authority(durable);
    if (genuine.privateAccess.state !== 'authenticated') {
      throw new Error('authenticated private authority missing');
    }
    const spread = {
      ...genuine,
      privateAccess: {
        ...genuine.privateAccess,
        authorizedScopes: [
          ...genuine.privateAccess.authorizedScopes,
          'handoff:write' as const,
        ],
      },
    };
    spread.authorityDigest = await stateRevision({
      schemaVersion: spread.schemaVersion,
      sessionId: spread.sessionId,
      customerId: spread.customerId,
      channel: spread.channel,
      currentTurnId: spread.currentTurnId,
      currentTurnRevision: spread.currentTurnRevision,
      currentTurnExternalUserId: spread.currentTurnExternalUserId,
      surfaceSubjectRef: spread.surfaceSubjectRef,
      privateAccess: {
        ...spread.privateAccess,
        authorizedScopes: [...spread.privateAccess.authorizedScopes].sort(),
      },
    });
    const descriptorCopy = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(genuine),
    ) as ModelPublicationAuthority;

    for (const forged of [
      spread as ModelPublicationAuthority,
      descriptorCopy,
    ]) {
      await expect(
        buildModelPublicationBundle({
          state: durable,
          authority: forged,
        }),
      ).rejects.toThrow('model_publication_authority_invalid');
    }
  });

  it('binds authenticated current-turn private evidence to the bundle only', async () => {
    const durable = state();
    const publicationAuthority = await authority(durable);
    const evidence = await responseEvidence({
      durable,
      publicationAuthority,
      call: {
        id: 'tool-call-current',
        toolName: 'getRecentOrder',
        arguments: {},
      },
      clientOptions: {
        recentOrderProvider: () => ({
          ok: true,
          value: order('completed', cart('private-recent-cart')),
          message: 'recent_order_observed',
        }),
      },
    });
    expect(evidence).toBeDefined();
    if (!evidence) throw new Error('expected current-turn evidence');

    const publication = await buildModelPublicationBundle({
      state: durable,
      authority: publicationAuthority,
      currentTurnEvidence: [evidence],
    });

    expect(publication.allowedEvidenceIds).toContain(evidence.evidenceId);
    expect(privateDisclosureEvidenceIds(publication)).toEqual([
      evidence.evidenceId,
    ]);
    expect(
      publication.evidence.find(
        (entry) => entry.evidenceId === evidence.evidenceId,
      ),
    ).toMatchObject({
      publicationAuthority: 'current_turn_authenticated',
      value: {
        id: 'order-private-history',
        status: 'completed',
      },
    });
    expect(Object.isFrozen(publication)).toBe(true);
    expect(Object.isFrozen(publication.evidence)).toBe(true);
    expect(Object.isFrozen(publication.evidence.at(-1)?.value)).toBe(true);
  });

  it('rejects caller-created and descriptor-copied tool execution receipts', async () => {
    const durable = state();
    const currentAccess = accessContext();
    const publicationAuthority = await authority(durable, currentAccess);
    const call = {
      id: 'tool-call-source-capability',
      toolName: 'getSavedAddresses',
      arguments: {},
    } satisfies PendingToolCall;
    const result: GraphExecutedToolResult['result'] = {
      toolName: 'getSavedAddresses',
      ok: true,
      value: [address()],
      message: 'saved_addresses_observed',
      provenance: [],
    };
    const forged: GraphExecutedToolResult = {
      authorityDigest: publicationAuthority.authorityDigest,
      toolCallId: call.id,
      result,
    };
    const genuine = await executePublicationTool({
      authority: publicationAuthority,
      state: durable,
      accessContext: currentAccess,
      call,
      clientOptions: {
        savedAddressesProvider: () => ({
          ok: true,
          value: [address()],
          message: 'saved_addresses_observed',
        }),
      },
    });
    const copied = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(genuine),
    ) as GraphExecutedToolResult;

    for (const execution of [forged, copied]) {
      await expect(
        buildCurrentTurnResponseEvidence({
          authority: publicationAuthority,
          execution,
        }),
      ).rejects.toThrow('current_turn_response_evidence_source_invalid');
    }
  });

  it('rejects execution under a different credential or scope context', async () => {
    const durable = state();
    const currentAccess = accessContext();
    const publicationAuthority = await authority(durable, currentAccess);
    if (currentAccess.authenticationEvidence.state !== 'verified') {
      throw new Error('verified authentication evidence missing');
    }
    const mismatchedEvidence = structuredClone(currentAccess);
    if (mismatchedEvidence.authenticationEvidence.state !== 'verified') {
      throw new Error('verified authentication evidence missing');
    }
    mismatchedEvidence.authenticationEvidence.evidenceRef =
      'different-authentication-evidence';
    const mismatchedScopes = structuredClone(currentAccess);
    mismatchedScopes.authorizedScopes =
      mismatchedScopes.authorizedScopes.filter(
        (scope) => scope !== 'payment:write',
      );
    const provider = vi.fn(() => ({
      ok: true as const,
      value: [address()],
      message: 'must not be reached',
    }));

    for (const runtimeAccess of [mismatchedEvidence, mismatchedScopes]) {
      await expect(
        executePublicationTool({
          authority: publicationAuthority,
          state: durable,
          accessContext: runtimeAccess,
          call: {
            id: crypto.randomUUID(),
            toolName: 'getSavedAddresses',
            arguments: {},
          },
          clientOptions: { savedAddressesProvider: provider },
        }),
      ).rejects.toThrow('graph_executed_tool_result_authority_invalid');
    }
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects a coherently rehashed structural evidence forgery', async () => {
    const durable = state();
    const publicationAuthority = await authority(durable);
    const genuine = await responseEvidence({
      durable,
      publicationAuthority,
      call: {
        id: 'tool-call-forgery',
        toolName: 'getSavedAddresses',
        arguments: {},
      },
      clientOptions: {
        savedAddressesProvider: () => ({
          ok: true,
          value: [address()],
          message: 'saved_addresses_observed',
        }),
      },
    });
    if (!genuine) throw new Error('genuine evidence missing');
    const forged = {
      ...genuine,
      claimKinds: [...genuine.claimKinds],
      value: structuredClone(genuine.value),
    } as CurrentTurnResponseEvidence;
    forged.value = [address({ line1: 'FORGED PRIVATE LINE' })];
    forged.digest = await stateRevision({
      schemaVersion: 'kfc-current-turn-response-evidence-v1',
      authorityDigest: publicationAuthority.authorityDigest,
      currentTurnRevision: publicationAuthority.currentTurnRevision,
      toolCallId: forged.toolCallId,
      toolName: forged.toolName,
      claimKinds: forged.claimKinds,
      value: forged.value,
      privateData: true,
      executionOutcome: forged.executionOutcome,
    });
    forged.evidenceId = `current:${forged.toolName}:${forged.digest}`;

    await expect(
      buildModelPublicationBundle({
        state: durable,
        authority: publicationAuthority,
        currentTurnEvidence: [forged],
      }),
    ).rejects.toThrow('current_turn_response_evidence_invalid');
  });

  it('rejects a descriptor-copied current evidence capability', async () => {
    const durable = state();
    const publicationAuthority = await authority(durable);
    const genuine = await responseEvidence({
      durable,
      publicationAuthority,
      call: {
        id: 'tool-call-descriptor-copy',
        toolName: 'getFavoriteItems',
        arguments: {},
      },
      clientOptions: {
        favoriteItemsProvider: () => ({
          ok: true,
          value: [menuItem()],
          message: 'favorites_observed',
        }),
      },
    });
    if (!genuine) throw new Error('current evidence missing');
    const copied = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(genuine),
    ) as CurrentTurnResponseEvidence;

    await expect(
      buildModelPublicationBundle({
        state: durable,
        authority: publicationAuthority,
        currentTurnEvidence: [copied],
      }),
    ).rejects.toThrow('current_turn_response_evidence_invalid');
  });

  it('rejects duplicate current-turn evidence identities', async () => {
    const durable = state();
    const publicationAuthority = await authority(durable);
    const evidence = await responseEvidence({
      durable,
      publicationAuthority,
      call: {
        id: 'tool-call-duplicate',
        toolName: 'getFavoriteItems',
        arguments: {},
      },
      clientOptions: {
        favoriteItemsProvider: () => ({
          ok: true,
          value: [menuItem()],
          message: 'favorites_observed',
        }),
      },
    });
    if (!evidence) throw new Error('current evidence missing');

    await expect(
      buildModelPublicationBundle({
        state: durable,
        authority: publicationAuthority,
        currentTurnEvidence: [evidence, evidence],
      }),
    ).rejects.toThrow('current_turn_response_evidence_invalid');
  });

  it('requires the exact authenticated tool scope for private evidence', async () => {
    const durable = state();
    const currentUserTurn = durable.recentTurns?.at(-1);
    if (!currentUserTurn) throw new Error('current user turn missing');
    const currentAccess = accessContext(['customer:read']);
    const publicationAuthority = await issueModelPublicationAuthority({
      state: durable,
      currentUserTurn,
      accessContext: currentAccess,
    });

    await expect(
      responseEvidence({
        durable,
        publicationAuthority,
        currentAccess,
        call: {
          id: 'tool-call-order-without-order-scope',
          toolName: 'getRecentOrder',
          arguments: {},
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('does not issue publication authority without verified authentication', async () => {
    const durable = state();
    const currentUserTurn = durable.recentTurns?.at(-1);
    if (!currentUserTurn) throw new Error('current user turn missing');
    const unverified = accessContext();
    unverified.authenticationState = 'unauthenticated';

    await expect(
      issueModelPublicationAuthority({
        state: durable,
        currentUserTurn,
        accessContext: unverified,
      }),
    ).rejects.toThrow('model_publication_authority_invalid');
  });

  it('does not issue authority for a different surface subject', async () => {
    const durable = state();
    const currentUserTurn = durable.recentTurns?.at(-1);
    if (!currentUserTurn) throw new Error('current user turn missing');
    const mismatched = accessContext();
    mismatched.surfaceSubjectRef = 'different-channel-user';

    await expect(
      issueModelPublicationAuthority({
        state: durable,
        currentUserTurn,
        accessContext: mismatched,
      }),
    ).rejects.toThrow('model_publication_authority_invalid');
  });

  it('binds an external-channel authority to the exact current surface user', async () => {
    const base = state();
    const baseTurn = base.recentTurns?.at(-1);
    if (!baseTurn) throw new Error('current user turn missing');
    const durable = state({
      channel: 'messenger',
      recentTurns: [
        {
          ...baseTurn,
          channel: 'messenger',
          externalUserId: 'messenger-user-a',
        },
      ],
    });
    const currentUserTurn = durable.recentTurns?.at(-1);
    if (!currentUserTurn) throw new Error('current user turn missing');
    const currentAccess = accessContext();
    currentAccess.customerSurface = 'messenger';
    currentAccess.surfaceSubjectRef = 'messenger-user-a';
    currentAccess.channelAccountLinkState = 'linked';

    await expect(
      issueModelPublicationAuthority({
        state: durable,
        currentUserTurn,
        accessContext: currentAccess,
      }),
    ).resolves.toMatchObject({
      surfaceSubjectRef: 'messenger-user-a',
      privateAccess: {
        state: 'authenticated',
        surfaceSubjectRef: 'messenger-user-a',
      },
    });

    currentAccess.surfaceSubjectRef = 'messenger-user-b';
    await expect(
      issueModelPublicationAuthority({
        state: durable,
        currentUserTurn,
        accessContext: currentAccess,
      }),
    ).rejects.toThrow('model_publication_authority_invalid');
  });

  it.each([
    {
      toolName: 'acquireVoucher' as const,
      targetId: 'reward-discount-10k',
    },
    {
      toolName: 'redeemReward' as const,
      targetId: 'wallet-new-member-25k',
    },
  ])(
    'keeps successful legacy $toolName receipts non-authoritative',
    async ({ toolName, targetId }) => {
      const durable = state();
      const publicationAuthority = await authority(durable);
      const evidenceDigest = 'a'.repeat(64);
      const receipt = {
        schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2' as const,
        evidenceId: `current:${toolName}:${evidenceDigest}`,
        evidenceDigest,
        toolCallId: `legacy-${toolName}-call`,
        toolName,
        executionOutcome: 'success' as const,
        result: 'audit_evidence_reference' as const,
      };
      const trace: ToolTraceEntry = {
        toolName,
        arguments: {
          privateArgumentsDigest: 'b'.repeat(64),
        },
        ok: true,
        resultSummary: 'membership_action_completed',
        provenance: [],
        publicationEvidenceAudit: {
          schemaVersion: 'kfc-tool-trace-publication-audit-v1',
          currentTurnId: publicationAuthority.currentTurnId,
          traceIndex: 0,
          traceDigest: 'c'.repeat(64),
          argumentsDigest: 'b'.repeat(64),
          toolCallId: receipt.toolCallId,
          toolName,
          executionOutcome: 'success',
          evidenceId: receipt.evidenceId,
          evidenceDigest,
          membershipActionOutcome: {
            actionId: `legacy-${toolName}-action`,
            status: 'completed',
            requiresUserConfirmation: false,
            targetId,
          },
        },
      };

      await expect(
        traceReceiptIsRecoverable({
          trace,
          receipt,
          currentTurnId: publicationAuthority.currentTurnId,
          traceIndex: 0,
        }),
      ).resolves.toBe(false);
      await expect(
        rehydrateCheckpointSafeCurrentTurnEvidence({
          authority: publicationAuthority,
          trace,
          receipt,
        }),
      ).rejects.toThrow('checkpoint_current_turn_evidence_unrecoverable');
    },
  );

  it('serializes only a neutral audit receipt with the actual execution outcome', async () => {
    const durable = state();
    const publicationAuthority = await authority(durable);
    const successfulEvidence = await responseEvidence({
      durable,
      publicationAuthority,
      call: {
        id: 'tool-call-private',
        toolName: 'getSavedAddresses',
        arguments: {},
      },
      clientOptions: {
        savedAddressesProvider: () => ({
          ok: true,
          value: [address()],
          message: 'saved_addresses_observed',
        }),
      },
    });
    if (!successfulEvidence) {
      throw new Error('expected successful current-turn evidence');
    }
    const failedEvidence = await responseEvidence({
      durable,
      publicationAuthority,
      call: {
        id: 'tool-call-private-failure',
        toolName: 'getSavedAddresses',
        arguments: {},
      },
      clientOptions: {
        savedAddressesProvider: () => ({
          ok: false,
          errorCode: 'saved_addresses_unavailable',
          message: 'private provider diagnostic',
        }),
      },
    });
    if (!failedEvidence) {
      throw new Error('expected failed current-turn evidence');
    }

    const successfulReceipt =
      checkpointSafeToolEvidenceReceipt(successfulEvidence);
    const failedReceipt = checkpointSafeToolEvidenceReceipt(failedEvidence);
    const serialized = JSON.stringify([successfulReceipt, failedReceipt]);

    expect(successfulReceipt).toEqual({
      schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2',
      evidenceId: successfulEvidence.evidenceId,
      evidenceDigest: successfulEvidence.digest,
      toolCallId: 'tool-call-private',
      toolName: 'getSavedAddresses',
      executionOutcome: 'success',
      result: 'audit_evidence_reference',
    });
    expect(failedReceipt).toEqual({
      schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2',
      evidenceId: failedEvidence.evidenceId,
      evidenceDigest: failedEvidence.digest,
      toolCallId: 'tool-call-private-failure',
      toolName: 'getSavedAddresses',
      executionOutcome: 'error',
      result: 'audit_evidence_reference',
    });
    expect(successfulReceipt).not.toHaveProperty('ok');
    expect(failedReceipt).not.toHaveProperty('ok');
    expect(serialized).not.toContain('runtime_evidence_available');
    expect(serialized).not.toContain('PRIVATE OLD LINE 1');
    expect(serialized).not.toContain('District 1');
    expect(serialized).not.toContain('Ho Chi Minh City');
    expect(serialized).not.toContain('private provider diagnostic');
    expect(serialized).not.toContain('saved_addresses_unavailable');
    expect(() =>
      checkpointSafeToolEvidenceReceipt({
        ...successfulEvidence,
      }),
    ).toThrow('checkpoint_tool_evidence_receipt_source_invalid');
  });
});
