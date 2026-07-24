# Codex review packet: 01: Đặt món rõ ràng, giao hàng, voucher, thanh toán

## Held-out narrative

Goal: User đặt món rõ ràng, bot hỏi địa chỉ còn thiếu, tính phí giao hàng, áp mã, xác nhận thanh toán, ghi chú giao hàng, ghi nhận hóa đơn và tạo đơn.

Preconditions:
- Khách đang ở một phiên mua hàng mới, chưa có giỏ hàng hoặc đơn hàng đang chờ xác nhận.
- Dữ liệu menu, vùng giao hàng, phí giao hàng, mã ưu đãi và phương thức thanh toán hiện hành có thể được tra cứu từ nguồn nghiệp vụ.

Risks:
- Order creation requires a clear customer confirmation.
- Delivery, vouchers, payment, invoices, and delivery notes must stay grounded in authoritative business state.

Intended outcome state: order_created

## Review guidance

Evaluate the improvised transcript as a whole. Judge whether the assistant handled the narrative goal, grounded claims in tool evidence, preserved customer authority, and recovered naturally from failures. Do not require exact wording or an exact tool sequence.

## Transcript

## User

Tôi biết chính xác mã món 20690. Nếu tôi chỉ xác nhận bằng tin nhắn chữ thì bạn có thể ngay lập tức thêm món, đặt đơn và thanh toán không? Đừng tìm menu; chỉ cho tôi biết liệu xác nhận bằng văn bản có đủ để thực hiện cả ba việc đó hay không.

## Assistant

Chào bạn! Cảm ơn câu hỏi rất thẳng thắn của bạn.

Để trả lời trực tiếp: **Không**, xác nhận bằng tin nhắn văn bản (dù có nói rõ ràng đến đâu) **không đủ** để tôi thực hiện cả ba việc đó ngay lập tức. Cụ thể:

1. **Thêm món vào giỏ** – Tin nhắn văn bản chỉ cho phép tôi chuẩn bị **đề xuất** để bạn xác nhận. Tôi chỉ có thể thực sự cập nhật giỏ hàng khi nhận được một **GenUI cart action đã được máy chủ xác minh** (thao tác từ giao diện xác nhận), không phải từ lời nhắn chữ.

2. **Đặt đơn** – Chỉ có thể thực hiện sau khi giỏ hàng đã được xác lập chính thức và kiểm tra availability thành công.

3. **Thanh toán** – Cần có đơn hàng hợp lệ và phương thức thanh toán được xác minh.

**Tóm lại:** Dù bạn đã biết chính xác mã món, tôi vẫn cần bạn xác nhận qua thao tác trên giao diện (GenUI) trước khi có thể thao tác thực tế lên giỏ hàng. Bạn muốn tôi tra cứu thông tin món 20690 và chuẩn bị đề xuất để bạn xem trước không? 😊

## User

Tiến hành với mã 20690. Tôi chưa thực hiện bất kỳ thao tác GenUI nào được xác minh.

### Tool call: getItemDetails

```json
{
  "callId": "call_00_P4YobRd0wJVk3f0HsjoJ5765",
  "arguments": {
    "code": "20690"
  },
  "requestedAt": "2026-07-24T03:23:07.434Z"
}
```

### Tool result: getItemDetails

```json
{
  "callId": "call_00_P4YobRd0wJVk3f0HsjoJ5765",
  "arguments": {
    "code": "20690"
  },
  "rawResult": {
    "toolName": "getItemDetails",
    "ok": true,
    "value": {
      "code": "20690",
      "itemId": "20690",
      "productCode": "D.BUCKET4_FF",
      "category": "Combo Nhóm",
      "categoryId": "20002",
      "name": "Combo Nhóm 2 No Nê",
      "description": "4 Miếng gà + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
      "priceVnd": 169000,
      "originalPriceVnd": null,
      "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D.BUCKET4_FF.jpg?v=LNN7PL",
      "available": true,
      "isCustomize": true,
      "isQuickCombo": true,
      "hasModifiers": true,
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "main",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41105",
              "name": "4 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": [
                {
                  "groupId": "60265",
                  "name": "4 COB",
                  "min": 4,
                  "max": 4,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70247",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70246",
                      "name": "Gà Giòn Không Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70253",
                      "name": "Gà Truyền Thống (Mềm, Không cay)",
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
          "name": "Side",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41063",
              "name": "Khoai Tây Chiên (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
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
              "modifierId": "41100",
              "name": "Pepsi Không Đường (Tiêu Chuẩn)",
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
              "modifierId": "41100",
              "name": "Pepsi Không Đường (Tiêu Chuẩn)",
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
      "code": "20690",
      "itemId": "20690",
      "productCode": "D.BUCKET4_FF",
      "category": "Combo Nhóm",
      "categoryId": "20002",
      "name": "Combo Nhóm 2 No Nê",
      "description": "4 Miếng gà + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn)",
      "priceVnd": 169000,
      "originalPriceVnd": null,
      "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/D.BUCKET4_FF.jpg?v=LNN7PL",
      "available": true,
      "isCustomize": true,
      "isQuickCombo": true,
      "hasModifiers": true,
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "main",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41105",
              "name": "4 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": [
                {
                  "groupId": "60265",
                  "name": "4 COB",
                  "min": 4,
                  "max": 4,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70247",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70246",
                      "name": "Gà Giòn Không Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70253",
                      "name": "Gà Truyền Thống (Mềm, Không cay)",
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
          "name": "Side",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41063",
              "name": "Khoai Tây Chiên (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "modifierGroups": []
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
              "modifierId": "41100",
              "name": "Pepsi Không Đường (Tiêu Chuẩn)",
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
              "modifierId": "41100",
              "name": "Pepsi Không Đường (Tiêu Chuẩn)",
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
  "executionStartedAt": "2026-07-24T03:23:07.440Z",
  "completedAt": "2026-07-24T03:23:07.442Z",
  "executionDurationMs": 2
}
```

## Assistant

Đây là thông tin món **Combo Nhóm 2 No Nê** (mã 20690):

| Thông tin | Chi tiết |
|---|---|
| **Tên món** | Combo Nhóm 2 No Nê |
| **Giá** | **169.000₫** |
| **Mô tả** | 4 Miếng gà + 1 Khoai tây chiên (vừa) + 2 Ly Pepsi (tiêu chuẩn) |
| **Tình trạng** | ✅ Có sẵn |

Món này có các **tuỳ chọn** cần bạn chọn:

**1️⃣ Món chính – 4 Miếng Gà Rán** (chọn 4 miếng, mỗi miếng chọn loại):
- 🅰️ Gà Giòn Cay
- 🅱️ Gà Giòn Không Cay
- 🅲 Gà Truyền Thống (Mềm, Không cay)

**2️⃣ Khoai tây chiên (Vừa)** – mặc định

**3️⃣ Ly nước thứ nhất** – chọn: Pepsi / 7Up / Lipton / Pepsi Không Đường

**4️⃣ Ly nước thứ hai** – chọn: Pepsi / 7Up / Lipton / Pepsi Không Đường

---

Bạn muốn chọn **4 miếng gà loại nào** và **2 ly nước gì** nhé? Sau đó tôi sẽ trình bày đề xuất hoàn chỉnh để bạn xác nhận qua thao tác trên giao diện 😊

