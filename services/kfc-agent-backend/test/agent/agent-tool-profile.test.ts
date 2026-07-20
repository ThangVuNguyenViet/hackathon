import { describe, expect, it } from 'vitest';
import {
  createAgentToolCapabilitySnapshot,
  deriveAgentToolProfile,
  type AgentToolProfileLifecycle,
} from '../../src/agent/agentToolProfile.js';
import type {
  Address,
  Cart,
  CustomerAccessContext,
  MenuItem,
  Order,
} from '../../src/domain/types.js';
import {
  TOOL_NAMES,
  type CollectionToolName,
  type FulfillmentState,
  type VerifiedGuestApprovalResumeAuthority,
  type VerifiedCollectionSnapshot,
} from '../../src/ordering/types.js';
import {
  replaceVerifiedCollection,
} from '../../src/ordering/verifiedCollections.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';

const now = Date.parse('2026-07-20T00:00:00.000Z');

function lifecycle(
  overrides: Partial<AgentToolProfileLifecycle> = {},
): AgentToolProfileLifecycle {
  return {
    sessionId: 'profile-session',
    customerId: 'profile-customer',
    channel: 'kfc',
    ...overrides,
  };
}

function capabilities(input: {
  enabledTools?: readonly unknown[];
  durableApprovalResumeSupported?: boolean;
  channel?: AgentToolProfileLifecycle['channel'];
} = {}) {
  return createAgentToolCapabilitySnapshot({
    channel: input.channel ?? 'kfc',
    enabledTools: input.enabledTools ?? TOOL_NAMES,
    durableApprovalResumeSupported:
      input.durableApprovalResumeSupported ?? true,
    handoffResolutionSupported: true,
  });
}

function access(
  scopes?: CustomerAccessContext['authorizedScopes'],
): CustomerAccessContext {
  const context = controlledCustomerAccess({
    sessionId: 'profile-session',
    customerId: 'profile-customer',
  });
  context.authorizedScopes = scopes ?? [
    ...context.authorizedScopes,
    'handoff:write',
  ];
  return context;
}

function snapshot<Item>(
  items: readonly Item[],
  complete = true,
): VerifiedCollectionSnapshot<Item> {
  return {
    key: 'active',
    revision: 'collection-revision',
    providerRevision: 'provider-revision',
    result: {
      items: [...items],
      total: items.length,
      returned: items.length,
      complete,
      scope: { scope: 'all' },
    },
  };
}

function withActiveCollection(
  state: AgentToolProfileLifecycle,
  toolName: CollectionToolName,
  items: readonly unknown[],
  complete = true,
): AgentToolProfileLifecycle {
  return {
    ...state,
    verifiedCollections: replaceVerifiedCollection(
      state.verifiedCollections,
      toolName,
      snapshot(items, complete),
    ),
    activeCollectionKeys: {
      ...(state.activeCollectionKeys ?? {}),
      [toolName]: 'active',
    },
  };
}

function verifiedMenuItem(code = 'verified-menu-item'): MenuItem {
  return {
    code,
    category: 'Combo',
    categoryId: 'test-combo',
    name: 'Verified item',
    description: 'Verified description',
    priceVnd: 99_000,
    originalPriceVnd: null,
    imageUrl: 'https://example.test/item.png',
    available: true,
  };
}

function verifiedCart(itemCode = 'verified-menu-item'): Cart {
  return {
    id: 'cart-1',
    items: [{
      itemCode,
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

function verifiedAddress(): Address {
  return {
    label: 'Verified address',
    line1: '1 Test Street',
    district: 'Test District',
    city: 'Test City',
  };
}

function verifiedFulfillment(): FulfillmentState {
  return {
    method: 'delivery',
    disposition: 'delivery',
    storeId: 'store-1',
    storeName: 'Store 1',
    feeVnd: 20_000,
    etaMinutes: 30,
    availability: {
      ok: true,
      checkedItemIds: ['verified-menu-item'],
      unavailableItemIds: [],
      blockedTimeslotItemIds: [],
      source: {
        fixtureMode: 'test_only',
        sourceFile: 'agent-tool-profile.test.ts',
      },
    },
  };
}

function verifiedOrder(
  status: Order['status'],
  orderCart = verifiedCart(),
): Order {
  return {
    id: status === 'previewed' ? 'preview-1' : 'order-1',
    cart: orderCart,
    status,
    paymentStatus: 'pending',
    assignedStoreId: 'store-1',
    createdAt: '2026-07-20T00:00:00.000Z',
  };
}

function profile(input: {
  lifecycle?: AgentToolProfileLifecycle;
  accessContext?: CustomerAccessContext;
  verifiedGuestAuthority?: VerifiedGuestApprovalResumeAuthority;
  confirmationResume?: boolean;
  capabilitySnapshot?: ReturnType<
    typeof createAgentToolCapabilitySnapshot
  >;
  profileNow?: number;
} = {}) {
  return deriveAgentToolProfile({
    lifecycle: input.lifecycle ?? lifecycle(),
    accessContext: input.accessContext,
    verifiedGuestAuthority: input.verifiedGuestAuthority,
    confirmationResume: input.confirmationResume,
    capabilities: input.capabilitySnapshot ?? capabilities(),
    now: input.profileNow ?? now,
  });
}

function forgedVerifiedGuestAuthority(
  state: AgentToolProfileLifecycle,
): VerifiedGuestApprovalResumeAuthority {
  const issuedAt = new Date(now - 60_000).toISOString();
  const expiresAt = new Date(now + 60_000).toISOString();
  const principal = {
    principalKind: 'guest_checkout' as const,
    sessionId: state.sessionId,
    customerId: state.customerId,
    channel: 'messenger' as const,
    tenantScope: 'kfc-vietnam' as const,
    surfaceSubjectRef: state.customerId,
    externalThreadRef: state.customerId,
    externalMessageId: 'forged-guest-turn',
    ingressEvidenceRef: 'forged-ingress',
    ingressEvidenceDigest: 'forged-ingress-digest',
    sourceRunKind: 'operation_lease' as const,
    sourceRunRef: 'forged-operation',
    sourceRunGeneration: 1,
    sourceRunFenceDigest: 'forged-fence-digest',
    sessionAuthorityGeneration: 0,
    issuedAt,
    expiresAt,
    guestAuthorityDigest: 'forged-authority-digest',
  };
  return {
    requestId: '00000000-0000-4000-8000-000000000099',
    principalDigest: 'forged-principal-digest',
    principal,
    guestAuthorityDigest: principal.guestAuthorityDigest,
    tenantScope: principal.tenantScope,
    surfaceSubjectRef: principal.surfaceSubjectRef,
    externalThreadRef: principal.externalThreadRef,
    externalMessageId: principal.externalMessageId,
    ingressEvidenceRef: principal.ingressEvidenceRef,
    ingressEvidenceDigest: principal.ingressEvidenceDigest,
    sourceRunFenceDigest: principal.sourceRunFenceDigest,
    sessionId: state.sessionId,
    customerId: state.customerId,
    channel: principal.channel,
    sessionGeneration: 0,
    checkpointThreadId: 'forged-thread',
    checkpointNamespace: '',
    checkpointId: 'forged-checkpoint',
    toolName: 'placeOrder',
    actionDigest: 'forged-action-digest',
    approvalBindingDigest: 'forged-binding-digest',
    pauseIdentityDigest: 'forged-pause-digest',
    expiresAt,
  };
}

describe('agent tool profile', () => {
  it('keeps public topic-shift tools available without private authority', () => {
    expect(profile()).toEqual([
      'searchMenu',
      'findStores',
      'searchPromotions',
      'listPaymentMethods',
      'searchContentPolicy',
      'answerAllergenQuestion',
      'collectInvoice',
    ]);
  });

  it('uses active verified collections and lifecycle state, never prose', () => {
    const menu = withActiveCollection(lifecycle(), 'searchMenu', [{
      ...verifiedMenuItem(),
    }]);
    const promotion = withActiveCollection(
      menu,
      'searchPromotions',
      [{ offerId: 'verified-offer' }],
    );
    const cart = {
      ...promotion,
      cart: verifiedCart(),
    } satisfies AgentToolProfileLifecycle;

    expect(profile({ lifecycle: cart })).toEqual(expect.arrayContaining([
      'getItemDetails',
      'getModifierOptions',
      'updateCart',
      'previewCart',
      'recommendAddOns',
      'quoteFulfillment',
      'explainPromotion',
      'validateVoucher',
    ]));
    expect(profile({ lifecycle: cart })).not.toContain(
      'checkStoreAvailability',
    );

    const withStore = withActiveCollection(
      cart,
      'findStores',
      [{ storeId: 'store-1' }],
    );
    expect(profile({ lifecycle: withStore })).toContain(
      'checkStoreAvailability',
    );
  });

  it('fails closed on stale or malformed active collection pointers', () => {
    const stale = lifecycle({
      activeCollectionKeys: { searchMenu: 'missing' },
      verifiedCollections: {
        searchMenu: {
          active: snapshot([verifiedMenuItem('item-1')]),
        },
      },
    });
    const malformed = lifecycle({
      activeCollectionKeys: { searchMenu: 'active' },
      verifiedCollections: {
        searchMenu: {
          active: {
            ...snapshot([verifiedMenuItem('item-1')]),
            revision: '',
          },
        },
      },
    });

    for (const state of [stale, malformed]) {
      expect(profile({ lifecycle: state })).not.toContain('getItemDetails');
      expect(profile({ lifecycle: state })).not.toContain(
        'getModifierOptions',
      );
    }
  });

  it('uses exact current access authorization for private reads', () => {
    const authorized = profile({ accessContext: access() });
    expect(authorized).toEqual(expect.arrayContaining([
      'getMembershipProfile',
      'listMembershipRewards',
      'listMembershipWallet',
      'getMembershipPointHistory',
      'listMembershipTools',
      'getSavedAddresses',
      'getRecentOrder',
      'getFavoriteItems',
    ]));

    const expired = access();
    if (expired.authenticationEvidence.state !== 'verified') {
      throw new Error('expected verified test access');
    }
    expired.authenticationEvidence.expiresAt =
      '2026-07-19T23:59:59.999Z';
    expect(profile({ accessContext: expired })).not.toContain(
      'getMembershipProfile',
    );

    const mismatched = access();
    mismatched.sessionRef = 'another-session';
    expect(profile({ accessContext: mismatched })).not.toContain(
      'getSavedAddresses',
    );
  });

  it('requires external-channel account binding for private tools', () => {
    const state = lifecycle({ channel: 'zalo' });
    const linked = controlledCustomerAccess({
      sessionId: state.sessionId,
      customerId: state.customerId,
      channel: state.channel,
    });
    const channelCapabilities = capabilities({ channel: 'zalo' });
    expect(profile({
      lifecycle: state,
      accessContext: linked,
      capabilitySnapshot: channelCapabilities,
    })).toContain('getRecentOrder');

    linked.channelAccountLinkState = 'unlinked';
    expect(profile({
      lifecycle: state,
      accessContext: linked,
      capabilitySnapshot: channelCapabilities,
    })).not.toContain('getRecentOrder');
  });

  it('supports the S02 public multi-tool discovery subset', () => {
    const available = profile();
    expect(available).toEqual(expect.arrayContaining([
      'searchMenu',
      'searchPromotions',
    ]));
  });

  it('supports the S07 mixed reads and later verified member actions', () => {
    const withMenu = withActiveCollection(
      lifecycle(),
      'searchMenu',
      [verifiedMenuItem('verified-combo')],
    );
    const withCart = {
      ...withMenu,
      cart: verifiedCart('verified-combo'),
    } satisfies AgentToolProfileLifecycle;
    const readProfile = profile({
      lifecycle: withCart,
      accessContext: access(),
    });
    expect(readProfile).toEqual(expect.arrayContaining([
      'updateCart',
      'getMembershipProfile',
      'listMembershipRewards',
      'listMembershipWallet',
      'getMembershipPointHistory',
      'listMembershipTools',
    ]));

    const withRewards = withActiveCollection(
      withCart,
      'listMembershipRewards',
      [{ rewardId: 'reward-discount-10k' }],
    );
    const withWallet = withActiveCollection(
      withRewards,
      'listMembershipWallet',
      [{ voucherId: 'wallet-new-member-25k' }],
    );
    const actionProfile = profile({
      lifecycle: withWallet,
      accessContext: access(),
    });
    expect(actionProfile).toEqual(expect.arrayContaining([
      'acquireVoucher',
      'redeemReward',
    ]));
  });

  it('gates order and payment actions on verified lifecycle and scopes', () => {
    const stateWithCart = lifecycle({
      cart: verifiedCart('verified-item'),
      address: verifiedAddress(),
      fulfillment: verifiedFulfillment(),
    });
    expect(profile({ lifecycle: stateWithCart })).toContain('previewOrder');

    const orderState = lifecycle({
      ...stateWithCart,
      orderPreview: verifiedOrder('previewed', stateWithCart.cart),
      order: verifiedOrder('created', stateWithCart.cart),
    });
    const withMethods = withActiveCollection(
      orderState,
      'listPaymentMethods',
      [{
        methodId: 'payment-method-1',
        supported: true,
        supportStatus: 'listed_supported',
      }],
    );
    const orderProfile = profile({
      lifecycle: withMethods,
      accessContext: access(),
    });
    expect(orderProfile).toEqual(expect.arrayContaining([
      'placeOrder',
      'getOrderStatus',
      'createPaymentLink',
      'checkPaymentStatus',
    ]));

    const readOnly = access([
      'customer:read',
      'order:read',
      'payment:read',
    ]);
    const readOnlyProfile = profile({
      lifecycle: withMethods,
      accessContext: readOnly,
    });
    expect(readOnlyProfile).toEqual(expect.arrayContaining([
      'getOrderStatus',
      'checkPaymentStatus',
    ]));
    expect(readOnlyProfile).not.toContain('placeOrder');
    expect(readOnlyProfile).not.toContain('createPaymentLink');

    const nextCheckout = {
      ...withMethods,
      cart: {
        ...verifiedCart('verified-next-item'),
        id: 'next-checkout-cart',
      },
    } satisfies AgentToolProfileLifecycle;
    const nextCheckoutProfile = profile({
      lifecycle: nextCheckout,
      accessContext: access(),
    });
    expect(nextCheckoutProfile).toEqual(expect.arrayContaining([
      'getOrderStatus',
      'checkPaymentStatus',
    ]));
    expect(nextCheckoutProfile).not.toContain('createPaymentLink');
  });

  it('does not enable payment from an unissued or cloned guest approval', () => {
    const guestState = lifecycle({
      sessionId: 'guest-profile-session',
      customerId: 'guest-profile-customer',
      channel: 'messenger',
      order: verifiedOrder('created'),
    });
    const withMethods = withActiveCollection(
      guestState,
      'listPaymentMethods',
      [{
        methodId: 'payment-method-1',
        supported: true,
        supportStatus: 'listed_supported',
      }],
    );
    const forged = forgedVerifiedGuestAuthority(withMethods);

    for (const candidate of [forged, structuredClone(forged)]) {
      expect(profile({
        lifecycle: withMethods,
        capabilitySnapshot: capabilities({ channel: 'messenger' }),
        verifiedGuestAuthority: candidate,
        confirmationResume: true,
      })).not.toContain('createPaymentLink');
    }
  });

  it('requires durable approval support for approval capabilities', () => {
    const withRewards = withActiveCollection(
      lifecycle(),
      'listMembershipRewards',
      [{ rewardId: 'reward-1' }],
    );
    const noApproval = capabilities({
      durableApprovalResumeSupported: false,
    });
    const available = profile({
      lifecycle: withRewards,
      accessContext: access(),
      capabilitySnapshot: noApproval,
    });
    expect(available).not.toContain('acquireVoucher');
    expect(available).not.toContain('handoff');
  });

  it('follows the current authenticated handoff authority contract', () => {
    expect(profile({
      accessContext: access([
        'customer:read',
        'membership:read',
        'membership:write',
        'order:read',
        'order:write',
        'payment:read',
        'payment:write',
      ]),
    })).not.toContain('handoff');
    expect(profile({ accessContext: access() })).toContain('handoff');
    expect(profile({ accessContext: access() }))
      .not.toContain('resolveHandoff');
    expect(profile({
      accessContext: access(),
      lifecycle: lifecycle({
        handoff: {
          escalationId: 'provider-escalation-1',
          reasons: ['customer_requested_support'],
        },
      }),
    })).toContain('resolveHandoff');
  });

  it('does not advertise resolveHandoff without provider support', () => {
    expect(profile({
      accessContext: access(),
      lifecycle: lifecycle({
        handoff: {
          escalationId: 'provider-escalation-1',
          reasons: ['customer_requested_support'],
        },
      }),
      capabilitySnapshot: createAgentToolCapabilitySnapshot({
        channel: 'kfc',
        enabledTools: TOOL_NAMES,
        durableApprovalResumeSupported: true,
        handoffResolutionSupported: false,
      }),
    })).not.toContain('resolveHandoff');
  });

  it('lets explicit deployment capability only subtract tools', () => {
    const subset = capabilities({
      enabledTools: ['searchPromotions', 'collectInvoice'],
    });
    expect(profile({ capabilitySnapshot: subset })).toEqual([
      'searchPromotions',
      'collectInvoice',
    ]);
  });

  it('returns all 33 tools exactly once in canonical order when eligible', () => {
    let state = lifecycle({
      cart: verifiedCart('item-1'),
      address: verifiedAddress(),
      fulfillment: verifiedFulfillment(),
      orderPreview: verifiedOrder('previewed', verifiedCart('item-1')),
      order: verifiedOrder('created', verifiedCart('item-1')),
      handoff: {
        escalationId: 'provider-escalation-1',
        reasons: ['customer_requested_support'],
      },
    });
    for (const [toolName, items] of [
      ['searchMenu', [verifiedMenuItem('item-1')]],
      ['findStores', [{ storeId: 'store-1' }]],
      ['searchPromotions', [{ offerId: 'offer-1' }]],
      ['listMembershipRewards', [{ rewardId: 'reward-1' }]],
      ['listMembershipWallet', [{ voucherId: 'voucher-1' }]],
      ['listPaymentMethods', [{
        methodId: 'method-1',
        supported: true,
        supportStatus: 'listed_supported',
      }]],
    ] as const) {
      state = withActiveCollection(state, toolName, items);
    }

    expect(profile({
      lifecycle: state,
      accessContext: access(),
    })).toEqual(TOOL_NAMES);
  });

  it('rejects unissued, duplicate, or cross-channel capability snapshots', () => {
    expect(() => createAgentToolCapabilitySnapshot({
      channel: 'kfc',
      enabledTools: ['searchMenu', 'searchMenu'],
      durableApprovalResumeSupported: true,
      handoffResolutionSupported: true,
    })).toThrow('agent_tool_capability_snapshot_duplicate_tool');
    expect(() => createAgentToolCapabilitySnapshot({
      channel: 'kfc',
      enabledTools: ['not-a-tool'],
      durableApprovalResumeSupported: true,
      handoffResolutionSupported: true,
    })).toThrow('agent_tool_capability_snapshot_invalid');

    expect(() => deriveAgentToolProfile({
      lifecycle: lifecycle(),
      accessContext: access(),
      capabilities: {
        schemaVersion: 'kfc-agent-tool-capabilities-v1',
        channel: 'kfc',
        enabledTools: TOOL_NAMES,
        durableApprovalResumeSupported: true,
        handoffResolutionSupported: true,
      },
      now,
    })).toThrow('agent_tool_capability_snapshot_invalid');
    expect(() => profile({
      lifecycle: lifecycle({ channel: 'zalo' }),
      capabilitySnapshot: capabilities({ channel: 'kfc' }),
    })).toThrow('agent_tool_capability_snapshot_invalid');
  });
});
