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

function renderMenu() {
  assistantCopy.textContent = 'Mình gợi ý 5 món phù hợp để bạn chọn nhanh.';
  const items = discoveryItems(prototypeData.menu);
  const selected = selectedMenuLines(items, state.menuQuantities);
  const selectedUnits = selected.reduce((sum, line) => sum + line.quantity, 0);
  const subtotalVnd = selected.reduce((sum, line) => {
    const item = items.find((candidate) => candidate.id === line.itemCode);
    return sum + (item?.priceVnd ?? 0) * line.quantity;
  }, 0);
  const rows = items
    .map((item) => {
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
            <button
              type="button"
              aria-label="Giảm ${escapeHtml(item.name)}"
              data-quantity-item="${escapeHtml(item.id)}"
              data-delta="-1"
              ${quantity === 0 ? 'disabled' : ''}
            >−</button>
            <output aria-label="Số lượng hiện tại">${quantity}</output>
            <button
              type="button"
              aria-label="Tăng ${escapeHtml(item.name)}"
              data-quantity-item="${escapeHtml(item.id)}"
              data-delta="1"
              ${quantity === 99 ? 'disabled' : ''}
            >+</button>
          </div>
        </article>`;
    })
    .join('');
  root.innerHTML = `
    <section class="genui-card">
      <h2>Gợi ý món phù hợp</h2>
      ${rows}
      <footer class="menu-confirmation">
        <p>
          <strong>${selectedUnits} món</strong>
          <span>Tạm tính ${money(subtotalVnd)}</span>
        </p>
        <button
          type="button"
          class="primary-action"
          data-confirm-menu
          ${selectedUnits === 0 ? 'disabled' : ''}
        >Xác nhận món</button>
      </footer>
      <p class="confirmation-status" data-confirmation-status role="status"></p>
    </section>`;
  root.querySelectorAll('[data-quantity-item]').forEach((button) => {
    button.addEventListener('click', () => {
      state.menuQuantities = updateMenuQuantity(
        state.menuQuantities,
        button.dataset.quantityItem,
        Number(button.dataset.delta),
      );
      state.confirmedMenuLines = [];
      renderMenu();
    });
  });
  root.querySelector('[data-confirm-menu]')?.addEventListener('click', () => {
    state.confirmedMenuLines = selectedMenuLines(items, state.menuQuantities);
    root.querySelector('[data-confirmation-status]').textContent =
      `Đã xác nhận ${selectedUnits} món trong một yêu cầu.`;
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
      <div class="detail-footer">
        <strong>${money(item.priceVnd)}</strong>
        <button type="button" class="primary-action">Thêm vào giỏ</button>
      </div>
    </section>`;
}

function renderModifier() {
  const hero = modifierHero(prototypeData.modifier, state.selectedModifier);
  assistantCopy.textContent = 'Bạn muốn chọn loại gà nào?';
  root.innerHTML = `
    <section class="genui-card">
      ${mediaFrame(hero, 'hero')}
      <h2>Tùy chỉnh 3 Miếng Gà</h2>
      <div class="choice-list">
        ${prototypeData.modifier.options
          .map(
            (option) => `
              <button
                type="button"
                class="choice"
                data-modifier="${escapeHtml(option.id)}"
                aria-pressed="${option.id === state.selectedModifier}"
              >${escapeHtml(option.name)}</button>`,
          )
          .join('')}
      </div>
    </section>`;
  root.querySelectorAll('[data-modifier]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedModifier = button.dataset.modifier;
      renderModifier();
    });
  });
}

function renderPromotions() {
  assistantCopy.textContent = 'Đây là các chương trình đang áp dụng.';
  const cards = activePromotionCards(prototypeData.promotions, '2026-07-11');
  root.innerHTML = `
    <section class="promotion-grid">
      ${cards
        .map(
          (promotion) => `
            <article class="genui-card promotion-card">
              ${mediaFrame(promotion.media, 'hero')}
              <h2>${escapeHtml(promotion.title)}</h2>
              <p>${escapeHtml(promotion.startDate)} – ${escapeHtml(promotion.endDate)}</p>
              <p>${escapeHtml(promotion.eligibility)}</p>
            </article>`,
        )
        .join('')}
    </section>`;
}

function renderAllergen() {
  const item = prototypeData.menu[3];
  assistantCopy.textContent =
    'Mình có thể cung cấp thông tin dị ứng cho món này.';
  root.innerHTML = `
    <section class="genui-card">
      ${mediaFrame(item.media, 'hero')}
      <h2>${escapeHtml(item.name)}</h2>
      <p>Thông tin dị ứng cần dựa trên bảng công bố chính thức của KFC.</p>
      <a
        class="secondary-action"
        href="https://www.kfcvietnam.com.vn/allergen-chart"
        target="_blank"
        rel="noreferrer"
      >Xem bảng dị ứng</a>
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
      ${prototypeData.cart.items
        .map(
          (item) => `
            <div class="cart-line">
              <span>${item.quantity}× ${escapeHtml(item.name)}</span>
            </div>`,
        )
        .join('')}
      <button type="button" class="primary-action">Tiếp tục giao hàng</button>
    </section>`;
}

function render(view) {
  state.forceFailure = view === 'failure';
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.setAttribute(
      'aria-current',
      String(button.dataset.view === view),
    );
  });
  if (view === 'menu' || view === 'failure') renderMenu();
  if (view === 'detail') renderDetail();
  if (view === 'modifier') renderModifier();
  if (view === 'promotion') renderPromotions();
  if (view === 'allergen') renderAllergen();
  if (view === 'cart') renderCart();
}

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => render(button.dataset.view));
});

render('menu');

export {
  activePromotionCards,
  cartHero,
  discoveryItems,
  mediaFrame,
  modifierHero,
  money,
  prototypeData,
  render,
  selectedMenuLines,
  state,
  updateMenuQuantity,
};
