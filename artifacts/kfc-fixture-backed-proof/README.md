# KFC Fixture-Backed Live AI Proof

Generated: 2026-07-08

## Videos

- `videos/messenger-chat-live-ai.mp4` - Facebook Messenger conversation with the connected test Page.
- `videos/monitor-dashboard-live-ai.mp4` - KFC Live Monitor showing the same live session conversation.

## Live Session

- Session id: `messenger:28045848808355563`
- Messenger Page shown in Facebook UI: `Braise - AI cooking assistant`
- Backend/runtime: KFC Vietnam ordering assistant at `http://127.0.0.1:18090`
- Monitor URL: `http://127.0.0.1:18191/`

The Page name is the connected Meta test Page for this local proof. The backend, monitor, fixture data, and assistant behavior are KFC-specific.

## Verified Backend Events

The clean Messenger session emitted these fixture-backed events:

- `searchMenu` for `Combo Hợp Gu 99K`
- `updateCart` for item `20751`
- `getModifierOptions` from `kfcvietnam-api-modifier-tree.json`
- `quoteFulfillment` using store availability crawl data
- `store_assigned`: `KFCVN0002` / `KFC BIG C ĐỒNG NAI`
- `delivery_quote`: `18000` VND, `35` minutes
- `searchPromotions`
- `previewOrder`
- `placeOrder` with `resultSummary: order_created`
- `order_created`: `KFC-MOCK-1001`

No real KFC order, payment, or voucher redemption was submitted. Order creation is through the mock OMS fixture layer.

## Checksums

```text
e4a0074c11c83c0b02e8c0d5dc2d341b228b21517145cc7b682ef9fbb222dac0  videos/messenger-chat-live-ai.mp4
9195bf84f3a5721706dfc599c371faff18c6716e3d6b42592901edc09c100a27  videos/monitor-dashboard-live-ai.mp4
8ee1ed8c5d3ea3f498ea50d4d32ab5e751d6e10c665974e5f6bcca7ee90558f3  screenshots/messenger-chat-live-ai.png
57a18b68195d3b74303ac29a1c878ffbe6d1b28f939be8e17cb9e9198e829d8e  screenshots/monitor-dashboard-live-ai.png
```
