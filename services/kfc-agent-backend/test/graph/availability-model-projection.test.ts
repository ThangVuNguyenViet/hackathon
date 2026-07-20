import { describe, expect, it } from 'vitest';
import {
  agentToolResultForModel,
} from '../../src/graph/orderStatusEvidenceProjection.js';
import {
  EXACT_CART_AVAILABILITY_OBSERVATION_V2_SCHEMA_VERSION,
} from '../../src/ordering/exactCartAvailabilityAuthority.js';

describe('availability model projection', () => {
  it('strips provider and checkout authority from model-facing results', () => {
    const projected = agentToolResultForModel({
      toolName: 'checkStoreAvailability',
      ok: true,
      value: { 'opaque-item': true },
      message: 'ok',
      provenance: [{
        fixtureMode: 'provider_runtime',
        sourceFile: 'inventory-provider',
      }],
      inventoryAvailabilityAuthority: {
        providerRevision: 'inventory:opaque-revision',
        observedAt: '2026-07-20T00:00:00.000Z',
        expiresAt: '2026-07-20T00:05:00.000Z',
      },
      verifiedAvailabilityObservation: {
        schemaVersion:
          EXACT_CART_AVAILABILITY_OBSERVATION_V2_SCHEMA_VERSION,
        observationId: 'opaque-observation',
        cartRevision: 'opaque-cart-revision',
        storeId: 'opaque-store',
        disposition: 'delivery',
        inventoryProviderRevision: {
          authority: 'inventory_availability',
          revision: 'inventory:opaque-revision',
        },
        observedAt: '2026-07-20T00:00:00.000Z',
        expiresAt: '2026-07-20T00:05:00.000Z',
        complete: true,
        rows: [{
          itemCode: 'opaque-item',
          quantity: 1,
          status: 'available',
        }],
      },
    });

    expect(projected).toEqual({
      toolName: 'checkStoreAvailability',
      ok: true,
      value: { 'opaque-item': true },
      message: 'ok',
      provenance: [{
        fixtureMode: 'provider_runtime',
        sourceFile: 'inventory-provider',
      }],
    });
  });
});
