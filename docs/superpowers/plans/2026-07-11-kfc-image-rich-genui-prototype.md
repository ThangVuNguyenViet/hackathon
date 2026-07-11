# KFC Image-Rich GenUI Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, reviewable browser prototype of every approved image-rich KFC GenUI decision point without modifying production Flutter or backend code.

**Architecture:** A small dependency-free HTML/CSS/JavaScript artifact lives under the Wayfinder map assets. A pure model module owns selection, limits, lifecycle, stable-cart, and failure state; a DOM adapter renders those states through one reusable verified-media frame. Node's built-in test runner verifies model behavior, while a local static server provides the visual review surface.

**Tech Stack:** Semantic HTML, CSS, browser-native ES modules, Node.js `node:test`, official KFC-hosted JPEG URLs, Python static HTTP server.

---

## File structure

Create only these files:

```text
docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/
  README.md                 # review/run instructions and prototype boundaries
  index.html                # state navigation and semantic prototype shell
  styles.css                # KFC chat visual treatment and responsive layout
  model.mjs                 # pure state/selection functions and verified sample data
  model.test.mjs            # deterministic model acceptance tests
  app.mjs                   # DOM renderer and interactive state controls
```

Do not modify any file under:

```text
apps/kfc_live_monitor_flutter/
services/kfc-agent-backend/src/
services/kfc-agent-backend/test/
```

Those paths contain concurrent uncommitted work and belong to later production tickets.

### Task 1: Build the pure prototype model with TDD

**Files:**
- Create: `docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/model.test.mjs`
- Create: `docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/model.mjs`

- [ ] **Step 1: Write failing tests for media limits, stable cart selection, modifier selection, promotion lifecycle, and failure state**

Create `model.test.mjs`:

```js
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
  const rows = discoveryItems([...prototypeData.menu, { id: 'six', name: 'Món thứ sáu', media: null }]);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((row) => row.id), prototypeData.menu.slice(0, 5).map((row) => row.id));
});

test('menu quantities start at zero and stay within zero through 99', () => {
  assert.equal(updateMenuQuantity({}, '2945', -1).get('2945'), 0);
  assert.equal(updateMenuQuantity({ '2945': 98 }, '2945', 1).get('2945'), 99);
  assert.equal(updateMenuQuantity({ '2945': 99 }, '2945', 1).get('2945'), 99);
});

test('one menu confirmation payload contains selected rows in display order', () => {
  const lines = selectedMenuLines(prototypeData.menu, { tieutungchill: 2, '2945': 1, 'd-chicken-1': 0 });
  assert.deepEqual(lines, [
    { itemCode: '2945', quantity: 1 },
    { itemCode: 'tieutungchill', quantity: 2 },
  ]);
});

test('modifier hero changes only after explicit verified selection', () => {
  assert.equal(modifierHero(prototypeData.modifier, null).mediaKey, prototypeData.modifier.parentMedia.mediaKey);
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
  const repriced = prototypeData.cart.items.map((item) => ({ ...item, quantity: item.quantity + 1 }));
  assert.equal(cartHero(repriced, first.mediaKey).mediaKey, first.mediaKey);
});

test('promotion cards exclude expired campaigns', () => {
  const cards = activePromotionCards(prototypeData.promotions, '2026-07-11');
  assert.deepEqual(cards.map((card) => card.id), ['lunch-2026', 'big-order-july-2026']);
});

test('forced failure collapses media without changing content', () => {
  assert.deepEqual(mediaFrameState(prototypeData.menu[0].media, 'failed'), {
    status: 'collapsed',
    media: prototypeData.menu[0].media,
  });
  assert.equal(mediaFrameState(prototypeData.menu[0].media, 'loading').status, 'loading');
  assert.equal(mediaFrameState(prototypeData.menu[0].media, 'loaded').status, 'loaded');
});
```

- [ ] **Step 2: Run the model tests and verify the missing module failure**

Run:

```bash
node --test docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/model.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `model.mjs`.

- [ ] **Step 3: Implement verified sample data and pure selection functions**

Create `model.mjs` with:

```js
const media = (mediaKey, entityId, url, altText) => ({
  mediaKey,
  entityType: 'menu_item',
  entityId,
  url,
  altText,
  mimeType: 'image/jpeg',
  sizeBytes: 0,
});

export const prototypeData = Object.freeze({
  menu: [
    {
      id: '2945',
      name: 'Xô Zòn Zã 159K',
      description: 'Xô 5 Miếng Gà giá ưu đãi',
      priceVnd: 159000,
      media: media(
        'kfcvn:item-image:fs-bucket5cob',
        '2945',
        'https://static.kfcvietnam.com.vn/images/items/lg/FS-BUCKET5COB.jpg?v=4lmbjg',
        'Xô Zòn Zã 159K của KFC',
      ),
    },
    {
      id: 'tieutungchill',
      name: 'Combo Tiêu Tung Chill 85K',
      description: 'Combo gà lắc tiêu chanh',
      priceVnd: 85000,
      media: media(
        'kfcvn:item-image:tieutungchill',
        'tieutungchill',
        'https://static.kfcvietnam.com.vn/images/items/lg/TIEUTUNGCHILL.jpg?v=4lmbjg',
        'Combo Tiêu Tung Chill 85K của KFC',
      ),
    },
    {
      id: 'd-chicken-1',
      name: 'Combo 1 Miếng Gà',
      description: '1 Miếng gà, khoai tây chiên và Pepsi',
      priceVnd: 59000,
      media: media(
        'kfcvn:item-image:d-chicken-1',
        'd-chicken-1',
        'https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-1.jpg?v=4lmbjg',
        'Combo 1 Miếng Gà của KFC',
      ),
    },
    {
      id: 'burger-flava',
      name: 'Burger Phi-lê Gà Quay',
      description: 'Burger với phi-lê gà quay',
      priceVnd: 56000,
      media: media(
        'kfcvn:item-image:burger-flava',
        'burger-flava',
        'https://static.kfcvietnam.com.vn/images/items/lg/Burger-Flava.jpg?v=4lmbjg',
        'Burger Phi-lê Gà Quay của KFC',
      ),
    },
    {
      id: 'salad-sesame',
      name: 'Salad Xốt Mè Rang',
      description: 'Salad ăn nhẹ với xốt mè rang',
      priceVnd: 22000,
      media: media(
        'kfcvn:item-image:salad-xot-me-rang',
        'salad-sesame',
        'https://static.kfcvietnam.com.vn/images/items/lg/SALAD-XOT-ME-RANG.jpg?v=4lmbjg',
        'Salad Xốt Mè Rang của KFC',
      ),
    },
  ],
  modifier: {
    parentMedia: media(
      'kfcvn:item-image:3-fried-chicken',
      'three-chicken',
      'https://static.kfcvietnam.com.vn/images/items/lg/3-Fried-Chicken.jpg?v=4lmbjg',
      'Ba miếng gà KFC',
    ),
    options: [
      {
        id: 'hot-spicy',
        name: 'Gà Giòn Cay',
        media: media(
          'kfcvn:item-image:mod-ga-gion-cay',
          'hot-spicy',
          'https://static.kfcvietnam.com.vn/images/items/lg/MOD-Ga-Gion-Cay.jpg?v=4lmbjg',
          'Lựa chọn Gà Giòn Cay của KFC',
        ),
      },
      { id: 'no-media', name: 'Giữ lựa chọn hiện tại', media: null },
    ],
  },
  promotions: [
    {
      id: 'lunch-2026',
      title: 'Trưa Nay Khỏi Nghĩ Nhiều',
      startDate: '2026-01-02',
      endDate: '2026-12-31',
      eligibility: '10:00–14:00, thứ Hai đến thứ Sáu',
      media: {
        ...media(
          'kfcvn:promotion-image:lunch-2026',
          'lunch-2026',
          'https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg',
          'Khuyến mãi bữa trưa KFC năm 2026',
        ),
        entityType: 'promotion_campaign',
      },
    },
    {
      id: 'big-order-july-2026',
      title: 'Thêm Gà, Tiệc Thêm Vui',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      eligibility: 'Áp dụng cho đơn hàng lớn',
      media: {
        ...media(
          'kfcvn:promotion-image:big-order-july-2026',
          'big-order-july-2026',
          'https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T7.jpg',
          'Khuyến mãi đơn hàng lớn KFC tháng 7 năm 2026',
        ),
        entityType: 'promotion_campaign',
      },
    },
    {
      id: 'expired-march-2026',
      title: 'Gà Giòn Thay Hoa',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      eligibility: 'Đã hết hạn',
      media: null,
    },
  ],
  cart: {
    items: [
      { entityId: '2945', name: 'Xô Zòn Zã 159K', category: 'main', quantity: 1 },
      { entityId: 'pepsi', name: 'Pepsi', category: 'drink', quantity: 2 },
    ],
  },
});

export function discoveryItems(items) {
  return items.slice(0, 5);
}

export function updateMenuQuantity(quantities, itemCode, delta) {
  const next = new Map(quantities instanceof Map ? quantities : Object.entries(quantities));
  const current = Number(next.get(itemCode) ?? 0);
  next.set(itemCode, Math.max(0, Math.min(99, current + delta)));
  return next;
}

export function selectedMenuLines(items, quantities) {
  const values = quantities instanceof Map ? quantities : new Map(Object.entries(quantities));
  return items.flatMap((item) => {
    const quantity = Number(values.get(item.id) ?? 0);
    return quantity > 0 ? [{ itemCode: item.id, quantity }] : [];
  });
}

export function modifierHero(modifier, selectedOptionId) {
  return modifier.options.find((option) => option.id === selectedOptionId)?.media ?? modifier.parentMedia;
}

export function cartHero(items, persistedMediaKey) {
  if (persistedMediaKey) {
    return prototypeData.menu.map((item) => item.media).find((entry) => entry?.mediaKey === persistedMediaKey) ?? null;
  }
  const firstMain = items.find((item) => item.category === 'main');
  return prototypeData.menu.find((item) => item.id === firstMain?.entityId)?.media ?? null;
}

export function activePromotionCards(promotions, asOfDate) {
  return promotions.filter((promotion) => promotion.startDate <= asOfDate && promotion.endDate >= asOfDate);
}

export function mediaFrameState(mediaValue, state) {
  if (!mediaValue || state === 'failed') return { status: 'collapsed', media: mediaValue };
  return { status: state, media: mediaValue };
}
```

- [ ] **Step 4: Run the model tests and verify they pass**

Run:

```bash
node --test docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/model.test.mjs
```

Expected: 7 tests pass, 0 fail.

- [ ] **Step 5: Commit the model slice**

```bash
git add docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/model.mjs \
  docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/model.test.mjs
git commit -m "test: model image-rich GenUI prototype states"
```

### Task 2: Create the semantic prototype shell and reusable media frame

**Files:**
- Create: `docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/index.html`
- Create: `docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/styles.css`
- Create: `docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/app.mjs`

- [ ] **Step 1: Add the state navigation and review canvas**

Create `index.html` with one navigation button per accepted state and one live region:

```html
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>KFC Image-Rich GenUI Prototype</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <header class="prototype-header">
      <p class="eyebrow">Wayfinder prototype</p>
      <h1>KFC Image-Rich GenUI</h1>
      <p>Ảnh KFC đã xác minh tại các điểm quyết định hữu ích.</p>
    </header>
    <nav class="state-nav" aria-label="Trạng thái mẫu">
      <button data-view="menu">Thực đơn</button>
      <button data-view="detail">Chi tiết</button>
      <button data-view="modifier">Tùy chọn</button>
      <button data-view="promotion">Khuyến mãi</button>
      <button data-view="allergen">Dị ứng</button>
      <button data-view="cart">Giỏ hàng</button>
      <button data-view="failure">Lỗi ảnh</button>
    </nav>
    <main>
      <section class="chat-frame" aria-label="Bản xem trước hội thoại">
        <div class="assistant-copy" id="assistant-copy"></div>
        <div id="prototype-root" aria-live="polite"></div>
      </section>
    </main>
    <script type="module" src="./app.mjs"></script>
  </body>
</html>
```

- [ ] **Step 2: Implement the reusable media-frame renderer before decision widgets**

Start `app.mjs` with:

```js
import {
  activePromotionCards,
  cartHero,
  discoveryItems,
  modifierHero,
  prototypeData,
  selectedMenuLines,
  updateMenuQuantity,
} from './model.mjs';

const root = document.querySelector('#prototype-root');
const assistantCopy = document.querySelector('#assistant-copy');
const state = {
  selectedModifier: null,
  menuQuantities: new Map(),
  confirmedMenuLines: [],
  cartMediaKey: null,
  forceFailure: false,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function mediaFrame(media, role = 'thumbnail') {
  if (!media || state.forceFailure) return '';
  return `
    <figure class="media-frame media-frame--${role}" data-media-key="${escapeHtml(media.mediaKey)}">
      <div class="media-shimmer" aria-hidden="true"></div>
      <img
        src="${escapeHtml(media.url)}"
        alt="${escapeHtml(media.altText)}"
        loading="eager"
        decoding="async"
        onload="this.closest('figure').dataset.status='loaded'"
        onerror="this.closest('figure').remove()"
      />
    </figure>`;
}

function money(value) {
  return `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
}
```

- [ ] **Step 3: Add the shared visual tokens, shimmer, and responsive conversation frame**

Create `styles.css` with explicit tokens and media behavior:

```css
:root {
  color-scheme: light;
  --kfc-red: #d71920;
  --ink: #241f20;
  --muted: #6f6668;
  --surface: #ffffff;
  --surface-soft: #f6f2f1;
  --line: #e6dcda;
  --shadow: 0 16px 42px rgb(36 31 32 / 10%);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }
body { margin: 0; background: #f3efee; color: var(--ink); }
button { font: inherit; }
.prototype-header, .state-nav, main { width: min(920px, calc(100% - 32px)); margin-inline: auto; }
.prototype-header { padding: 36px 0 18px; }
.prototype-header h1 { margin: 4px 0 8px; font-size: clamp(28px, 5vw, 48px); }
.eyebrow { margin: 0; color: var(--kfc-red); font-weight: 800; text-transform: uppercase; letter-spacing: .12em; }
.state-nav { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 14px; }
.state-nav button { border: 1px solid var(--line); border-radius: 999px; background: var(--surface); padding: 9px 14px; white-space: nowrap; cursor: pointer; }
.state-nav button[aria-current="true"] { background: var(--kfc-red); border-color: var(--kfc-red); color: white; }
main { padding-bottom: 48px; }
.chat-frame { max-width: 620px; margin-inline: auto; background: var(--surface); border-radius: 24px; padding: 20px; box-shadow: var(--shadow); }
.assistant-copy { width: fit-content; max-width: 88%; margin-bottom: 10px; border: 1px solid var(--line); border-radius: 14px 14px 14px 4px; padding: 10px 13px; line-height: 1.45; }
.genui-card { border: 1px solid var(--line); border-radius: 18px; padding: 14px; background: var(--surface); }
.media-frame { position: relative; margin: 0; overflow: hidden; background: var(--surface-soft); }
.media-frame--thumbnail { width: 88px; height: 72px; flex: 0 0 88px; border-radius: 12px; }
.media-frame--hero { width: 100%; aspect-ratio: var(--media-ratio, 480 / 390); border-radius: 14px; margin-bottom: 12px; }
.media-frame img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; opacity: 0; transition: opacity 160ms ease; }
.media-frame[data-status="loaded"] img { opacity: 1; }
.media-frame[data-status="loaded"] .media-shimmer { display: none; }
.media-shimmer { position: absolute; inset: 0; background: linear-gradient(100deg, #eee7e5 20%, #faf7f6 45%, #eee7e5 70%); background-size: 240% 100%; animation: shimmer 1.2s infinite linear; }
@keyframes shimmer { to { background-position-x: -240%; } }
@media (prefers-reduced-motion: reduce) { .media-shimmer { animation: none; } }
```

- [ ] **Step 4: Serve the shell and inspect browser console/errors**

Run:

```bash
python3 -m http.server 4173 --directory docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype
```

Open `http://localhost:4173`, click every state button, and confirm the console contains no module or network errors other than states intentionally simulated later.

- [ ] **Step 5: Commit the shell**

```bash
git add docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/index.html \
  docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/styles.css \
  docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/app.mjs
git commit -m "feat: scaffold image-rich GenUI prototype"
```

### Task 3: Render menu discovery and product detail

**Files:**
- Modify: `docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/app.mjs`
- Modify: `docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/styles.css`

- [ ] **Step 1: Add menu and detail renderers**

Add to `app.mjs`:

```js
function renderMenu() {
  assistantCopy.textContent = 'Mình gợi ý 5 món phù hợp để bạn chọn nhanh.';
  const items = discoveryItems(prototypeData.menu);
  const selected = selectedMenuLines(items, state.menuQuantities);
  const selectedUnits = selected.reduce((sum, line) => sum + line.quantity, 0);
  const subtotalVnd = selected.reduce((sum, line) => {
    const item = items.find((candidate) => candidate.id === line.itemCode);
    return sum + (item?.priceVnd ?? 0) * line.quantity;
  }, 0);
  const rows = items.map((item) => {
    const quantity = Number(state.menuQuantities.get(item.id) ?? 0);
    return `
    <article class="menu-row">
      ${mediaFrame(item.media, 'thumbnail')}
      <div class="menu-copy">
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.description)}</p>
        <strong>${money(item.priceVnd)}</strong>
      </div>
      <div class="quantity-stepper" aria-label="Số lượng ${escapeHtml(item.name)}">
        <button data-quantity-item="${escapeHtml(item.id)}" data-delta="-1" ${quantity === 0 ? 'disabled' : ''}>−</button>
        <output>${quantity}</output>
        <button data-quantity-item="${escapeHtml(item.id)}" data-delta="1" ${quantity === 99 ? 'disabled' : ''}>+</button>
      </div>
    </article>`;
  }).join('');
  root.innerHTML = `
    <section class="genui-card">
      <h2>Gợi ý món phù hợp</h2>
      ${rows}
      <footer class="menu-confirmation">
        <p><strong>${selectedUnits} món</strong><span>Tạm tính ${money(subtotalVnd)}</span></p>
        <button class="primary-action" data-confirm-menu ${selectedUnits === 0 ? 'disabled' : ''}>Xác nhận món</button>
      </footer>
    </section>`;
  root.querySelectorAll('[data-quantity-item]').forEach((button) => {
    button.addEventListener('click', () => {
      state.menuQuantities = updateMenuQuantity(
        state.menuQuantities,
        button.dataset.quantityItem,
        Number(button.dataset.delta),
      );
      renderMenu();
    });
  });
  root.querySelector('[data-confirm-menu]')?.addEventListener('click', () => {
    state.confirmedMenuLines = selectedMenuLines(items, state.menuQuantities);
    root.querySelector('[data-confirm-menu]').textContent = `Đã xác nhận ${selectedUnits} món`;
  });
}

function renderDetail() {
  const item = prototypeData.menu[3];
  assistantCopy.textContent = 'Đây là thông tin Burger Phi-lê Gà Quay.';
  root.innerHTML = `
    <section class="genui-card">
      ${mediaFrame(item.media, 'hero')}
      <h2>${escapeHtml(item.name)}</h2>
      <p>${escapeHtml(item.description)}</p>
      <div class="detail-footer"><strong>${money(item.priceVnd)}</strong><button class="primary-action">Thêm vào giỏ</button></div>
    </section>`;
}
```

- [ ] **Step 2: Add compact row and action styles**

Append to `styles.css`:

```css
.genui-card h2 { margin: 0 0 12px; font-size: 18px; }
.menu-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); }
.menu-row:first-of-type { border-top: 0; }
.menu-copy { min-width: 0; flex: 1; }
.menu-copy h3 { margin: 0; font-size: 14px; }
.menu-copy p { display: -webkit-box; margin: 3px 0; overflow: hidden; color: var(--muted); font-size: 12px; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.menu-copy strong { font-size: 13px; }
.primary-action { border: 0; border-radius: 10px; background: var(--kfc-red); color: white; font-weight: 800; padding: 9px 12px; cursor: pointer; }
.primary-action:disabled { cursor: not-allowed; opacity: .45; }
.quantity-stepper { display: grid; grid-template-columns: 32px 32px 32px; align-items: center; text-align: center; }
.quantity-stepper button { width: 32px; height: 32px; border: 1px solid var(--line); background: var(--surface); cursor: pointer; }
.quantity-stepper button:disabled { cursor: not-allowed; opacity: .4; }
.quantity-stepper output { font-weight: 800; }
.menu-confirmation { position: sticky; bottom: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px -14px -14px; border-top: 1px solid var(--line); border-radius: 0 0 18px 18px; padding: 12px 14px; background: var(--surface); }
.menu-confirmation p { display: grid; gap: 2px; margin: 0; }
.menu-confirmation span { color: var(--muted); font-size: 12px; }
.detail-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
```

- [ ] **Step 3: Wire state navigation and verify five-item/one-item behavior**

Add a `render(view)` switch and button listeners:

```js
function render(view) {
  state.forceFailure = view === 'failure';
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.setAttribute('aria-current', String(button.dataset.view === view));
  });
  if (view === 'menu' || view === 'failure') renderMenu();
  if (view === 'detail') renderDetail();
}

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => render(button.dataset.view));
});

render('menu');
```

Serve the prototype and confirm:

- menu shows five rows and five thumbnails;
- every menu quantity starts at zero and minus is disabled;
- there are no per-dish add buttons;
- the only `Xác nhận món` button is disabled until a quantity increases;
- one confirmation stores one ordered payload containing only non-zero dishes and exact quantities;
- detail shows one full-width hero;
- failure shows identical five text rows/actions with no media frames.

- [ ] **Step 4: Run the model tests**

```bash
node --test docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/model.test.mjs
```

Expected: 7 pass, 0 fail.

- [ ] **Step 5: Commit menu/detail states**

```bash
git add docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/app.mjs \
  docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/styles.css
git commit -m "feat: prototype menu and detail media states"
```

### Task 4: Render modifier, promotion, allergen, and cart states

**Files:**
- Modify: `docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/app.mjs`
- Modify: `docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/styles.css`

- [ ] **Step 1: Add modifier selection with explicit hero switching**

Add:

```js
function renderModifier() {
  const hero = modifierHero(prototypeData.modifier, state.selectedModifier);
  assistantCopy.textContent = 'Bạn muốn chọn loại gà nào?';
  root.innerHTML = `
    <section class="genui-card">
      ${mediaFrame(hero, 'hero')}
      <h2>Tùy chỉnh 3 Miếng Gà</h2>
      <div class="choice-list">
        ${prototypeData.modifier.options.map((option) => `
          <button class="choice" data-modifier="${escapeHtml(option.id)}" aria-pressed="${option.id === state.selectedModifier}">
            ${escapeHtml(option.name)}
          </button>`).join('')}
      </div>
    </section>`;
  root.querySelectorAll('[data-modifier]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedModifier = button.dataset.modifier;
      renderModifier();
    });
  });
}
```

- [ ] **Step 2: Add active promotion cards**

Add:

```js
function renderPromotions() {
  assistantCopy.textContent = 'Đây là các chương trình đang áp dụng.';
  const cards = activePromotionCards(prototypeData.promotions, '2026-07-11');
  root.innerHTML = `<section class="promotion-grid">${cards.map((promotion) => `
    <article class="genui-card promotion-card">
      ${mediaFrame(promotion.media, 'hero')}
      <h2>${escapeHtml(promotion.title)}</h2>
      <p>${escapeHtml(promotion.startDate)} – ${escapeHtml(promotion.endDate)}</p>
      <p>${escapeHtml(promotion.eligibility)}</p>
    </article>`).join('')}</section>`;
}
```

- [ ] **Step 3: Add allergen and stable first-cart states**

Add:

```js
function renderAllergen() {
  const item = prototypeData.menu[3];
  assistantCopy.textContent = 'Mình có thể cung cấp thông tin dị ứng cho món này.';
  root.innerHTML = `
    <section class="genui-card">
      ${mediaFrame(item.media, 'hero')}
      <h2>${escapeHtml(item.name)}</h2>
      <p>Thông tin dị ứng cần dựa trên bảng công bố chính thức của KFC.</p>
      <a class="secondary-action" href="https://www.kfcvietnam.com.vn/allergen-chart" target="_blank" rel="noreferrer">Xem bảng dị ứng</a>
    </section>`;
}

function renderCart() {
  const hero = cartHero(prototypeData.cart.items, state.cartMediaKey);
  state.cartMediaKey ??= hero?.mediaKey ?? null;
  assistantCopy.textContent = 'Mình đã cập nhật giỏ hàng để bạn kiểm tra.';
  root.innerHTML = `
    <section class="genui-card">
      ${mediaFrame(hero, 'hero')}
      <h2>Giỏ hàng của bạn</h2>
      ${prototypeData.cart.items.map((item) => `<div class="cart-line"><span>${item.quantity}× ${escapeHtml(item.name)}</span></div>`).join('')}
      <button class="primary-action">Tiếp tục giao hàng</button>
    </section>`;
}
```

- [ ] **Step 4: Complete navigation and styles**

Extend `render(view)` with `modifier`, `promotion`, `allergen`, and `cart`. Append:

```css
.choice-list { display: grid; gap: 8px; }
.choice { border: 1px solid var(--line); border-radius: 12px; background: var(--surface); padding: 11px; text-align: left; cursor: pointer; }
.choice[aria-pressed="true"] { border-color: var(--kfc-red); box-shadow: inset 3px 0 var(--kfc-red); }
.promotion-grid { display: grid; gap: 12px; }
.promotion-card p { color: var(--muted); }
.secondary-action { display: inline-flex; border: 1px solid var(--kfc-red); border-radius: 10px; color: var(--kfc-red); font-weight: 800; padding: 9px 12px; text-decoration: none; }
.cart-line { padding: 10px 0; border-top: 1px solid var(--line); }
```

Serve and verify each navigation state renders without changing the menu/payment/handoff production files.

- [ ] **Step 5: Commit remaining prototype states**

```bash
git add docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/app.mjs \
  docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/styles.css
git commit -m "feat: prototype remaining catalog media decisions"
```

### Task 5: Add review instructions and run final prototype verification

**Files:**
- Create: `docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/README.md`
- Modify: `docs/wayfinder/kfc-verified-catalog-media-chat/issues/05-prototype-image-rich-genui-decision-points.md`
- Modify: `docs/wayfinder/kfc-verified-catalog-media-chat/map.md`

- [ ] **Step 1: Write the review guide**

Create `README.md`:

```md
# KFC Image-Rich GenUI Prototype

This standalone artifact illustrates the approved GenUI visual hierarchy. It does not modify or import production Flutter/backend code.

## Run

```bash
python3 -m http.server 4173 --directory docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype
```

Open `http://localhost:4173`.

## Review states

1. Thực đơn — five compact thumbnail rows, zero-based per-dish quantity controls, and one batch-confirm button.
2. Chi tiết — one full-width verified product image.
3. Tùy chọn — parent hero changes only after explicit modifier selection.
4. Khuyến mãi — active campaign cards; expired campaign excluded.
5. Dị ứng — parent product image plus official chart action.
6. Giỏ hàng — one stable first-main-item image.
7. Lỗi ảnh — text/actions preserved and media fully collapsed.

All remote images use verified official `static.kfcvietnam.com.vn` URLs. There is no replacement artwork.
```

- [ ] **Step 2: Run deterministic tests**

```bash
node --test docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/model.test.mjs
```

Expected: 7 tests pass, 0 fail.

- [ ] **Step 3: Verify all official prototype images remain reachable**

```bash
node -e "import('./docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype/model.mjs').then(async ({prototypeData}) => { const values = [...prototypeData.menu.map((x) => x.media), prototypeData.modifier.parentMedia, ...prototypeData.modifier.options.map((x) => x.media), ...prototypeData.promotions.map((x) => x.media)].filter(Boolean); const unique = [...new Map(values.map((x) => [x.url, x])).values()]; const rows = await Promise.all(unique.map(async (x) => { const r = await fetch(x.url, { method: 'HEAD' }); return { url: x.url, ok: r.ok, type: r.headers.get('content-type') }; })); const failures = rows.filter((x) => !x.ok || !x.type?.startsWith('image/')); console.log(JSON.stringify({ checked: rows.length, failures }, null, 2)); if (failures.length) process.exit(1); })"
```

Expected: every unique URL reports `ok: true`, an `image/*` content type, and `failures: []`.

- [ ] **Step 4: Perform the manual acceptance walkthrough**

Run the server and confirm:

- five menu choices remain scanable at 390px and 620px viewport widths;
- every dish starts at zero; minus is disabled at zero and plus stops at 99;
- no row has an add/confirm action; exactly one chooser-level `Xác nhận món` button exists;
- the confirm button remains disabled for an empty selection and emits one display-ordered batch after selection;
- no image uses `object-fit: cover`;
- product detail shows one hero;
- modifier selection swaps only to its verified media;
- promotions show two current campaigns and no expired campaign;
- allergen action opens the official KFC chart;
- cart image stays unchanged after quantity data is altered in browser devtools and rerendered;
- failure state contains the same names, prices, and actions as menu state but zero `<figure>` elements;
- keyboard focus reaches all navigation, choice, action, and link controls;
- reduced-motion mode removes shimmer animation.

- [ ] **Step 5: Record the Wayfinder prototype resolution after user review**

Do not mark the ticket resolved before the user reviews the running artifact. After approval:

- add an `## Answer` linking `README.md` and `index.html`;
- set ticket status to `resolved`;
- append one decision pointer to the map;
- update the frontier to the remaining open/unblocked tickets.

- [ ] **Step 6: Commit the reviewed prototype and Wayfinder resolution**

```bash
git add docs/wayfinder/kfc-verified-catalog-media-chat/assets/image-rich-genui-prototype \
  docs/wayfinder/kfc-verified-catalog-media-chat/issues/05-prototype-image-rich-genui-decision-points.md \
  docs/wayfinder/kfc-verified-catalog-media-chat/map.md
git commit -m "feat: add reviewed image-rich GenUI prototype"
```

## Plan self-review

- Spec coverage: all seven prototype acceptance states map to Tasks 3–5.
- Isolation: every code file is under the Wayfinder prototype asset; production runtime files are explicitly excluded.
- Type consistency: `mediaKey`, `entityType`, `entityId`, `url`, `altText`, `mimeType`, and `sizeBytes` match the approved spec.
- Limits: menu is capped at five; detail/modifier/cart/allergen use one image; promotion data excludes expired campaigns.
- Failure behavior: media is removed while authoritative text/actions remain.
- Placeholders: request examples use fixed prototype values; no unfinished implementation markers remain.
