import { describe, expect, it } from 'vitest';
import {
  issueModelPublicationAuthority,
} from '../../src/agent/modelPublicationAuthority.js';
import {
  buildModelPublicationBundle,
} from '../../src/agent/modelPublicationProjection.js';
import {
  loadTurnState,
} from '../../src/agent/singleAgentRuntime.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { AgentTurnInput } from '../../src/graph/agentTurnState.js';
import {
  buildVerifiedStateSnapshot,
  loadPriorVerifiedState,
  persistVerifiedStateSnapshot,
} from '../../src/graph/verifiedState.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const rejectedPlannerKeys = [
  'intent',
  'pendingReorder',
  'comboConversionProposal',
  'pendingCatalogSuggestion',
  'plannerMenuSearchResults',
  'plannerMenuCatalogContext',
  'entities',
] as const;

describe('legacy planner-state migration boundary', () => {
  it('drops rejected planner state before hydration, persistence, and model publication', async () => {
    const sessionId = 'kfc:legacy-planner-state-migration';
    const customerId = 'legacy-planner-state-migration';
    const store = new MemoryStore();
    const legacyMarker = 'LEGACY_PLANNER_STATE_MUST_NOT_SURVIVE';
    const verifiedRef = {
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'saved_address' as const,
    };
    const cart = {
      id: 'migration-cart',
      items: [{
        itemCode: '20751',
        name: 'Verified menu item',
        quantity: 1,
        unitPriceVnd: 99_000,
      }],
      subtotalVnd: 99_000,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 99_000,
      voucherCode: null,
    };
    const legacyPlannerState = {
      intent: 'voucher',
      pendingReorder: {
        orderId: legacyMarker,
        cart,
      },
      comboConversionProposal: {
        itemCode: legacyMarker,
      },
      pendingCatalogSuggestion: {
        itemCode: legacyMarker,
        name: legacyMarker,
        source: 'favorite',
      },
      plannerMenuSearchResults: [{
        code: legacyMarker,
        name: legacyMarker,
      }],
      plannerMenuCatalogContext: {
        query: legacyMarker,
        candidates: [],
      },
      entities: {
        itemText: legacyMarker,
        preferCartSurface: true,
        suppressGenUi: true,
      },
    };
    const legacyVerifiedState: Record<string, unknown> = {
      cart,
      pendingSavedAddressRef: verifiedRef,
      customerContext: {
        savedAddresses: [{
          label: legacyMarker,
          line1: legacyMarker,
          district: 'Quận 7',
          city: 'Hồ Chí Minh',
        }],
        recentOrders: [],
        favorites: [],
      },
      toolTrace: [],
      ...legacyPlannerState,
    };
    await store.appendEvent(sessionId, 'graph:verified_state', {
      verifiedState: legacyVerifiedState,
    });
    const input = {
      sessionId,
      customerId,
      channel: 'kfc',
      text: 'Show my current verified cart',
      externalMessageId: 'legacy-planner-state-migration-message',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
    } satisfies AgentTurnInput;

    const loaded = await loadTurnState(input);
    expect(loaded.state.cart).toEqual(cart);
    expect(loaded.state.pendingSavedAddressRef).toEqual(verifiedRef);
    expect(loaded.state.customerContext?.savedAddresses).toEqual([]);
    for (const key of rejectedPlannerKeys) {
      expect(loaded.state).not.toHaveProperty(key);
    }

    const stateWithTurnLocalPresentation = Object.assign(
      {
        ...loaded.state,
        trustedPresentation: {
          preferredSurface: 'cart' as const,
        },
      },
      // Simulate an old in-memory/checkpoint object reaching the new
      // persistence and publication boundaries without a fresh load.
      legacyPlannerState,
    );
    const snapshot = buildVerifiedStateSnapshot(
      stateWithTurnLocalPresentation,
    );
    expect(snapshot.cart).toEqual(cart);
    expect(snapshot.pendingSavedAddressRef).toEqual(verifiedRef);
    expect(snapshot).not.toHaveProperty('trustedPresentation');
    for (const key of rejectedPlannerKeys) {
      expect(snapshot).not.toHaveProperty(key);
    }
    expect(JSON.stringify(snapshot)).not.toContain(legacyMarker);

    await persistVerifiedStateSnapshot(
      store,
      stateWithTurnLocalPresentation,
    );
    const reloaded = await loadPriorVerifiedState(store, sessionId);
    expect(reloaded.cart).toEqual(cart);
    expect(reloaded.pendingSavedAddressRef).toEqual(verifiedRef);
    expect(JSON.stringify(reloaded)).not.toContain(legacyMarker);
    expect(reloaded).not.toHaveProperty('trustedPresentation');
    for (const key of rejectedPlannerKeys) {
      expect(reloaded).not.toHaveProperty(key);
    }

    const currentUserTurn = loaded.currentUserTurn;
    if (!currentUserTurn) {
      throw new Error('migration_current_user_turn_missing');
    }
    const authority = await issueModelPublicationAuthority({
      state: stateWithTurnLocalPresentation,
      currentUserTurn,
    });
    const publication = await buildModelPublicationBundle({
      state: stateWithTurnLocalPresentation,
      authority,
    });
    const serializedPublication = JSON.stringify(publication);
    expect(publication.modelState.cart).toEqual(cart);
    expect(serializedPublication).not.toContain(legacyMarker);
    for (const key of rejectedPlannerKeys) {
      expect(serializedPublication).not.toContain(`"${key}"`);
    }
  });
});
