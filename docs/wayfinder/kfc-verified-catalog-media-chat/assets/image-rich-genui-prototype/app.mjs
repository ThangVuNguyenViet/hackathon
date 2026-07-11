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
