import { describe, expect, it } from 'vitest';
import type { AgentGraphState } from '../../src/graph/state.js';
import { applySafetyGates } from '../../src/ordering/safetyGates.js';

function state(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: 'session_1',
    customerId: 'customer_1',
    channel: 'web_mock',
    latestUserMessage: 'xác nhận đơn',
    intent: 'ordering',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
    ...overrides,
  };
}

describe('safety gates', () => {
  it('blocks placeOrder without explicit confirmation', () => {
    const result = applySafetyGates(state(), [{ toolName: 'placeOrder', arguments: {} }]);
    expect(result.allowedCalls).toHaveLength(0);
    expect(result.blockedReasons).toContain('order_confirmation_required');
  });

  it('blocks promo claim when no promotion tool evidence exists', () => {
    const result = applySafetyGates(state(), [{ toolName: 'previewOrder', arguments: {} }], {
      responseClaims: ['promotion'],
    });
    expect(result.blockedReasons).toContain('promotion_evidence_required');
  });

  it('allows placeOrder after confirmation and valid fulfillment', () => {
    const result = applySafetyGates(
      state({
        userConfirmedOrder: true,
        fulfillment: {
          method: 'delivery',
          disposition: 'delivery',
          storeId: 'KFCVN0002',
          storeName: 'KFC BIG C ĐỒNG NAI',
          feeVnd: 18000,
          etaMinutes: 25,
          availability: {
            ok: true,
            checkedItemIds: ['20751'],
            unavailableItemIds: [],
            blockedTimeslotItemIds: [],
            source: { fixtureMode: 'public_crawl_seed', sourceFile: 'fixtures/generated/store-availability.json' },
          },
        },
      }),
      [{ toolName: 'placeOrder', arguments: {} }],
    );
    expect(result.blockedReasons).toEqual([]);
    expect(result.allowedCalls[0]?.toolName).toBe('placeOrder');
  });
});
