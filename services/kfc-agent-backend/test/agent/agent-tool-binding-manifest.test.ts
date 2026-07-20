import { describe, expect, it } from 'vitest';
import {
  ordinaryToolBindingManifest,
  ordinaryToolBindingUpdateAfterAcceptedBatch,
} from '../../src/agent/agentToolBindingManifest.js';

describe('ordinary tool binding manifest', () => {
  it('keeps the full active commerce ceiling on the initial model call', () => {
    expect(ordinaryToolBindingManifest({
      phase: 'initial',
      activeToolNames: ['searchMenu', 'updateCart', 'getRecentOrder'],
      closedInitialIndependentToolNames: [],
      consumedToolNames: [],
    })).toEqual(['searchMenu', 'updateCart', 'getRecentOrder']);
  });

  it('subtracts closed initial independent reads and accepted consumed names from every continuation', () => {
    expect(ordinaryToolBindingManifest({
      phase: 'dependency_frontier',
      activeToolNames: [
        'searchMenu',
        'getItemDetails',
        'updateCart',
        'getRecentOrder',
        'getOrderStatus',
        'checkPaymentStatus',
      ],
      closedInitialIndependentToolNames: [
        'searchMenu',
        'getRecentOrder',
      ],
      consumedToolNames: ['getRecentOrder', 'getOrderStatus'],
    })).toEqual([
      'getItemDetails',
      'updateCart',
      'checkPaymentStatus',
    ]);
  });

  it('retains initially visible unconsumed action tools across arbitrary dependency depth', () => {
    expect(ordinaryToolBindingManifest({
      phase: 'dependency_frontier',
      activeToolNames: [
        'searchMenu',
        'updateCart',
        'quoteFulfillment',
        'previewOrder',
      ],
      closedInitialIndependentToolNames: ['searchMenu'],
      consumedToolNames: ['updateCart'],
    })).toEqual(['quoteFulfillment', 'previewOrder']);
  });

  it('keeps semantic correction response-only regardless of remaining capabilities', () => {
    expect(ordinaryToolBindingManifest({
      phase: 'response_only',
      activeToolNames: ['searchMenu', 'updateCart'],
      closedInitialIndependentToolNames: [],
      consumedToolNames: [],
    })).toEqual([]);
  });
});

describe('accepted model-authored batch frontier update', () => {
  it('atomically closes the initial independent manifest and consumes unique batch names in canonical order', () => {
    expect(ordinaryToolBindingUpdateAfterAcceptedBatch({
      phase: 'initial',
      advertisedToolNames: [
        'searchMenu',
        'updateCart',
        'findStores',
        'getRecentOrder',
      ],
      acceptedToolNames: [
        'getRecentOrder',
        'updateCart',
        'updateCart',
      ],
      closedInitialIndependentToolNames: [],
      consumedToolNames: [],
    })).toEqual({
      ordinaryToolBindingPhase: 'dependency_frontier',
      closedInitialIndependentToolNames: [
        'searchMenu',
        'findStores',
        'getRecentOrder',
      ],
      consumedToolNames: ['updateCart', 'getRecentOrder'],
    });
  });

  it('monotonically consumes later accepted batches without closing newly visible independent names', () => {
    expect(ordinaryToolBindingUpdateAfterAcceptedBatch({
      phase: 'dependency_frontier',
      advertisedToolNames: ['previewOrder', 'placeOrder'],
      acceptedToolNames: ['placeOrder'],
      closedInitialIndependentToolNames: ['searchMenu'],
      consumedToolNames: ['updateCart', 'previewOrder'],
    })).toEqual({
      ordinaryToolBindingPhase: 'dependency_frontier',
      closedInitialIndependentToolNames: ['searchMenu'],
      consumedToolNames: ['updateCart', 'previewOrder', 'placeOrder'],
    });
  });
});
