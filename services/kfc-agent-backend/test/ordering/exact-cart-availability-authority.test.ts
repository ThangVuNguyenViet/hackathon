import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Cart } from '../../src/domain/types.js';
import {
  EXACT_CART_AVAILABILITY_OBSERVATION_V2_SCHEMA_VERSION,
  authorizeExactCartAvailability,
  exactCartAvailabilityRevision,
  type ExactCartAvailabilityAuthorityInput,
  type ExactCartAvailabilityObservationV2,
} from '../../src/ordering/exactCartAvailabilityAuthority.js';

const now = Date.parse('2026-07-20T12:00:00.000Z');

function cart(input?: {
  id?: string;
  firstQuantity?: number;
}): Cart {
  return {
    id: input?.id ?? 'cart/opaque:α',
    items: [
      {
        itemCode: 'sku/rotated:α',
        name: 'Provider item A',
        quantity: input?.firstQuantity ?? 2,
        unitPriceVnd: 91_000,
        modifiers: [{
          groupId: 'group/arbitrary',
          groupName: 'Provider group',
          modifierId: 'modifier/2026-07',
          modifierName: 'Provider option',
          quantity: 1,
          priceDeltaVnd: 3_000,
        }],
      },
      {
        itemCode: 'opaque-item-🧪',
        name: 'Provider item B',
        quantity: 1,
        unitPriceVnd: 23_000,
      },
    ],
    subtotalVnd: 208_000,
    discountVnd: 0,
    deliveryFeeVnd: 18_000,
    totalVnd: 226_000,
    voucherCode: null,
  };
}

async function observation(
  currentCart: Cart,
  overrides: Partial<ExactCartAvailabilityObservationV2> = {},
): Promise<ExactCartAvailabilityObservationV2> {
  return {
    schemaVersion:
      EXACT_CART_AVAILABILITY_OBSERVATION_V2_SCHEMA_VERSION,
    observationId: 'inventory-observation/opaque:17',
    cartRevision: await exactCartAvailabilityRevision(currentCart),
    storeId: 'store/arbitrary:SEA',
    disposition: 'delivery',
    inventoryProviderRevision: {
      authority: 'inventory_availability',
      revision: 'opaque-revision:atomic-55',
    },
    observedAt: '2026-07-20T11:59:00.000Z',
    expiresAt: '2026-07-20T12:01:00.000Z',
    complete: true,
    rows: [
      {
        itemCode: 'opaque-item-🧪',
        quantity: 1,
        status: 'available',
      },
      {
        itemCode: 'sku/rotated:α',
        quantity: 2,
        status: 'available',
      },
    ],
    ...overrides,
  };
}

async function authorityInput(
  overrides: Partial<ExactCartAvailabilityAuthorityInput> = {},
): Promise<ExactCartAvailabilityAuthorityInput> {
  const currentCart = overrides.cart ?? cart();
  return {
    action: 'previewOrder',
    cart: currentCart,
    observation: await observation(currentCart!),
    activeStoreId: 'store/arbitrary:SEA',
    activeDisposition: 'delivery',
    activeInventoryProviderRevision: {
      authority: 'inventory_availability',
      revision: 'opaque-revision:atomic-55',
    },
    nowMs: now,
    ...overrides,
  };
}

describe('exact cart availability observation V2 authority', () => {
  it.each(['previewOrder', 'placeOrder'] as const)(
    'authorizes %s only from one exact active inventory observation',
    async (action) => {
      const result = await authorizeExactCartAvailability(
        await authorityInput({ action }),
      );

      expect(result).toEqual({
        ok: true,
        grant: {
          schemaVersion:
            EXACT_CART_AVAILABILITY_OBSERVATION_V2_SCHEMA_VERSION,
          action,
          observationId: 'inventory-observation/opaque:17',
          cartRevision: await exactCartAvailabilityRevision(cart()),
          storeId: 'store/arbitrary:SEA',
          disposition: 'delivery',
          inventoryProviderRevision: {
            authority: 'inventory_availability',
            revision: 'opaque-revision:atomic-55',
          },
          observedAt: '2026-07-20T11:59:00.000Z',
          expiresAt: '2026-07-20T12:01:00.000Z',
          complete: true,
          rows: [
            {
              itemCode: 'opaque-item-🧪',
              quantity: 1,
              status: 'available',
            },
            {
              itemCode: 'sku/rotated:α',
              quantity: 2,
              status: 'available',
            },
          ],
        },
      });
    },
  );

  it.each([
    {
      name: 'missing cart',
      update: { cart: undefined },
      errorCode: 'cart_availability_cart_required',
    },
    {
      name: 'missing observation',
      update: { observation: undefined },
      errorCode: 'cart_availability_observation_missing',
    },
    {
      name: 'missing active store',
      update: { activeStoreId: undefined },
      errorCode: 'cart_availability_active_store_required',
    },
    {
      name: 'missing active disposition',
      update: { activeDisposition: undefined },
      errorCode: 'cart_availability_active_disposition_required',
    },
    {
      name: 'missing active inventory provider revision',
      update: { activeInventoryProviderRevision: undefined },
      errorCode: 'cart_availability_active_inventory_provider_required',
    },
    {
      name: 'store mismatch',
      update: { activeStoreId: 'store/other' },
      errorCode: 'cart_availability_store_mismatch',
    },
    {
      name: 'disposition mismatch',
      update: { activeDisposition: 'pickup' },
      errorCode: 'cart_availability_disposition_mismatch',
    },
    {
      name: 'inventory provider revision mismatch',
      update: {
        activeInventoryProviderRevision: {
          authority: 'inventory_availability',
          revision: 'opaque-revision:new',
        },
      },
      errorCode: 'cart_availability_inventory_provider_mismatch',
    },
  ] as const)('rejects $name', async ({ update, errorCode }) => {
    await expect(
      authorizeExactCartAvailability(await authorityInput(update)),
    ).resolves.toEqual({ ok: false, errorCode });
  });

  it.each([
    {
      name: 'cart identity',
      change: (observedCart: Cart): Cart => ({
        ...observedCart,
        id: 'cart/opaque:replacement',
      }),
    },
    {
      name: 'item quantity',
      change: (observedCart: Cart): Cart => ({
        ...observedCart,
        items: observedCart.items.map((item, index) =>
          index === 0 ? { ...item, quantity: 3 } : item),
      }),
    },
    {
      name: 'modifier identity',
      change: (observedCart: Cart): Cart => ({
        ...observedCart,
        items: observedCart.items.map((item, index) =>
          index === 0
            ? {
                ...item,
                modifiers: item.modifiers?.map((modifier) => ({
                  ...modifier,
                  modifierId: 'modifier/rotated:replacement',
                })),
              }
            : item),
      }),
    },
    {
      name: 'modifier quantity',
      change: (observedCart: Cart): Cart => ({
        ...observedCart,
        items: observedCart.items.map((item, index) =>
          index === 0
            ? {
                ...item,
                modifiers: item.modifiers?.map((modifier) => ({
                  ...modifier,
                  quantity: 2,
                })),
              }
            : item),
      }),
    },
    {
      name: 'voucher and financial totals',
      change: (observedCart: Cart): Cart => ({
        ...observedCart,
        discountVnd: 10_000,
        totalVnd: observedCart.totalVnd - 10_000,
        voucherCode: 'opaque-voucher/provider-77',
      }),
    },
  ])('rejects prior observation after a $name change', async ({ change }) => {
    const observedCart = cart();
    const currentCart = change(observedCart);

    await expect(authorizeExactCartAvailability({
      ...await authorityInput({ cart: currentCart }),
      observation: await observation(observedCart),
    })).resolves.toEqual({
      ok: false,
      errorCode: 'cart_availability_cart_revision_mismatch',
    });
  });

  it.each([
    {
      name: 'provider marks the observation incomplete',
      change: { complete: false },
    },
    {
      name: 'one current cart row is absent',
      change: {
        rows: [{
          itemCode: 'sku/rotated:α',
          quantity: 2,
          status: 'available',
        }],
      },
    },
    {
      name: 'an unrelated row is added',
      change: {
        rows: [
          {
            itemCode: 'sku/rotated:α',
            quantity: 2,
            status: 'available',
          },
          {
            itemCode: 'opaque-item-🧪',
            quantity: 1,
            status: 'available',
          },
          {
            itemCode: 'unrelated/provider-item',
            quantity: 1,
            status: 'available',
          },
        ],
      },
    },
    {
      name: 'an attested quantity differs',
      change: {
        rows: [
          {
            itemCode: 'sku/rotated:α',
            quantity: 1,
            status: 'available',
          },
          {
            itemCode: 'opaque-item-🧪',
            quantity: 1,
            status: 'available',
          },
        ],
      },
    },
  ] satisfies readonly {
    name: string;
    change: Partial<ExactCartAvailabilityObservationV2>;
  }[])('rejects incomplete coverage when $name', async ({ change }) => {
    const currentCart = cart();
    await expect(authorizeExactCartAvailability({
      ...await authorityInput({ cart: currentCart }),
      observation: await observation(currentCart, change),
    })).resolves.toEqual({
      ok: false,
      errorCode: 'cart_availability_incomplete',
    });
  });

  it.each([
    {
      status: 'unavailable',
      errorCode: 'cart_availability_unavailable',
    },
    {
      status: 'blocked',
      errorCode: 'cart_availability_blocked',
    },
  ] as const)('rejects an exact $status row', async ({ status, errorCode }) => {
    const currentCart = cart();
    await expect(authorizeExactCartAvailability({
      ...await authorityInput({ cart: currentCart }),
      observation: await observation(currentCart, {
        rows: [
          {
            itemCode: 'sku/rotated:α',
            quantity: 2,
            status,
          },
          {
            itemCode: 'opaque-item-🧪',
            quantity: 1,
            status: 'available',
          },
        ],
      }),
    })).resolves.toEqual({ ok: false, errorCode });
  });

  it.each([
    {
      name: 'expired at the decision instant',
      change: { expiresAt: '2026-07-20T12:00:00.000Z' },
      errorCode: 'cart_availability_observation_expired',
    },
    {
      name: 'observed in the future',
      change: { observedAt: '2026-07-20T12:00:01.000Z' },
      errorCode: 'cart_availability_observation_not_yet_valid',
    },
    {
      name: 'has an invalid observation interval',
      change: {
        observedAt: '2026-07-20T12:01:00.000Z',
        expiresAt: '2026-07-20T12:01:00.000Z',
      },
      errorCode: 'cart_availability_observation_invalid',
    },
  ] as const)('rejects an observation that $name', async ({
    change,
    errorCode,
  }) => {
    const currentCart = cart();
    await expect(authorizeExactCartAvailability({
      ...await authorityInput({ cart: currentCart }),
      observation: await observation(currentCart, change),
    })).resolves.toEqual({ ok: false, errorCode });
  });

  it.each([
    {
      name: 'empty cart',
      currentCart: { ...cart(), items: [] },
    },
    {
      name: 'duplicate cart item code',
      currentCart: {
        ...cart(),
        items: [cart().items[0]!, { ...cart().items[0]! }],
      },
    },
    {
      name: 'non-positive cart quantity',
      currentCart: cart({ firstQuantity: 0 }),
    },
  ])('rejects an invalid $name', async ({ currentCart }) => {
    await expect(authorizeExactCartAvailability({
      ...await authorityInput(),
      cart: currentCart,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'cart_availability_cart_invalid',
    });
  });

  it.each([
    {
      name: 'legacy code-to-boolean inventory response',
      build: async () => ({
        'sku/rotated:α': true,
        'opaque-item-🧪': true,
      }),
    },
    {
      name: 'V1 field aliases with a generic provider revision',
      build: async () => ({
        schemaVersion: 'kfc-exact-cart-availability-v1',
        observationId: 'old-observation',
        cartRevision: 'old-cart-revision',
        storeId: 'store/arbitrary:SEA',
        providerRevision: 'confirmation/revision:not-inventory',
        observedAt: '2026-07-20T11:59:00.000Z',
        expiresAt: '2026-07-20T12:01:00.000Z',
        complete: true,
        items: [],
      }),
    },
    {
      name: 'row without an attested quantity',
      build: async () => ({
        ...await observation(cart()),
        rows: [{
          itemCode: 'sku/rotated:α',
          status: 'available',
        }],
      }),
    },
    {
      name: 'row with a non-positive quantity',
      build: async () => ({
        ...await observation(cart()),
        rows: [{
          itemCode: 'sku/rotated:α',
          quantity: 0,
          status: 'available',
        }],
      }),
    },
    {
      name: 'duplicate item rows',
      build: async () => ({
        ...await observation(cart()),
        rows: [
          {
            itemCode: 'sku/rotated:α',
            quantity: 2,
            status: 'available',
          },
          {
            itemCode: 'sku/rotated:α',
            quantity: 2,
            status: 'available',
          },
        ],
      }),
    },
    {
      name: 'malformed timestamp',
      build: async () => ({
        ...await observation(cart()),
        observedAt: 'not-a-timestamp',
      }),
    },
  ])('rejects $name as a non-V2 observation', async ({ build }) => {
    await expect(authorizeExactCartAvailability({
      ...await authorityInput(),
      observation: await build(),
    })).resolves.toEqual({
      ok: false,
      errorCode: 'cart_availability_observation_invalid',
    });
  });

  it('rejects cross-disposition replay even when all rows remain available', async () => {
    const currentCart = cart();
    const deliveryObservation = await observation(currentCart, {
      disposition: 'delivery',
    });

    await expect(authorizeExactCartAvailability({
      ...await authorityInput({
        cart: currentCart,
        activeDisposition: 'pickup',
      }),
      observation: deliveryObservation,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'cart_availability_disposition_mismatch',
    });
  });

  it('accepts an opaque revision token without inspecting its text', async () => {
    const currentCart = cart();
    const opaqueRevision = {
      authority: 'inventory_availability' as const,
      revision: 'confirmation-shaped/opaque-token:44',
    };

    await expect(authorizeExactCartAvailability({
      ...await authorityInput({
        cart: currentCart,
        activeInventoryProviderRevision: opaqueRevision,
      }),
      observation: await observation(currentCart, {
        inventoryProviderRevision: opaqueRevision,
      }),
    })).resolves.toMatchObject({ ok: true });
  });

  it('rejects matching non-inventory provenance on both revision sides', async () => {
    const currentCart = cart();
    const sharedNonInventoryRevision = {
      authority: 'catalog_observation',
      revision: 'shared-opaque-revision',
    };
    const input = {
      ...await authorityInput({ cart: currentCart }),
      activeInventoryProviderRevision: sharedNonInventoryRevision,
      observation: {
        ...await observation(currentCart),
        inventoryProviderRevision: sharedNonInventoryRevision,
      },
    } as unknown as ExactCartAvailabilityAuthorityInput;

    await expect(authorizeExactCartAvailability(input)).resolves.toEqual({
      ok: false,
      errorCode: 'cart_availability_observation_invalid',
    });
  });

  it('rejects matching token text from non-inventory active authority', async () => {
    const currentCart = cart();
    const sharedRevision = 'shared-opaque-revision';
    const input = {
      ...await authorityInput({ cart: currentCart }),
      activeInventoryProviderRevision: {
        authority: 'confirmation_authority',
        revision: sharedRevision,
      },
      observation: await observation(currentCart, {
        inventoryProviderRevision: {
          authority: 'inventory_availability',
          revision: sharedRevision,
        },
      }),
    } as unknown as ExactCartAvailabilityAuthorityInput;

    await expect(authorizeExactCartAvailability(input)).resolves.toEqual({
      ok: false,
      errorCode: 'cart_availability_active_inventory_provider_invalid',
    });
  });

  it('runtime-rejects actions and dispositions outside the V2 boundary', async () => {
    const input = await authorityInput();

    await expect(authorizeExactCartAvailability({
      ...input,
      action: 'refundOrder',
    } as unknown as ExactCartAvailabilityAuthorityInput)).resolves.toEqual({
      ok: false,
      errorCode: 'cart_availability_action_invalid',
    });
    await expect(authorizeExactCartAvailability({
      ...input,
      activeDisposition: 'dine_in',
    } as unknown as ExactCartAvailabilityAuthorityInput)).resolves.toEqual({
      ok: false,
      errorCode: 'cart_availability_active_disposition_invalid',
    });
  });

  it('is input-immutable and returns attestation rather than executable work', async () => {
    const input = await authorityInput({ action: 'placeOrder' });
    const before = structuredClone(input);
    Object.freeze(input.cart);
    Object.freeze(input.observation);

    const result = await authorizeExactCartAvailability(input);

    expect(input).toEqual(before);
    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty('toolCall');
    expect(result).not.toHaveProperty('toolCalls');
    expect(result).not.toHaveProperty('arguments');

    const source = readFileSync(
      'src/ordering/exactCartAvailabilityAuthority.ts',
      'utf8',
    );
    expect(source).not.toContain('checkStoreAvailability');
    expect(source).not.toContain('latestUserMessage');
    expect(source).not.toMatch(/\bRegExp\b/u);
    expect(source).not.toMatch(/\.(?:match|matchAll|replace|search|test)\s*\(/u);
  });
});
