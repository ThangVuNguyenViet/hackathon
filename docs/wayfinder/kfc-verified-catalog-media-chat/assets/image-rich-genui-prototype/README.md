# KFC Image-Rich GenUI Prototype

This standalone artifact illustrates the approved GenUI visual hierarchy. It does not modify or import production Flutter or backend code.

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
7. Lỗi ảnh — text and actions preserved while media fully collapses.

All remote images use verified official `static.kfcvietnam.com.vn` URLs. There is no replacement artwork.

## Menu chooser contract

- Every dish starts at quantity zero.
- Minus is disabled at zero; plus is capped at 99.
- Dish rows do not contain add or confirmation buttons.
- The only `Xác nhận món` button is disabled until at least one dish is selected.
- Confirmation creates one display-ordered batch containing only non-zero dish quantities.

## Boundaries

- The prototype contains no fixture refresh or production runtime integration.
- Remote image failure removes the media frame and leaves text and controls intact.
- Promotion lifecycle is evaluated against the documented prototype evidence date, `2026-07-11`.
