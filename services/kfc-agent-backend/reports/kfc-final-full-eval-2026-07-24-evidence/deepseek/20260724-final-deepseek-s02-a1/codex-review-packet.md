# Codex review packet: 02: Tư vấn combo, ngân sách, khuyến mãi, upsell

## Held-out narrative

Goal: Khách đặt nhiều món lẻ cho nhóm; AI nhận ra combo tương đương tiết kiệm hơn, chờ khách đồng ý đổi đơn, rồi upsell tăng size nước và cập nhật giỏ hàng theo lựa chọn của khách.

Preconditions:
- Khách bắt đầu với giỏ hàng trống và đang chọn món cho nhóm bốn người trong ngân sách khoảng 300.000đ.
- Menu, thành phần combo, tùy chọn kích cỡ và giá hiện hành có thể được tra cứu; chưa có thay đổi giỏ hàng nào được khách chấp thuận.

Risks:
- Recommendations must be grounded in available menu and price information.
- Cart changes and upsells require clear customer agreement.

Intended outcome state: cart_ready

## Review guidance

Evaluate the improvised transcript as a whole. Judge whether the assistant handled the narrative goal, grounded claims in tool evidence, preserved customer authority, and recovered naturally from failures. Do not require exact wording or an exact tool sequence.

## Transcript

## User

Nhóm mình 4 người mà chỉ khoảng 300 nghìn, chưa biết chọn gì. Bạn xem menu và ưu đãi hiện có rồi gợi ý phương án đủ ăn giúp mình, không cần món tráng miệng.

### Tool call: searchMenu

```json
{
  "callId": "call_00_UwQCCna2HqUagDpess1G3454",
  "arguments": {
    "mode": "full",
    "queries": [],
    "category": "combo",
    "maxPriceVnd": 300000,
    "partySize": 4,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T07:48:07.480Z"
}
```

### Tool call: searchPromotions

```json
{
  "callId": "call_01_Htlc5UHY5txb1Sae04eM6020",
  "arguments": {},
  "requestedAt": "2026-07-24T07:48:07.482Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_UwQCCna2HqUagDpess1G3454",
  "arguments": {
    "mode": "full",
    "queries": [],
    "modifierQueries": [],
    "category": "combo",
    "maxPriceVnd": 300000,
    "partySize": 4
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "full",
      "queries": [],
      "total": 21,
      "returned": 21,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"full\",\"queries\":[],\"category\":\"combo\",\"maxPriceVnd\":300000,\"partySize\":4,\"modifierQueries\":[]}"
      },
      "items": [
        {
          "code": "20690",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 2 No Nê",
          "description": "4 Miếng gà + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 169000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D.BUCKET4_FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20706",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà No 279k",
          "description": "4 Miếng gà rán + 2 Burger zinger + 1 Khoai tây chiên (vừa) + 4 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 279000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-4COB-279K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "10515",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 139K",
          "description": "3 Miếng Gà + 5 Nuggets + 3 Tenders",
          "priceVnd": 139000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CBO-139.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20687",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 1 Miếng Gà",
          "description": "1 Miếng gà + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 59000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-1.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20688",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Một Mình Chill",
          "description": "1 Miếng gà + 1 Mì ý xúc xích + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 91000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1COB-Pasta.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20689",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 2 Miếng Gà",
          "description": "2 Miếng gà + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 91000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-2.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20692",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Mỳ Ý Solo",
          "description": "1 Mì ý gà rán + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 71000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1-Pasta-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20693",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Mì Ý & Gà Tenders",
          "description": "1 Mì ý xúc xích + 3 Tender + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Pasta-Tender.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20694",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Rán Solo",
          "description": "1 Cơm Gà rán + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20695",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Rán & Súp",
          "description": "1 Cơm Gà rán + 1 Súp rong biển + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 69000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Rice-Soup.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20696",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Quay Solo",
          "description": "1 Cơm Gà quay + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 59000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-FLAVA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20697",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Nanban Solo",
          "description": "1 Cơm Gà nanban + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 46000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-NANBAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20698",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Zinger",
          "description": "1 Burger zinger + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-B.ZINGER-FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20700",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Tôm",
          "description": "1 Burger tôm + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 69000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.Shrimp.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20699",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Gà Quay",
          "description": "1 Burger gà quay +  1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DB-ROASTED-FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20701",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Gà Yo",
          "description": "1 Burger gà yo + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20691",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 3 Tụ Tập",
          "description": "5 Miếng gà + 1 Gà viên (Vừa) + 3 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 239000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-5-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20702",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Burger Gà Yo & Gà Rán",
          "description": "1 Burger gà yo + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (vừa)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo-COB_.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20703",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 2 Vui Vẻ",
          "description": "3 Miếng gà rán + 1 Mì ý gà viên + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 159000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-3-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20704",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Hai Mình Chill",
          "description": "2 Mì ý xúc xích + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 146000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-2-Pasta-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20705",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà Chill 199k",
          "description": "3 Miếng gà rán + 2 Mì ý xúc xích + 1 Khoai tây chiên (vừa) + 3 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 199000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-3COB-199K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        }
      ]
    },
    "message": "verified_menu_collection",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "modelFacingResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "items": [
        {
          "code": "20690",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 2 No Nê",
          "description": "4 Miếng gà + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 169000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D.BUCKET4_FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20706",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà No 279k",
          "description": "4 Miếng gà rán + 2 Burger zinger + 1 Khoai tây chiên (vừa) + 4 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 279000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-4COB-279K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "10515",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 139K",
          "description": "3 Miếng Gà + 5 Nuggets + 3 Tenders",
          "priceVnd": 139000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CBO-139.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20687",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 1 Miếng Gà",
          "description": "1 Miếng gà + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 59000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-1.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20688",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Một Mình Chill",
          "description": "1 Miếng gà + 1 Mì ý xúc xích + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 91000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1COB-Pasta.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20689",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 2 Miếng Gà",
          "description": "2 Miếng gà + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 91000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-2.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20692",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Mỳ Ý Solo",
          "description": "1 Mì ý gà rán + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 71000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1-Pasta-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20693",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Mì Ý & Gà Tenders",
          "description": "1 Mì ý xúc xích + 3 Tender + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Pasta-Tender.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20694",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Rán Solo",
          "description": "1 Cơm Gà rán + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20695",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Rán & Súp",
          "description": "1 Cơm Gà rán + 1 Súp rong biển + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 69000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Rice-Soup.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20696",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Quay Solo",
          "description": "1 Cơm Gà quay + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 59000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-FLAVA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20697",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Nanban Solo",
          "description": "1 Cơm Gà nanban + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 46000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-NANBAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20698",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Zinger",
          "description": "1 Burger zinger + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-B.ZINGER-FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20700",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Tôm",
          "description": "1 Burger tôm + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 69000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.Shrimp.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20699",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Gà Quay",
          "description": "1 Burger gà quay +  1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DB-ROASTED-FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20701",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Gà Yo",
          "description": "1 Burger gà yo + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20691",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 3 Tụ Tập",
          "description": "5 Miếng gà + 1 Gà viên (Vừa) + 3 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 239000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-5-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20702",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Burger Gà Yo & Gà Rán",
          "description": "1 Burger gà yo + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (vừa)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo-COB_.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20703",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 2 Vui Vẻ",
          "description": "3 Miếng gà rán + 1 Mì ý gà viên + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 159000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-3-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20704",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Hai Mình Chill",
          "description": "2 Mì ý xúc xích + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 146000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-2-Pasta-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20705",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà Chill 199k",
          "description": "3 Miếng gà rán + 2 Mì ý xúc xích + 1 Khoai tây chiên (vừa) + 3 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 199000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-3COB-199K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        }
      ],
      "total": 21,
      "returned": 21,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"full\",\"queries\":[],\"category\":\"combo\",\"maxpricevnd\":300000,\"partysize\":4,\"modifierqueries\":[]}"
      }
    },
    "message": "verified_menu_collection",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ],
    "verifiedCollection": {
      "key": "filtered:%7B%22mode%22%3A%22full%22%2C%22queries%22%3A%5B%5D%2C%22category%22%3A%22combo%22%2C%22maxpricevnd%22%3A300000%2C%22partysize%22%3A4%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "e9590475b2b4d0326c232659dac5466fa04c4f533e5c817a6c7bb912a673ec2e",
      "providerRevision": "menu-result:62289aa92f92bdfecf7d19201c3a5ee53c6e38e878ad2f59f071f86ab1d5ab5e",
      "result": {
        "items": [
          {
            "code": "20690",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Nhóm 2 No Nê",
            "description": "4 Miếng gà + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 169000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D.BUCKET4_FF.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20706",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Gà No 279k",
            "description": "4 Miếng gà rán + 2 Burger zinger + 1 Khoai tây chiên (vừa) + 4 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 279000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-4COB-279K.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "10515",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo 139K",
            "description": "3 Miếng Gà + 5 Nuggets + 3 Tenders",
            "priceVnd": 139000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CBO-139.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20687",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo 1 Miếng Gà",
            "description": "1 Miếng gà + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 59000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-1.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20688",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Một Mình Chill",
            "description": "1 Miếng gà + 1 Mì ý xúc xích + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 91000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1COB-Pasta.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20689",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo 2 Miếng Gà",
            "description": "2 Miếng gà + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 91000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-2.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20692",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Mỳ Ý Solo",
            "description": "1 Mì ý gà rán + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 71000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1-Pasta-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20693",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Mì Ý & Gà Tenders",
            "description": "1 Mì ý xúc xích + 3 Tender + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 79000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Pasta-Tender.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20694",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Cơm Gà Rán Solo",
            "description": "1 Cơm Gà rán + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 56000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20695",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Cơm Gà Rán & Súp",
            "description": "1 Cơm Gà rán + 1 Súp rong biển + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 69000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Rice-Soup.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20696",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Cơm Gà Quay Solo",
            "description": "1 Cơm Gà quay + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 59000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-FLAVA.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20697",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Cơm Gà Nanban Solo",
            "description": "1 Cơm Gà nanban + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 46000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-NANBAN.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20698",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Burger Zinger",
            "description": "1 Burger zinger + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 79000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-B.ZINGER-FF.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20700",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Burger Tôm",
            "description": "1 Burger tôm + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 69000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.Shrimp.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20699",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Burger Gà Quay",
            "description": "1 Burger gà quay +  1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 79000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DB-ROASTED-FF.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20701",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Burger Gà Yo",
            "description": "1 Burger gà yo + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 56000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20691",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Nhóm 3 Tụ Tập",
            "description": "5 Miếng gà + 1 Gà viên (Vừa) + 3 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 239000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-5-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20702",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Burger Gà Yo & Gà Rán",
            "description": "1 Burger gà yo + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (vừa)",
            "priceVnd": 129000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo-COB_.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20703",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Nhóm 2 Vui Vẻ",
            "description": "3 Miếng gà rán + 1 Mì ý gà viên + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 159000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-3-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20704",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Hai Mình Chill",
            "description": "2 Mì ý xúc xích + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 146000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-2-Pasta-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20705",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Gà Chill 199k",
            "description": "3 Miếng gà rán + 2 Mì ý xúc xích + 1 Khoai tây chiên (vừa) + 3 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 199000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-3COB-199K.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          }
        ],
        "total": 21,
        "returned": 21,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"full\",\"queries\":[],\"category\":\"combo\",\"maxpricevnd\":300000,\"partysize\":4,\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T07:48:07.504Z",
  "completedAt": "2026-07-24T07:48:07.540Z",
  "executionDurationMs": 36
}
```

### Tool result: searchPromotions

```json
{
  "callId": "call_01_Htlc5UHY5txb1Sae04eM6020",
  "arguments": {},
  "rawResult": {
    "toolName": "searchPromotions",
    "ok": true,
    "value": [
      {
        "offerId": "lunch-2026-combo-42k",
        "imageUrl": "https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg",
        "campaign": "🍴 TRƯA NAY KHỎI NGHĨ NHIỀU – ĐÃ CÓ KFC LO!",
        "campaignType": "lunch_combo",
        "offerType": "fixed_price_combo",
        "offerName": "Bữa trưa 42K",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": 42000,
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "",
        "appliesTo": "Cơm Gà Viên Nanban + Pepsi hoặc Mì Ý Migaxuxi Gà Viên + Pepsi",
        "channel": "Giao hàng tận nơi / website / app / Zalo / TikTok Shop",
        "startDate": "2026-01-02",
        "endDate": "2026-12-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Cơm Gà Viên Nanban + Pepsi (Tiêu chuẩn) – 42K; Mì Ý Migaxuxi Gà Viên + Pepsi (Tiêu chuẩn) – 42K.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/trua-nay-an-gi",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-trua-nay-an-gi.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "lunch-2026-combo-44k",
        "imageUrl": "https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg",
        "campaign": "🍴 TRƯA NAY KHỎI NGHĨ NHIỀU – ĐÃ CÓ KFC LO!",
        "campaignType": "lunch_combo",
        "offerType": "fixed_price_combo",
        "offerName": "Bữa trưa 44K",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": 44000,
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "",
        "appliesTo": "Cơm Phi-lê Gà Quay + Pepsi hoặc Burger Tôm + Pepsi",
        "channel": "Giao hàng tận nơi / website / app / Zalo / TikTok Shop",
        "startDate": "2026-01-02",
        "endDate": "2026-12-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Cơm Phi-lê Gà Quay + Pepsi (Tiêu chuẩn) – 44K; Burger Tôm + Pepsi (Tiêu chuẩn) – 44K.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/trua-nay-an-gi",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-trua-nay-an-gi.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "lunch-2026-combo-49k",
        "imageUrl": "https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg",
        "campaign": "🍴 TRƯA NAY KHỎI NGHĨ NHIỀU – ĐÃ CÓ KFC LO!",
        "campaignType": "lunch_combo",
        "offerType": "fixed_price_combo",
        "offerName": "Bữa trưa 49K",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": 49000,
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "",
        "appliesTo": "Cơm Gà Sốt Mắm Tỏi + Pepsi",
        "channel": "Giao hàng tận nơi / website / app / Zalo / TikTok Shop",
        "startDate": "2026-01-02",
        "endDate": "2026-12-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Cơm Gà Sốt Mắm Tỏi + Pepsi (Tiêu chuẩn) – 49K.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/trua-nay-an-gi",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-trua-nay-an-gi.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-2026-july-tier-1m",
        "imageUrl": "https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T7.jpg",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "gift_bundle",
        "offerName": "Big order tier từ 1 triệu đến dưới 2,5 triệu",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": 1000000,
        "maximumDiscountVnd": "",
        "giftQuantity": "06 Pepsi + 02 VietGoal + 02 GreenSM + 02 Shopee VIP + 01 Động Lực Sport",
        "partnerBrand": "VietGoal | GreenSM | Shopee VIP | Động Lực Sport",
        "appliesTo": "Đơn hàng lớn sau chiết khấu",
        "channel": "Big order / tổng đài / website",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Từ 1 triệu đến dưới 2,5 triệu đồng: 06 lon Pepsi, 02 Voucher VietGoal, 02 Voucher GreenSM, 02 Voucher Shopee VIP, 01 Voucher Động Lực Sport.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-2026-july-tier-2p5m",
        "imageUrl": "https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T7.jpg",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "gift_bundle",
        "offerName": "Big order tier từ 2,5 triệu đến dưới 5 triệu",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": 2500000,
        "maximumDiscountVnd": "",
        "giftQuantity": "12 Pepsi + 05 VietGoal + 05 GreenSM + 05 Shopee VIP + 01 Động Lực Sport",
        "partnerBrand": "VietGoal | GreenSM | Shopee VIP | Động Lực Sport",
        "appliesTo": "Đơn hàng lớn sau chiết khấu",
        "channel": "Big order / tổng đài / website",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Từ 2,5 triệu đến dưới 5 triệu đồng: 12 lon Pepsi, 05 Voucher VietGoal, 05 Voucher GreenSM, 05 Voucher Shopee VIP, 01 Voucher Động Lực Sport.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-2026-july-tier-5m",
        "imageUrl": "https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T7.jpg",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "gift_bundle",
        "offerName": "Big order tier từ 5 triệu trở lên",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": 5000000,
        "maximumDiscountVnd": "",
        "giftQuantity": "24 Pepsi + 10 VietGoal + 10 GreenSM + 10 Shopee VIP + 01 Động Lực Sport",
        "partnerBrand": "VietGoal | GreenSM | Shopee VIP | Động Lực Sport",
        "appliesTo": "Đơn hàng lớn sau chiết khấu",
        "channel": "Big order / tổng đài / website",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Từ 5 triệu đồng trở lên: 24 lon Pepsi, 10 Voucher VietGoal, 10 Voucher GreenSM, 10 Voucher Shopee VIP, 01 Voucher Động Lực Sport.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-vietgoal-free-session",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher VietGoal miễn phí 1 buổi học bóng đá",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "VietGoal",
        "appliesTo": "Hệ thống sân tập VietGoal toàn quốc",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher VietGoal miễn phí 1 buổi học bóng đá trị giá 150.000đ/buổi.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-greensm-20pct-max-50k",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher GreenSM giảm 20%",
        "discountPercent": 20,
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": "",
        "maximumDiscountVnd": 50000,
        "giftQuantity": "",
        "partnerBrand": "GreenSM",
        "appliesTo": "Dịch vụ đặt xe GreenSM",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher GreenSM giảm 20% tối đa 50.000đ cho dịch vụ đặt xe GreenSM.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-shopee-vip-3-months",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher miễn phí 03 tháng Shopee VIP",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "Shopee VIP",
        "appliesTo": "Gói Shopee VIP",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher miễn phí 03 tháng sử dụng gói Shopee Vip.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-dong-luc-300k-min-1m",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher Động Lực Sport giảm 300.000đ",
        "discountPercent": "",
        "discountAmountVnd": 300000,
        "priceVnd": "",
        "minimumOrderVnd": 1000000,
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "Động Lực Sport",
        "appliesTo": "Jogarbola.com.vn / Donglucsport.vn / hệ thống cửa hàng trừ AEON Mall",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher Động Lực Sport giảm 300.000đ cho đơn từ 1.000.000đ khi mua hàng tại website Jogarbola.com.vn/ Donglucsport.vn hoặc trực tiếp tại hệ thống cửa hàng (trừ AEON Mall).",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "offer_kfc50_hidden",
        "campaign": "Giảm giá đơn hàng",
        "campaignType": "voucher",
        "offerType": "amount_off",
        "offerName": "Giảm 50K cho đơn đủ điều kiện",
        "discountPercent": "",
        "discountAmountVnd": 50000,
        "priceVnd": "",
        "minimumOrderVnd": 195000,
        "maximumDiscountVnd": 50000,
        "giftQuantity": "",
        "partnerBrand": "KFC",
        "appliesTo": "Đơn giao hàng",
        "channel": "web",
        "startDate": "2026-01-01",
        "endDate": "2026-12-31",
        "actualCodeExposed": true,
        "publicCode": "KFC50",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "public_site",
        "evidenceText": "Demo stable voucher KFC50 applies 50K off for scenario fixture orders from 195.000đ.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/khuyen-mai",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-promotion-vouchers.json",
        "notes": "Demo-stable fixture entry for Messenger scenario 01."
      }
    ],
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "modelFacingResult": {
    "toolName": "searchPromotions",
    "ok": true,
    "value": [
      {
        "offerId": "lunch-2026-combo-42k",
        "imageUrl": "https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg",
        "campaign": "🍴 TRƯA NAY KHỎI NGHĨ NHIỀU – ĐÃ CÓ KFC LO!",
        "campaignType": "lunch_combo",
        "offerType": "fixed_price_combo",
        "offerName": "Bữa trưa 42K",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": 42000,
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "",
        "appliesTo": "Cơm Gà Viên Nanban + Pepsi hoặc Mì Ý Migaxuxi Gà Viên + Pepsi",
        "channel": "Giao hàng tận nơi / website / app / Zalo / TikTok Shop",
        "startDate": "2026-01-02",
        "endDate": "2026-12-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Cơm Gà Viên Nanban + Pepsi (Tiêu chuẩn) – 42K; Mì Ý Migaxuxi Gà Viên + Pepsi (Tiêu chuẩn) – 42K.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/trua-nay-an-gi",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-trua-nay-an-gi.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "lunch-2026-combo-44k",
        "imageUrl": "https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg",
        "campaign": "🍴 TRƯA NAY KHỎI NGHĨ NHIỀU – ĐÃ CÓ KFC LO!",
        "campaignType": "lunch_combo",
        "offerType": "fixed_price_combo",
        "offerName": "Bữa trưa 44K",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": 44000,
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "",
        "appliesTo": "Cơm Phi-lê Gà Quay + Pepsi hoặc Burger Tôm + Pepsi",
        "channel": "Giao hàng tận nơi / website / app / Zalo / TikTok Shop",
        "startDate": "2026-01-02",
        "endDate": "2026-12-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Cơm Phi-lê Gà Quay + Pepsi (Tiêu chuẩn) – 44K; Burger Tôm + Pepsi (Tiêu chuẩn) – 44K.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/trua-nay-an-gi",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-trua-nay-an-gi.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "lunch-2026-combo-49k",
        "imageUrl": "https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg",
        "campaign": "🍴 TRƯA NAY KHỎI NGHĨ NHIỀU – ĐÃ CÓ KFC LO!",
        "campaignType": "lunch_combo",
        "offerType": "fixed_price_combo",
        "offerName": "Bữa trưa 49K",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": 49000,
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "",
        "appliesTo": "Cơm Gà Sốt Mắm Tỏi + Pepsi",
        "channel": "Giao hàng tận nơi / website / app / Zalo / TikTok Shop",
        "startDate": "2026-01-02",
        "endDate": "2026-12-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Cơm Gà Sốt Mắm Tỏi + Pepsi (Tiêu chuẩn) – 49K.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/trua-nay-an-gi",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-trua-nay-an-gi.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-2026-july-tier-1m",
        "imageUrl": "https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T7.jpg",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "gift_bundle",
        "offerName": "Big order tier từ 1 triệu đến dưới 2,5 triệu",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": 1000000,
        "maximumDiscountVnd": "",
        "giftQuantity": "06 Pepsi + 02 VietGoal + 02 GreenSM + 02 Shopee VIP + 01 Động Lực Sport",
        "partnerBrand": "VietGoal | GreenSM | Shopee VIP | Động Lực Sport",
        "appliesTo": "Đơn hàng lớn sau chiết khấu",
        "channel": "Big order / tổng đài / website",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Từ 1 triệu đến dưới 2,5 triệu đồng: 06 lon Pepsi, 02 Voucher VietGoal, 02 Voucher GreenSM, 02 Voucher Shopee VIP, 01 Voucher Động Lực Sport.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-2026-july-tier-2p5m",
        "imageUrl": "https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T7.jpg",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "gift_bundle",
        "offerName": "Big order tier từ 2,5 triệu đến dưới 5 triệu",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": 2500000,
        "maximumDiscountVnd": "",
        "giftQuantity": "12 Pepsi + 05 VietGoal + 05 GreenSM + 05 Shopee VIP + 01 Động Lực Sport",
        "partnerBrand": "VietGoal | GreenSM | Shopee VIP | Động Lực Sport",
        "appliesTo": "Đơn hàng lớn sau chiết khấu",
        "channel": "Big order / tổng đài / website",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Từ 2,5 triệu đến dưới 5 triệu đồng: 12 lon Pepsi, 05 Voucher VietGoal, 05 Voucher GreenSM, 05 Voucher Shopee VIP, 01 Voucher Động Lực Sport.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-2026-july-tier-5m",
        "imageUrl": "https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T7.jpg",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "gift_bundle",
        "offerName": "Big order tier từ 5 triệu trở lên",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": 5000000,
        "maximumDiscountVnd": "",
        "giftQuantity": "24 Pepsi + 10 VietGoal + 10 GreenSM + 10 Shopee VIP + 01 Động Lực Sport",
        "partnerBrand": "VietGoal | GreenSM | Shopee VIP | Động Lực Sport",
        "appliesTo": "Đơn hàng lớn sau chiết khấu",
        "channel": "Big order / tổng đài / website",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Từ 5 triệu đồng trở lên: 24 lon Pepsi, 10 Voucher VietGoal, 10 Voucher GreenSM, 10 Voucher Shopee VIP, 01 Voucher Động Lực Sport.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-vietgoal-free-session",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher VietGoal miễn phí 1 buổi học bóng đá",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "VietGoal",
        "appliesTo": "Hệ thống sân tập VietGoal toàn quốc",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher VietGoal miễn phí 1 buổi học bóng đá trị giá 150.000đ/buổi.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-greensm-20pct-max-50k",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher GreenSM giảm 20%",
        "discountPercent": 20,
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": "",
        "maximumDiscountVnd": 50000,
        "giftQuantity": "",
        "partnerBrand": "GreenSM",
        "appliesTo": "Dịch vụ đặt xe GreenSM",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher GreenSM giảm 20% tối đa 50.000đ cho dịch vụ đặt xe GreenSM.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-shopee-vip-3-months",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher miễn phí 03 tháng Shopee VIP",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "Shopee VIP",
        "appliesTo": "Gói Shopee VIP",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher miễn phí 03 tháng sử dụng gói Shopee Vip.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-dong-luc-300k-min-1m",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher Động Lực Sport giảm 300.000đ",
        "discountPercent": "",
        "discountAmountVnd": 300000,
        "priceVnd": "",
        "minimumOrderVnd": 1000000,
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "Động Lực Sport",
        "appliesTo": "Jogarbola.com.vn / Donglucsport.vn / hệ thống cửa hàng trừ AEON Mall",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher Động Lực Sport giảm 300.000đ cho đơn từ 1.000.000đ khi mua hàng tại website Jogarbola.com.vn/ Donglucsport.vn hoặc trực tiếp tại hệ thống cửa hàng (trừ AEON Mall).",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "offer_kfc50_hidden",
        "campaign": "Giảm giá đơn hàng",
        "campaignType": "voucher",
        "offerType": "amount_off",
        "offerName": "Giảm 50K cho đơn đủ điều kiện",
        "discountPercent": "",
        "discountAmountVnd": 50000,
        "priceVnd": "",
        "minimumOrderVnd": 195000,
        "maximumDiscountVnd": 50000,
        "giftQuantity": "",
        "partnerBrand": "KFC",
        "appliesTo": "Đơn giao hàng",
        "channel": "web",
        "startDate": "2026-01-01",
        "endDate": "2026-12-31",
        "actualCodeExposed": true,
        "publicCode": "KFC50",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "public_site",
        "evidenceText": "Demo stable voucher KFC50 applies 50K off for scenario fixture orders from 195.000đ.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/khuyen-mai",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-promotion-vouchers.json",
        "notes": "Demo-stable fixture entry for Messenger scenario 01."
      }
    ],
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "executionStartedAt": "2026-07-24T07:48:07.550Z",
  "completedAt": "2026-07-24T07:48:07.559Z",
  "executionDurationMs": 9
}
```

## Assistant

Tuyệt vời! Tôi đã xem menu và các ưu đãi. Với 4 người ~300k, tôi thấy có **một combo nhóm siêu hợp lý**:

---

### 🎯 Gợi ý số 1 (ưu tiên nhất): **Combo Gà No 279K**
- **Giá:** **279.000₫** (còn dư ~21k)
- **Gồm:** 4 Miếng gà rán + 2 Burger Zinger + 1 Khoai tây chiên (vừa) + 4 Ly Pepsi
- **Đủ cho 4 người** – mỗi người có gà + burger hoặc gà + khoai, đủ nước uống
- Còn dư 21k có thể thêm 1 **Combo Cơm Gà Nanban Solo 46K** nếu muốn thêm (tổng 325k hơi quá) hoặc để dành

---

### 🥈 Gợi ý số 2: **Combo Nhóm 3 Tụ Tập (239K) + Combo 1 Miếng Gà (59K) = 298K**
- Combo Nhóm 3 Tụ Tập: 5 Miếng gà + 1 Gà viên (vừa) + 3 Ly Pepsi
- Thêm Combo 1 Miếng Gà: 1 Miếng gà + 1 Khoai tây chiên + 1 Pepsi
- **Tổng: 298.000₫** – nhiều gà hơn, nhưng không có burger

---

### 💡 Voucher có thể áp dụng
Có mã **KFC50** – giảm 50K cho đơn từ 195K (giao hàng). Nếu bạn đặt giao hàng, combo 279K sau giảm còn **229K** — siêu tiết kiệm!

---

Bạn thấy phương án nào ổn hơn? Nếu muốn, tôi có thể giúp chọn **Combo Gà No 279K** và thêm vào giỏ hàng cho bạn luôn nhé! 🍗

## User

Mình lại muốn cân nhắc gọi lẻ 10 miếng gà rán với 4 Pepsi tiêu chuẩn. Bạn so sánh đúng giá với phương án combo tương đương, xem lựa chọn nào tiết kiệm hơn; chưa đổi giỏ hay thêm món cho tới khi mình đồng ý.

### Tool call: searchMenu

```json
{
  "callId": "call_00_blj5HhzuuU1ZyAcKhHhn8873",
  "arguments": {
    "mode": "search",
    "queries": [
      "10 miếng gà rán",
      "gà rán",
      "Pepsi tiêu chuẩn",
      "Pepsi"
    ],
    "category": null,
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T07:49:00.636Z"
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_01_ogf0uAUAMvveVkBJp7N67425",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Gà No",
      "combo nhóm"
    ],
    "category": null,
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T07:49:00.639Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_blj5HhzuuU1ZyAcKhHhn8873",
  "arguments": {
    "mode": "search",
    "queries": [
      "10 miếng gà rán",
      "gà rán",
      "Pepsi tiêu chuẩn",
      "Pepsi"
    ],
    "modifierQueries": []
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "10 miếng gà rán",
        "gà rán",
        "Pepsi tiêu chuẩn",
        "Pepsi"
      ],
      "total": 65,
      "returned": 65,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"10 miếng gà rán\",\"gà rán\",\"Pepsi tiêu chuẩn\",\"Pepsi\"],\"modifierQueries\":[]}"
      },
      "items": [
        {
          "code": "41075",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi (Vừa)",
          "description": "1 Ly Pepsi (Vừa)",
          "priceVnd": 17000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-M.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41076",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi (Đại)",
          "description": "1 Ly Pepsi (Lớn)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-J.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41035",
          "category": "Gà Rán - Gà Quay",
          "categoryId": "20003",
          "name": "1 Miếng Gà Rán",
          "description": "1 Miếng Gà Rán + 1 Gói tương (cà/ ớt)",
          "priceVnd": 37000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/1-Fried-Chicken.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41074",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi (Tiêu Chuẩn)",
          "description": "1 Ly Pepsi (Tiêu Chuẩn)",
          "priceVnd": 13000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-STD.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "20702",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Burger Gà Yo & Gà Rán",
          "description": "1 Burger gà yo + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (vừa)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo-COB_.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20694",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Rán Solo",
          "description": "1 Cơm Gà rán + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20695",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Rán & Súp",
          "description": "1 Cơm Gà rán + 1 Súp rong biển + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 69000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Rice-Soup.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41036",
          "category": "Gà Rán - Gà Quay",
          "categoryId": "20003",
          "name": "2 Miếng Gà Rán",
          "description": "2 Miếng Gà Rán + 2 Gói tương (cà/ ớt)",
          "priceVnd": 74000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/2-Fried-Chicken.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41037",
          "category": "Gà Rán - Gà Quay",
          "categoryId": "20003",
          "name": "3 Miếng Gà Rán",
          "description": "3 Miếng Gà Rán + 3 Gói tương (cà/ ớt)",
          "priceVnd": 105000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/3-Fried-Chicken.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41038",
          "category": "Gà Rán - Gà Quay",
          "categoryId": "20003",
          "name": "6 Miếng Gà Rán",
          "description": "6 Miếng Gà Rán + 6 Gói tương (cà/ ớt)",
          "priceVnd": 210000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/6-Fried-Chicken-new.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41040",
          "category": "Gà Rán - Gà Quay",
          "categoryId": "20003",
          "name": "3 Miếng Gà Rán Tender",
          "description": "3 Miếng Gà Rán Tender + 1 Gói tương (cà/ ớt)",
          "priceVnd": 42000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TENDERS-3.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41041",
          "category": "Gà Rán - Gà Quay",
          "categoryId": "20003",
          "name": "5 Miếng Gà Rán Tender",
          "description": "5 Miếng Gà Rán Tender + 2 Gói tương (cà/ ớt)",
          "priceVnd": 68000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TENDERS-5.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41083",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi Không Đường (Tiêu Chuẩn)",
          "description": "1 Ly Pepsi Không Đường (Tiêu Chuẩn)",
          "priceVnd": 13000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-ZERO-STD.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41084",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi Không Đường (Vừa)",
          "description": "1 Ly Pepsi Không Đường (Vừa)",
          "priceVnd": 17000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-ZERO-M.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41085",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi Không Đường (Đại)",
          "description": "1 Ly Pepsi Không Đường (Lớn)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-ZERO-J.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41086",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi (Lon)",
          "description": "1 Pepsi (Lon)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI_CAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41088",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi Không Đường (Lon)",
          "description": "1 Pepsi Không Đường (Lon)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Pepsi-Zero-Can-ALC.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41048",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Mì Ý Gà Rán",
          "description": "1 Mì Ý Gà Rán + 1 Gói tương (cà/ ớt)",
          "priceVnd": 68000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41049",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "1 Cơm Gà Rán",
          "description": "1 Cơm Gà Rán + 1 Gói tương (cà/ ớt)",
          "priceVnd": 49000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Rice-OR.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40775",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Tặng 1 lon Pepsi",
          "description": "Tặng 1 lon Pepsi",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI_CAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "20752",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Đẫy Đà 129K",
          "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20687",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 1 Miếng Gà",
          "description": "1 Miếng gà + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 59000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-1.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20688",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Một Mình Chill",
          "description": "1 Miếng gà + 1 Mì ý xúc xích + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 91000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1COB-Pasta.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20689",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 2 Miếng Gà",
          "description": "2 Miếng gà + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 91000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-2.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20692",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Mỳ Ý Solo",
          "description": "1 Mì ý gà rán + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 71000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1-Pasta-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20693",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Mì Ý & Gà Tenders",
          "description": "1 Mì ý xúc xích + 3 Tender + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Pasta-Tender.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20696",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Quay Solo",
          "description": "1 Cơm Gà quay + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 59000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-FLAVA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20697",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Nanban Solo",
          "description": "1 Cơm Gà nanban + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 46000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-NANBAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20698",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Zinger",
          "description": "1 Burger zinger + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-B.ZINGER-FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20700",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Tôm",
          "description": "1 Burger tôm + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 69000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.Shrimp.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20699",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Gà Quay",
          "description": "1 Burger gà quay +  1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DB-ROASTED-FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20701",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Gà Yo",
          "description": "1 Burger gà yo + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20690",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 2 No Nê",
          "description": "4 Miếng gà + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 169000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D.BUCKET4_FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20691",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 3 Tụ Tập",
          "description": "5 Miếng gà + 1 Gà viên (Vừa) + 3 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 239000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-5-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20703",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 2 Vui Vẻ",
          "description": "3 Miếng gà rán + 1 Mì ý gà viên + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 159000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-3-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20704",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Hai Mình Chill",
          "description": "2 Mì ý xúc xích + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 146000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-2-Pasta-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20705",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà Chill 199k",
          "description": "3 Miếng gà rán + 2 Mì ý xúc xích + 1 Khoai tây chiên (vừa) + 3 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 199000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-3COB-199K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20706",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà No 279k",
          "description": "4 Miếng gà rán + 2 Burger zinger + 1 Khoai tây chiên (vừa) + 4 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 279000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-4COB-279K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20708",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà Xịn 389k",
          "description": "5 Miếng gà rán + 4 Mì ý xúc xích + 3 Khoai tây chiên (vừa) + 5 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 389000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-5COB-389K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20712",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20711",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa) + Tặng 1 Vé KFC Zestival (Khu Khuấy Đảo)_SỐ LƯỢNG CÓ HẠN",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO-2.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20751",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Hợp Gu 99K",
          "description": "3 Miếng Gà Rán + 1 Burger Tôm",
          "priceVnd": 99000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20709",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Tiêu Tung Chill 85k",
          "description": "1 Miếng Gà Rán + 1 Miếng Gà Lắc Tiêu Chanh + 1 ly Pepsi Không Đường (Đại)",
          "priceVnd": 85000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TIEUTUNGCHILL.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20710",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Chanh Sang Chảnh 140k",
          "description": "2 Miếng Gà Lắc Tiêu Chanh + 1 Miếng Gà Rán + 1 Khoai Tây Chiên (Vừa) + 2 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 140000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CHANHSANGCHANH.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20742",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng Vui",
          "description": "Combo 6 Miếng Gà Rán. Tặng kèm 3 lon Pepsi",
          "priceVnd": 199000,
          "originalPriceVnd": 210000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGVUI-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20743",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng \"Dzô\"",
          "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
          "priceVnd": 369000,
          "originalPriceVnd": 444000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20732",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Xô Hợp Cạ 189k",
          "description": "Xô 5 Miếng Gà + 1 Khoai Tây Chiên (Vừa) + 2 ly Pepsi (Vừa)",
          "priceVnd": 189000,
          "originalPriceVnd": 239000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BUCKET-CBO-189K_HDE.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20748",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Xô Cùng Tiệc 269k",
          "description": "Xô 9 Miếng Gà + 3 ly Pepsi (Vừa)",
          "priceVnd": 269000,
          "originalPriceVnd": 404000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BUCKET-CBO-269K_HDE.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20707",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà To 339k",
          "description": "8 Miếng gà rán + 4 Khoai tây chiên (vừa) + 4 Ly Pepsi (đại)",
          "priceVnd": 339000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-8COB-339K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "10515",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 139K",
          "description": "3 Miếng Gà + 5 Nuggets + 3 Tenders",
          "priceVnd": 139000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CBO-139.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41039",
          "category": "Gà Rán - Gà Quay",
          "categoryId": "20003",
          "name": "1 Miếng Phi-lê Gà Quay",
          "description": "1 Miếng Phi-lê Gà Quay",
          "priceVnd": 43000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/MOD-PHI-LE-GA-QUAY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40905",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "1 Miếng Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/1GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40906",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "2 Miếng Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/2GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40907",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "3 Miếng Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
          "priceVnd": 116000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/3GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40924",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "1 Phần Cơm Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt ăn kèm cơm nóng dẻo.",
          "priceVnd": 52000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/COM-GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40968",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Miễn phí 1 miếng gà cho DH 120K",
          "description": "1 Miếng Gà",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PNS-1COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41072",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "1 Bánh Trứng",
          "description": "1 Bánh Trứng",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EGGTART-1.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41073",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "4 Bánh Trứng",
          "description": "4 Bánh Trứng",
          "priceVnd": 72000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EGGTART-4.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41077",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "7Up (Tiêu Chuẩn)",
          "description": "1 Ly 7Up (Vừa)/ (Tiêu Chuẩn)",
          "priceVnd": 13000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/7UP-STD.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41078",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "7Up (Vừa)",
          "description": "1 Ly 7Up (Vừa)",
          "priceVnd": 17000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/7UP-R.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41079",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "7Up (Đại)",
          "description": "1 Ly 7Up (Lớn)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/7UP-L.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41080",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Lipton (Tiêu Chuẩn)",
          "description": "1 Ly Lipton (Tiêu Chuẩn)",
          "priceVnd": 13000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/LIPTON-STD.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41081",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Lipton (Vừa)",
          "description": "1 Ly Lipton (Vừa)",
          "priceVnd": 17000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/LIPTON-M.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41082",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Lipton (Đại)",
          "description": "1 Ly Lipton (Lớn)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/LIPTON-J.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41087",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "7Up (Lon)",
          "description": "1 7Up (Lon)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/7UP_CAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        }
      ]
    },
    "message": "verified_menu_collection",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "modelFacingResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "items": [
        {
          "code": "41075",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi (Vừa)",
          "description": "1 Ly Pepsi (Vừa)",
          "priceVnd": 17000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-M.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41076",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi (Đại)",
          "description": "1 Ly Pepsi (Lớn)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-J.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41035",
          "category": "Gà Rán - Gà Quay",
          "categoryId": "20003",
          "name": "1 Miếng Gà Rán",
          "description": "1 Miếng Gà Rán + 1 Gói tương (cà/ ớt)",
          "priceVnd": 37000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/1-Fried-Chicken.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41074",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi (Tiêu Chuẩn)",
          "description": "1 Ly Pepsi (Tiêu Chuẩn)",
          "priceVnd": 13000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-STD.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "20702",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Burger Gà Yo & Gà Rán",
          "description": "1 Burger gà yo + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (vừa)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo-COB_.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20694",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Rán Solo",
          "description": "1 Cơm Gà rán + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20695",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Rán & Súp",
          "description": "1 Cơm Gà rán + 1 Súp rong biển + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 69000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Rice-Soup.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41036",
          "category": "Gà Rán - Gà Quay",
          "categoryId": "20003",
          "name": "2 Miếng Gà Rán",
          "description": "2 Miếng Gà Rán + 2 Gói tương (cà/ ớt)",
          "priceVnd": 74000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/2-Fried-Chicken.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41037",
          "category": "Gà Rán - Gà Quay",
          "categoryId": "20003",
          "name": "3 Miếng Gà Rán",
          "description": "3 Miếng Gà Rán + 3 Gói tương (cà/ ớt)",
          "priceVnd": 105000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/3-Fried-Chicken.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41038",
          "category": "Gà Rán - Gà Quay",
          "categoryId": "20003",
          "name": "6 Miếng Gà Rán",
          "description": "6 Miếng Gà Rán + 6 Gói tương (cà/ ớt)",
          "priceVnd": 210000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/6-Fried-Chicken-new.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41040",
          "category": "Gà Rán - Gà Quay",
          "categoryId": "20003",
          "name": "3 Miếng Gà Rán Tender",
          "description": "3 Miếng Gà Rán Tender + 1 Gói tương (cà/ ớt)",
          "priceVnd": 42000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TENDERS-3.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41041",
          "category": "Gà Rán - Gà Quay",
          "categoryId": "20003",
          "name": "5 Miếng Gà Rán Tender",
          "description": "5 Miếng Gà Rán Tender + 2 Gói tương (cà/ ớt)",
          "priceVnd": 68000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TENDERS-5.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41083",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi Không Đường (Tiêu Chuẩn)",
          "description": "1 Ly Pepsi Không Đường (Tiêu Chuẩn)",
          "priceVnd": 13000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-ZERO-STD.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41084",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi Không Đường (Vừa)",
          "description": "1 Ly Pepsi Không Đường (Vừa)",
          "priceVnd": 17000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-ZERO-M.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41085",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi Không Đường (Đại)",
          "description": "1 Ly Pepsi Không Đường (Lớn)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-ZERO-J.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41086",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi (Lon)",
          "description": "1 Pepsi (Lon)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI_CAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41088",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Pepsi Không Đường (Lon)",
          "description": "1 Pepsi Không Đường (Lon)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Pepsi-Zero-Can-ALC.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41048",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Mì Ý Gà Rán",
          "description": "1 Mì Ý Gà Rán + 1 Gói tương (cà/ ớt)",
          "priceVnd": 68000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41049",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "1 Cơm Gà Rán",
          "description": "1 Cơm Gà Rán + 1 Gói tương (cà/ ớt)",
          "priceVnd": 49000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Rice-OR.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40775",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Tặng 1 lon Pepsi",
          "description": "Tặng 1 lon Pepsi",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI_CAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "20752",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Đẫy Đà 129K",
          "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20687",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 1 Miếng Gà",
          "description": "1 Miếng gà + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 59000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-1.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20688",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Một Mình Chill",
          "description": "1 Miếng gà + 1 Mì ý xúc xích + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 91000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1COB-Pasta.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20689",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 2 Miếng Gà",
          "description": "2 Miếng gà + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 91000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-2.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20692",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Mỳ Ý Solo",
          "description": "1 Mì ý gà rán + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 71000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1-Pasta-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20693",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Mì Ý & Gà Tenders",
          "description": "1 Mì ý xúc xích + 3 Tender + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Pasta-Tender.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20696",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Quay Solo",
          "description": "1 Cơm Gà quay + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 59000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-FLAVA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20697",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Nanban Solo",
          "description": "1 Cơm Gà nanban + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 46000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-NANBAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20698",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Zinger",
          "description": "1 Burger zinger + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-B.ZINGER-FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20700",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Tôm",
          "description": "1 Burger tôm + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 69000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.Shrimp.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20699",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Gà Quay",
          "description": "1 Burger gà quay +  1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DB-ROASTED-FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20701",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Gà Yo",
          "description": "1 Burger gà yo + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20690",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 2 No Nê",
          "description": "4 Miếng gà + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 169000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D.BUCKET4_FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20691",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 3 Tụ Tập",
          "description": "5 Miếng gà + 1 Gà viên (Vừa) + 3 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 239000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-5-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20703",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 2 Vui Vẻ",
          "description": "3 Miếng gà rán + 1 Mì ý gà viên + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 159000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-3-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20704",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Hai Mình Chill",
          "description": "2 Mì ý xúc xích + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 146000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-2-Pasta-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20705",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà Chill 199k",
          "description": "3 Miếng gà rán + 2 Mì ý xúc xích + 1 Khoai tây chiên (vừa) + 3 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 199000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-3COB-199K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20706",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà No 279k",
          "description": "4 Miếng gà rán + 2 Burger zinger + 1 Khoai tây chiên (vừa) + 4 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 279000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-4COB-279K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20708",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà Xịn 389k",
          "description": "5 Miếng gà rán + 4 Mì ý xúc xích + 3 Khoai tây chiên (vừa) + 5 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 389000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-5COB-389K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20712",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20711",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa) + Tặng 1 Vé KFC Zestival (Khu Khuấy Đảo)_SỐ LƯỢNG CÓ HẠN",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO-2.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20751",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Hợp Gu 99K",
          "description": "3 Miếng Gà Rán + 1 Burger Tôm",
          "priceVnd": 99000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20709",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Tiêu Tung Chill 85k",
          "description": "1 Miếng Gà Rán + 1 Miếng Gà Lắc Tiêu Chanh + 1 ly Pepsi Không Đường (Đại)",
          "priceVnd": 85000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TIEUTUNGCHILL.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20710",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Chanh Sang Chảnh 140k",
          "description": "2 Miếng Gà Lắc Tiêu Chanh + 1 Miếng Gà Rán + 1 Khoai Tây Chiên (Vừa) + 2 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 140000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CHANHSANGCHANH.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20742",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng Vui",
          "description": "Combo 6 Miếng Gà Rán. Tặng kèm 3 lon Pepsi",
          "priceVnd": 199000,
          "originalPriceVnd": 210000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGVUI-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20743",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng \"Dzô\"",
          "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
          "priceVnd": 369000,
          "originalPriceVnd": 444000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20732",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Xô Hợp Cạ 189k",
          "description": "Xô 5 Miếng Gà + 1 Khoai Tây Chiên (Vừa) + 2 ly Pepsi (Vừa)",
          "priceVnd": 189000,
          "originalPriceVnd": 239000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BUCKET-CBO-189K_HDE.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20748",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Xô Cùng Tiệc 269k",
          "description": "Xô 9 Miếng Gà + 3 ly Pepsi (Vừa)",
          "priceVnd": 269000,
          "originalPriceVnd": 404000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BUCKET-CBO-269K_HDE.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20707",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà To 339k",
          "description": "8 Miếng gà rán + 4 Khoai tây chiên (vừa) + 4 Ly Pepsi (đại)",
          "priceVnd": 339000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-8COB-339K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "10515",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 139K",
          "description": "3 Miếng Gà + 5 Nuggets + 3 Tenders",
          "priceVnd": 139000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CBO-139.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41039",
          "category": "Gà Rán - Gà Quay",
          "categoryId": "20003",
          "name": "1 Miếng Phi-lê Gà Quay",
          "description": "1 Miếng Phi-lê Gà Quay",
          "priceVnd": 43000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/MOD-PHI-LE-GA-QUAY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40905",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "1 Miếng Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/1GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40906",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "2 Miếng Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/2GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40907",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "3 Miếng Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
          "priceVnd": 116000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/3GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40924",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "1 Phần Cơm Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt ăn kèm cơm nóng dẻo.",
          "priceVnd": 52000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/COM-GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40968",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Miễn phí 1 miếng gà cho DH 120K",
          "description": "1 Miếng Gà",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PNS-1COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41072",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "1 Bánh Trứng",
          "description": "1 Bánh Trứng",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EGGTART-1.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41073",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "4 Bánh Trứng",
          "description": "4 Bánh Trứng",
          "priceVnd": 72000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EGGTART-4.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41077",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "7Up (Tiêu Chuẩn)",
          "description": "1 Ly 7Up (Vừa)/ (Tiêu Chuẩn)",
          "priceVnd": 13000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/7UP-STD.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41078",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "7Up (Vừa)",
          "description": "1 Ly 7Up (Vừa)",
          "priceVnd": 17000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/7UP-R.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41079",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "7Up (Đại)",
          "description": "1 Ly 7Up (Lớn)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/7UP-L.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41080",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Lipton (Tiêu Chuẩn)",
          "description": "1 Ly Lipton (Tiêu Chuẩn)",
          "priceVnd": 13000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/LIPTON-STD.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41081",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Lipton (Vừa)",
          "description": "1 Ly Lipton (Vừa)",
          "priceVnd": 17000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/LIPTON-M.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41082",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Lipton (Đại)",
          "description": "1 Ly Lipton (Lớn)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/LIPTON-J.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41087",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "7Up (Lon)",
          "description": "1 7Up (Lon)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/7UP_CAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        }
      ],
      "total": 65,
      "returned": 65,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"10 miếng gà rán\",\"gà rán\",\"pepsi tiêu chuẩn\",\"pepsi\"],\"modifierqueries\":[]}"
      }
    },
    "message": "verified_menu_collection",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ],
    "verifiedCollection": {
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%2210%20mi%E1%BA%BFng%20g%C3%A0%20r%C3%A1n%22%2C%22g%C3%A0%20r%C3%A1n%22%2C%22pepsi%20ti%C3%AAu%20chu%E1%BA%A9n%22%2C%22pepsi%22%5D%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "0d35fe4e2cca9cd7ade9421cef7f90abc13eb0606b4ff7adf7952e3aca4f7210",
      "providerRevision": "menu-result:13561231dfe5edba408631bd6d32b4d1630916aa617005a3f31c57785a250693",
      "result": {
        "items": [
          {
            "code": "41075",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "Pepsi (Vừa)",
            "description": "1 Ly Pepsi (Vừa)",
            "priceVnd": 17000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-M.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41076",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "Pepsi (Đại)",
            "description": "1 Ly Pepsi (Lớn)",
            "priceVnd": 20000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-J.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41035",
            "category": "Gà Rán - Gà Quay",
            "categoryId": "20003",
            "name": "1 Miếng Gà Rán",
            "description": "1 Miếng Gà Rán + 1 Gói tương (cà/ ớt)",
            "priceVnd": 37000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/1-Fried-Chicken.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41074",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "Pepsi (Tiêu Chuẩn)",
            "description": "1 Ly Pepsi (Tiêu Chuẩn)",
            "priceVnd": 13000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-STD.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "20702",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Burger Gà Yo & Gà Rán",
            "description": "1 Burger gà yo + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (vừa)",
            "priceVnd": 129000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo-COB_.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20694",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Cơm Gà Rán Solo",
            "description": "1 Cơm Gà rán + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 56000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20695",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Cơm Gà Rán & Súp",
            "description": "1 Cơm Gà rán + 1 Súp rong biển + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 69000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Rice-Soup.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41036",
            "category": "Gà Rán - Gà Quay",
            "categoryId": "20003",
            "name": "2 Miếng Gà Rán",
            "description": "2 Miếng Gà Rán + 2 Gói tương (cà/ ớt)",
            "priceVnd": 74000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/2-Fried-Chicken.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41037",
            "category": "Gà Rán - Gà Quay",
            "categoryId": "20003",
            "name": "3 Miếng Gà Rán",
            "description": "3 Miếng Gà Rán + 3 Gói tương (cà/ ớt)",
            "priceVnd": 105000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/3-Fried-Chicken.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41038",
            "category": "Gà Rán - Gà Quay",
            "categoryId": "20003",
            "name": "6 Miếng Gà Rán",
            "description": "6 Miếng Gà Rán + 6 Gói tương (cà/ ớt)",
            "priceVnd": 210000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/6-Fried-Chicken-new.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41040",
            "category": "Gà Rán - Gà Quay",
            "categoryId": "20003",
            "name": "3 Miếng Gà Rán Tender",
            "description": "3 Miếng Gà Rán Tender + 1 Gói tương (cà/ ớt)",
            "priceVnd": 42000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TENDERS-3.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41041",
            "category": "Gà Rán - Gà Quay",
            "categoryId": "20003",
            "name": "5 Miếng Gà Rán Tender",
            "description": "5 Miếng Gà Rán Tender + 2 Gói tương (cà/ ớt)",
            "priceVnd": 68000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TENDERS-5.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41083",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "Pepsi Không Đường (Tiêu Chuẩn)",
            "description": "1 Ly Pepsi Không Đường (Tiêu Chuẩn)",
            "priceVnd": 13000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-ZERO-STD.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41084",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "Pepsi Không Đường (Vừa)",
            "description": "1 Ly Pepsi Không Đường (Vừa)",
            "priceVnd": 17000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-ZERO-M.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41085",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "Pepsi Không Đường (Đại)",
            "description": "1 Ly Pepsi Không Đường (Lớn)",
            "priceVnd": 20000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-ZERO-J.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41086",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "Pepsi (Lon)",
            "description": "1 Pepsi (Lon)",
            "priceVnd": 20000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI_CAN.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41088",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "Pepsi Không Đường (Lon)",
            "description": "1 Pepsi Không Đường (Lon)",
            "priceVnd": 20000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Pepsi-Zero-Can-ALC.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41048",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Mì Ý Gà Rán",
            "description": "1 Mì Ý Gà Rán + 1 Gói tương (cà/ ớt)",
            "priceVnd": 68000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41049",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "1 Cơm Gà Rán",
            "description": "1 Cơm Gà Rán + 1 Gói tương (cà/ ớt)",
            "priceVnd": 49000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Rice-OR.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "40775",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "Tặng 1 lon Pepsi",
            "description": "Tặng 1 lon Pepsi",
            "priceVnd": 0,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PEPSI_CAN.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "20752",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Đẫy Đà 129K",
            "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
            "priceVnd": 129000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20687",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo 1 Miếng Gà",
            "description": "1 Miếng gà + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 59000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-1.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20688",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Một Mình Chill",
            "description": "1 Miếng gà + 1 Mì ý xúc xích + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 91000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1COB-Pasta.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20689",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo 2 Miếng Gà",
            "description": "2 Miếng gà + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 91000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-2.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20692",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Mỳ Ý Solo",
            "description": "1 Mì ý gà rán + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 71000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1-Pasta-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20693",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Mì Ý & Gà Tenders",
            "description": "1 Mì ý xúc xích + 3 Tender + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 79000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Pasta-Tender.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20696",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Cơm Gà Quay Solo",
            "description": "1 Cơm Gà quay + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 59000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-FLAVA.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20697",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Cơm Gà Nanban Solo",
            "description": "1 Cơm Gà nanban + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 46000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-NANBAN.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20698",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Burger Zinger",
            "description": "1 Burger zinger + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 79000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-B.ZINGER-FF.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20700",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Burger Tôm",
            "description": "1 Burger tôm + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 69000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.Shrimp.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20699",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Burger Gà Quay",
            "description": "1 Burger gà quay +  1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 79000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DB-ROASTED-FF.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20701",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Burger Gà Yo",
            "description": "1 Burger gà yo + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 56000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20690",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Nhóm 2 No Nê",
            "description": "4 Miếng gà + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 169000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D.BUCKET4_FF.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20691",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Nhóm 3 Tụ Tập",
            "description": "5 Miếng gà + 1 Gà viên (Vừa) + 3 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 239000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-5-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20703",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Nhóm 2 Vui Vẻ",
            "description": "3 Miếng gà rán + 1 Mì ý gà viên + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 159000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-3-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20704",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Hai Mình Chill",
            "description": "2 Mì ý xúc xích + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 146000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-2-Pasta-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20705",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Gà Chill 199k",
            "description": "3 Miếng gà rán + 2 Mì ý xúc xích + 1 Khoai tây chiên (vừa) + 3 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 199000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-3COB-199K.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20706",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Gà No 279k",
            "description": "4 Miếng gà rán + 2 Burger zinger + 1 Khoai tây chiên (vừa) + 4 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 279000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-4COB-279K.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20708",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Gà Xịn 389k",
            "description": "5 Miếng gà rán + 4 Mì ý xúc xích + 3 Khoai tây chiên (vừa) + 5 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 389000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-5COB-389K.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20712",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Gà Rôm Rả 245k",
            "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa)",
            "priceVnd": 245000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20711",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Gà Rôm Rả 245k",
            "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa) + Tặng 1 Vé KFC Zestival (Khu Khuấy Đảo)_SỐ LƯỢNG CÓ HẠN",
            "priceVnd": 245000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO-2.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20751",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Hợp Gu 99K",
            "description": "3 Miếng Gà Rán + 1 Burger Tôm",
            "priceVnd": 99000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20709",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Tiêu Tung Chill 85k",
            "description": "1 Miếng Gà Rán + 1 Miếng Gà Lắc Tiêu Chanh + 1 ly Pepsi Không Đường (Đại)",
            "priceVnd": 85000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TIEUTUNGCHILL.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20710",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Chanh Sang Chảnh 140k",
            "description": "2 Miếng Gà Lắc Tiêu Chanh + 1 Miếng Gà Rán + 1 Khoai Tây Chiên (Vừa) + 2 ly Pepsi Không Đường (Vừa)",
            "priceVnd": 140000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CHANHSANGCHANH.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20742",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Cùng Vui",
            "description": "Combo 6 Miếng Gà Rán. Tặng kèm 3 lon Pepsi",
            "priceVnd": 199000,
            "originalPriceVnd": 210000,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGVUI-JULY.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20743",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Cùng \"Dzô\"",
            "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
            "priceVnd": 369000,
            "originalPriceVnd": 444000,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20732",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Xô Hợp Cạ 189k",
            "description": "Xô 5 Miếng Gà + 1 Khoai Tây Chiên (Vừa) + 2 ly Pepsi (Vừa)",
            "priceVnd": 189000,
            "originalPriceVnd": 239000,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BUCKET-CBO-189K_HDE.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20748",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Xô Cùng Tiệc 269k",
            "description": "Xô 9 Miếng Gà + 3 ly Pepsi (Vừa)",
            "priceVnd": 269000,
            "originalPriceVnd": 404000,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BUCKET-CBO-269K_HDE.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20707",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Gà To 339k",
            "description": "8 Miếng gà rán + 4 Khoai tây chiên (vừa) + 4 Ly Pepsi (đại)",
            "priceVnd": 339000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-8COB-339K.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "10515",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo 139K",
            "description": "3 Miếng Gà + 5 Nuggets + 3 Tenders",
            "priceVnd": 139000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CBO-139.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41039",
            "category": "Gà Rán - Gà Quay",
            "categoryId": "20003",
            "name": "1 Miếng Phi-lê Gà Quay",
            "description": "1 Miếng Phi-lê Gà Quay",
            "priceVnd": 43000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/MOD-PHI-LE-GA-QUAY.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "40905",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "1 Miếng Gà Xốt Mắm Tỏi",
            "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
            "priceVnd": 40000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/1GXMT.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "40906",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "2 Miếng Gà Xốt Mắm Tỏi",
            "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
            "priceVnd": 79000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/2GXMT.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "40907",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "3 Miếng Gà Xốt Mắm Tỏi",
            "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
            "priceVnd": 116000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/3GXMT.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "40924",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "1 Phần Cơm Gà Xốt Mắm Tỏi",
            "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt ăn kèm cơm nóng dẻo.",
            "priceVnd": 52000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/COM-GXMT.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "40968",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "Miễn phí 1 miếng gà cho DH 120K",
            "description": "1 Miếng Gà",
            "priceVnd": 0,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PNS-1COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41072",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "1 Bánh Trứng",
            "description": "1 Bánh Trứng",
            "priceVnd": 20000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EGGTART-1.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41073",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "4 Bánh Trứng",
            "description": "4 Bánh Trứng",
            "priceVnd": 72000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EGGTART-4.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41077",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "7Up (Tiêu Chuẩn)",
            "description": "1 Ly 7Up (Vừa)/ (Tiêu Chuẩn)",
            "priceVnd": 13000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/7UP-STD.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41078",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "7Up (Vừa)",
            "description": "1 Ly 7Up (Vừa)",
            "priceVnd": 17000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/7UP-R.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41079",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "7Up (Đại)",
            "description": "1 Ly 7Up (Lớn)",
            "priceVnd": 20000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/7UP-L.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41080",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "Lipton (Tiêu Chuẩn)",
            "description": "1 Ly Lipton (Tiêu Chuẩn)",
            "priceVnd": 13000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/LIPTON-STD.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41081",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "Lipton (Vừa)",
            "description": "1 Ly Lipton (Vừa)",
            "priceVnd": 17000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/LIPTON-M.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41082",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "Lipton (Đại)",
            "description": "1 Ly Lipton (Lớn)",
            "priceVnd": 20000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/LIPTON-J.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41087",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "7Up (Lon)",
            "description": "1 7Up (Lon)",
            "priceVnd": 20000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/7UP_CAN.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          }
        ],
        "total": 65,
        "returned": 65,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"10 miếng gà rán\",\"gà rán\",\"pepsi tiêu chuẩn\",\"pepsi\"],\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T07:49:00.645Z",
  "completedAt": "2026-07-24T07:49:00.653Z",
  "executionDurationMs": 8
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_01_ogf0uAUAMvveVkBJp7N67425",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Gà No",
      "combo nhóm"
    ],
    "modifierQueries": []
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Combo Gà No",
        "combo nhóm"
      ],
      "total": 38,
      "returned": 38,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Combo Gà No\",\"combo nhóm\"],\"modifierQueries\":[]}"
      },
      "items": [
        {
          "code": "20690",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 2 No Nê",
          "description": "4 Miếng gà + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 169000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D.BUCKET4_FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20691",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 3 Tụ Tập",
          "description": "5 Miếng gà + 1 Gà viên (Vừa) + 3 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 239000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-5-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20703",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 2 Vui Vẻ",
          "description": "3 Miếng gà rán + 1 Mì ý gà viên + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 159000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-3-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20706",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà No 279k",
          "description": "4 Miếng gà rán + 2 Burger zinger + 1 Khoai tây chiên (vừa) + 4 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 279000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-4COB-279K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20702",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Burger Gà Yo & Gà Rán",
          "description": "1 Burger gà yo + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (vừa)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo-COB_.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20704",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Hai Mình Chill",
          "description": "2 Mì ý xúc xích + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 146000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-2-Pasta-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20705",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà Chill 199k",
          "description": "3 Miếng gà rán + 2 Mì ý xúc xích + 1 Khoai tây chiên (vừa) + 3 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 199000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-3COB-199K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20707",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà To 339k",
          "description": "8 Miếng gà rán + 4 Khoai tây chiên (vừa) + 4 Ly Pepsi (đại)",
          "priceVnd": 339000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-8COB-339K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20708",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà Xịn 389k",
          "description": "5 Miếng gà rán + 4 Mì ý xúc xích + 3 Khoai tây chiên (vừa) + 5 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 389000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-5COB-389K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20712",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20711",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa) + Tặng 1 Vé KFC Zestival (Khu Khuấy Đảo)_SỐ LƯỢNG CÓ HẠN",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO-2.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20701",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Gà Yo",
          "description": "1 Burger gà yo + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41131",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Add Garlic Butter FF L",
          "description": "",
          "priceVnd": 32000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41133",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Add Garlic Butter Pop R",
          "description": "",
          "priceVnd": 42000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "40908",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "Rice G.Fishsauce Chicken",
          "description": "",
          "priceVnd": 52000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41159",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "LOY_COB_0d_HD",
          "description": "",
          "priceVnd": 37000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20687",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 1 Miếng Gà",
          "description": "1 Miếng gà + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 59000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-1.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20689",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 2 Miếng Gà",
          "description": "2 Miếng gà + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 91000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-2.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20693",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Mì Ý & Gà Tenders",
          "description": "1 Mì ý xúc xích + 3 Tender + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Pasta-Tender.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20694",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Rán Solo",
          "description": "1 Cơm Gà rán + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20695",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Rán & Súp",
          "description": "1 Cơm Gà rán + 1 Súp rong biển + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 69000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Rice-Soup.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20696",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Quay Solo",
          "description": "1 Cơm Gà quay + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 59000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-FLAVA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20697",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Nanban Solo",
          "description": "1 Cơm Gà nanban + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 46000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-NANBAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20699",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Gà Quay",
          "description": "1 Burger gà quay +  1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DB-ROASTED-FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20751",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Hợp Gu 99K",
          "description": "3 Miếng Gà Rán + 1 Burger Tôm",
          "priceVnd": 99000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20752",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Đẫy Đà 129K",
          "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20709",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Tiêu Tung Chill 85k",
          "description": "1 Miếng Gà Rán + 1 Miếng Gà Lắc Tiêu Chanh + 1 ly Pepsi Không Đường (Đại)",
          "priceVnd": 85000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TIEUTUNGCHILL.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20710",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Chanh Sang Chảnh 140k",
          "description": "2 Miếng Gà Lắc Tiêu Chanh + 1 Miếng Gà Rán + 1 Khoai Tây Chiên (Vừa) + 2 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 140000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CHANHSANGCHANH.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20742",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng Vui",
          "description": "Combo 6 Miếng Gà Rán. Tặng kèm 3 lon Pepsi",
          "priceVnd": 199000,
          "originalPriceVnd": 210000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGVUI-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20743",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng \"Dzô\"",
          "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
          "priceVnd": 369000,
          "originalPriceVnd": 444000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "10515",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 139K",
          "description": "3 Miếng Gà + 5 Nuggets + 3 Tenders",
          "priceVnd": 139000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CBO-139.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20688",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Một Mình Chill",
          "description": "1 Miếng gà + 1 Mì ý xúc xích + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 91000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1COB-Pasta.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20692",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Mỳ Ý Solo",
          "description": "1 Mì ý gà rán + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 71000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1-Pasta-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20698",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Zinger",
          "description": "1 Burger zinger + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-B.ZINGER-FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40905",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "1 Miếng Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/1GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40906",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "2 Miếng Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/2GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40907",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "3 Miếng Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
          "priceVnd": 116000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/3GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40924",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "1 Phần Cơm Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt ăn kèm cơm nóng dẻo.",
          "priceVnd": 52000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/COM-GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        }
      ]
    },
    "message": "verified_menu_collection",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "modelFacingResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "items": [
        {
          "code": "20690",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 2 No Nê",
          "description": "4 Miếng gà + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 169000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D.BUCKET4_FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20691",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 3 Tụ Tập",
          "description": "5 Miếng gà + 1 Gà viên (Vừa) + 3 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 239000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-5-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20703",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Nhóm 2 Vui Vẻ",
          "description": "3 Miếng gà rán + 1 Mì ý gà viên + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 159000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-3-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20706",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà No 279k",
          "description": "4 Miếng gà rán + 2 Burger zinger + 1 Khoai tây chiên (vừa) + 4 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 279000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-4COB-279K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20702",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Burger Gà Yo & Gà Rán",
          "description": "1 Burger gà yo + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (vừa)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo-COB_.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20704",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Hai Mình Chill",
          "description": "2 Mì ý xúc xích + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 146000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-2-Pasta-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20705",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà Chill 199k",
          "description": "3 Miếng gà rán + 2 Mì ý xúc xích + 1 Khoai tây chiên (vừa) + 3 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 199000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-3COB-199K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20707",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà To 339k",
          "description": "8 Miếng gà rán + 4 Khoai tây chiên (vừa) + 4 Ly Pepsi (đại)",
          "priceVnd": 339000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-8COB-339K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20708",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà Xịn 389k",
          "description": "5 Miếng gà rán + 4 Mì ý xúc xích + 3 Khoai tây chiên (vừa) + 5 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 389000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-5COB-389K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20712",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20711",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa) + Tặng 1 Vé KFC Zestival (Khu Khuấy Đảo)_SỐ LƯỢNG CÓ HẠN",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO-2.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20701",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Gà Yo",
          "description": "1 Burger gà yo + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41131",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Add Garlic Butter FF L",
          "description": "",
          "priceVnd": 32000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41133",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Add Garlic Butter Pop R",
          "description": "",
          "priceVnd": 42000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "40908",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "Rice G.Fishsauce Chicken",
          "description": "",
          "priceVnd": 52000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41159",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "LOY_COB_0d_HD",
          "description": "",
          "priceVnd": 37000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20687",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 1 Miếng Gà",
          "description": "1 Miếng gà + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 59000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-1.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20689",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 2 Miếng Gà",
          "description": "2 Miếng gà + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 91000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-2.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20693",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Mì Ý & Gà Tenders",
          "description": "1 Mì ý xúc xích + 3 Tender + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Pasta-Tender.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20694",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Rán Solo",
          "description": "1 Cơm Gà rán + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20695",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Rán & Súp",
          "description": "1 Cơm Gà rán + 1 Súp rong biển + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 69000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Rice-Soup.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20696",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Quay Solo",
          "description": "1 Cơm Gà quay + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 59000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-FLAVA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20697",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Cơm Gà Nanban Solo",
          "description": "1 Cơm Gà nanban + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 46000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-NANBAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20699",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Gà Quay",
          "description": "1 Burger gà quay +  1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DB-ROASTED-FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20751",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Hợp Gu 99K",
          "description": "3 Miếng Gà Rán + 1 Burger Tôm",
          "priceVnd": 99000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20752",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Đẫy Đà 129K",
          "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20709",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Tiêu Tung Chill 85k",
          "description": "1 Miếng Gà Rán + 1 Miếng Gà Lắc Tiêu Chanh + 1 ly Pepsi Không Đường (Đại)",
          "priceVnd": 85000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TIEUTUNGCHILL.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20710",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Chanh Sang Chảnh 140k",
          "description": "2 Miếng Gà Lắc Tiêu Chanh + 1 Miếng Gà Rán + 1 Khoai Tây Chiên (Vừa) + 2 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 140000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CHANHSANGCHANH.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20742",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng Vui",
          "description": "Combo 6 Miếng Gà Rán. Tặng kèm 3 lon Pepsi",
          "priceVnd": 199000,
          "originalPriceVnd": 210000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGVUI-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20743",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng \"Dzô\"",
          "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
          "priceVnd": 369000,
          "originalPriceVnd": 444000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "10515",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo 139K",
          "description": "3 Miếng Gà + 5 Nuggets + 3 Tenders",
          "priceVnd": 139000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CBO-139.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20688",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Một Mình Chill",
          "description": "1 Miếng gà + 1 Mì ý xúc xích + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 91000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1COB-Pasta.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20692",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Mỳ Ý Solo",
          "description": "1 Mì ý gà rán + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 71000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1-Pasta-COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20698",
          "category": "Combo 1 Người",
          "categoryId": "20001",
          "name": "Combo Burger Zinger",
          "description": "1 Burger zinger + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-B.ZINGER-FF.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40905",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "1 Miếng Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/1GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40906",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "2 Miếng Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/2GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40907",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "3 Miếng Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
          "priceVnd": 116000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/3GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40924",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "1 Phần Cơm Gà Xốt Mắm Tỏi",
          "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt ăn kèm cơm nóng dẻo.",
          "priceVnd": 52000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/COM-GXMT.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        }
      ],
      "total": 38,
      "returned": 38,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"combo gà no\",\"combo nhóm\"],\"modifierqueries\":[]}"
      }
    },
    "message": "verified_menu_collection",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ],
    "verifiedCollection": {
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22combo%20g%C3%A0%20no%22%2C%22combo%20nh%C3%B3m%22%5D%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "1c69c9b9824ec58a9d474748112bf3eb7a8a659897f7c768718654d7a9bb7e71",
      "providerRevision": "menu-result:cc3e0462d726cd1f65bccbb952bcca04e3675c9897a2f797a8e39a54a54ab2ad",
      "result": {
        "items": [
          {
            "code": "20690",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Nhóm 2 No Nê",
            "description": "4 Miếng gà + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 169000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D.BUCKET4_FF.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20691",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Nhóm 3 Tụ Tập",
            "description": "5 Miếng gà + 1 Gà viên (Vừa) + 3 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 239000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-5-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20703",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Nhóm 2 Vui Vẻ",
            "description": "3 Miếng gà rán + 1 Mì ý gà viên + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 159000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.Bucket-3-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20706",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Gà No 279k",
            "description": "4 Miếng gà rán + 2 Burger zinger + 1 Khoai tây chiên (vừa) + 4 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 279000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-4COB-279K.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20702",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Burger Gà Yo & Gà Rán",
            "description": "1 Burger gà yo + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (vừa)",
            "priceVnd": 129000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo-COB_.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20704",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Hai Mình Chill",
            "description": "2 Mì ý xúc xích + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 146000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-2-Pasta-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20705",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Gà Chill 199k",
            "description": "3 Miếng gà rán + 2 Mì ý xúc xích + 1 Khoai tây chiên (vừa) + 3 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 199000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-3COB-199K.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20707",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Gà To 339k",
            "description": "8 Miếng gà rán + 4 Khoai tây chiên (vừa) + 4 Ly Pepsi (đại)",
            "priceVnd": 339000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-8COB-339K.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20708",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Gà Xịn 389k",
            "description": "5 Miếng gà rán + 4 Mì ý xúc xích + 3 Khoai tây chiên (vừa) + 5 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 389000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-5COB-389K.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20712",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Gà Rôm Rả 245k",
            "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa)",
            "priceVnd": 245000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20711",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Gà Rôm Rả 245k",
            "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa) + Tặng 1 Vé KFC Zestival (Khu Khuấy Đảo)_SỐ LƯỢNG CÓ HẠN",
            "priceVnd": 245000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO-2.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20701",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Burger Gà Yo",
            "description": "1 Burger gà yo + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 56000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41131",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "Add Garlic Butter FF L",
            "description": "",
            "priceVnd": 32000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41133",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "Add Garlic Butter Pop R",
            "description": "",
            "priceVnd": 42000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "40908",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "Rice G.Fishsauce Chicken",
            "description": "",
            "priceVnd": 52000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41159",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "LOY_COB_0d_HD",
            "description": "",
            "priceVnd": 37000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20687",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo 1 Miếng Gà",
            "description": "1 Miếng gà + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 59000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-1.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20689",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo 2 Miếng Gà",
            "description": "2 Miếng gà + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 91000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-2.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20693",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Mì Ý & Gà Tenders",
            "description": "1 Mì ý xúc xích + 3 Tender + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 79000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Pasta-Tender.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20694",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Cơm Gà Rán Solo",
            "description": "1 Cơm Gà rán + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 56000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20695",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Cơm Gà Rán & Súp",
            "description": "1 Cơm Gà rán + 1 Súp rong biển + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 69000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-Rice-Soup.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20696",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Cơm Gà Quay Solo",
            "description": "1 Cơm Gà quay + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 59000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-FLAVA.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20697",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Cơm Gà Nanban Solo",
            "description": "1 Cơm Gà nanban + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 46000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-RICE-NANBAN.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20699",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Burger Gà Quay",
            "description": "1 Burger gà quay +  1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 79000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DB-ROASTED-FF.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20751",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Hợp Gu 99K",
            "description": "3 Miếng Gà Rán + 1 Burger Tôm",
            "priceVnd": 99000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20752",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Đẫy Đà 129K",
            "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
            "priceVnd": 129000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20709",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Tiêu Tung Chill 85k",
            "description": "1 Miếng Gà Rán + 1 Miếng Gà Lắc Tiêu Chanh + 1 ly Pepsi Không Đường (Đại)",
            "priceVnd": 85000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TIEUTUNGCHILL.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20710",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Chanh Sang Chảnh 140k",
            "description": "2 Miếng Gà Lắc Tiêu Chanh + 1 Miếng Gà Rán + 1 Khoai Tây Chiên (Vừa) + 2 ly Pepsi Không Đường (Vừa)",
            "priceVnd": 140000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CHANHSANGCHANH.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20742",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Cùng Vui",
            "description": "Combo 6 Miếng Gà Rán. Tặng kèm 3 lon Pepsi",
            "priceVnd": 199000,
            "originalPriceVnd": 210000,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGVUI-JULY.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20743",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Cùng \"Dzô\"",
            "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
            "priceVnd": 369000,
            "originalPriceVnd": 444000,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "10515",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo 139K",
            "description": "3 Miếng Gà + 5 Nuggets + 3 Tenders",
            "priceVnd": 139000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CBO-139.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20688",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Một Mình Chill",
            "description": "1 Miếng gà + 1 Mì ý xúc xích + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 91000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1COB-Pasta.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20692",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Mỳ Ý Solo",
            "description": "1 Mì ý gà rán + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 71000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-1-Pasta-COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20698",
            "category": "Combo 1 Người",
            "categoryId": "20001",
            "name": "Combo Burger Zinger",
            "description": "1 Burger zinger + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)",
            "priceVnd": 79000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D-B.ZINGER-FF.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "40905",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "1 Miếng Gà Xốt Mắm Tỏi",
            "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
            "priceVnd": 40000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/1GXMT.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "40906",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "2 Miếng Gà Xốt Mắm Tỏi",
            "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
            "priceVnd": 79000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/2GXMT.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "40907",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "3 Miếng Gà Xốt Mắm Tỏi",
            "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt.",
            "priceVnd": 116000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/3GXMT.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "40924",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "1 Phần Cơm Gà Xốt Mắm Tỏi",
            "description": "Gà rán giòn tan, quyện thêm xốt mắm tỏi đậm đà, cay cay, ngọt ngọt, thơm nồng nàn từ tỏi và ớt ăn kèm cơm nóng dẻo.",
            "priceVnd": 52000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/COM-GXMT.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          }
        ],
        "total": 38,
        "returned": 38,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"combo gà no\",\"combo nhóm\"],\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T07:49:00.659Z",
  "completedAt": "2026-07-24T07:49:00.665Z",
  "executionDurationMs": 6
}
```

### Tool call: searchPromotions

```json
{
  "callId": "call_00_wKbXAiFkowLmsPJHAfmU5397",
  "arguments": {
    "query": ""
  },
  "requestedAt": "2026-07-24T07:49:03.342Z"
}
```

### Tool result: searchPromotions

```json
{
  "callId": "call_00_wKbXAiFkowLmsPJHAfmU5397",
  "arguments": {
    "query": ""
  },
  "rawResult": {
    "toolName": "searchPromotions",
    "ok": true,
    "value": [
      {
        "offerId": "lunch-2026-combo-42k",
        "imageUrl": "https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg",
        "campaign": "🍴 TRƯA NAY KHỎI NGHĨ NHIỀU – ĐÃ CÓ KFC LO!",
        "campaignType": "lunch_combo",
        "offerType": "fixed_price_combo",
        "offerName": "Bữa trưa 42K",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": 42000,
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "",
        "appliesTo": "Cơm Gà Viên Nanban + Pepsi hoặc Mì Ý Migaxuxi Gà Viên + Pepsi",
        "channel": "Giao hàng tận nơi / website / app / Zalo / TikTok Shop",
        "startDate": "2026-01-02",
        "endDate": "2026-12-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Cơm Gà Viên Nanban + Pepsi (Tiêu chuẩn) – 42K; Mì Ý Migaxuxi Gà Viên + Pepsi (Tiêu chuẩn) – 42K.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/trua-nay-an-gi",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-trua-nay-an-gi.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "lunch-2026-combo-44k",
        "imageUrl": "https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg",
        "campaign": "🍴 TRƯA NAY KHỎI NGHĨ NHIỀU – ĐÃ CÓ KFC LO!",
        "campaignType": "lunch_combo",
        "offerType": "fixed_price_combo",
        "offerName": "Bữa trưa 44K",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": 44000,
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "",
        "appliesTo": "Cơm Phi-lê Gà Quay + Pepsi hoặc Burger Tôm + Pepsi",
        "channel": "Giao hàng tận nơi / website / app / Zalo / TikTok Shop",
        "startDate": "2026-01-02",
        "endDate": "2026-12-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Cơm Phi-lê Gà Quay + Pepsi (Tiêu chuẩn) – 44K; Burger Tôm + Pepsi (Tiêu chuẩn) – 44K.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/trua-nay-an-gi",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-trua-nay-an-gi.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "lunch-2026-combo-49k",
        "imageUrl": "https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg",
        "campaign": "🍴 TRƯA NAY KHỎI NGHĨ NHIỀU – ĐÃ CÓ KFC LO!",
        "campaignType": "lunch_combo",
        "offerType": "fixed_price_combo",
        "offerName": "Bữa trưa 49K",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": 49000,
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "",
        "appliesTo": "Cơm Gà Sốt Mắm Tỏi + Pepsi",
        "channel": "Giao hàng tận nơi / website / app / Zalo / TikTok Shop",
        "startDate": "2026-01-02",
        "endDate": "2026-12-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Cơm Gà Sốt Mắm Tỏi + Pepsi (Tiêu chuẩn) – 49K.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/trua-nay-an-gi",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-trua-nay-an-gi.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-2026-july-tier-1m",
        "imageUrl": "https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T7.jpg",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "gift_bundle",
        "offerName": "Big order tier từ 1 triệu đến dưới 2,5 triệu",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": 1000000,
        "maximumDiscountVnd": "",
        "giftQuantity": "06 Pepsi + 02 VietGoal + 02 GreenSM + 02 Shopee VIP + 01 Động Lực Sport",
        "partnerBrand": "VietGoal | GreenSM | Shopee VIP | Động Lực Sport",
        "appliesTo": "Đơn hàng lớn sau chiết khấu",
        "channel": "Big order / tổng đài / website",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Từ 1 triệu đến dưới 2,5 triệu đồng: 06 lon Pepsi, 02 Voucher VietGoal, 02 Voucher GreenSM, 02 Voucher Shopee VIP, 01 Voucher Động Lực Sport.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-2026-july-tier-2p5m",
        "imageUrl": "https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T7.jpg",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "gift_bundle",
        "offerName": "Big order tier từ 2,5 triệu đến dưới 5 triệu",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": 2500000,
        "maximumDiscountVnd": "",
        "giftQuantity": "12 Pepsi + 05 VietGoal + 05 GreenSM + 05 Shopee VIP + 01 Động Lực Sport",
        "partnerBrand": "VietGoal | GreenSM | Shopee VIP | Động Lực Sport",
        "appliesTo": "Đơn hàng lớn sau chiết khấu",
        "channel": "Big order / tổng đài / website",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Từ 2,5 triệu đến dưới 5 triệu đồng: 12 lon Pepsi, 05 Voucher VietGoal, 05 Voucher GreenSM, 05 Voucher Shopee VIP, 01 Voucher Động Lực Sport.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-2026-july-tier-5m",
        "imageUrl": "https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T7.jpg",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "gift_bundle",
        "offerName": "Big order tier từ 5 triệu trở lên",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": 5000000,
        "maximumDiscountVnd": "",
        "giftQuantity": "24 Pepsi + 10 VietGoal + 10 GreenSM + 10 Shopee VIP + 01 Động Lực Sport",
        "partnerBrand": "VietGoal | GreenSM | Shopee VIP | Động Lực Sport",
        "appliesTo": "Đơn hàng lớn sau chiết khấu",
        "channel": "Big order / tổng đài / website",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Từ 5 triệu đồng trở lên: 24 lon Pepsi, 10 Voucher VietGoal, 10 Voucher GreenSM, 10 Voucher Shopee VIP, 01 Voucher Động Lực Sport.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-vietgoal-free-session",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher VietGoal miễn phí 1 buổi học bóng đá",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "VietGoal",
        "appliesTo": "Hệ thống sân tập VietGoal toàn quốc",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher VietGoal miễn phí 1 buổi học bóng đá trị giá 150.000đ/buổi.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-greensm-20pct-max-50k",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher GreenSM giảm 20%",
        "discountPercent": 20,
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": "",
        "maximumDiscountVnd": 50000,
        "giftQuantity": "",
        "partnerBrand": "GreenSM",
        "appliesTo": "Dịch vụ đặt xe GreenSM",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher GreenSM giảm 20% tối đa 50.000đ cho dịch vụ đặt xe GreenSM.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-shopee-vip-3-months",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher miễn phí 03 tháng Shopee VIP",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "Shopee VIP",
        "appliesTo": "Gói Shopee VIP",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher miễn phí 03 tháng sử dụng gói Shopee Vip.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-dong-luc-300k-min-1m",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher Động Lực Sport giảm 300.000đ",
        "discountPercent": "",
        "discountAmountVnd": 300000,
        "priceVnd": "",
        "minimumOrderVnd": 1000000,
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "Động Lực Sport",
        "appliesTo": "Jogarbola.com.vn / Donglucsport.vn / hệ thống cửa hàng trừ AEON Mall",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher Động Lực Sport giảm 300.000đ cho đơn từ 1.000.000đ khi mua hàng tại website Jogarbola.com.vn/ Donglucsport.vn hoặc trực tiếp tại hệ thống cửa hàng (trừ AEON Mall).",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "offer_kfc50_hidden",
        "campaign": "Giảm giá đơn hàng",
        "campaignType": "voucher",
        "offerType": "amount_off",
        "offerName": "Giảm 50K cho đơn đủ điều kiện",
        "discountPercent": "",
        "discountAmountVnd": 50000,
        "priceVnd": "",
        "minimumOrderVnd": 195000,
        "maximumDiscountVnd": 50000,
        "giftQuantity": "",
        "partnerBrand": "KFC",
        "appliesTo": "Đơn giao hàng",
        "channel": "web",
        "startDate": "2026-01-01",
        "endDate": "2026-12-31",
        "actualCodeExposed": true,
        "publicCode": "KFC50",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "public_site",
        "evidenceText": "Demo stable voucher KFC50 applies 50K off for scenario fixture orders from 195.000đ.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/khuyen-mai",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-promotion-vouchers.json",
        "notes": "Demo-stable fixture entry for Messenger scenario 01."
      }
    ],
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "modelFacingResult": {
    "toolName": "searchPromotions",
    "ok": true,
    "value": [
      {
        "offerId": "lunch-2026-combo-42k",
        "imageUrl": "https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg",
        "campaign": "🍴 TRƯA NAY KHỎI NGHĨ NHIỀU – ĐÃ CÓ KFC LO!",
        "campaignType": "lunch_combo",
        "offerType": "fixed_price_combo",
        "offerName": "Bữa trưa 42K",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": 42000,
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "",
        "appliesTo": "Cơm Gà Viên Nanban + Pepsi hoặc Mì Ý Migaxuxi Gà Viên + Pepsi",
        "channel": "Giao hàng tận nơi / website / app / Zalo / TikTok Shop",
        "startDate": "2026-01-02",
        "endDate": "2026-12-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Cơm Gà Viên Nanban + Pepsi (Tiêu chuẩn) – 42K; Mì Ý Migaxuxi Gà Viên + Pepsi (Tiêu chuẩn) – 42K.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/trua-nay-an-gi",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-trua-nay-an-gi.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "lunch-2026-combo-44k",
        "imageUrl": "https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg",
        "campaign": "🍴 TRƯA NAY KHỎI NGHĨ NHIỀU – ĐÃ CÓ KFC LO!",
        "campaignType": "lunch_combo",
        "offerType": "fixed_price_combo",
        "offerName": "Bữa trưa 44K",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": 44000,
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "",
        "appliesTo": "Cơm Phi-lê Gà Quay + Pepsi hoặc Burger Tôm + Pepsi",
        "channel": "Giao hàng tận nơi / website / app / Zalo / TikTok Shop",
        "startDate": "2026-01-02",
        "endDate": "2026-12-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Cơm Phi-lê Gà Quay + Pepsi (Tiêu chuẩn) – 44K; Burger Tôm + Pepsi (Tiêu chuẩn) – 44K.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/trua-nay-an-gi",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-trua-nay-an-gi.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "lunch-2026-combo-49k",
        "imageUrl": "https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg",
        "campaign": "🍴 TRƯA NAY KHỎI NGHĨ NHIỀU – ĐÃ CÓ KFC LO!",
        "campaignType": "lunch_combo",
        "offerType": "fixed_price_combo",
        "offerName": "Bữa trưa 49K",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": 49000,
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "",
        "appliesTo": "Cơm Gà Sốt Mắm Tỏi + Pepsi",
        "channel": "Giao hàng tận nơi / website / app / Zalo / TikTok Shop",
        "startDate": "2026-01-02",
        "endDate": "2026-12-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Cơm Gà Sốt Mắm Tỏi + Pepsi (Tiêu chuẩn) – 49K.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/trua-nay-an-gi",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-trua-nay-an-gi.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-2026-july-tier-1m",
        "imageUrl": "https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T7.jpg",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "gift_bundle",
        "offerName": "Big order tier từ 1 triệu đến dưới 2,5 triệu",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": 1000000,
        "maximumDiscountVnd": "",
        "giftQuantity": "06 Pepsi + 02 VietGoal + 02 GreenSM + 02 Shopee VIP + 01 Động Lực Sport",
        "partnerBrand": "VietGoal | GreenSM | Shopee VIP | Động Lực Sport",
        "appliesTo": "Đơn hàng lớn sau chiết khấu",
        "channel": "Big order / tổng đài / website",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Từ 1 triệu đến dưới 2,5 triệu đồng: 06 lon Pepsi, 02 Voucher VietGoal, 02 Voucher GreenSM, 02 Voucher Shopee VIP, 01 Voucher Động Lực Sport.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-2026-july-tier-2p5m",
        "imageUrl": "https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T7.jpg",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "gift_bundle",
        "offerName": "Big order tier từ 2,5 triệu đến dưới 5 triệu",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": 2500000,
        "maximumDiscountVnd": "",
        "giftQuantity": "12 Pepsi + 05 VietGoal + 05 GreenSM + 05 Shopee VIP + 01 Động Lực Sport",
        "partnerBrand": "VietGoal | GreenSM | Shopee VIP | Động Lực Sport",
        "appliesTo": "Đơn hàng lớn sau chiết khấu",
        "channel": "Big order / tổng đài / website",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Từ 2,5 triệu đến dưới 5 triệu đồng: 12 lon Pepsi, 05 Voucher VietGoal, 05 Voucher GreenSM, 05 Voucher Shopee VIP, 01 Voucher Động Lực Sport.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-2026-july-tier-5m",
        "imageUrl": "https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T7.jpg",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "gift_bundle",
        "offerName": "Big order tier từ 5 triệu trở lên",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": 5000000,
        "maximumDiscountVnd": "",
        "giftQuantity": "24 Pepsi + 10 VietGoal + 10 GreenSM + 10 Shopee VIP + 01 Động Lực Sport",
        "partnerBrand": "VietGoal | GreenSM | Shopee VIP | Động Lực Sport",
        "appliesTo": "Đơn hàng lớn sau chiết khấu",
        "channel": "Big order / tổng đài / website",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Từ 5 triệu đồng trở lên: 24 lon Pepsi, 10 Voucher VietGoal, 10 Voucher GreenSM, 10 Voucher Shopee VIP, 01 Voucher Động Lực Sport.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-vietgoal-free-session",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher VietGoal miễn phí 1 buổi học bóng đá",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "VietGoal",
        "appliesTo": "Hệ thống sân tập VietGoal toàn quốc",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher VietGoal miễn phí 1 buổi học bóng đá trị giá 150.000đ/buổi.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-greensm-20pct-max-50k",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher GreenSM giảm 20%",
        "discountPercent": 20,
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": "",
        "maximumDiscountVnd": 50000,
        "giftQuantity": "",
        "partnerBrand": "GreenSM",
        "appliesTo": "Dịch vụ đặt xe GreenSM",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher GreenSM giảm 20% tối đa 50.000đ cho dịch vụ đặt xe GreenSM.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-shopee-vip-3-months",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher miễn phí 03 tháng Shopee VIP",
        "discountPercent": "",
        "discountAmountVnd": "",
        "priceVnd": "",
        "minimumOrderVnd": "",
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "Shopee VIP",
        "appliesTo": "Gói Shopee VIP",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher miễn phí 03 tháng sử dụng gói Shopee Vip.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "big-order-voucher-dong-luc-300k-min-1m",
        "campaign": "🎉 THÊM GÀ, TIỆC THÊM VUI 🎉",
        "campaignType": "big_order",
        "offerType": "partner_voucher",
        "offerName": "Voucher Động Lực Sport giảm 300.000đ",
        "discountPercent": "",
        "discountAmountVnd": 300000,
        "priceVnd": "",
        "minimumOrderVnd": 1000000,
        "maximumDiscountVnd": "",
        "giftQuantity": "",
        "partnerBrand": "Động Lực Sport",
        "appliesTo": "Jogarbola.com.vn / Donglucsport.vn / hệ thống cửa hàng trừ AEON Mall",
        "channel": "Big order gift bundle",
        "startDate": "2026-07-01",
        "endDate": "2026-07-31",
        "actualCodeExposed": false,
        "publicCode": "",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "KFC campaign / ordering flow",
        "evidenceText": "Voucher Động Lực Sport giảm 300.000đ cho đơn từ 1.000.000đ khi mua hàng tại website Jogarbola.com.vn/ Donglucsport.vn hoặc trực tiếp tại hệ thống cửa hàng (trừ AEON Mall).",
        "sourceUrl": "https://www.kfcvietnam.com.vn/kfc-tabs/promotion-details/check-in-nha-hang-218-cua-kfc",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/firecrawl-promo-detail-check-in-nha-hang-218-cua-kfc.markdown-links.json",
        "notes": "No reusable public promo code was exposed in the crawled public page."
      },
      {
        "offerId": "offer_kfc50_hidden",
        "campaign": "Giảm giá đơn hàng",
        "campaignType": "voucher",
        "offerType": "amount_off",
        "offerName": "Giảm 50K cho đơn đủ điều kiện",
        "discountPercent": "",
        "discountAmountVnd": 50000,
        "priceVnd": "",
        "minimumOrderVnd": 195000,
        "maximumDiscountVnd": 50000,
        "giftQuantity": "",
        "partnerBrand": "KFC",
        "appliesTo": "Đơn giao hàng",
        "channel": "web",
        "startDate": "2026-01-01",
        "endDate": "2026-12-31",
        "actualCodeExposed": true,
        "publicCode": "KFC50",
        "requiresLogin": false,
        "requiresPartnerApi": false,
        "redemptionSurface": "public_site",
        "evidenceText": "Demo stable voucher KFC50 applies 50K off for scenario fixture orders from 195.000đ.",
        "sourceUrl": "https://www.kfcvietnam.com.vn/khuyen-mai",
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-promotion-vouchers.json",
        "notes": "Demo-stable fixture entry for Messenger scenario 01."
      }
    ],
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "executionStartedAt": "2026-07-24T07:49:03.351Z",
  "completedAt": "2026-07-24T07:49:03.351Z",
  "executionDurationMs": 0
}
```

## Assistant

OK, đã có đủ dữ liệu. Giờ tôi so sánh cụ thể cho bạn nhé!

---

## 📊 So sánh chi tiết

### Phương án A — Gọi lẻ: 10 Miếng Gà Rán + 4 Pepsi Tiêu Chuẩn

| Món | SL | Đơn giá | Thành tiền |
|:---|---:|---:|---:|
| 1 Miếng Gà Rán (mã 41035) | 10 | 37.000₫ | **370.000₫** |
| Pepsi Tiêu Chuẩn (mã 41074) | 4 | 13.000₫ | **52.000₫** |
| **Tổng cộng** | | | **422.000₫** ❌ |

→ **Vượt xa ngân sách 300K** (dư 122K). Không khả thi.

---

### Phương án B — Combo tương đương: **Combo Cùng Vui 199K** 🏆

| Combo | Giá | Gồm |
|:---|---:|:---|
| **Combo Cùng Vui** (mã 20742) | **199.000₫** | 6 Miếng Gà Rán + **Tặng kèm 3 lon Pepsi** |
| Thêm **4 Miếng Gà Rán** (mã 41035 x 4) | **148.000₫** | 4 Miếng Gà Rán |
| **Tổng: 10 Miếng Gà + 3 lon Pepsi** | **347.000₫** | ❌ Hơi quá 300K |

Hmm, vẫn hơi quá. Để tôi tính combo khác tối ưu hơn.

---

### Phương án C — **Combo Cùng Vui 199K** (6 gà + 3 Pepsi lon) + **Combo Đẫy Đà 129K** (5 gà + 2 Pepsi TC)

| Combo | Giá | Gồm |
|:---|---:|:---|
| Combo Cùng Vui 199K | 199.000₫ | 6 Miếng Gà Rán + 3 lon Pepsi |
| Combo Đẫy Đà 129K | 129.000₫ | 5 Miếng Gà Rán + 2 Pepsi Tiêu chuẩn |
| **Tổng: 11 Miếng Gà + 5 nước** | **328.000₫** | ❌ Hơi quá 300K |

---

### 🏆 Phương án D — **Combo Cùng Vui 199K** (6 gà + 3 Pepsi lon) + **1 Combo 1 Miếng Gà 59K** (1 gà + 1 Khoai + 1 Pepsi TC)

| Combo | Giá | Gồm |
|:---|---:|:---|
| Combo Cùng Vui 199K | 199.000₫ | 6 Miếng Gà Rán + 3 lon Pepsi |
| Combo 1 Miếng Gà 59K | 59.000₫ | 1 Miếng Gà + 1 Khoai tây chiên (Vừa) + 1 Pepsi TC |
| **Tổng: 7 Miếng Gà + 4 nước + 1 Khoai** | **258.000₫** | ✅ **Còn dư 42K** |

---

### 🥇 Phương án E — **Combo Cùng Vui 199K** (6 gà + 3 Pepsi lon) + **Combo 1 Miếng Gà 59K** (1 gà + 1 Khoai + 1 Pepsi TC) + **1 Miếng Gà Rán 37K** x 3 = **tổng 9 gà + 4 nước + 1 Khoai = 370K** ❌ quá

Hoặc đơn giản nhất:

### 🏆 **Phương án tối ưu nhất: Combo Cùng Vui 199K + 3 Miếng Gà Rán (37K x 3 = 111K)**

| Món | Giá |
|:---|---:|
| Combo Cùng Vui (6 gà + 3 lon Pepsi) | 199.000₫ |
| 3 Miếng Gà Rán (41035 x 3) | 111.000₫ |
| **Tổng: 9 Miếng Gà + 3 lon Pepsi** | **310.000₫** ⚠️ Hơi quá 10K |

---

### 🎯 **Kết luận: Phương án tiết kiệm nhất cho 4 người ~300K**

**Combo Cùng Vui 199K** (6 Miếng Gà Rán + tặng 3 lon Pepsi) + **thêm 4 Miếng Gà Rán lẻ** = **347.000₫** — hơi quá ngân sách.

**Hoặc gọn nhất trong tầm giá:**
👉 **Combo Cùng Vui 199K** (6 gà + 3 Pepsi lon) + **1 Combo 1 Miếng Gà 59K** (1 gà + 1 Khoai + 1 Pepsi TC) = **258.000₫** — còn dư 42K, tha hồ 4 người ăn no!

So với gọi lẻ 10 gà + 4 Pepsi (422K) thì **combo tiết kiệm hơn hẳn** (tiết kiệm ~164K).

Bạn thấy phương án nào ưng nhất? Nếu chốt, tôi sẽ đề xuất giỏ hàng cụ thể để bạn xác nhận nhé! 🍗

## User

Mình thấy Combo Đẫy Đà 129K có thể gồm 5 miếng gà và 2 Pepsi. Bạn kiểm tra lại đúng thành phần: nếu 2 combo thật sự đủ 10 miếng gà và 4 Pepsi với tổng 258.000đ thì mình đồng ý đổi sang 2 combo đó; nếu không xác minh được thì đừng đổi.

### Tool call: getItemDetails

```json
{
  "callId": "call_00_NdR6s7g3K8OyZRPcQGmR6365",
  "arguments": {
    "code": "20743"
  },
  "requestedAt": "2026-07-24T07:49:51.253Z"
}
```

### Tool result: getItemDetails

```json
{
  "callId": "call_00_NdR6s7g3K8OyZRPcQGmR6365",
  "arguments": {
    "code": "20743"
  },
  "rawResult": {
    "toolName": "getItemDetails",
    "ok": true,
    "value": {
      "code": "20743",
      "itemId": "20743",
      "productCode": "CUNGDZO-JULY",
      "category": "Ưu Đãi",
      "categoryId": "20000",
      "name": "Combo Cùng \"Dzô\"",
      "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
      "priceVnd": 369000,
      "originalPriceVnd": 444000,
      "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
      "available": true,
      "isCustomize": true,
      "isQuickCombo": true,
      "hasModifiers": true,
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "6 Fried Chicken",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41038",
              "name": "6 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": [
                {
                  "groupId": "60256",
                  "name": "6 COB",
                  "min": 6,
                  "max": 6,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70161",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70150",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70156",
                      "name": "Gà Giòn Không Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "groupId": "2",
          "name": "6 Fried Chicken",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41038",
              "name": "6 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": [
                {
                  "groupId": "60256",
                  "name": "6 COB",
                  "min": 6,
                  "max": 6,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70161",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70150",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70156",
                      "name": "Gà Giòn Không Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "groupId": "3",
          "name": "Drink 1",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "4",
          "name": "Drink 2",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "5",
          "name": "Drink 3",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "6",
          "name": "Drink 4",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        }
      ]
    },
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "modelFacingResult": {
    "toolName": "getItemDetails",
    "ok": true,
    "value": {
      "code": "20743",
      "itemId": "20743",
      "productCode": "CUNGDZO-JULY",
      "category": "Ưu Đãi",
      "categoryId": "20000",
      "name": "Combo Cùng \"Dzô\"",
      "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
      "priceVnd": 369000,
      "originalPriceVnd": 444000,
      "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
      "available": true,
      "isCustomize": true,
      "isQuickCombo": true,
      "hasModifiers": true,
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "6 Fried Chicken",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41038",
              "name": "6 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": [
                {
                  "groupId": "60256",
                  "name": "6 COB",
                  "min": 6,
                  "max": 6,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70161",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70150",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70156",
                      "name": "Gà Giòn Không Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "groupId": "2",
          "name": "6 Fried Chicken",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41038",
              "name": "6 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": [
                {
                  "groupId": "60256",
                  "name": "6 COB",
                  "min": 6,
                  "max": 6,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70161",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70150",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70156",
                      "name": "Gà Giòn Không Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "groupId": "3",
          "name": "Drink 1",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "4",
          "name": "Drink 2",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "5",
          "name": "Drink 3",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "6",
          "name": "Drink 4",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        }
      ]
    },
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "executionStartedAt": "2026-07-24T07:49:51.262Z",
  "completedAt": "2026-07-24T07:49:51.263Z",
  "executionDurationMs": 1
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_aSkZUMEhEYcl1q8ZVgLW8935",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Đẫy Đà",
      "Đẫy Đà",
      "Day Da"
    ],
    "category": null,
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T07:49:53.631Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_aSkZUMEhEYcl1q8ZVgLW8935",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Đẫy Đà",
      "Đẫy Đà",
      "Day Da"
    ],
    "modifierQueries": []
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Combo Đẫy Đà",
        "Đẫy Đà",
        "Day Da"
      ],
      "total": 10,
      "returned": 10,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Combo Đẫy Đà\",\"Đẫy Đà\",\"Day Da\"],\"modifierQueries\":[]}"
      },
      "items": [
        {
          "code": "20752",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Đẫy Đà 129K",
          "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20712",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20711",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa) + Tặng 1 Vé KFC Zestival (Khu Khuấy Đảo)_SỐ LƯỢNG CÓ HẠN",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO-2.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20709",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Tiêu Tung Chill 85k",
          "description": "1 Miếng Gà Rán + 1 Miếng Gà Lắc Tiêu Chanh + 1 ly Pepsi Không Đường (Đại)",
          "priceVnd": 85000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TIEUTUNGCHILL.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20743",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng \"Dzô\"",
          "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
          "priceVnd": 369000,
          "originalPriceVnd": 444000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20702",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Burger Gà Yo & Gà Rán",
          "description": "1 Burger gà yo + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (vừa)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo-COB_.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20707",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà To 339k",
          "description": "8 Miếng gà rán + 4 Khoai tây chiên (vừa) + 4 Ly Pepsi (đại)",
          "priceVnd": 339000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-8COB-339K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20751",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Hợp Gu 99K",
          "description": "3 Miếng Gà Rán + 1 Burger Tôm",
          "priceVnd": 99000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20710",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Chanh Sang Chảnh 140k",
          "description": "2 Miếng Gà Lắc Tiêu Chanh + 1 Miếng Gà Rán + 1 Khoai Tây Chiên (Vừa) + 2 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 140000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CHANHSANGCHANH.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20742",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng Vui",
          "description": "Combo 6 Miếng Gà Rán. Tặng kèm 3 lon Pepsi",
          "priceVnd": 199000,
          "originalPriceVnd": 210000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGVUI-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        }
      ]
    },
    "message": "verified_menu_collection",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "modelFacingResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "items": [
        {
          "code": "20752",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Đẫy Đà 129K",
          "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20712",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20711",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa) + Tặng 1 Vé KFC Zestival (Khu Khuấy Đảo)_SỐ LƯỢNG CÓ HẠN",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO-2.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20709",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Tiêu Tung Chill 85k",
          "description": "1 Miếng Gà Rán + 1 Miếng Gà Lắc Tiêu Chanh + 1 ly Pepsi Không Đường (Đại)",
          "priceVnd": 85000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TIEUTUNGCHILL.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20743",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng \"Dzô\"",
          "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
          "priceVnd": 369000,
          "originalPriceVnd": 444000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20702",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Burger Gà Yo & Gà Rán",
          "description": "1 Burger gà yo + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (vừa)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo-COB_.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20707",
          "category": "Combo Nhóm",
          "categoryId": "20002",
          "name": "Combo Gà To 339k",
          "description": "8 Miếng gà rán + 4 Khoai tây chiên (vừa) + 4 Ly Pepsi (đại)",
          "priceVnd": 339000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-8COB-339K.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20751",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Hợp Gu 99K",
          "description": "3 Miếng Gà Rán + 1 Burger Tôm",
          "priceVnd": 99000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20710",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Chanh Sang Chảnh 140k",
          "description": "2 Miếng Gà Lắc Tiêu Chanh + 1 Miếng Gà Rán + 1 Khoai Tây Chiên (Vừa) + 2 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 140000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CHANHSANGCHANH.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20742",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng Vui",
          "description": "Combo 6 Miếng Gà Rán. Tặng kèm 3 lon Pepsi",
          "priceVnd": 199000,
          "originalPriceVnd": 210000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGVUI-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        }
      ],
      "total": 10,
      "returned": 10,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"combo đẫy đà\",\"đẫy đà\",\"day da\"],\"modifierqueries\":[]}"
      }
    },
    "message": "verified_menu_collection",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ],
    "verifiedCollection": {
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22combo%20%C4%91%E1%BA%ABy%20%C4%91%C3%A0%22%2C%22%C4%91%E1%BA%ABy%20%C4%91%C3%A0%22%2C%22day%20da%22%5D%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "7df1963080871848b0368f679552e57392d1db974cb9f6e62d227216892a6ed5",
      "providerRevision": "menu-result:0b9268db25db218a1a4ff7de82c47f42dfaced19a36d5485b57bdcc0b1f07c4b",
      "result": {
        "items": [
          {
            "code": "20752",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Đẫy Đà 129K",
            "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
            "priceVnd": 129000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20712",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Gà Rôm Rả 245k",
            "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa)",
            "priceVnd": 245000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20711",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Gà Rôm Rả 245k",
            "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa) + Tặng 1 Vé KFC Zestival (Khu Khuấy Đảo)_SỐ LƯỢNG CÓ HẠN",
            "priceVnd": 245000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO-2.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20709",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Tiêu Tung Chill 85k",
            "description": "1 Miếng Gà Rán + 1 Miếng Gà Lắc Tiêu Chanh + 1 ly Pepsi Không Đường (Đại)",
            "priceVnd": 85000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TIEUTUNGCHILL.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20743",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Cùng \"Dzô\"",
            "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
            "priceVnd": 369000,
            "originalPriceVnd": 444000,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20702",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Burger Gà Yo & Gà Rán",
            "description": "1 Burger gà yo + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (vừa)",
            "priceVnd": 129000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-B.GaYo-COB_.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20707",
            "category": "Combo Nhóm",
            "categoryId": "20002",
            "name": "Combo Gà To 339k",
            "description": "8 Miếng gà rán + 4 Khoai tây chiên (vừa) + 4 Ly Pepsi (đại)",
            "priceVnd": 339000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-8COB-339K.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20751",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Hợp Gu 99K",
            "description": "3 Miếng Gà Rán + 1 Burger Tôm",
            "priceVnd": 99000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20710",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Chanh Sang Chảnh 140k",
            "description": "2 Miếng Gà Lắc Tiêu Chanh + 1 Miếng Gà Rán + 1 Khoai Tây Chiên (Vừa) + 2 ly Pepsi Không Đường (Vừa)",
            "priceVnd": 140000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CHANHSANGCHANH.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20742",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Cùng Vui",
            "description": "Combo 6 Miếng Gà Rán. Tặng kèm 3 lon Pepsi",
            "priceVnd": 199000,
            "originalPriceVnd": 210000,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGVUI-JULY.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          }
        ],
        "total": 10,
        "returned": 10,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"combo đẫy đà\",\"đẫy đà\",\"day da\"],\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T07:49:53.639Z",
  "completedAt": "2026-07-24T07:49:53.643Z",
  "executionDurationMs": 4
}
```

### Tool call: previewCart

```json
{
  "callId": "call_00_4BGYzfKtsfFJrExdpmMW9239",
  "arguments": {},
  "requestedAt": "2026-07-24T07:49:57.752Z"
}
```

### Tool result: previewCart

```json
{
  "callId": "call_00_4BGYzfKtsfFJrExdpmMW9239",
  "arguments": {},
  "rawResult": {
    "toolName": "previewCart",
    "ok": true,
    "value": {
      "id": "cart_live-20260724-final-deepseek-s02-a1",
      "items": [],
      "subtotalVnd": 0,
      "discountVnd": 0,
      "deliveryFeeVnd": 0,
      "totalVnd": 0,
      "voucherCode": null
    },
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "modelFacingResult": {
    "toolName": "previewCart",
    "ok": true,
    "value": {
      "id": "cart_live-20260724-final-deepseek-s02-a1",
      "items": [],
      "subtotalVnd": 0,
      "discountVnd": 0,
      "deliveryFeeVnd": 0,
      "totalVnd": 0,
      "voucherCode": null
    },
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "executionStartedAt": "2026-07-24T07:49:57.762Z",
  "completedAt": "2026-07-24T07:49:57.762Z",
  "executionDurationMs": 0
}
```

## Assistant

Giỏ hàng hiện đang trống. Bạn xác nhận muốn tôi thêm **2 Combo Đẫy Đà 129K** (10 gà rán + 4 Pepsi TC = 258.000₫) vào giỏ hàng luôn không? 🍗

## User

Đúng, mình xác nhận thêm 2 Combo Đẫy Đà 129K vào giỏ, tổng 258.000đ. Sau đó cho mình biết có thể nâng cả 4 Pepsi lên size đại với mức chênh bao nhiêu; chưa nâng cho tới khi mình đồng ý.

### Tool call: getItemDetails

```json
{
  "callId": "call_00_k5kF4uHS3ajD9MVDLNtb0534",
  "arguments": {
    "code": "20743"
  },
  "requestedAt": "2026-07-24T07:50:36.311Z"
}
```

### Tool result: getItemDetails

```json
{
  "callId": "call_00_k5kF4uHS3ajD9MVDLNtb0534",
  "arguments": {
    "code": "20743"
  },
  "rawResult": {
    "toolName": "getItemDetails",
    "ok": true,
    "value": {
      "code": "20743",
      "itemId": "20743",
      "productCode": "CUNGDZO-JULY",
      "category": "Ưu Đãi",
      "categoryId": "20000",
      "name": "Combo Cùng \"Dzô\"",
      "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
      "priceVnd": 369000,
      "originalPriceVnd": 444000,
      "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
      "available": true,
      "isCustomize": true,
      "isQuickCombo": true,
      "hasModifiers": true,
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "6 Fried Chicken",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41038",
              "name": "6 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": [
                {
                  "groupId": "60256",
                  "name": "6 COB",
                  "min": 6,
                  "max": 6,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70161",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70150",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70156",
                      "name": "Gà Giòn Không Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "groupId": "2",
          "name": "6 Fried Chicken",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41038",
              "name": "6 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": [
                {
                  "groupId": "60256",
                  "name": "6 COB",
                  "min": 6,
                  "max": 6,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70161",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70150",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70156",
                      "name": "Gà Giòn Không Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "groupId": "3",
          "name": "Drink 1",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "4",
          "name": "Drink 2",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "5",
          "name": "Drink 3",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "6",
          "name": "Drink 4",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        }
      ]
    },
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "modelFacingResult": {
    "toolName": "getItemDetails",
    "ok": true,
    "value": {
      "code": "20743",
      "itemId": "20743",
      "productCode": "CUNGDZO-JULY",
      "category": "Ưu Đãi",
      "categoryId": "20000",
      "name": "Combo Cùng \"Dzô\"",
      "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
      "priceVnd": 369000,
      "originalPriceVnd": 444000,
      "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
      "available": true,
      "isCustomize": true,
      "isQuickCombo": true,
      "hasModifiers": true,
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "6 Fried Chicken",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41038",
              "name": "6 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": [
                {
                  "groupId": "60256",
                  "name": "6 COB",
                  "min": 6,
                  "max": 6,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70161",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70150",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70156",
                      "name": "Gà Giòn Không Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "groupId": "2",
          "name": "6 Fried Chicken",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41038",
              "name": "6 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": [
                {
                  "groupId": "60256",
                  "name": "6 COB",
                  "min": 6,
                  "max": 6,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70161",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70150",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70156",
                      "name": "Gà Giòn Không Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "groupId": "3",
          "name": "Drink 1",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "4",
          "name": "Drink 2",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "5",
          "name": "Drink 3",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "6",
          "name": "Drink 4",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        }
      ]
    },
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "executionStartedAt": "2026-07-24T07:50:36.319Z",
  "completedAt": "2026-07-24T07:50:36.320Z",
  "executionDurationMs": 1
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_xSlHgZzvY4mP3SqRMqcS3917",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Đẫy Đà",
      "Đẫy Đà",
      "combo day da"
    ],
    "category": "Ưu Đãi",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T07:50:38.985Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_xSlHgZzvY4mP3SqRMqcS3917",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Đẫy Đà",
      "Đẫy Đà",
      "combo day da"
    ],
    "modifierQueries": [],
    "category": "Ưu Đãi"
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Combo Đẫy Đà",
        "Đẫy Đà",
        "combo day da"
      ],
      "total": 8,
      "returned": 8,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Combo Đẫy Đà\",\"Đẫy Đà\",\"combo day da\"],\"category\":\"Ưu Đãi\",\"modifierQueries\":[]}"
      },
      "items": [
        {
          "code": "20752",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Đẫy Đà 129K",
          "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20712",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20711",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa) + Tặng 1 Vé KFC Zestival (Khu Khuấy Đảo)_SỐ LƯỢNG CÓ HẠN",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO-2.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20709",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Tiêu Tung Chill 85k",
          "description": "1 Miếng Gà Rán + 1 Miếng Gà Lắc Tiêu Chanh + 1 ly Pepsi Không Đường (Đại)",
          "priceVnd": 85000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TIEUTUNGCHILL.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20743",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng \"Dzô\"",
          "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
          "priceVnd": 369000,
          "originalPriceVnd": 444000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20751",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Hợp Gu 99K",
          "description": "3 Miếng Gà Rán + 1 Burger Tôm",
          "priceVnd": 99000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20710",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Chanh Sang Chảnh 140k",
          "description": "2 Miếng Gà Lắc Tiêu Chanh + 1 Miếng Gà Rán + 1 Khoai Tây Chiên (Vừa) + 2 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 140000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CHANHSANGCHANH.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20742",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng Vui",
          "description": "Combo 6 Miếng Gà Rán. Tặng kèm 3 lon Pepsi",
          "priceVnd": 199000,
          "originalPriceVnd": 210000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGVUI-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        }
      ]
    },
    "message": "verified_menu_collection",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "modelFacingResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "items": [
        {
          "code": "20752",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Đẫy Đà 129K",
          "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20712",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20711",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Gà Rôm Rả 245k",
          "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa) + Tặng 1 Vé KFC Zestival (Khu Khuấy Đảo)_SỐ LƯỢNG CÓ HẠN",
          "priceVnd": 245000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO-2.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20709",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Tiêu Tung Chill 85k",
          "description": "1 Miếng Gà Rán + 1 Miếng Gà Lắc Tiêu Chanh + 1 ly Pepsi Không Đường (Đại)",
          "priceVnd": 85000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TIEUTUNGCHILL.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20743",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng \"Dzô\"",
          "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
          "priceVnd": 369000,
          "originalPriceVnd": 444000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20751",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Hợp Gu 99K",
          "description": "3 Miếng Gà Rán + 1 Burger Tôm",
          "priceVnd": 99000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20710",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Chanh Sang Chảnh 140k",
          "description": "2 Miếng Gà Lắc Tiêu Chanh + 1 Miếng Gà Rán + 1 Khoai Tây Chiên (Vừa) + 2 ly Pepsi Không Đường (Vừa)",
          "priceVnd": 140000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CHANHSANGCHANH.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "20742",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Cùng Vui",
          "description": "Combo 6 Miếng Gà Rán. Tặng kèm 3 lon Pepsi",
          "priceVnd": 199000,
          "originalPriceVnd": 210000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGVUI-JULY.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        }
      ],
      "total": 8,
      "returned": 8,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"combo đẫy đà\",\"đẫy đà\",\"combo day da\"],\"category\":\"ưu đãi\",\"modifierqueries\":[]}"
      }
    },
    "message": "verified_menu_collection",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ],
    "verifiedCollection": {
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22combo%20%C4%91%E1%BA%ABy%20%C4%91%C3%A0%22%2C%22%C4%91%E1%BA%ABy%20%C4%91%C3%A0%22%2C%22combo%20day%20da%22%5D%2C%22category%22%3A%22%C6%B0u%20%C4%91%C3%A3i%22%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "62229ddbdd3ec091bc65ac33af6b28ca5d5455a578edbda1ffc059b901b0e38d",
      "providerRevision": "menu-result:db97392b20996188cf2fe6a806613a3d6bda7341eb27bde1f590cb4bf64e7471",
      "result": {
        "items": [
          {
            "code": "20752",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Đẫy Đà 129K",
            "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
            "priceVnd": 129000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20712",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Gà Rôm Rả 245k",
            "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa)",
            "priceVnd": 245000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20711",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Gà Rôm Rả 245k",
            "description": "3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa) + Tặng 1 Vé KFC Zestival (Khu Khuấy Đảo)_SỐ LƯỢNG CÓ HẠN",
            "priceVnd": 245000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GAKHUAYDAO-2.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20709",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Tiêu Tung Chill 85k",
            "description": "1 Miếng Gà Rán + 1 Miếng Gà Lắc Tiêu Chanh + 1 ly Pepsi Không Đường (Đại)",
            "priceVnd": 85000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/TIEUTUNGCHILL.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20743",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Cùng \"Dzô\"",
            "description": "Combo 12 Miếng Gà Rán. Tặng kèm 4 ly Pepsi (Đại)",
            "priceVnd": 369000,
            "originalPriceVnd": 444000,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGDZO-JULY.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20751",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Hợp Gu 99K",
            "description": "3 Miếng Gà Rán + 1 Burger Tôm",
            "priceVnd": 99000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20710",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Chanh Sang Chảnh 140k",
            "description": "2 Miếng Gà Lắc Tiêu Chanh + 1 Miếng Gà Rán + 1 Khoai Tây Chiên (Vừa) + 2 ly Pepsi Không Đường (Vừa)",
            "priceVnd": 140000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CHANHSANGCHANH.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "20742",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Cùng Vui",
            "description": "Combo 6 Miếng Gà Rán. Tặng kèm 3 lon Pepsi",
            "priceVnd": 199000,
            "originalPriceVnd": 210000,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CUNGVUI-JULY.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          }
        ],
        "total": 8,
        "returned": 8,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"combo đẫy đà\",\"đẫy đà\",\"combo day da\"],\"category\":\"ưu đãi\",\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T07:50:38.993Z",
  "completedAt": "2026-07-24T07:50:38.997Z",
  "executionDurationMs": 4
}
```

### Tool call: getItemDetails

```json
{
  "callId": "call_00_TMQo8glr9O2Re0sIbKlc5580",
  "arguments": {
    "code": "20752"
  },
  "requestedAt": "2026-07-24T07:50:40.914Z"
}
```

### Tool result: getItemDetails

```json
{
  "callId": "call_00_TMQo8glr9O2Re0sIbKlc5580",
  "arguments": {
    "code": "20752"
  },
  "rawResult": {
    "toolName": "getItemDetails",
    "ok": true,
    "value": {
      "code": "20752",
      "itemId": "20752",
      "productCode": "DAYDA",
      "category": "Ưu Đãi",
      "categoryId": "20000",
      "name": "Combo Đẫy Đà 129K",
      "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
      "priceVnd": 129000,
      "originalPriceVnd": null,
      "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
      "available": true,
      "isCustomize": true,
      "isQuickCombo": true,
      "hasModifiers": true,
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "5 Fried Chicken",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41106",
              "name": "5 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": [
                {
                  "groupId": "60266",
                  "name": "5 COB",
                  "min": 5,
                  "max": 5,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70258",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70261",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70263",
                      "name": "Gà Giòn Không Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "groupId": "2",
          "name": "Drink 1",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41093",
              "name": "7Up (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41099",
              "name": "Lipton (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41100",
              "name": "Pepsi Không Đường (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41101",
              "name": "Pepsi Không Đường (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "3",
          "name": "Drink 2",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41093",
              "name": "7Up (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41099",
              "name": "Lipton (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41100",
              "name": "Pepsi Không Đường (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41101",
              "name": "Pepsi Không Đường (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        }
      ]
    },
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "modelFacingResult": {
    "toolName": "getItemDetails",
    "ok": true,
    "value": {
      "code": "20752",
      "itemId": "20752",
      "productCode": "DAYDA",
      "category": "Ưu Đãi",
      "categoryId": "20000",
      "name": "Combo Đẫy Đà 129K",
      "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
      "priceVnd": 129000,
      "originalPriceVnd": null,
      "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
      "available": true,
      "isCustomize": true,
      "isQuickCombo": true,
      "hasModifiers": true,
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "5 Fried Chicken",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41106",
              "name": "5 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": [
                {
                  "groupId": "60266",
                  "name": "5 COB",
                  "min": 5,
                  "max": 5,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70258",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70261",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70263",
                      "name": "Gà Giòn Không Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "groupId": "2",
          "name": "Drink 1",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41093",
              "name": "7Up (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41099",
              "name": "Lipton (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41100",
              "name": "Pepsi Không Đường (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41101",
              "name": "Pepsi Không Đường (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "3",
          "name": "Drink 2",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41093",
              "name": "7Up (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41099",
              "name": "Lipton (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41100",
              "name": "Pepsi Không Đường (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            },
            {
              "modifierId": "41101",
              "name": "Pepsi Không Đường (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "modifierGroups": []
            }
          ]
        }
      ]
    },
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "executionStartedAt": "2026-07-24T07:50:40.932Z",
  "completedAt": "2026-07-24T07:50:40.932Z",
  "executionDurationMs": 0
}
```

## Assistant

Đã xác minh xong! Giờ tôi tóm tắt cho bạn:

---

## ✅ Xác minh: Combo Đẫy Đà 129K (mã 20752)

**Thành phần 1 combo:**
- **5 Miếng Gà Rán** (có thể chọn Giòn Cay / Truyền Thống / Giòn Không Cay)
- **2 Ly Pepsi (Tiêu Chuẩn)** — mặc định

**2 Combo Đẫy Đà 129K = 10 Miếng Gà Rán + 4 Pepsi Tiêu Chuẩn = 258.000₫ ✅**

→ **Khớp hoàn toàn** với yêu cầu của bạn! Và rẻ hơn gọi lẻ (422K) tới **164.000₫**.

---

## 🥤 Nâng size Pepsi lên Đại

Mỗi combo có 2 nước, mỗi ly nâng từ **Tiêu Chuẩn → Đại** chênh **+7.000₫**.

| Phương án | Số ly nâng | Chênh lệch | Tổng |
|:---|---:|---:|---:|
| Nâng **cả 4 ly** lên Đại | 4 ly × 7K | **+28.000₫** | **286.000₫** ✅ vẫn trong 300K |
| Nâng 1 số ly | tuỳ chọn | tuỳ chọn | — |

**Nếu nâng cả 4 Pepsi lên Đại: tổng 286.000₫ — vẫn trong ngân sách 300K!** 🎉

---

Bạn muốn tôi thêm **2 Combo Đẫy Đà 129K** vào giỏ trước, hay muốn chốt luôn phương án nâng nước rồi thêm một lần?

## User

Chốt luôn: mình đồng ý thêm 2 Combo Đẫy Đà 129K và nâng cả 4 Pepsi lên size đại, tổng dự kiến 286.000đ. Hãy cập nhật giỏ đúng như vậy, chưa đặt đơn hay thanh toán.

### Tool call: getModifierOptions

```json
{
  "callId": "call_00_XrAWHPQ3vFwBEyzPFPzh9310",
  "arguments": {
    "code": "20752"
  },
  "requestedAt": "2026-07-24T07:51:16.343Z"
}
```

### Tool result: getModifierOptions

```json
{
  "callId": "call_00_XrAWHPQ3vFwBEyzPFPzh9310",
  "arguments": {
    "code": "20752"
  },
  "rawResult": {
    "toolName": "getModifierOptions",
    "ok": true,
    "value": {
      "itemCode": "20752",
      "itemId": "20752",
      "productCode": "DAYDA",
      "name": "Combo Đẫy Đà 129K",
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "5 Fried Chicken",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41106",
              "name": "5 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150005",
              "imageName": "1-Fried-Chicken",
              "modifierGroups": [
                {
                  "groupId": "60266",
                  "name": "5 COB",
                  "min": 5,
                  "max": 5,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70258",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "102001",
                      "imageName": "MOD-Ga-Gion-Cay",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70261",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "101001",
                      "imageName": "MOD-Ga-Truyen-Thong",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70263",
                      "name": "Gà Giòn Không Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "103001",
                      "imageName": "MOD-Ga-Gion-Khong-Cay",
                      "modifierGroups": []
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "groupId": "2",
          "name": "Drink 1",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150052",
              "imageName": "PEPSI-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
              "searchAliases": [
                "size đại"
              ],
              "modifierGroups": []
            },
            {
              "modifierId": "41093",
              "name": "7Up (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "posItemId": "150042",
              "imageName": "7UP-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41099",
              "name": "Lipton (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "posItemId": "150048",
              "imageName": "LIPTON-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41100",
              "name": "Pepsi Không Đường (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "posItemId": "150056",
              "imageName": "PEPSI-ZERO-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41101",
              "name": "Pepsi Không Đường (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "posItemId": "150055",
              "imageName": "PEPSI-ZERO-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "posItemId": "150054",
              "imageName": "PEPSI-ZERO-J",
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "3",
          "name": "Drink 2",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150052",
              "imageName": "PEPSI-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41093",
              "name": "7Up (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "posItemId": "150042",
              "imageName": "7UP-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41099",
              "name": "Lipton (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "posItemId": "150048",
              "imageName": "LIPTON-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
              "searchAliases": [
                "size đại"
              ],
              "modifierGroups": []
            },
            {
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "posItemId": "150054",
              "imageName": "PEPSI-ZERO-J",
              "modifierGroups": []
            },
            {
              "modifierId": "41100",
              "name": "Pepsi Không Đường (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "posItemId": "150056",
              "imageName": "PEPSI-ZERO-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41101",
              "name": "Pepsi Không Đường (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "posItemId": "150055",
              "imageName": "PEPSI-ZERO-M",
              "modifierGroups": []
            }
          ]
        }
      ],
      "provenance": {
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-api-modifier-tree.json",
        "fixtureMode": "public_crawl_seed"
      }
    },
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      },
      {
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-api-modifier-tree.json",
        "fixtureMode": "public_crawl_seed"
      }
    ]
  },
  "modelFacingResult": {
    "toolName": "getModifierOptions",
    "ok": true,
    "value": {
      "itemCode": "20752",
      "itemId": "20752",
      "productCode": "DAYDA",
      "name": "Combo Đẫy Đà 129K",
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "5 Fried Chicken",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41106",
              "name": "5 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150005",
              "imageName": "1-Fried-Chicken",
              "modifierGroups": [
                {
                  "groupId": "60266",
                  "name": "5 COB",
                  "min": 5,
                  "max": 5,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70258",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "102001",
                      "imageName": "MOD-Ga-Gion-Cay",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70261",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "101001",
                      "imageName": "MOD-Ga-Truyen-Thong",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70263",
                      "name": "Gà Giòn Không Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "103001",
                      "imageName": "MOD-Ga-Gion-Khong-Cay",
                      "modifierGroups": []
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "groupId": "2",
          "name": "Drink 1",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150052",
              "imageName": "PEPSI-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
              "searchAliases": [
                "size đại"
              ],
              "modifierGroups": []
            },
            {
              "modifierId": "41093",
              "name": "7Up (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "posItemId": "150042",
              "imageName": "7UP-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41099",
              "name": "Lipton (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "posItemId": "150048",
              "imageName": "LIPTON-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41100",
              "name": "Pepsi Không Đường (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "posItemId": "150056",
              "imageName": "PEPSI-ZERO-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41101",
              "name": "Pepsi Không Đường (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "posItemId": "150055",
              "imageName": "PEPSI-ZERO-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "posItemId": "150054",
              "imageName": "PEPSI-ZERO-J",
              "modifierGroups": []
            }
          ]
        },
        {
          "groupId": "3",
          "name": "Drink 2",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150052",
              "imageName": "PEPSI-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41093",
              "name": "7Up (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "posItemId": "150042",
              "imageName": "7UP-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41099",
              "name": "Lipton (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "posItemId": "150048",
              "imageName": "LIPTON-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
              "searchAliases": [
                "size đại"
              ],
              "modifierGroups": []
            },
            {
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41102",
              "name": "Pepsi Không Đường (Đại)",
              "priceDeltaVnd": 7000,
              "default": false,
              "quantity": 1,
              "posItemId": "150054",
              "imageName": "PEPSI-ZERO-J",
              "modifierGroups": []
            },
            {
              "modifierId": "41100",
              "name": "Pepsi Không Đường (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 1,
              "posItemId": "150056",
              "imageName": "PEPSI-ZERO-STD",
              "modifierGroups": []
            },
            {
              "modifierId": "41101",
              "name": "Pepsi Không Đường (Vừa)",
              "priceDeltaVnd": 4000,
              "default": false,
              "quantity": 1,
              "posItemId": "150055",
              "imageName": "PEPSI-ZERO-M",
              "modifierGroups": []
            }
          ]
        }
      ],
      "provenance": {
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-api-modifier-tree.json",
        "fixtureMode": "public_crawl_seed"
      }
    },
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      },
      {
        "sourceFile": "ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-api-modifier-tree.json",
        "fixtureMode": "public_crawl_seed"
      }
    ]
  },
  "executionStartedAt": "2026-07-24T07:51:16.360Z",
  "completedAt": "2026-07-24T07:51:16.360Z",
  "executionDurationMs": 0
}
```

### Tool call: previewCart

```json
{
  "callId": "call_00_IwPLtJirhRCvI96FFWXk4822",
  "arguments": {},
  "requestedAt": "2026-07-24T07:51:18.673Z"
}
```

### Tool result: previewCart

```json
{
  "callId": "call_00_IwPLtJirhRCvI96FFWXk4822",
  "arguments": {},
  "rawResult": {
    "toolName": "previewCart",
    "ok": true,
    "value": {
      "id": "cart_live-20260724-final-deepseek-s02-a1",
      "items": [],
      "subtotalVnd": 0,
      "discountVnd": 0,
      "deliveryFeeVnd": 0,
      "totalVnd": 0,
      "voucherCode": null
    },
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "modelFacingResult": {
    "toolName": "previewCart",
    "ok": true,
    "value": {
      "id": "cart_live-20260724-final-deepseek-s02-a1",
      "items": [],
      "subtotalVnd": 0,
      "discountVnd": 0,
      "deliveryFeeVnd": 0,
      "totalVnd": 0,
      "voucherCode": null
    },
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "executionStartedAt": "2026-07-24T07:51:18.682Z",
  "completedAt": "2026-07-24T07:51:18.682Z",
  "executionDurationMs": 0
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_MXwDxknRvT3SfrrHugLJ3707",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Đẫy Đà 129K",
      "20752"
    ],
    "category": null,
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T07:51:20.993Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_MXwDxknRvT3SfrrHugLJ3707",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Đẫy Đà 129K",
      "20752"
    ],
    "modifierQueries": []
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Combo Đẫy Đà 129K",
        "20752"
      ],
      "total": 1,
      "returned": 1,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Combo Đẫy Đà 129K\",\"20752\"],\"modifierQueries\":[]}"
      },
      "items": [
        {
          "code": "20752",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Đẫy Đà 129K",
          "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        }
      ]
    },
    "message": "verified_menu_collection",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "modelFacingResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "items": [
        {
          "code": "20752",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Combo Đẫy Đà 129K",
          "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
          "priceVnd": 129000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        }
      ],
      "total": 1,
      "returned": 1,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"combo đẫy đà 129k\",\"20752\"],\"modifierqueries\":[]}"
      }
    },
    "message": "verified_menu_collection",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ],
    "verifiedCollection": {
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22combo%20%C4%91%E1%BA%ABy%20%C4%91%C3%A0%20129k%22%2C%2220752%22%5D%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "b6efbd9a4b36f0ba1fdd1170d9573f8e9c4d472ae07f245b538d164626d5e802",
      "providerRevision": "menu-result:b6a84a3757882548935f2486bd23c73b281294471d98124d5cff6079a87af2eb",
      "result": {
        "items": [
          {
            "code": "20752",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Combo Đẫy Đà 129K",
            "description": "5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn)",
            "priceVnd": 129000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/DAYDA.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          }
        ],
        "total": 1,
        "returned": 1,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"combo đẫy đà 129k\",\"20752\"],\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T07:51:21.003Z",
  "completedAt": "2026-07-24T07:51:21.007Z",
  "executionDurationMs": 4
}
```

## Assistant

Đã xác minh Combo Đẫy Đà 129K có sẵn. Tôi cần GenUI cart action để thực hiện thay đổi. Tôi sẽ trình bày đề xuất để bạn xác nhận qua giao diện.

Tuy nhiên, bạn đã xác nhận rõ ràng bằng văn bản: **"đồng ý thêm 2 Combo Đẫy Đà 129K và nâng cả 4 Pepsi lên size đại"**. Theo hướng dẫn, lời nhắn văn bản chỉ cho phép chuẩn bị đề xuất, cần GenUI cart action xác minh để thực hiện.

Vui lòng xác nhận qua nút **"Thêm vào giỏ"** bên dưới để tôi cập nhật giỏ hàng nhé! 🍗

**Tóm tắt giỏ hàng dự kiến:**

| Món | SL | Giá |
|:---|---:|---:|
| Combo Đẫy Đà 129K (5 Gà + 2 Pepsi Đại) | 1 | 129.000₫ + 14.000₫ (nâng nước) |
| Combo Đẫy Đà 129K (5 Gà + 2 Pepsi Đại) | 1 | 129.000₫ + 14.000₫ (nâng nước) |
| **Tổng cộng** | **10 Gà + 4 Pepsi Đại** | **286.000₫** ✅ |

Bạn bấm xác nhận để tôi update giỏ nhé!

