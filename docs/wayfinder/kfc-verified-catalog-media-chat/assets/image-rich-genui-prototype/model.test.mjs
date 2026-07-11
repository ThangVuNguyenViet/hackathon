import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activePromotionCards,
  cartHero,
  discoveryItems,
  mediaFrameState,
  modifierHero,
  prototypeData,
  selectedMenuLines,
  updateMenuQuantity,
} from './model.mjs';

test('menu discovery keeps five ordered choices including text-only rows', () => {
  const rows = discoveryItems([
    ...prototypeData.menu,
    { id: 'six', name: 'Món thứ sáu', media: null },
  ]);
  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows.map((row) => row.id),
    prototypeData.menu.slice(0, 5).map((row) => row.id),
  );
});

test('menu quantities start at zero and stay within zero through 99', () => {
  assert.equal(updateMenuQuantity({}, '2945', -1).get('2945'), 0);
  assert.equal(updateMenuQuantity({ 2945: 98 }, '2945', 1).get('2945'), 99);
  assert.equal(updateMenuQuantity({ 2945: 99 }, '2945', 1).get('2945'), 99);
});

test('one menu confirmation payload contains selected rows in display order', () => {
  const lines = selectedMenuLines(prototypeData.menu, {
    tieutungchill: 2,
    2945: 1,
    'd-chicken-1': 0,
  });
  assert.deepEqual(lines, [
    { itemCode: '2945', quantity: 1 },
    { itemCode: 'tieutungchill', quantity: 2 },
  ]);
});

test('modifier hero changes only after explicit verified selection', () => {
  assert.equal(
    modifierHero(prototypeData.modifier, null).mediaKey,
    prototypeData.modifier.parentMedia.mediaKey,
  );
  assert.equal(
    modifierHero(prototypeData.modifier, 'hot-spicy').mediaKey,
    prototypeData.modifier.options[0].media.mediaKey,
  );
  assert.equal(
    modifierHero(prototypeData.modifier, 'no-media').mediaKey,
    prototypeData.modifier.parentMedia.mediaKey,
  );
});

test('cart hero uses the first main item and remains stable', () => {
  const first = cartHero(prototypeData.cart.items, null);
  assert.equal(first.entityId, '2945');
  const repriced = prototypeData.cart.items.map((item) => ({
    ...item,
    quantity: item.quantity + 1,
  }));
  assert.equal(cartHero(repriced, first.mediaKey).mediaKey, first.mediaKey);
});

test('promotion cards exclude expired campaigns', () => {
  const cards = activePromotionCards(prototypeData.promotions, '2026-07-11');
  assert.deepEqual(
    cards.map((card) => card.id),
    ['lunch-2026', 'big-order-july-2026'],
  );
});

test('forced failure collapses media without changing content', () => {
  assert.deepEqual(mediaFrameState(prototypeData.menu[0].media, 'failed'), {
    status: 'collapsed',
    media: prototypeData.menu[0].media,
  });
  assert.equal(
    mediaFrameState(prototypeData.menu[0].media, 'loading').status,
    'loading',
  );
  assert.equal(
    mediaFrameState(prototypeData.menu[0].media, 'loaded').status,
    'loaded',
  );
});
