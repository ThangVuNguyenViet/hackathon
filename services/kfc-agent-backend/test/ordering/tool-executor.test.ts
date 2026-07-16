import { describe, expect, it, vi } from 'vitest';
import { createMockClients } from '../../src/mock/createMockClients.js';
import type { Address, Order } from '../../src/domain/types.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import { classifyToolSideEffect, executeToolCall } from '../../src/ordering/toolExecutor.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';

const clients = createMockClients(createTestFixtures());

const controlledAccess = controlledCustomerAccess({
  sessionId: 'session_1',
  customerId: 'customer_1',
});

function buildState(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: 'session_1',
    customerId: 'customer_1',
    channel: 'kfc',
    latestUserMessage: 'thanh toan',
    intent: 'payment',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
    ...overrides,
  };
}

function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'KFC-MOCK-1001',
    cart: {
      id: 'cart_1',
      items: [],
      subtotalVnd: 120000,
      discountVnd: 0,
      deliveryFeeVnd: 18000,
      totalVnd: 138000,
      voucherCode: null,
    },
    status: 'created',
    paymentStatus: 'pending',
    assignedStoreId: 'KFCVN0002',
    createdAt: '2026-07-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('tool executor', () => {
  it('classifies tool side effects centrally', () => {
    expect(classifyToolSideEffect('searchMenu', {})).toBe('read');
    expect(classifyToolSideEffect('updateCart', {})).toBe('reversible');
    expect(classifyToolSideEffect('acquireVoucher', { rewardId: 'reward-discount-10k' })).toBe('read');
    expect(classifyToolSideEffect('acquireVoucher', { rewardId: 'reward-discount-10k', confirmed: true })).toBe('irreversible');
    expect(classifyToolSideEffect('placeOrder', {})).toBe('irreversible');
    expect(classifyToolSideEffect('createPaymentLink', { method: 'momo' })).toBe('irreversible');
    expect(classifyToolSideEffect('handoff', { reasons: ['operator'] })).toBe('irreversible');
  });

  it('blocks stale irreversible tool calls before executing client side effects', async () => {
    const guardedClients = createMockClients(createTestFixtures());
    const placeOrder = guardedClients.oms.placeOrder;
    let placeOrderCalls = 0;
    guardedClients.oms.placeOrder = async (...args) => {
      placeOrderCalls += 1;
      return placeOrder(...args);
    };

    const result = await executeToolCall(
      guardedClients,
      buildState({
        intent: 'ordering',
        orderPreview: buildOrder({ id: 'preview_1', status: 'previewed', paymentStatus: 'not_started' }),
        userConfirmedOrder: true,
      }),
      { toolName: 'placeOrder', arguments: {} },
      {
        runGuard: {
          isCurrent: async () => false,
          recordIrreversibleBoundary: async () => {
            throw new Error('stale run must not record irreversible boundary');
          },
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('stale_agent_run');
    expect(placeOrderCalls).toBe(0);
  });

  it('executes menu search through the state-centric contract', async () => {
    const result = await executeToolCall(clients, buildState({ intent: 'ordering' }), {
      toolName: 'searchMenu',
      arguments: { query: 'Combo Hợp Gu 99K' },
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.value)).toContain('Combo Hợp Gu 99K');
  });

  it('keeps the direct request adapter for invalid argument rejection', async () => {
    const result = await executeToolCall(clients, { toolName: 'searchMenu', arguments: { q: 'wrong' } });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('invalid_tool_arguments');
  });

  it('executes fixture-backed demo voucher validation from state', async () => {
    const result = await executeToolCall(clients, buildState({ intent: 'voucher' }), {
      toolName: 'validateVoucher',
      arguments: { voucherText: 'KFC50', subtotalVnd: 250000 },
    });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ ok: true, reason: 'validated', publicCode: 'KFC50', discountVnd: 50000 });
  });

  it('executes membership tool discovery and keeps acquireVoucher confirmation-gated', async () => {
    const tools = await executeToolCall(clients, buildState({ intent: 'voucher' }), {
      toolName: 'listMembershipTools',
      arguments: { sideEffect: 'voucher_acquisition' },
    }, { accessContext: controlledAccess });
    expect(tools.ok).toBe(true);
    expect(JSON.stringify(tools.value)).toContain('/users/acquire-voucher');

    const unconfirmedAcquire = await executeToolCall(clients, buildState({ intent: 'voucher' }), {
      toolName: 'acquireVoucher',
      arguments: { rewardId: 'reward-discount-10k' },
    }, { accessContext: controlledAccess });
    expect(unconfirmedAcquire.ok).toBe(false);
    expect(unconfirmedAcquire.errorCode).toBe('confirmation_required');

    const confirmedAcquire = await executeToolCall(clients, buildState({ intent: 'voucher' }), {
      toolName: 'acquireVoucher',
      arguments: { rewardId: 'reward-discount-10k', confirmed: true },
    }, { accessContext: controlledAccess });
    expect(confirmedAcquire.ok).toBe(true);
    expect(confirmedAcquire.value).toMatchObject({
      status: 'completed',
      targetId: 'reward-discount-10k',
    });
  });

  it('fails closed before calling membership providers without verified caller access', async () => {
    const guardedClients = createMockClients(createTestFixtures());
    const getProfile = vi.spyOn(guardedClients.membership, 'getProfile');

    const result = await executeToolCall(
      guardedClients,
      buildState({ intent: 'voucher' }),
      { toolName: 'getMembershipProfile', arguments: {} },
    );

    expect(result).toMatchObject({ ok: false, errorCode: 'authentication_required' });
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('rejects private writes before recording an irreversible boundary', async () => {
    const isCurrent = vi.fn(async () => true);
    const recordIrreversibleBoundary = vi.fn(async () => undefined);

    const result = await executeToolCall(
      clients,
      buildState({ intent: 'voucher' }),
      { toolName: 'acquireVoucher', arguments: { rewardId: 'reward-discount-10k', confirmed: true } },
      { runGuard: { isCurrent, recordIrreversibleBoundary } },
    );

    expect(result).toMatchObject({ ok: false, errorCode: 'authentication_required' });
    expect(isCurrent).not.toHaveBeenCalled();
    expect(recordIrreversibleBoundary).not.toHaveBeenCalled();
  });

  it('fails closed before calling private order and payment providers', async () => {
    const guardedClients = createMockClients(createTestFixtures());
    const getOrderStatus = vi.spyOn(guardedClients.oms, 'getOrderStatus');
    const checkPaymentStatus = vi.spyOn(guardedClients.payment, 'checkPaymentStatus');

    const orderResult = await executeToolCall(
      guardedClients,
      buildState({ intent: 'order_status' }),
      { toolName: 'getOrderStatus', arguments: { orderId: 'KFC-MOCK-1001' } },
    );
    const paymentResult = await executeToolCall(
      guardedClients,
      buildState({ intent: 'payment' }),
      { toolName: 'checkPaymentStatus', arguments: { orderId: 'KFC-MOCK-1001' } },
    );

    expect(orderResult).toMatchObject({ ok: false, errorCode: 'authentication_required' });
    expect(paymentResult).toMatchObject({ ok: false, errorCode: 'authentication_required' });
    expect(getOrderStatus).not.toHaveBeenCalled();
    expect(checkPaymentStatus).not.toHaveBeenCalled();
  });

  it('rejects order and payment reads when the requested order is not the verified current order', async () => {
    const guardedClients = createMockClients(createTestFixtures());
    const getOrderStatus = vi.spyOn(guardedClients.oms, 'getOrderStatus');
    const checkPaymentStatus = vi.spyOn(guardedClients.payment, 'checkPaymentStatus');
    const state = buildState({ order: buildOrder() });

    const orderResult = await executeToolCall(
      guardedClients,
      state,
      { toolName: 'getOrderStatus', arguments: { orderId: 'ANOTHER-CUSTOMERS-ORDER' } },
      { accessContext: controlledAccess },
    );
    const paymentResult = await executeToolCall(
      guardedClients,
      state,
      { toolName: 'checkPaymentStatus', arguments: { orderId: 'ANOTHER-CUSTOMERS-ORDER' } },
      { accessContext: controlledAccess },
    );

    expect(orderResult).toMatchObject({ ok: false, errorCode: 'order_access_unverified' });
    expect(paymentResult).toMatchObject({ ok: false, errorCode: 'order_access_unverified' });
    expect(getOrderStatus).not.toHaveBeenCalled();
    expect(checkPaymentStatus).not.toHaveBeenCalled();
  });

  it('rejects a verified context bound to a different customer', async () => {
    const result = await executeToolCall(
      clients,
      buildState({ intent: 'voucher' }),
      { toolName: 'getMembershipProfile', arguments: {} },
      {
        accessContext: {
          ...controlledAccess,
          kfcSubjectRef: 'customer_2',
        },
      },
    );

    expect(result).toMatchObject({ ok: false, errorCode: 'access_context_mismatch' });
  });

  it('executes fixture-backed payment method lookup', async () => {
    const result = await executeToolCall(clients, buildState({ intent: 'payment' }), {
      toolName: 'listPaymentMethods' as any,
      arguments: { query: 'momo' },
    });

    expect(result.ok).toBe(true);
    expect(result.value).toEqual([
      expect.objectContaining({
        methodId: 'momo_wallet',
        displayName: 'Ví MoMo',
        supported: false,
        supportStatus: 'not_listed_in_policy',
      }),
    ]);
    expect(result.provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fixtureMode: 'public_crawl_seed',
        sourceUrl: 'https://kfcvietnam.com.vn/privacy-policy',
      }),
    ]));
  });

  it('uses the exact typed line as a display label but rejects district-only addresses', async () => {
    let quotedAddress: Address | undefined;
    const fulfillmentClients = createMockClients(createTestFixtures(), {
      fulfillmentQuoteProvider: async ({ address }) => {
        quotedAddress = address;
        return { ok: true, value: { feeVnd: 18000, etaMinutes: 35 }, message: 'ok' };
      },
    });
    const result = await executeToolCall(fulfillmentClients, buildState({ intent: 'ordering' }), {
      toolName: 'quoteFulfillment',
      arguments: {
        address: { line1: 'Big C Đồng Nai', district: 'Biên Hòa', city: 'Đồng Nai' },
        method: 'delivery',
        itemCodes: ['20751'],
      },
    });

    expect(result).toMatchObject({ ok: true });
    expect(quotedAddress).toEqual({
      label: 'Big C Đồng Nai',
      line1: 'Big C Đồng Nai',
      district: 'Biên Hòa',
      city: 'Đồng Nai',
    });

    const districtOnly = await executeToolCall(fulfillmentClients, buildState({ intent: 'ordering' }), {
      toolName: 'quoteFulfillment',
      arguments: {
        address: { label: 'Quận 7', line1: 'Quận 7', district: 'Quận 7', city: 'Hồ Chí Minh' },
        method: 'delivery',
        itemCodes: ['20751'],
      },
    });
    expect(districtOnly).toMatchObject({ ok: false, errorCode: 'invalid_tool_arguments' });
  });

  it('propagates failing client results in the state-centric path', async () => {
    const order = buildOrder();
    const result = await executeToolCall(
      clients,
      buildState({
        order,
        paymentAttempt: { method: 'momo', status: 'pending', paymentUrl: 'https://pay.mock/momo/KFC-MOCK-1001' },
      }),
      { toolName: 'checkPaymentStatus', arguments: { orderId: order.id } },
      { accessContext: controlledAccess },
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('payment_failed');
    expect(result.message).toContain('Mock payment is configured to fail');
  });

  it('rejects payment link creation when only an order preview exists', async () => {
    const result = await executeToolCall(
      clients,
      buildState({
        orderPreview: buildOrder({ id: 'preview_1', status: 'previewed', paymentStatus: 'not_started' }),
      }),
      { toolName: 'createPaymentLink', arguments: { method: 'momo' } },
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('order_required');
  });

  it('rejects payment link creation when the current order is not created', async () => {
    const result = await executeToolCall(
      clients,
      buildState({
        order: buildOrder({ status: 'cancelled', paymentStatus: 'failed' }),
      }),
      { toolName: 'createPaymentLink', arguments: { method: 'momo' } },
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('created_order_required');
  });

  it('rejects payment link creation for methods not listed in website checkout policy', async () => {
    const result = await executeToolCall(
      clients,
      buildState({
        order: buildOrder(),
      }),
      { toolName: 'createPaymentLink', arguments: { method: 'momo' } },
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('payment_method_unsupported');
    expect(result.message).toContain('MoMo');
  });
});
