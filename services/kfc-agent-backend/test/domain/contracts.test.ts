import * as clientsModule from '../../src/clients/interfaces.js';
import * as domainModule from '../../src/domain/types.js';
import { TOOL_NAMES } from '../../src/ordering/types.js';
import { describe, expect, it } from 'vitest';
import type {
  AgentRun,
  Cart,
  DashboardEvent,
  MenuItem,
  Order,
  PendingCustomerTurn,
  SessionAgentState,
  ToolSideEffectClass,
} from '../../src/domain/types.js';
import type { ExternalClients } from '../../src/clients/interfaces.js';
import type {
  ContentEvidence,
  FulfillmentState,
  PromotionContext,
  ToolTraceEntry,
} from '../../src/ordering/types.js';
import type { AgentGraphState } from '../../src/graph/state.js';

describe('domain contracts', () => {
  it('exposes the domain and client contract modules', () => {
    expect(domainModule).toBeDefined();
    expect(clientsModule).toBeDefined();
  });

  it('represents menu, cart, and order state without channel details', () => {
    const item: MenuItem = {
      code: 'HOPGU',
      category: 'Hot Deals',
      categoryId: 'hot-deals',
      name: 'Combo 99K',
      description: '3 Fried Chicken + 1 Shrimp Burger',
      priceVnd: 99000,
      originalPriceVnd: null,
      imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL',
      available: true,
    };

    const cart: Cart = {
      id: 'cart_1',
      items: [{ itemCode: item.code, name: item.name, quantity: 1, unitPriceVnd: 99000 }],
      subtotalVnd: 99000,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 99000,
      voucherCode: null,
    };

    const order: Order = {
      id: 'KFC-MOCK-1001',
      cart,
      status: 'created',
      paymentStatus: 'pending',
      assignedStoreId: 'store_q7_mock',
      createdAt: '2026-07-07T00:00:00.000Z',
    };

    expect(order.cart.items[0]?.itemCode).toBe('HOPGU');
    expect(order.paymentStatus).toBe('pending');
  });

  it('requires all production-shaped client groups', () => {
    const keys: Array<keyof ExternalClients> = [
      'menu',
      'cart',
      'recommendation',
      'promotion',
      'membership',
      'inventory',
      'storeLocator',
      'oms',
      'payment',
      'delivery',
      'customer',
      'loyalty',
      'handoff',
      'feedback',
      'messenger',
      'zalo',
    ];

    expect(keys).toHaveLength(16);
  });

  it('models fixture-backed evidence in graph state', () => {
    expect(TOOL_NAMES).toContain('searchPromotions');
    expect(TOOL_NAMES).toContain('acquireVoucher');

    const fulfillment = {
      method: 'delivery',
      disposition: 'delivery',
      storeId: 'KFCVN0002',
      storeName: 'KFC BIG C DONG NAI',
      feeVnd: 18000,
      etaMinutes: 25,
      availability: {
        ok: true,
        checkedItemIds: ['20751'],
        unavailableItemIds: [],
        blockedTimeslotItemIds: [],
        source: {
          fixtureMode: 'public_crawl_seed',
          sourceFile: 'fixtures/generated/store-availability.json',
          sourceApi: 'https://api.kfcvietnam.com.vn/stores',
        },
      },
    } satisfies FulfillmentState;

    const promotionContext = {
      matchedOfferIds: ['big-order-2026-march-kfc-voucher-30k-min-120k'],
      validation: {
        ok: false,
        reason: 'public_code_not_exposed',
        publicCode: '',
        discountVnd: 0,
        source: {
          fixtureMode: 'public_crawl_seed',
          sourceFile: 'fixtures/generated/promotion-voucher-offers.json',
          sourceUrl:
            'https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc',
        },
      },
      caveats: ['Public crawl exposes offer rules but no reusable public code.'],
    } satisfies PromotionContext;

    const contentEvidence = {
      kind: 'allergen',
      title: 'Bang Thanh Phan Di Ung',
      snippet: 'Public allergen evidence only; do not claim medical certainty.',
      sourceUrl: 'https://www.kfcvietnam.com.vn/allergen-chart',
      sourceFile: 'fixtures/generated/content-pages.json',
    } satisfies ContentEvidence;

    const trace = {
      toolName: 'searchPromotions',
      arguments: { query: 'voucher' },
      ok: true,
      resultSummary: '1 offer matched',
      provenance: [promotionContext.validation.source],
    } satisfies ToolTraceEntry;

    const state = {
      sessionId: 'session_1',
      customerId: 'customer_1',
      channel: 'kfc',
      latestUserMessage: 'Co ma giam gia nao khong?',
      userConfirmedOrder: false,
      escalationReasons: [],
      retrievedEvidence: [],
      fulfillment,
      promotionContext,
      contentEvidence: [contentEvidence],
      toolTrace: [trace],
    } satisfies AgentGraphState;

    expect(state.fulfillment.storeId).toBe('KFCVN0002');
    expect(state.promotionContext.validation?.reason).toBe('public_code_not_exposed');
    expect(state.contentEvidence[0]?.kind).toBe('allergen');
    expect(state.toolTrace[0]?.toolName).toBe('searchPromotions');
  });

  it('models interruption run-state contracts without merging raw customer turns', () => {
    const pendingTurn = {
      turnId: 'pending_mid_1',
      sessionId: 'messenger:psid_1',
      channel: 'messenger',
      externalMessageId: 'mid_1',
      externalUserId: 'psid_1',
      text: 'Cho minh 1 combo',
      steerMode: 'steering',
      status: 'pending',
      claimedRunId: null,
      receivedAt: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
    } satisfies PendingCustomerTurn;
    const run = {
      id: 'run_1',
      sessionId: 'messenger:psid_1',
      generation: 1,
      sessionAuthorityGeneration: 0,
      channel: 'messenger',
      externalUserId: 'psid_1',
      status: 'scheduled',
      executionAttempt: 0,
      executionLeaseToken: null,
      executionLeaseExpiresAt: null,
      coalescedInputText: '1. Cho minh 1 combo\n2. doi thanh 2 combo',
      supersededByRunId: null,
      irreversibleSideEffectAt: null,
      irreversibleToolName: null,
      assistantTurnId: null,
      deliveryStatus: 'pending',
      deliveryExternalMessageId: null,
      errorCode: null,
      errorMessage: null,
      scheduledAt: '2026-07-10T00:00:02.000Z',
      startedAt: null,
      completedAt: null,
      updatedAt: '2026-07-10T00:00:02.000Z',
    } satisfies AgentRun;
    const state = {
      sessionId: 'messenger:psid_1',
      currentRunId: 'run_1',
      generation: 1,
      debounceDeadlineAt: '2026-07-10T00:00:02.000Z',
      updatedAt: '2026-07-10T00:00:00.500Z',
    } satisfies SessionAgentState;
    const sideEffect: ToolSideEffectClass = 'irreversible';

    expect(pendingTurn.status).toBe('pending');
    expect(run.deliveryStatus).toBe('pending');
    expect(state.generation).toBe(1);
    expect(sideEffect).toBe('irreversible');
  });

  it('declares dashboard run lifecycle events for proof and diagnostics', () => {
    const event = {
      id: 'dash_run_1',
      sessionId: 'messenger:psid_1',
      type: 'agent_run_scheduled',
      payload: {
        runId: 'run_1',
        generation: 1,
        channel: 'messenger',
        includedTurnIds: ['pending_mid_1', 'pending_mid_2'],
        reason: 'debounce_elapsed',
      },
      createdAt: '2026-07-10T00:00:02.000Z',
    } satisfies DashboardEvent;

    expect(event.type).toBe('agent_run_scheduled');
    expect(event.payload).toMatchObject({
      runId: 'run_1',
      includedTurnIds: ['pending_mid_1', 'pending_mid_2'],
    });
  });
});
