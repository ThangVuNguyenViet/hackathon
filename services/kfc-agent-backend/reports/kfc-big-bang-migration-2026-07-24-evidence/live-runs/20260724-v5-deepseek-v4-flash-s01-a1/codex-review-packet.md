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

Bạn có thể giúp tôi chọn một đơn giao tận nơi cho 2 người, ngân sách dưới 200.000đ, có gà và Pepsi không?

### Tool call: searchMenu

```json
{
  "callId": "call_00_yJv6c2HsvRt1tZ6Pe8xv2302",
  "arguments": {
    "mode": "search",
    "queries": [
      "gà",
      "Pepsi",
      "combo"
    ],
    "category": "Combo",
    "maxPriceVnd": 200000,
    "partySize": 2,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T03:11:58.920Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_yJv6c2HsvRt1tZ6Pe8xv2302",
  "arguments": {
    "mode": "search",
    "queries": [
      "gà",
      "Pepsi",
      "combo"
    ],
    "modifierQueries": [],
    "category": "Combo",
    "maxPriceVnd": 200000,
    "partySize": 2
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "gà",
        "Pepsi",
        "combo"
      ],
      "total": 19,
      "returned": 19,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"gà\",\"Pepsi\",\"combo\"],\"category\":\"Combo\",\"maxPriceVnd\":200000,\"partySize\":2,\"modifierQueries\":[]}"
      },
      "items": [
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
        }
      ],
      "total": 19,
      "returned": 19,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"gà\",\"pepsi\",\"combo\"],\"category\":\"combo\",\"maxpricevnd\":200000,\"partysize\":2,\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22g%C3%A0%22%2C%22pepsi%22%2C%22combo%22%5D%2C%22category%22%3A%22combo%22%2C%22maxpricevnd%22%3A200000%2C%22partysize%22%3A2%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "0f586cacf3ba7b4534fc5e93f54897e0221bf24eb5d13cbe0f971f0ca26a9b64",
      "providerRevision": "menu-result:8f5ef7be60c00f9c346b9fea9c27f59459bd7fd497d4d4dc8c5333fd89d3f41f",
      "result": {
        "items": [
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
          }
        ],
        "total": 19,
        "returned": 19,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"gà\",\"pepsi\",\"combo\"],\"category\":\"combo\",\"maxpricevnd\":200000,\"partysize\":2,\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T03:11:58.925Z",
  "completedAt": "2026-07-24T03:11:58.931Z",
  "executionDurationMs": 6
}
```

## Assistant

Tuyệt vời! Mình đã tìm được nhiều lựa chọn phù hợp cho 2 người với ngân sách dưới 200.000đ, có gà và Pepsi. Dưới đây là các combo nhóm đáng chú ý nhất:

---

### 🍗 Các Combo Nhóm cho 2 người (có gà + Pepsi):

| Combo | Giá | Mô tả |
|-------|:---:|-------|
| **🔥 Combo Nhóm 2 No Nê** | **169.000đ** | 4 Miếng gà + 1 Khoai tây chiên (vừa) + **2 Ly Pepsi** |
| **🔥 Combo Nhóm 2 Vui Vẻ** | **159.000đ** | 3 Miếng gà rán + 1 Mì ý gà viên + 1 Khoai tây chiên (vừa) + **2 Ly Pepsi** |
| **🔥 Combo Hai Mình Chill** | **146.000đ** | 2 Mì ý xúc xích + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + **2 Ly Pepsi** |
| **🔥 Combo Burger Gà Yo & Gà Rán** | **129.000đ** | 1 Burger gà yo + 2 Miếng gà rán + 1 Khoai tây chiên (vừa) + **2 Ly Pepsi (vừa)** |
| **🔥 Combo Gà Chill 199k** | **199.000đ** | 3 Miếng gà rán + 2 Mì ý xúc xích + 1 Khoai tây chiên (vừa) + **3 Ly Pepsi** |

---

### 🌟 Gợi ý của mình:

- **Nếu thích nhiều gà**: **Combo Nhóm 2 No Nê** (169.000đ) — 4 miếng gà + 2 Pepsi, siêu đầy đặn!
- **Nếu muốn đa dạng**: **Combo Nhóm 2 Vui Vẻ** (159.000đ) — gà rán + mì ý + 2 Pepsi
- **Tiết kiệm nhất**: **Combo Burger Gà Yo & Gà Rán** (129.000đ) — vừa có burger vừa có gà rán

Bạn thích combo nào nhất? Mình sẽ giúp bạn kiểm tra cửa hàng gần nhất và đặt giao tận nơi nhé! 🚚

