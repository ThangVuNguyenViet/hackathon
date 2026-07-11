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

function renderPending(view) {
  assistantCopy.textContent = 'Đang chuẩn bị trạng thái mẫu.';
  root.innerHTML = `<section class="genui-card"><p>${escapeHtml(view)}</p></section>`;
}

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => renderPending(button.dataset.view));
});

renderPending('menu');

export {
  activePromotionCards,
  cartHero,
  discoveryItems,
  mediaFrame,
  modifierHero,
  money,
  prototypeData,
  selectedMenuLines,
  state,
  updateMenuQuantity,
};
