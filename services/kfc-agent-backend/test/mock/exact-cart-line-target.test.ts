import { describe, expect, it } from 'vitest';
import type { Cart } from '../../src/domain/types.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';

const externalCallContext = {
  signal: new AbortController().signal,
  deadlineAt: Date.now() + 60_000,
};

describe('exact cart-line mutation target', () => {
  it('replaces only the selected line when duplicate item codes exist', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const [item, replacement] = fixtures.menuItems;
    if (!item || !replacement) throw new Error('Expected two menu fixtures');
    const clients = createMockClients(fixtures);
    const cart: Cart = {
      id: 'cart-duplicate-lines',
      items: [
        {
          itemCode: item.code,
          name: `${item.name} first`,
          quantity: 1,
          unitPriceVnd: item.priceVnd,
        },
        {
          itemCode: item.code,
          name: `${item.name} second`,
          quantity: 1,
          unitPriceVnd: item.priceVnd,
        },
      ],
      subtotalVnd: item.priceVnd * 2,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: item.priceVnd * 2,
      voucherCode: null,
    };

    const result = await clients.cart.applyChanges(
      cart,
      [
        {
          itemCode: replacement.code,
          quantity: 1,
          targetCartLineId: `cart-line:2:${item.code}`,
        },
      ],
      externalCallContext,
    );

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.value?.items).toEqual([
      expect.objectContaining({ name: `${item.name} first` }),
      expect.objectContaining({ itemCode: replacement.code }),
    ]);
  });

  it('applies a modifier only to the exact duplicate parent line', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const modifierTree = fixtures.menuModifiers.find(
      (candidate) => candidate.modifierGroups[0]?.options[0],
    );
    if (!modifierTree) throw new Error('Expected modifier fixture');
    const rootGroup = modifierTree.modifierGroups[0]!;
    const rootOption = rootGroup.options[0]!;
    const rootQuantity =
      typeof rootOption.quantity === 'number'
        ? rootOption.quantity
        : typeof rootGroup.min === 'number'
          ? rootGroup.min
          : 1;
    const menuItem = fixtures.menuItems.find(
      (candidate) => candidate.code === modifierTree.itemCode,
    )!;
    const clients = createMockClients(fixtures);
    const cart: Cart = {
      id: 'cart-duplicate-nested-lines',
      items: [
        {
          itemCode: menuItem.code,
          name: `${menuItem.name} first`,
          quantity: 1,
          unitPriceVnd: menuItem.priceVnd,
        },
        {
          itemCode: menuItem.code,
          name: `${menuItem.name} second`,
          quantity: 1,
          unitPriceVnd: menuItem.priceVnd + rootOption.priceDeltaVnd,
          modifiers: [
            {
              groupId: rootGroup.groupId,
              groupName: rootGroup.name,
              modifierId: rootOption.modifierId,
              modifierName: rootOption.name,
              quantity: rootQuantity,
              priceDeltaVnd: rootOption.priceDeltaVnd,
            },
          ],
        },
      ],
      subtotalVnd: menuItem.priceVnd * 2 + rootOption.priceDeltaVnd,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: menuItem.priceVnd * 2 + rootOption.priceDeltaVnd,
      voucherCode: null,
    };

    const result = await clients.cart.applyChanges(
      cart,
      [
        {
          itemCode: menuItem.code,
          quantity: 1,
          targetCartLineId: `cart-line:2:${menuItem.code}`,
          modifiers: [
            {
              groupId: rootGroup.groupId,
              modifierId: rootOption.modifierId,
              quantity: rootQuantity,
            },
          ],
        },
      ],
      externalCallContext,
    );

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.value?.items).toHaveLength(2);
    expect(result.value?.items[0]?.modifiers).toBeUndefined();
    expect(result.value?.items[1]?.modifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modifierId: rootOption.modifierId }),
      ]),
    );
  });
});
