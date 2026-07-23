import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { AgentTurnInput } from '../../src/graph/agentTurnState.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import * as verifiedStateModule from '../../src/graph/verifiedState.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const {
  applyAgentCollectionToVerifiedState,
  applyToolResultToState,
  buildVerifiedStateSnapshot,
  extractVerifiedStateSnapshot,
} = verifiedStateModule;

const paymentCollectionKey = 'payment-methods:all';
const paymentCollectionRevision = 'payment-collection-revision-1';
const paymentProviderRevision = 'payment-provider-revision-1';

function paymentSelection(methodId: string) {
  return {
    methodId,
    collectionKey: paymentCollectionKey,
    collectionRevision: paymentCollectionRevision,
    providerRevision: paymentProviderRevision,
  };
}

function paymentState(
  overrides: Partial<AgentGraphState> = {},
): AgentGraphState {
  return {
    sessionId: 'payment-session',
    customerId: 'payment-customer',
    channel: 'kfc',
    latestUserMessage: '',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    ...overrides,
  };
}

function paymentOrder(id: string): NonNullable<AgentGraphState['order']> {
  return {
    id,
    cart: {
      id: `cart-${id}`,
      items: [],
      subtotalVnd: 0,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 0,
      voucherCode: null,
    },
    status: 'created',
    paymentStatus: 'pending',
    assignedStoreId: 'KFC-Q5',
    createdAt: '2026-07-20T00:00:00.000Z',
  };
}

function applyPaymentMethodEvidence(
  state: AgentGraphState,
  methodIds: string[],
  query: string | undefined,
  authority: {
    collectionKey?: string;
    collectionRevision?: string;
    providerRevision?: string;
  } = {},
): void {
  const collectionKey =
    authority.collectionKey ?? paymentCollectionKey;
  const collectionRevision =
    authority.collectionRevision ?? paymentCollectionRevision;
  const providerRevision =
    authority.providerRevision ?? paymentProviderRevision;
  const value = createTestFixtures().paymentMethods.filter(
    ({ methodId }) => methodIds.includes(methodId),
  );
  applyAgentCollectionToVerifiedState(
    state,
    {
      toolName: 'listPaymentMethods',
      ok: true,
      value: {
        items: value,
        total: value.length,
        returned: value.length,
        complete: true,
        scope: query
          ? { scope: 'filtered', query }
          : { scope: 'all' },
      },
      message: 'verified payment methods',
      provenance: [],
      verifiedCollection: {
        key: collectionKey,
        revision: collectionRevision,
        providerRevision,
        result: {
          items: value,
          total: value.length,
          returned: value.length,
          complete: true,
          scope: query
            ? { scope: 'filtered', query }
            : { scope: 'all' },
        },
      },
    },
  );
}

describe('verified state', () => {
  it('does not expose deterministic tool-call merge or suppression helpers', () => {
    expect(verifiedStateModule).not.toHaveProperty('canonicalJsonValue');
    expect(verifiedStateModule).not.toHaveProperty('stableToolCallKey');
    expect(verifiedStateModule).not.toHaveProperty(
      'hasSuccessfulCurrentTurnToolCall',
    );
    expect(verifiedStateModule).not.toHaveProperty(
      'normalizeNewItemCartUpdates',
    );
    expect(verifiedStateModule).not.toHaveProperty('deduplicateToolCalls');
  });

  it('retains a matching fulfillment quote with truthful unavailable evidence', () => {
    const cart: NonNullable<AgentGraphState['cart']> = {
      id: 'availability-cart',
      items: [{
        itemCode: 'item-1',
        name: 'Item 1',
        quantity: 1,
        unitPriceVnd: 50_000,
      }],
      subtotalVnd: 50_000,
      discountVnd: 0,
      deliveryFeeVnd: 18_000,
      totalVnd: 68_000,
      voucherCode: null,
    };
    const state = paymentState({
      cart,
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'store-1',
        storeName: 'Verified store',
        feeVnd: 18_000,
        etaMinutes: 35,
        availability: {
          ok: true,
          checkedItemIds: ['item-1'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: {
            fixtureMode: 'test_only',
            sourceFile: 'prior-quote',
          },
        },
      },
      orderPreview: {
        id: 'preview-1',
        cart,
        status: 'previewed',
        paymentStatus: 'not_started',
        assignedStoreId: 'store-1',
        createdAt: '2026-07-20T00:00:00.000Z',
      },
    });

    applyToolResultToState(
      {
        sessionId: state.sessionId,
        dashboard: new DashboardEventBus(),
      } as AgentTurnInput,
      state,
      {
        toolName: 'checkStoreAvailability',
        ok: true,
        value: { 'item-1': false },
        message: 'ok',
        provenance: [{
          fixtureMode: 'provider_runtime',
          sourceFile: 'inventory-provider',
          sourceApi: 'provider://inventory',
        }],
      },
      {
        storeId: 'store-1',
        itemCodes: ['item-1'],
        disposition: 'delivery',
      },
      [],
    );

    expect(state.fulfillment).toMatchObject({
      storeId: 'store-1',
      disposition: 'delivery',
      feeVnd: 18_000,
      availability: {
        ok: false,
        checkedItemIds: ['item-1'],
        unavailableItemIds: ['item-1'],
        blockedTimeslotItemIds: [],
        source: {
          fixtureMode: 'provider_runtime',
          sourceFile: 'inventory-provider',
        },
      },
    });
    expect(state.cart).toEqual(cart);
    expect(state.orderPreview).toBeUndefined();
    expect(state).not.toHaveProperty('entities');
    expect(state.escalationReasons).toContain(
      'item_unavailable_before_confirmation',
    );
  });

  it('fails closed instead of preserving available fulfillment when atomic provenance is absent', () => {
    const cart: NonNullable<AgentGraphState['cart']> = {
      id: 'availability-cart-missing-source',
      items: [{
        itemCode: 'item-1',
        name: 'Item 1',
        quantity: 1,
        unitPriceVnd: 50_000,
      }],
      subtotalVnd: 50_000,
      discountVnd: 0,
      deliveryFeeVnd: 18_000,
      totalVnd: 68_000,
      voucherCode: null,
    };
    const state = paymentState({
      cart,
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'store-1',
        storeName: 'Verified store',
        feeVnd: 18_000,
        etaMinutes: 35,
        availability: {
          ok: true,
          checkedItemIds: ['item-1'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: {
            fixtureMode: 'test_only',
            sourceFile: 'prior-quote',
          },
        },
      },
      orderPreview: {
        id: 'preview-1',
        cart,
        status: 'previewed',
        paymentStatus: 'not_started',
        assignedStoreId: 'store-1',
        createdAt: '2026-07-20T00:00:00.000Z',
      },
    });

    applyToolResultToState(
      {
        sessionId: state.sessionId,
        dashboard: new DashboardEventBus(),
      } as AgentTurnInput,
      state,
      {
        toolName: 'checkStoreAvailability',
        ok: true,
        value: { 'item-1': false },
        message: 'provider omitted source',
        provenance: [],
      },
      {
        storeId: 'store-1',
        itemCodes: ['item-1'],
        disposition: 'delivery',
      },
      [],
    );

    expect(state.exactCartAvailabilityObservation).toBeUndefined();
    expect(state.fulfillment).toBeUndefined();
    expect(state.orderPreview).toBeUndefined();
    expect(state.userConfirmedOrder).toBe(false);
    expect(state).not.toHaveProperty('entities');
    expect(state.escalationReasons).toContain('tool_execution_failed');
  });

  it('invalidates cart-bound checkout facts without erasing the submitted order', () => {
    const priorCart: NonNullable<AgentGraphState['cart']> = {
      id: 'cart-1',
      items: [{
        itemCode: 'item-1',
        name: 'Item 1',
        quantity: 1,
        unitPriceVnd: 50_000,
      }],
      subtotalVnd: 50_000,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 50_000,
      voucherCode: null,
    };
    const nextCart: NonNullable<AgentGraphState['cart']> = {
      ...priorCart,
      items: [{ ...priorCart.items[0]!, quantity: 2 }],
      subtotalVnd: 100_000,
      totalVnd: 100_000,
    };
    const submittedOrder: NonNullable<AgentGraphState['order']> = {
      id: 'KFC-1024',
      cart: priorCart,
      status: 'created',
      paymentStatus: 'pending',
      assignedStoreId: 'KFC-Q5',
      createdAt: '2026-07-20T00:00:00.000Z',
    };
    const paymentAttempt: NonNullable<AgentGraphState['paymentAttempt']> = {
      orderId: submittedOrder.id,
      method: 'zalopay_wallet',
      status: 'pending',
      paymentUrl: 'https://payment.kfc.vn/orders/KFC-1024',
    };
    const state: AgentGraphState = {
      sessionId: 'session-1',
      customerId: 'customer-1',
      channel: 'kfc',
      latestUserMessage: '',
      userConfirmedOrder: false,
      escalationReasons: [],
      retrievedEvidence: [],
      cart: priorCart,
      fulfillment: {} as NonNullable<AgentGraphState['fulfillment']>,
      orderPreview: {
        ...submittedOrder,
        id: 'preview-current-cart',
        status: 'previewed',
        paymentStatus: 'not_started',
      },
      order: submittedOrder,
      paymentAttempt,
      selectedPaymentMethod: paymentSelection('visa_master_card'),
      promotionContext: {
        matchedOfferIds: ['offer-current-cart'],
        caveats: [],
      },
      invoiceRequest: {
        companyName: 'KFC Test',
        taxCode: '0123456789',
        email: 'invoice@example.test',
      },
    };
    const turnInput = {
      sessionId: state.sessionId,
      dashboard: new DashboardEventBus(),
    } as AgentTurnInput;

    applyToolResultToState(
      turnInput,
      state,
      {
        toolName: 'updateCart',
        ok: true,
        value: nextCart,
        message: 'updated',
        provenance: [],
      },
      { changes: [{ itemCode: 'item-1', quantity: 2 }] },
      [],
    );

    expect(state.cart).toEqual(nextCart);
    expect(state.order).toBe(submittedOrder);
    expect(state.order?.cart).toEqual(priorCart);
    expect(state.paymentAttempt).toBe(paymentAttempt);
    expect(state.fulfillment).toBeUndefined();
    expect(state.orderPreview).toBeUndefined();
    expect(state.selectedPaymentMethod).toBeUndefined();
    expect(state.promotionContext).toBeUndefined();
    expect(state.invoiceRequest).toBeUndefined();
  });

  it('treats an exact modifier replacement as a cart mutation', () => {
    const priorCart: NonNullable<AgentGraphState['cart']> = {
      id: 'modifier-cart',
      items: [{
        itemCode: 'item-1',
        name: 'Item 1',
        quantity: 1,
        unitPriceVnd: 50_000,
        modifiers: [{
          groupId: 'size',
          groupName: 'Size',
          modifierId: 'large',
          modifierName: 'Large',
          quantity: 1,
          priceDeltaVnd: 10_000,
        }],
      }],
      subtotalVnd: 60_000,
      discountVnd: 0,
      deliveryFeeVnd: 18_000,
      totalVnd: 78_000,
      voucherCode: null,
    };
    const nextCart: NonNullable<AgentGraphState['cart']> = {
      ...priorCart,
      items: [{
        ...priorCart.items[0]!,
        modifiers: [{
          groupId: 'size',
          groupName: 'Size',
          modifierId: 'medium',
          modifierName: 'Medium',
          quantity: 1,
          priceDeltaVnd: 5_000,
        }],
      }],
    };
    const state = paymentState({
      cart: priorCart,
      fulfillment: {} as NonNullable<AgentGraphState['fulfillment']>,
      orderPreview: {
        id: 'modifier-preview',
        cart: priorCart,
        status: 'previewed',
        paymentStatus: 'not_started',
        assignedStoreId: 'store-1',
        createdAt: '2026-07-20T00:00:00.000Z',
      },
      selectedPaymentMethod: paymentSelection('visa_master_card'),
    });

    applyToolResultToState(
      {
        sessionId: state.sessionId,
        dashboard: new DashboardEventBus(),
      } as AgentTurnInput,
      state,
      {
        toolName: 'updateCart',
        ok: true,
        value: nextCart,
        message: 'modifier updated',
        provenance: [],
      },
      {
        changes: [{
          itemCode: 'item-1',
          quantity: 1,
          modifiers: [{
            groupId: 'size',
            modifierId: 'medium',
            quantity: 1,
          }],
        }],
      },
      [],
    );

    expect(state.cart).toEqual(nextCart);
    expect(state.fulfillment).toBeUndefined();
    expect(state.orderPreview).toBeUndefined();
    expect(state.selectedPaymentMethod).toBeUndefined();
  });

  it('clears a prior payment attempt when a different order is placed', () => {
    const priorOrder: NonNullable<AgentGraphState['order']> = {
      id: 'KFC-1024',
      cart: {
        id: 'cart-1',
        items: [],
        subtotalVnd: 0,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 0,
        voucherCode: null,
      },
      status: 'created',
      paymentStatus: 'pending',
      assignedStoreId: 'KFC-Q5',
      createdAt: '2026-07-20T00:00:00.000Z',
    };
    const replacementOrder: NonNullable<AgentGraphState['order']> = {
      ...priorOrder,
      id: 'KFC-2048',
      paymentStatus: 'not_started',
      createdAt: '2026-07-20T01:00:00.000Z',
    };
    const state = paymentState({
      order: priorOrder,
      paymentAttempt: {
        method: 'zalopay_wallet',
        status: 'pending',
        paymentUrl: 'https://payment.kfc.vn/orders/KFC-1024',
      },
    });

    applyToolResultToState(
      {
        sessionId: state.sessionId,
        dashboard: new DashboardEventBus(),
      } as AgentTurnInput,
      state,
      {
        toolName: 'placeOrder',
        ok: true,
        value: replacementOrder,
        message: 'placed',
        provenance: [],
      },
      {},
      [],
    );

    expect(state.order).toBe(replacementOrder);
    expect(state.paymentAttempt).toBeUndefined();
  });

  it('retains the paired payment attempt for an idempotent same-order result', () => {
    const priorOrder: NonNullable<AgentGraphState['order']> = {
      id: 'KFC-1024',
      cart: {
        id: 'cart-1',
        items: [],
        subtotalVnd: 0,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 0,
        voucherCode: null,
      },
      status: 'created',
      paymentStatus: 'pending',
      assignedStoreId: 'KFC-Q5',
      createdAt: '2026-07-20T00:00:00.000Z',
    };
    const idempotentOrder: NonNullable<AgentGraphState['order']> = {
      ...priorOrder,
      status: 'preparing',
    };
    const paymentAttempt: NonNullable<AgentGraphState['paymentAttempt']> = {
      orderId: priorOrder.id,
      method: 'zalopay_wallet',
      status: 'pending',
      paymentUrl: 'https://payment.kfc.vn/orders/KFC-1024',
    };
    const state = paymentState({
      order: priorOrder,
      paymentAttempt,
    });

    applyToolResultToState(
      {
        sessionId: state.sessionId,
        dashboard: new DashboardEventBus(),
      } as AgentTurnInput,
      state,
      {
        toolName: 'placeOrder',
        ok: true,
        value: idempotentOrder,
        message: 'same order',
        provenance: [],
      },
      {},
      [],
    );

    expect(state.order).toBe(idempotentOrder);
    expect(state.paymentAttempt).toBe(paymentAttempt);
  });

  it('binds a created payment link to the exact verified order', () => {
    const order = paymentOrder('KFC-PAYMENT-1');
    const state = paymentState({ order });

    applyToolResultToState(
      {
        sessionId: state.sessionId,
        dashboard: new DashboardEventBus(),
      } as AgentTurnInput,
      state,
      {
        toolName: 'createPaymentLink',
        ok: true,
        value: {
          orderId: order.id,
          url: `https://pay.example/orders/${order.id}`,
          status: 'pending',
        },
        message: 'payment_link_created',
        provenance: [],
      },
      { methodId: 'zalopay_wallet' },
      [],
    );

    expect(state.paymentAttempt).toEqual({
      orderId: order.id,
      method: 'zalopay_wallet',
      status: 'pending',
      paymentUrl: `https://pay.example/orders/${order.id}`,
    });
  });

  it('rejects a payment-link result bound to a different order', () => {
    const order = paymentOrder('KFC-PAYMENT-1');
    const state = paymentState({ order });

    applyToolResultToState(
      {
        sessionId: state.sessionId,
        dashboard: new DashboardEventBus(),
      } as AgentTurnInput,
      state,
      {
        toolName: 'createPaymentLink',
        ok: true,
        value: {
          orderId: 'KFC-DIFFERENT',
          url: 'https://pay.example/orders/KFC-DIFFERENT',
          status: 'pending',
        },
        message: 'payment_link_created',
        provenance: [],
      },
      { methodId: 'zalopay_wallet' },
      [],
    );

    expect(state.paymentAttempt).toBeUndefined();
    expect(state.escalationReasons).toContain('tool_execution_failed');
  });

  it('does not invent a payment method from payment status', () => {
    const state: AgentGraphState = {
      sessionId: 'session-1',
      customerId: 'customer-1',
      channel: 'kfc',
      latestUserMessage: '',
      userConfirmedOrder: false,
      escalationReasons: [],
      retrievedEvidence: [],
    };
    const turnInput = {
      sessionId: state.sessionId,
      dashboard: new DashboardEventBus(),
    } as AgentTurnInput;

    applyToolResultToState(
      turnInput,
      state,
      {
        toolName: 'checkPaymentStatus',
        ok: true,
        value: { orderId: 'KFC-STATUS-1', status: 'paid' },
        message: 'paid',
        provenance: [],
      },
      { orderId: 'KFC-STATUS-1' },
      [],
    );

    expect(state.paymentAttempt).toBeUndefined();
    expect(state.selectedPaymentMethod).toBeUndefined();
  });

  it('updates a changed payment observation but preserves an identical refreshed snapshot', () => {
    const pendingPayment = {
      orderId: 'order-1',
      method: 'zalopay_wallet',
      status: 'pending' as const,
      paymentUrl: 'https://pay.example/order-1',
    };
    const state = paymentState({
      order: paymentOrder('order-1'),
      paymentAttempt: pendingPayment,
    });
    const turnInput = {
      sessionId: state.sessionId,
      dashboard: new DashboardEventBus(),
    } as AgentTurnInput;
    const failedResult = {
      toolName: 'checkPaymentStatus' as const,
      ok: true as const,
      value: {
        orderId: 'order-1',
        status: 'failed' as const,
      },
      message: 'fresh provider observation',
      provenance: [],
    };

    applyToolResultToState(
      turnInput,
      state,
      failedResult,
      { orderId: 'order-1' },
      [],
    );
    expect(state.paymentAttempt).toEqual({
      ...pendingPayment,
      status: 'failed',
    });
    expect(state.paymentAttempt).not.toBe(pendingPayment);

    const failedPayment = state.paymentAttempt;
    applyToolResultToState(
      turnInput,
      state,
      failedResult,
      { orderId: 'order-1' },
      [],
    );
    expect(state.paymentAttempt).toBe(failedPayment);
  });

  it('does not select from free-form customer text or lookup query', () => {
    const state = paymentState({
      latestUserMessage: 'Thanh toán bằng ZaloPay',
    });

    applyPaymentMethodEvidence(state, ['zalopay_wallet'], 'ZaloPay');

    expect(state.paymentMethodEvidence).toHaveLength(1);
    expect(state.selectedPaymentMethod).toBeUndefined();
  });

  it('does not infer payment selection from a single supported result', () => {
    const state = paymentState();

    applyPaymentMethodEvidence(state, ['zalopay_wallet'], undefined);

    expect(state.selectedPaymentMethod).toBeUndefined();
  });

  it('retains a trusted structured selection only while current evidence supports it', () => {
    const state = paymentState({
      selectedPaymentMethod: paymentSelection('zalopay_wallet'),
    });

    applyPaymentMethodEvidence(state, ['zalopay_wallet'], undefined);

    expect(state.selectedPaymentMethod).toEqual(
      paymentSelection('zalopay_wallet'),
    );
  });

  it.each([
    ['collection key', {
      collectionKey: 'payment-methods:refreshed',
    }],
    ['collection revision', {
      collectionRevision: 'payment-collection-revision-2',
    }],
    ['provider revision', {
      providerRevision: 'payment-provider-revision-2',
    }],
  ] as const)(
    'invalidates the selected tuple when the active %s changes even if the method id is unchanged',
    (_name, authority) => {
      const state = paymentState({
        selectedPaymentMethod: paymentSelection('zalopay_wallet'),
      });

      applyPaymentMethodEvidence(
        state,
        ['zalopay_wallet'],
        undefined,
        authority,
      );

      expect(state.selectedPaymentMethod).toBeUndefined();
    },
  );

  it('keeps payment unselected and clears trusted selections absent from current evidence', () => {
    const noTrustedSelection = paymentState();
    const absentTrusted = paymentState({
      selectedPaymentMethod: paymentSelection('visa_master_card'),
    });

    applyPaymentMethodEvidence(
      noTrustedSelection,
      ['momo_wallet'],
      undefined,
    );
    applyPaymentMethodEvidence(
      absentTrusted,
      ['zalopay_wallet'],
      undefined,
    );

    expect(noTrustedSelection.selectedPaymentMethod).toBeUndefined();
    expect(absentTrusted.selectedPaymentMethod).toBeUndefined();
  });

  it('preserves verified item detail across durable turn snapshots', () => {
    const menuItemDetail = createTestFixtures().menuItems[0]!;
    const snapshot = buildVerifiedStateSnapshot(paymentState({
      menuItemDetail,
    }));

    expect(snapshot.menuItemDetail).toEqual(menuItemDetail);
    expect(extractVerifiedStateSnapshot({
      verifiedState: snapshot,
    })?.menuItemDetail).toEqual(menuItemDetail);
  });

  it('clears only the exact active handoff after verified provider resolution', () => {
    const state = paymentState({
      handoff: {
        escalationId: 'escalation-active',
        reasons: ['order_cancellation_after_preparation'],
      },
    });
    const dashboard = new DashboardEventBus();

    applyToolResultToState(
      {
        sessionId: state.sessionId,
        dashboard,
      } as AgentTurnInput,
      state,
      {
        toolName: 'resolveHandoff',
        ok: true,
        value: {
          escalationId: 'escalation-active',
          status: 'resolved',
        },
        message: 'resolved',
        provenance: [{
          fixtureMode: 'test_only',
          sourceFile: 'verified-state.test.ts',
        }],
      },
      { escalationId: 'escalation-active' },
      [],
    );

    expect(state.handoff).toBeUndefined();
    expect(dashboard.getEvents(state.sessionId)).toEqual([
      expect.objectContaining({
        type: 'session_updated',
        payload: {
          updateType: 'tool_called',
          toolName: 'resolveHandoff',
          boundary: 'handoff',
          ok: true,
          resultSummary: 'resolved',
          provenance: expect.any(Array),
        },
      }),
      expect.objectContaining({
        type: 'session_updated',
        payload: {
          updateType: 'handoff_resolved',
          escalationId: 'escalation-active',
        },
      }),
    ]);
  });

  it('keeps the active handoff when provider resolution identifies another escalation', () => {
    const state = paymentState({
      handoff: {
        escalationId: 'escalation-active',
        reasons: ['order_cancellation_after_preparation'],
      },
    });

    applyToolResultToState(
      {
        sessionId: state.sessionId,
        dashboard: new DashboardEventBus(),
      } as AgentTurnInput,
      state,
      {
        toolName: 'resolveHandoff',
        ok: true,
        value: {
          escalationId: 'escalation-different',
          status: 'resolved',
        },
        message: 'resolved',
        provenance: [],
      },
      { escalationId: 'escalation-active' },
      [],
    );

    expect(state.handoff?.escalationId).toBe('escalation-active');
    expect(state.escalationReasons).toContain('tool_execution_failed');
  });
});
