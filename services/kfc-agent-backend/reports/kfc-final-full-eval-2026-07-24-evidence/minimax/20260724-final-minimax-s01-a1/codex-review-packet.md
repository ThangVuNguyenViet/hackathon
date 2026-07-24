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

Cho mình 1 Combo Burger Gà Yo & Gà Rán, phần gà giòn cay, thêm 1 Burger Gà Zinger và 2 Pepsi giao về Quận 7 nhé.

### Tool call: searchMenu

```json
{
  "callId": "call_function_9aggwaubxa20_1",
  "arguments": {
    "category": null,
    "maxPriceVnd": null,
    "mode": "search",
    "modifierQueries": [],
    "partySize": null,
    "queries": [
      "Combo Burger Gà Yo & Gà Rán",
      "Burger Gà Zinger",
      "Pepsi"
    ]
  },
  "requestedAt": "2026-07-24T07:47:57.771Z"
}
```

### Tool call: getSavedAddresses

```json
{
  "callId": "call_function_9aggwaubxa20_2",
  "arguments": {},
  "requestedAt": "2026-07-24T07:47:57.773Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_function_9aggwaubxa20_1",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Burger Gà Yo & Gà Rán",
      "Burger Gà Zinger",
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
        "Combo Burger Gà Yo & Gà Rán",
        "Burger Gà Zinger",
        "Pepsi"
      ],
      "total": 51,
      "returned": 51,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Combo Burger Gà Yo & Gà Rán\",\"Burger Gà Zinger\",\"Pepsi\"],\"modifierQueries\":[]}"
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
          "code": "41141",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Gà Zinger",
          "description": "1 Burger Gà Zinger + 1 Gói tương (cà/ ớt)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Zinger.jpg?v=LNN7PL",
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
          "code": "41042",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Gà Yo",
          "description": "1 phần Burger Gà Yo (cay)/1 phần Burger Gà Yo (không cay)",
          "priceVnd": 30000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BURGER-GAYO.jpg?v=LNN7PL",
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
          "code": "41043",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Phi-lê Gà Quay",
          "description": "1 Burger Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Flava.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41046",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Mì Ý Xúc Xích Gà",
          "description": "1 Mì Ý Xúc Xích Gà",
          "priceVnd": 38000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41047",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Mì Ý Gà Viên",
          "description": "1 Mì Ý Gà Viên",
          "priceVnd": 43000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta-Popcorn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41050",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "1 Cơm Gà Viên Nanban",
          "description": "1 Cơm Gà Viên Nanban + 1 Gói tương (cà/ ớt)",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/NANBAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41051",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "1 Cơm Phi-lê Gà Quay",
          "description": "1 Cơm Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
          "priceVnd": 54000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Rice-Flava.jpg?v=LNN7PL",
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
          "code": "41141",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Gà Zinger",
          "description": "1 Burger Gà Zinger + 1 Gói tương (cà/ ớt)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Zinger.jpg?v=LNN7PL",
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
          "code": "41042",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Gà Yo",
          "description": "1 phần Burger Gà Yo (cay)/1 phần Burger Gà Yo (không cay)",
          "priceVnd": 30000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BURGER-GAYO.jpg?v=LNN7PL",
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
          "code": "41043",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Phi-lê Gà Quay",
          "description": "1 Burger Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Flava.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41046",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Mì Ý Xúc Xích Gà",
          "description": "1 Mì Ý Xúc Xích Gà",
          "priceVnd": 38000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41047",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Mì Ý Gà Viên",
          "description": "1 Mì Ý Gà Viên",
          "priceVnd": 43000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta-Popcorn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41050",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "1 Cơm Gà Viên Nanban",
          "description": "1 Cơm Gà Viên Nanban + 1 Gói tương (cà/ ớt)",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/NANBAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41051",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "1 Cơm Phi-lê Gà Quay",
          "description": "1 Cơm Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
          "priceVnd": 54000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Rice-Flava.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        }
      ],
      "total": 51,
      "returned": 51,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"combo burger gà yo & gà rán\",\"burger gà zinger\",\"pepsi\"],\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22combo%20burger%20g%C3%A0%20yo%20%26%20g%C3%A0%20r%C3%A1n%22%2C%22burger%20g%C3%A0%20zinger%22%2C%22pepsi%22%5D%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "8988568d4bbb466ff5ccf3fccedcdf2c684da36300ee48d52eab2a7145eb9200",
      "providerRevision": "menu-result:cf253142c9c18acf94bf0a42de1921e1b8690c1ffbdc9ae941ad10471a0fbead",
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
            "code": "41141",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Burger Gà Zinger",
            "description": "1 Burger Gà Zinger + 1 Gói tương (cà/ ớt)",
            "priceVnd": 56000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Zinger.jpg?v=LNN7PL",
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
            "code": "41042",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Burger Gà Yo",
            "description": "1 phần Burger Gà Yo (cay)/1 phần Burger Gà Yo (không cay)",
            "priceVnd": 30000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BURGER-GAYO.jpg?v=LNN7PL",
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
            "code": "41043",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Burger Phi-lê Gà Quay",
            "description": "1 Burger Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
            "priceVnd": 56000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Flava.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41046",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Mì Ý Xúc Xích Gà",
            "description": "1 Mì Ý Xúc Xích Gà",
            "priceVnd": 38000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41047",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Mì Ý Gà Viên",
            "description": "1 Mì Ý Gà Viên",
            "priceVnd": 43000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta-Popcorn.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41050",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "1 Cơm Gà Viên Nanban",
            "description": "1 Cơm Gà Viên Nanban + 1 Gói tương (cà/ ớt)",
            "priceVnd": 40000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/NANBAN.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41051",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "1 Cơm Phi-lê Gà Quay",
            "description": "1 Cơm Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
            "priceVnd": 54000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Rice-Flava.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          }
        ],
        "total": 51,
        "returned": 51,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"combo burger gà yo & gà rán\",\"burger gà zinger\",\"pepsi\"],\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T07:47:57.781Z",
  "completedAt": "2026-07-24T07:47:57.803Z",
  "executionDurationMs": 22
}
```

### Tool result: getSavedAddresses

```json
{
  "callId": "call_function_9aggwaubxa20_2",
  "arguments": {},
  "rawResult": {
    "toolName": "getSavedAddresses",
    "ok": false,
    "message": "Current caller-bound KFC authentication is required",
    "errorCode": "authentication_required",
    "provenance": []
  },
  "modelFacingResult": {
    "toolName": "getSavedAddresses",
    "ok": false,
    "message": "Current caller-bound KFC authentication is required",
    "errorCode": "authentication_required",
    "provenance": []
  },
  "executionStartedAt": "2026-07-24T07:47:57.811Z",
  "completedAt": "2026-07-24T07:47:57.813Z",
  "executionDurationMs": 2
}
```

### Tool call: getModifierOptions

```json
{
  "callId": "call_function_a8rwc5wtx7sn_1",
  "arguments": {
    "code": "20702"
  },
  "requestedAt": "2026-07-24T07:48:07.533Z"
}
```

### Tool call: getModifierOptions

```json
{
  "callId": "call_function_a8rwc5wtx7sn_2",
  "arguments": {
    "code": "41141"
  },
  "requestedAt": "2026-07-24T07:48:07.537Z"
}
```

### Tool result: getModifierOptions

```json
{
  "callId": "call_function_a8rwc5wtx7sn_1",
  "arguments": {
    "code": "20702"
  },
  "rawResult": {
    "toolName": "getModifierOptions",
    "ok": true,
    "value": {
      "itemCode": "20702",
      "itemId": "20702",
      "productCode": "EC.CBO-B.GaYo-COB_",
      "name": "Combo Burger Gà Yo & Gà Rán",
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "main",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41036",
              "name": "2 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150002",
              "imageName": "2-Fried-Chicken",
              "modifierGroups": [
                {
                  "groupId": "60254",
                  "name": "2 COB",
                  "min": 2,
                  "max": 2,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70003",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "101001",
                      "imageName": "MOD-Ga-Truyen-Thong",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70012",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "102001",
                      "imageName": "MOD-Ga-Gion-Cay",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70017",
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
          "name": "side",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41042",
              "name": "Burger Gà Yo",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150012",
              "imageName": "BURGER-GAYO",
              "modifierGroups": [
                {
                  "groupId": "60258",
                  "name": "Burger Yo Mod",
                  "min": 1,
                  "max": 1,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70443",
                      "name": "Burger Gà Yo (Cay)",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "120036",
                      "imageName": "BURGER-GAYO",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70444",
                      "name": "Burger Gà Yo (Không Cay)",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "120037",
                      "imageName": "BURGER-GAYO",
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
          "name": "side 2",
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
              "posItemId": "150033",
              "imageName": "FF-R",
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
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 3000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
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
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 3000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
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
      "itemCode": "20702",
      "itemId": "20702",
      "productCode": "EC.CBO-B.GaYo-COB_",
      "name": "Combo Burger Gà Yo & Gà Rán",
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "main",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41036",
              "name": "2 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150002",
              "imageName": "2-Fried-Chicken",
              "modifierGroups": [
                {
                  "groupId": "60254",
                  "name": "2 COB",
                  "min": 2,
                  "max": 2,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70003",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "101001",
                      "imageName": "MOD-Ga-Truyen-Thong",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70012",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "102001",
                      "imageName": "MOD-Ga-Gion-Cay",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70017",
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
          "name": "side",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41042",
              "name": "Burger Gà Yo",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150012",
              "imageName": "BURGER-GAYO",
              "modifierGroups": [
                {
                  "groupId": "60258",
                  "name": "Burger Yo Mod",
                  "min": 1,
                  "max": 1,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70443",
                      "name": "Burger Gà Yo (Cay)",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "120036",
                      "imageName": "BURGER-GAYO",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70444",
                      "name": "Burger Gà Yo (Không Cay)",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "120037",
                      "imageName": "BURGER-GAYO",
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
          "name": "side 2",
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
              "posItemId": "150033",
              "imageName": "FF-R",
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
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 3000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
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
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 3000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
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
  "executionStartedAt": "2026-07-24T07:48:07.546Z",
  "completedAt": "2026-07-24T07:48:07.546Z",
  "executionDurationMs": 0
}
```

### Tool result: getModifierOptions

```json
{
  "callId": "call_function_a8rwc5wtx7sn_2",
  "arguments": {
    "code": "41141"
  },
  "rawResult": {
    "toolName": "getModifierOptions",
    "ok": true,
    "value": {
      "itemCode": "41141",
      "itemId": "41141",
      "productCode": "Burger-Zinger",
      "name": "Burger Gà Zinger",
      "modifierGroups": [
        {
          "groupId": "60284",
          "name": "B.Zinger MOD",
          "min": 0,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "70046",
              "name": "Thêm Phô Mai",
              "priceDeltaVnd": 8000,
              "default": false,
              "quantity": 0,
              "posItemId": "",
              "imageName": "Cheese",
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
      "itemCode": "41141",
      "itemId": "41141",
      "productCode": "Burger-Zinger",
      "name": "Burger Gà Zinger",
      "modifierGroups": [
        {
          "groupId": "60284",
          "name": "B.Zinger MOD",
          "min": 0,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "70046",
              "name": "Thêm Phô Mai",
              "priceDeltaVnd": 8000,
              "default": false,
              "quantity": 0,
              "posItemId": "",
              "imageName": "Cheese",
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
  "executionStartedAt": "2026-07-24T07:48:07.550Z",
  "completedAt": "2026-07-24T07:48:07.550Z",
  "executionDurationMs": 0
}
```

## Assistant

Mình đã có đủ thông tin. Trước khi vào giỏ, mình xác nhận lại 2 điểm cho rõ để tránh sai món nhé:

1. **2 Pepsi lẻ thêm** – Bạn muốn size nào: Pepsi (Tiêu Chuẩn) 13k, Pepsi (Vừa) 17k hay Pepsi (Đại) 20k?
2. **Burger Gà Yo trong combo** – Bạn nói "phần gà giòn cay" nên mình sẽ chọn 2 miếng gà rán = Gà Giòn Cay và Burger Gà Yo (Cay) luôn đúng không?

Sau khi bạn chốt 2 điểm trên, mình sẽ soạn giỏ gồm:
- 1 Combo Burger Gà Yo & Gà Rán – 129k (gà giòn cay, burger yo cay, 2 Pepsi vừa mặc định)
- 1 Burger Gà Zinger – 56k
- 2 Pepsi (size bạn chọn)

Giao về **Quận 7** – bạn gửi giúp mình địa chỉ chi tiết (số nhà, tên đường, phường) để mình báo phí ship và kiểm tra cửa hàng phục vụ nhé.

## User

Chọn Pepsi tiêu chuẩn. Trong combo chọn cả Burger Gà Yo cay và gà giòn cay. Địa chỉ là Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng, Quận 7. Kiểm tra phí giao giúp mình.

### Tool call: searchMenu

```json
{
  "callId": "call_function_tmmoa61foinf_1",
  "arguments": {
    "category": null,
    "maxPriceVnd": 200000,
    "mode": "search",
    "modifierQueries": [
      "Burger Gà Yo cay",
      "Gà Giòn Cay",
      "Pepsi tiêu chuẩn"
    ],
    "partySize": 1,
    "queries": [
      "Combo Burger Gà Yo & Gà Rán",
      "Burger Gà Zinger",
      "Pepsi tiêu chuẩn"
    ]
  },
  "requestedAt": "2026-07-24T07:48:54.147Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_function_tmmoa61foinf_1",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Burger Gà Yo & Gà Rán",
      "Burger Gà Zinger",
      "Pepsi tiêu chuẩn"
    ],
    "modifierQueries": [
      "Burger Gà Yo cay",
      "Gà Giòn Cay",
      "Pepsi tiêu chuẩn"
    ],
    "maxPriceVnd": 200000,
    "partySize": 1
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Combo Burger Gà Yo & Gà Rán",
        "Burger Gà Zinger",
        "Pepsi tiêu chuẩn"
      ],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Combo Burger Gà Yo & Gà Rán\",\"Burger Gà Zinger\",\"Pepsi tiêu chuẩn\"],\"maxPriceVnd\":200000,\"partySize\":1,\"modifierQueries\":[\"Burger Gà Yo cay\",\"Gà Giòn Cay\",\"Pepsi tiêu chuẩn\"]}"
      },
      "items": []
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
      "items": [],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"combo burger gà yo & gà rán\",\"burger gà zinger\",\"pepsi tiêu chuẩn\"],\"maxpricevnd\":200000,\"partysize\":1,\"modifierqueries\":[\"burger gà yo cay\",\"gà giòn cay\",\"pepsi tiêu chuẩn\"]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22combo%20burger%20g%C3%A0%20yo%20%26%20g%C3%A0%20r%C3%A1n%22%2C%22burger%20g%C3%A0%20zinger%22%2C%22pepsi%20ti%C3%AAu%20chu%E1%BA%A9n%22%5D%2C%22maxpricevnd%22%3A200000%2C%22partysize%22%3A1%2C%22modifierqueries%22%3A%5B%22burger%20g%C3%A0%20yo%20cay%22%2C%22g%C3%A0%20gi%C3%B2n%20cay%22%2C%22pepsi%20ti%C3%AAu%20chu%E1%BA%A9n%22%5D%7D",
      "revision": "21015a1477c504ab8fd28c8d896748ab213df2468e498609d6bbec1d9d6e46af",
      "providerRevision": "menu-result:75ef4356359d693fe8438215561005fb62afdeef9bdf99d2c5108c1da7039083",
      "result": {
        "items": [],
        "total": 0,
        "returned": 0,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"combo burger gà yo & gà rán\",\"burger gà zinger\",\"pepsi tiêu chuẩn\"],\"maxpricevnd\":200000,\"partysize\":1,\"modifierqueries\":[\"burger gà yo cay\",\"gà giòn cay\",\"pepsi tiêu chuẩn\"]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T07:48:54.157Z",
  "completedAt": "2026-07-24T07:48:54.166Z",
  "executionDurationMs": 9
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_function_tr2avz9epo59_1",
  "arguments": {
    "maxPriceVnd": 200000,
    "mode": "search",
    "modifierQueries": [
      "cay",
      "Pepsi tiêu chuẩn"
    ],
    "partySize": 1,
    "queries": [
      "Combo",
      "Burger Gà Yo",
      "Gà Rán",
      "Zinger",
      "Pepsi"
    ]
  },
  "requestedAt": "2026-07-24T07:48:56.619Z"
}
```

### Tool failure: searchMenu

```json
{
  "callId": "call_function_tr2avz9epo59_1",
  "arguments": {
    "maxPriceVnd": 200000,
    "mode": "search",
    "modifierQueries": [
      "cay",
      "Pepsi tiêu chuẩn"
    ],
    "partySize": 1,
    "queries": [
      "Combo",
      "Burger Gà Yo",
      "Gà Rán",
      "Zinger",
      "Pepsi"
    ]
  },
  "error": {
    "name": "Error",
    "message": "local_evidence_tool_arguments_invalid"
  },
  "completedAt": "2026-07-24T07:48:56.623Z",
  "requestedAt": "2026-07-24T07:48:56.619Z",
  "totalDurationMs": 4
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_function_ci4le8hgjz2d_1",
  "arguments": {
    "category": null,
    "maxPriceVnd": 200000,
    "mode": "search",
    "modifierQueries": [
      "cay",
      "Pepsi tiêu chuẩn"
    ],
    "partySize": 1,
    "queries": [
      "Combo",
      "Burger Gà Yo",
      "Gà Rán",
      "Zinger",
      "Pepsi"
    ]
  },
  "requestedAt": "2026-07-24T07:48:59.188Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_function_ci4le8hgjz2d_1",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo",
      "Burger Gà Yo",
      "Gà Rán",
      "Zinger",
      "Pepsi"
    ],
    "modifierQueries": [
      "cay",
      "Pepsi tiêu chuẩn"
    ],
    "maxPriceVnd": 200000,
    "partySize": 1
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Combo",
        "Burger Gà Yo",
        "Gà Rán",
        "Zinger",
        "Pepsi"
      ],
      "total": 12,
      "returned": 12,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Combo\",\"Burger Gà Yo\",\"Gà Rán\",\"Zinger\",\"Pepsi\"],\"maxPriceVnd\":200000,\"partySize\":1,\"modifierQueries\":[\"cay\",\"Pepsi tiêu chuẩn\"]}"
      },
      "items": [
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60258",
              "groupName": "Burger Yo Mod",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70443",
              "name": "Burger Gà Yo (Cay)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "3",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60261",
              "groupName": "1 COB",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70027",
              "name": "Gà Giòn Không Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "2",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60261",
              "groupName": "1 COB",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70027",
              "name": "Gà Giòn Không Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "3",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60253",
              "groupName": "1 COB",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70031",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "3",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60253",
              "groupName": "1 COB",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70031",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "4",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60254",
              "groupName": "2 COB",
              "groupMin": 2,
              "groupMax": 2,
              "modifierId": "70012",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "3",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60260",
              "groupName": "1 COB",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70027",
              "name": "Gà Giòn Không Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "2",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60265",
              "groupName": "4 COB",
              "groupMin": 4,
              "groupMax": 4,
              "modifierId": "70247",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "3",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60255",
              "groupName": "3 COB",
              "groupMin": 3,
              "groupMax": 3,
              "modifierId": "70087",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "4",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60254",
              "groupName": "2 COB",
              "groupMin": 2,
              "groupMax": 2,
              "modifierId": "70012",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "5",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60255",
              "groupName": "3 COB",
              "groupMin": 3,
              "groupMax": 3,
              "modifierId": "70087",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "5",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60266",
              "groupName": "5 COB",
              "groupMin": 5,
              "groupMax": 5,
              "modifierId": "70258",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "2",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60258",
              "groupName": "Burger Yo Mod",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70443",
              "name": "Burger Gà Yo (Cay)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "3",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60261",
              "groupName": "1 COB",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70027",
              "name": "Gà Giòn Không Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "2",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60261",
              "groupName": "1 COB",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70027",
              "name": "Gà Giòn Không Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "3",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60253",
              "groupName": "1 COB",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70031",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "3",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60253",
              "groupName": "1 COB",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70031",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "4",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60254",
              "groupName": "2 COB",
              "groupMin": 2,
              "groupMax": 2,
              "modifierId": "70012",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "3",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60260",
              "groupName": "1 COB",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70027",
              "name": "Gà Giòn Không Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "2",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60265",
              "groupName": "4 COB",
              "groupMin": 4,
              "groupMax": 4,
              "modifierId": "70247",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "3",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60255",
              "groupName": "3 COB",
              "groupMin": 3,
              "groupMax": 3,
              "modifierId": "70087",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "4",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60254",
              "groupName": "2 COB",
              "groupMin": 2,
              "groupMax": 2,
              "modifierId": "70012",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "5",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60255",
              "groupName": "3 COB",
              "groupMin": 3,
              "groupMax": 3,
              "modifierId": "70087",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "5",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "cay",
              "groupId": "60266",
              "groupName": "5 COB",
              "groupMin": 5,
              "groupMax": 5,
              "modifierId": "70258",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Pepsi tiêu chuẩn",
              "groupId": "2",
              "groupName": "Drink 1",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41089",
              "name": "Pepsi (Tiêu Chuẩn)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": true
        }
      ],
      "total": 12,
      "returned": 12,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"combo\",\"burger gà yo\",\"gà rán\",\"zinger\",\"pepsi\"],\"maxpricevnd\":200000,\"partysize\":1,\"modifierqueries\":[\"cay\",\"pepsi tiêu chuẩn\"]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22combo%22%2C%22burger%20g%C3%A0%20yo%22%2C%22g%C3%A0%20r%C3%A1n%22%2C%22zinger%22%2C%22pepsi%22%5D%2C%22maxpricevnd%22%3A200000%2C%22partysize%22%3A1%2C%22modifierqueries%22%3A%5B%22cay%22%2C%22pepsi%20ti%C3%AAu%20chu%E1%BA%A9n%22%5D%7D",
      "revision": "9470bc033df1248202ecd43a2e9dd17fabfd0794900e1fe2f7ad33b42d764901",
      "providerRevision": "menu-result:8dfe72de5f76b83b040b2603dd19fd3d5fd22838b5af6c54ebba91ac04e34a31",
      "result": {
        "items": [
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
            "hasModifiers": true,
            "matchedModifiers": [
              {
                "query": "cay",
                "groupId": "60258",
                "groupName": "Burger Yo Mod",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "70443",
                "name": "Burger Gà Yo (Cay)",
                "priceDeltaVnd": 0,
                "default": false,
                "quantity": 0
              },
              {
                "query": "Pepsi tiêu chuẩn",
                "groupId": "3",
                "groupName": "Drink 1",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "41089",
                "name": "Pepsi (Tiêu Chuẩn)",
                "priceDeltaVnd": 0,
                "default": true,
                "quantity": 1
              }
            ],
            "matchesAllModifierQueries": true
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
            "hasModifiers": true,
            "matchedModifiers": [
              {
                "query": "cay",
                "groupId": "60261",
                "groupName": "1 COB",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "70027",
                "name": "Gà Giòn Không Cay",
                "priceDeltaVnd": 0,
                "default": false,
                "quantity": 0
              },
              {
                "query": "Pepsi tiêu chuẩn",
                "groupId": "2",
                "groupName": "Drink 1",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "41089",
                "name": "Pepsi (Tiêu Chuẩn)",
                "priceDeltaVnd": 0,
                "default": true,
                "quantity": 1
              }
            ],
            "matchesAllModifierQueries": true
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
            "hasModifiers": true,
            "matchedModifiers": [
              {
                "query": "cay",
                "groupId": "60261",
                "groupName": "1 COB",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "70027",
                "name": "Gà Giòn Không Cay",
                "priceDeltaVnd": 0,
                "default": false,
                "quantity": 0
              },
              {
                "query": "Pepsi tiêu chuẩn",
                "groupId": "3",
                "groupName": "Drink 1",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "41089",
                "name": "Pepsi (Tiêu Chuẩn)",
                "priceDeltaVnd": 0,
                "default": true,
                "quantity": 1
              }
            ],
            "matchesAllModifierQueries": true
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
            "hasModifiers": true,
            "matchedModifiers": [
              {
                "query": "cay",
                "groupId": "60253",
                "groupName": "1 COB",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "70031",
                "name": "Gà Giòn Cay",
                "priceDeltaVnd": 0,
                "default": false,
                "quantity": 0
              },
              {
                "query": "Pepsi tiêu chuẩn",
                "groupId": "3",
                "groupName": "Drink 1",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "41089",
                "name": "Pepsi (Tiêu Chuẩn)",
                "priceDeltaVnd": 0,
                "default": true,
                "quantity": 1
              }
            ],
            "matchesAllModifierQueries": true
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
            "hasModifiers": true,
            "matchedModifiers": [
              {
                "query": "cay",
                "groupId": "60253",
                "groupName": "1 COB",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "70031",
                "name": "Gà Giòn Cay",
                "priceDeltaVnd": 0,
                "default": false,
                "quantity": 0
              },
              {
                "query": "Pepsi tiêu chuẩn",
                "groupId": "4",
                "groupName": "Drink 1",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "41089",
                "name": "Pepsi (Tiêu Chuẩn)",
                "priceDeltaVnd": 0,
                "default": true,
                "quantity": 1
              }
            ],
            "matchesAllModifierQueries": true
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
            "hasModifiers": true,
            "matchedModifiers": [
              {
                "query": "cay",
                "groupId": "60254",
                "groupName": "2 COB",
                "groupMin": 2,
                "groupMax": 2,
                "modifierId": "70012",
                "name": "Gà Giòn Cay",
                "priceDeltaVnd": 0,
                "default": false,
                "quantity": 0
              },
              {
                "query": "Pepsi tiêu chuẩn",
                "groupId": "3",
                "groupName": "Drink 1",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "41089",
                "name": "Pepsi (Tiêu Chuẩn)",
                "priceDeltaVnd": 0,
                "default": true,
                "quantity": 1
              }
            ],
            "matchesAllModifierQueries": true
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
            "hasModifiers": true,
            "matchedModifiers": [
              {
                "query": "cay",
                "groupId": "60260",
                "groupName": "1 COB",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "70027",
                "name": "Gà Giòn Không Cay",
                "priceDeltaVnd": 0,
                "default": false,
                "quantity": 0
              },
              {
                "query": "Pepsi tiêu chuẩn",
                "groupId": "2",
                "groupName": "Drink 1",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "41089",
                "name": "Pepsi (Tiêu Chuẩn)",
                "priceDeltaVnd": 0,
                "default": true,
                "quantity": 1
              }
            ],
            "matchesAllModifierQueries": true
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
            "hasModifiers": true,
            "matchedModifiers": [
              {
                "query": "cay",
                "groupId": "60265",
                "groupName": "4 COB",
                "groupMin": 4,
                "groupMax": 4,
                "modifierId": "70247",
                "name": "Gà Giòn Cay",
                "priceDeltaVnd": 0,
                "default": false,
                "quantity": 0
              },
              {
                "query": "Pepsi tiêu chuẩn",
                "groupId": "3",
                "groupName": "Drink 1",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "41089",
                "name": "Pepsi (Tiêu Chuẩn)",
                "priceDeltaVnd": 0,
                "default": true,
                "quantity": 1
              }
            ],
            "matchesAllModifierQueries": true
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
            "hasModifiers": true,
            "matchedModifiers": [
              {
                "query": "cay",
                "groupId": "60255",
                "groupName": "3 COB",
                "groupMin": 3,
                "groupMax": 3,
                "modifierId": "70087",
                "name": "Gà Giòn Cay",
                "priceDeltaVnd": 0,
                "default": false,
                "quantity": 0
              },
              {
                "query": "Pepsi tiêu chuẩn",
                "groupId": "4",
                "groupName": "Drink 1",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "41089",
                "name": "Pepsi (Tiêu Chuẩn)",
                "priceDeltaVnd": 0,
                "default": true,
                "quantity": 1
              }
            ],
            "matchesAllModifierQueries": true
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
            "hasModifiers": true,
            "matchedModifiers": [
              {
                "query": "cay",
                "groupId": "60254",
                "groupName": "2 COB",
                "groupMin": 2,
                "groupMax": 2,
                "modifierId": "70012",
                "name": "Gà Giòn Cay",
                "priceDeltaVnd": 0,
                "default": false,
                "quantity": 0
              },
              {
                "query": "Pepsi tiêu chuẩn",
                "groupId": "5",
                "groupName": "Drink 1",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "41089",
                "name": "Pepsi (Tiêu Chuẩn)",
                "priceDeltaVnd": 0,
                "default": true,
                "quantity": 1
              }
            ],
            "matchesAllModifierQueries": true
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
            "hasModifiers": true,
            "matchedModifiers": [
              {
                "query": "cay",
                "groupId": "60255",
                "groupName": "3 COB",
                "groupMin": 3,
                "groupMax": 3,
                "modifierId": "70087",
                "name": "Gà Giòn Cay",
                "priceDeltaVnd": 0,
                "default": false,
                "quantity": 0
              },
              {
                "query": "Pepsi tiêu chuẩn",
                "groupId": "5",
                "groupName": "Drink 1",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "41089",
                "name": "Pepsi (Tiêu Chuẩn)",
                "priceDeltaVnd": 0,
                "default": true,
                "quantity": 1
              }
            ],
            "matchesAllModifierQueries": true
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
            "hasModifiers": true,
            "matchedModifiers": [
              {
                "query": "cay",
                "groupId": "60266",
                "groupName": "5 COB",
                "groupMin": 5,
                "groupMax": 5,
                "modifierId": "70258",
                "name": "Gà Giòn Cay",
                "priceDeltaVnd": 0,
                "default": false,
                "quantity": 0
              },
              {
                "query": "Pepsi tiêu chuẩn",
                "groupId": "2",
                "groupName": "Drink 1",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "41089",
                "name": "Pepsi (Tiêu Chuẩn)",
                "priceDeltaVnd": 0,
                "default": true,
                "quantity": 1
              }
            ],
            "matchesAllModifierQueries": true
          }
        ],
        "total": 12,
        "returned": 12,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"combo\",\"burger gà yo\",\"gà rán\",\"zinger\",\"pepsi\"],\"maxpricevnd\":200000,\"partysize\":1,\"modifierqueries\":[\"cay\",\"pepsi tiêu chuẩn\"]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T07:48:59.197Z",
  "completedAt": "2026-07-24T07:48:59.206Z",
  "executionDurationMs": 9
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_function_xsi9d3aq527m_1",
  "arguments": {
    "maxPriceVnd": 200000,
    "mode": "full",
    "modifierQueries": [
      "Burger Gà Yo Cay",
      "Gà Giòn Cay",
      "Zinger"
    ],
    "partySize": 1,
    "queries": [
      "Burger Gà Yo & Gà Rán",
      "Burger Gà Yo",
      "Zinger"
    ]
  },
  "requestedAt": "2026-07-24T07:49:04.652Z"
}
```

### Tool failure: searchMenu

```json
{
  "callId": "call_function_xsi9d3aq527m_1",
  "arguments": {
    "maxPriceVnd": 200000,
    "mode": "full",
    "modifierQueries": [
      "Burger Gà Yo Cay",
      "Gà Giòn Cay",
      "Zinger"
    ],
    "partySize": 1,
    "queries": [
      "Burger Gà Yo & Gà Rán",
      "Burger Gà Yo",
      "Zinger"
    ]
  },
  "error": {
    "name": "Error",
    "message": "local_evidence_tool_arguments_invalid"
  },
  "completedAt": "2026-07-24T07:49:04.659Z",
  "requestedAt": "2026-07-24T07:49:04.652Z",
  "totalDurationMs": 7
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_function_xsi9d3aq527m_2",
  "arguments": {
    "maxPriceVnd": 200000,
    "mode": "full",
    "modifierQueries": [
      "Pepsi tiêu chuẩn"
    ],
    "partySize": 1,
    "queries": [
      "Pepsi lẻ",
      "nước uống"
    ]
  },
  "requestedAt": "2026-07-24T07:49:04.663Z"
}
```

### Tool failure: searchMenu

```json
{
  "callId": "call_function_xsi9d3aq527m_2",
  "arguments": {
    "maxPriceVnd": 200000,
    "mode": "full",
    "modifierQueries": [
      "Pepsi tiêu chuẩn"
    ],
    "partySize": 1,
    "queries": [
      "Pepsi lẻ",
      "nước uống"
    ]
  },
  "error": {
    "name": "Error",
    "message": "local_evidence_tool_arguments_invalid"
  },
  "completedAt": "2026-07-24T07:49:04.666Z",
  "requestedAt": "2026-07-24T07:49:04.663Z",
  "totalDurationMs": 3
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_function_ekbr82crl4ez_1",
  "arguments": {
    "maxPriceVnd": 200000,
    "mode": "search",
    "modifierQueries": [
      "Burger Gà Yo Cay",
      "Gà Giòn Cay",
      "Zinger"
    ],
    "partySize": 1,
    "queries": [
      "Burger Gà Yo & Gà Rán",
      "Burger Gà Yo",
      "Zinger"
    ]
  },
  "requestedAt": "2026-07-24T07:49:07.517Z"
}
```

### Tool failure: searchMenu

```json
{
  "callId": "call_function_ekbr82crl4ez_1",
  "arguments": {
    "maxPriceVnd": 200000,
    "mode": "search",
    "modifierQueries": [
      "Burger Gà Yo Cay",
      "Gà Giòn Cay",
      "Zinger"
    ],
    "partySize": 1,
    "queries": [
      "Burger Gà Yo & Gà Rán",
      "Burger Gà Yo",
      "Zinger"
    ]
  },
  "error": {
    "name": "Error",
    "message": "local_evidence_tool_arguments_invalid"
  },
  "completedAt": "2026-07-24T07:49:07.521Z",
  "requestedAt": "2026-07-24T07:49:07.517Z",
  "totalDurationMs": 4
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_function_ekbr82crl4ez_2",
  "arguments": {
    "maxPriceVnd": 50000,
    "mode": "search",
    "modifierQueries": [
      "Pepsi tiêu chuẩn"
    ],
    "partySize": 1,
    "queries": [
      "Pepsi lẻ",
      "Burger Zinger"
    ]
  },
  "requestedAt": "2026-07-24T07:49:07.524Z"
}
```

### Tool failure: searchMenu

```json
{
  "callId": "call_function_ekbr82crl4ez_2",
  "arguments": {
    "maxPriceVnd": 50000,
    "mode": "search",
    "modifierQueries": [
      "Pepsi tiêu chuẩn"
    ],
    "partySize": 1,
    "queries": [
      "Pepsi lẻ",
      "Burger Zinger"
    ]
  },
  "error": {
    "name": "Error",
    "message": "local_evidence_tool_arguments_invalid"
  },
  "completedAt": "2026-07-24T07:49:07.527Z",
  "requestedAt": "2026-07-24T07:49:07.524Z",
  "totalDurationMs": 3
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_function_on24goxt10vv_1",
  "arguments": {
    "category": null,
    "maxPriceVnd": 200000,
    "mode": "full",
    "modifierQueries": [],
    "partySize": 1,
    "queries": []
  },
  "requestedAt": "2026-07-24T07:49:17.243Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_function_on24goxt10vv_1",
  "arguments": {
    "mode": "full",
    "queries": [],
    "modifierQueries": [],
    "maxPriceVnd": 200000,
    "partySize": 1
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "full",
      "queries": [],
      "total": 111,
      "returned": 111,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"full\",\"queries\":[],\"maxPriceVnd\":200000,\"partySize\":1,\"modifierQueries\":[]}"
      },
      "items": [
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
          "code": "41127",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "1 Miếng Gà Lắc Tiêu Chanh",
          "description": "1 Miếng Gà Lắc Tiêu Chanh",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/1TIEUCHANH.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41123",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "1 Cơm Gà Lắc Tiêu Chanh",
          "description": "1 Cơm Gà Lắc Tiêu Chanh",
          "priceVnd": 52000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/COMGA-TIEUCHANH.jpg?v=LNN7PL",
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
          "code": "41042",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Gà Yo",
          "description": "1 phần Burger Gà Yo (cay)/1 phần Burger Gà Yo (không cay)",
          "priceVnd": 30000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BURGER-GAYO.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41043",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Phi-lê Gà Quay",
          "description": "1 Burger Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Flava.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41140",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Tôm",
          "description": "1 Burger Tôm + 1 Gói tương (cà/ ớt)",
          "priceVnd": 45000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Shrimp.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41141",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Gà Zinger",
          "description": "1 Burger Gà Zinger + 1 Gói tương (cà/ ớt)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Zinger.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41046",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Mì Ý Xúc Xích Gà",
          "description": "1 Mì Ý Xúc Xích Gà",
          "priceVnd": 38000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41047",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Mì Ý Gà Viên",
          "description": "1 Mì Ý Gà Viên",
          "priceVnd": 43000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta-Popcorn.jpg?v=LNN7PL",
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
          "code": "41050",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "1 Cơm Gà Viên Nanban",
          "description": "1 Cơm Gà Viên Nanban + 1 Gói tương (cà/ ớt)",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/NANBAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41051",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "1 Cơm Phi-lê Gà Quay",
          "description": "1 Cơm Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
          "priceVnd": 54000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Rice-Flava.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41052",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Salad Xốt Mè Rang",
          "description": "1 Salad Xốt Mè Rang",
          "priceVnd": 22000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/SALAD-XOT-ME-RANG.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41053",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Salad Hạt Gà Viên",
          "description": "1 Salad Hạt Gà Viên",
          "priceVnd": 37000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/SALAD-HAT-GA-VIEN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41057",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Gà Viên Popcorn (Vừa)",
          "description": "Gà Viên Popcorn (Vừa) + 1 Gói tương (cà/ ớt)",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/POP-R.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41058",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "1 Bắp Cải Trộn (Đại)",
          "description": "1 Bắp Cải Trộn (Đại)",
          "priceVnd": 32000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CL-(J)-new.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41059",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "1 Bắp Cải Trộn (Lớn)",
          "description": "1 Bắp Cải Trộn (Lớn)",
          "priceVnd": 23000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CL-(L)-new.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41060",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "1 Bắp Cải Trộn (Vừa)",
          "description": "1 Bắp Cải Trộn (Vừa)",
          "priceVnd": 13000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CL-(R)-new.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41062",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Khoai Tây Chiên (Lớn)",
          "description": "Khoai Tây Chiên (Lớn) + 1 Gói tương (cà/ ớt)",
          "priceVnd": 30000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/FF-L.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41063",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Khoai Tây Chiên (Vừa)",
          "description": "Khoai Tây Chiên (Vừa) + 1 Gói tương (cà/ ớt)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/FF-R.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "40657",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Tặng 1 Bánh Trứng",
          "description": "Tặng 1 Bánh Trứng",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/1-eggtart.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
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
          "code": "40969",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Miễn phí 1 burger tôm cho DH 120k",
          "description": "1 Burger Tôm",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PNS-BurgerTom.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "40970",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Miễn phí 1 migaxuxi cho DH 120k",
          "description": "1 Migaxuxi",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PNS-Migaxuxi.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41021",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Miễn phí 1 bánh trứng cho DH 99k",
          "description": "1 Bánh Trứng",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PNS-Eggtart.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41022",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Miễn phí 1 khoai tây chiên (lớn) cho DH 120k",
          "description": "1 Khoai Tây Chiên",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PNS-FF.jpg?v=LNN7PL",
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
          "code": "41172",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Xô Zòn Zã 159K",
          "description": "Xô 5 Miếng Gà (Giá Ưu Đãi)",
          "priceVnd": 159000,
          "originalPriceVnd": 179000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/FS-BUCKET5COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41173",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Xô Zui Zẻ 139K",
          "description": "Xô 12 Gà Miếng Tenders (Giá Ưu Đãi)",
          "priceVnd": 139000,
          "originalPriceVnd": 159000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/FS-BUCKET12TE.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41174",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Xô Zòn Zã 179K",
          "description": "Xô 5 Miếng Gà",
          "priceVnd": 179000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BUCKET-5-COB_HDE.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41175",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Xô Zui Zẻ 159K",
          "description": "Xô 12 Gà Miếng Tenders",
          "priceVnd": 159000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BUCKET-12-TENDERS_HDE.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
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
          "code": "41128",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "2 Miếng Gà Lắc Tiêu Chanh",
          "description": "2 Miếng Gà Lắc Tiêu Chanh",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/2TIEUCHANH.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41129",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "3 Miếng Gà Lắc Tiêu Chanh",
          "description": "3 Miếng Gà Lắc Tiêu Chanh",
          "priceVnd": 116000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/3TIEUCHANH.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40949",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "Khoai Lắc Phô Mai (L)",
          "description": "Khoai tây chiên giòn tan, lắc đều cùng phô mai thơm ngậy, cho vị ngon xuất shake!!!",
          "priceVnd": 32000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/KHOAI-PHO-MAI-ALC.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "40950",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "Khoai Lắc Bơ Tỏi (L)",
          "description": "Khoai tây chiên giòn tan, lắc đều cùng bơ tỏi thơm lừng, cho vị ngon xuất shake!!!",
          "priceVnd": 32000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/KHOAI-BO-TOI-ALC.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "40951",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "Gà Popcorn Lắc Phô Mai ( R)",
          "description": "Gà Popcorn giòn rụm, lắc đều cùng phô mai thơm ngậy, cho vị ngon xuất shake!!!",
          "priceVnd": 42000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GA-LAC-PHO-MAI-ALC.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "40952",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "Gà  Popcorn Lắc Bơ Tỏi ( R)",
          "description": "Gà Popcorn giòn rụm, lắc đều cùng bơ tỏi thơm lừng, cho vị ngon xuất shake!!!",
          "priceVnd": 42000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GA-LAC-BO-TOI-ALC.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
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
          "code": "41054",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "4 Phô Mai Viên",
          "description": "4 Phô Mai Viên",
          "priceVnd": 38000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/4-Chewy-Cheese.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41055",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "6 Phô Mai Viên",
          "description": "6 Phô Mai Viên",
          "priceVnd": 53000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/6-Chewy-Cheese.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41056",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Gà Viên Popcorn (Lớn)",
          "description": "Gà Viên Popcorn (Lớn) + 2 Gói tương (cà/ ớt)",
          "priceVnd": 67000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/POP-L.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41061",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Khoai Tây Chiên (Đại)",
          "description": "Khoai Tây Chiên (Đại) + 2 Gói tương (cà/ ớt)",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/FF-J.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41064",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Khoai Tây Nghiền (Đại)",
          "description": "Khoai Tây Nghiền (Đại)",
          "priceVnd": 32000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/MP-(J)-new.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41065",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Khoai Tây Nghiền (Lớn)",
          "description": "Khoai Tây Nghiền (Lớn)",
          "priceVnd": 23000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/MP-(L)-new.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41066",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Khoai Tây Nghiền (Vừa)",
          "description": "Khoai Tây Nghiền (Vừa)",
          "priceVnd": 13000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/MP-(R)-new.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41067",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Cơm trắng",
          "description": "Cơm trắng",
          "priceVnd": 12000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Rice.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41068",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Súp Rong Biển",
          "description": "Súp Rong Biển",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Soup-Rong-Bien.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "40658",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "01 Khoai Tây Múi Cau (vừa)",
          "description": "01 Khoai Tây Múi Cau (vừa)",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/khoai-mui-cau-R.jpg?v=LNN7PL",
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
          "code": "41111",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Add 3 Nuggets + Vani Cone",
          "description": "",
          "priceVnd": 26000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41119",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "LOY_1PEP_M_129K",
          "description": "",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41130",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Add Cheese FF L",
          "description": "",
          "priceVnd": 32000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
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
          "code": "41132",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Add Cheese Pop R",
          "description": "",
          "priceVnd": 42000,
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
          "code": "41160",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "LOY_KEM_VANI_0d",
          "description": "",
          "priceVnd": 7000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41161",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "LOY_PEP_S_0d",
          "description": "",
          "priceVnd": 13000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41162",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "LOY_BUG_TOM_0d",
          "description": "",
          "priceVnd": 45000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41163",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "LOY_FF(R)_0d",
          "description": "",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
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
          "code": "41127",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "1 Miếng Gà Lắc Tiêu Chanh",
          "description": "1 Miếng Gà Lắc Tiêu Chanh",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/1TIEUCHANH.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41123",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "1 Cơm Gà Lắc Tiêu Chanh",
          "description": "1 Cơm Gà Lắc Tiêu Chanh",
          "priceVnd": 52000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/COMGA-TIEUCHANH.jpg?v=LNN7PL",
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
          "code": "41042",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Gà Yo",
          "description": "1 phần Burger Gà Yo (cay)/1 phần Burger Gà Yo (không cay)",
          "priceVnd": 30000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BURGER-GAYO.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41043",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Phi-lê Gà Quay",
          "description": "1 Burger Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Flava.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41140",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Tôm",
          "description": "1 Burger Tôm + 1 Gói tương (cà/ ớt)",
          "priceVnd": 45000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Shrimp.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41141",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Gà Zinger",
          "description": "1 Burger Gà Zinger + 1 Gói tương (cà/ ớt)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Zinger.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41046",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Mì Ý Xúc Xích Gà",
          "description": "1 Mì Ý Xúc Xích Gà",
          "priceVnd": 38000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41047",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Mì Ý Gà Viên",
          "description": "1 Mì Ý Gà Viên",
          "priceVnd": 43000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta-Popcorn.jpg?v=LNN7PL",
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
          "code": "41050",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "1 Cơm Gà Viên Nanban",
          "description": "1 Cơm Gà Viên Nanban + 1 Gói tương (cà/ ớt)",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/NANBAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41051",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "1 Cơm Phi-lê Gà Quay",
          "description": "1 Cơm Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
          "priceVnd": 54000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Rice-Flava.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41052",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Salad Xốt Mè Rang",
          "description": "1 Salad Xốt Mè Rang",
          "priceVnd": 22000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/SALAD-XOT-ME-RANG.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41053",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Salad Hạt Gà Viên",
          "description": "1 Salad Hạt Gà Viên",
          "priceVnd": 37000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/SALAD-HAT-GA-VIEN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41057",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Gà Viên Popcorn (Vừa)",
          "description": "Gà Viên Popcorn (Vừa) + 1 Gói tương (cà/ ớt)",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/POP-R.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41058",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "1 Bắp Cải Trộn (Đại)",
          "description": "1 Bắp Cải Trộn (Đại)",
          "priceVnd": 32000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CL-(J)-new.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41059",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "1 Bắp Cải Trộn (Lớn)",
          "description": "1 Bắp Cải Trộn (Lớn)",
          "priceVnd": 23000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CL-(L)-new.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41060",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "1 Bắp Cải Trộn (Vừa)",
          "description": "1 Bắp Cải Trộn (Vừa)",
          "priceVnd": 13000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CL-(R)-new.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41062",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Khoai Tây Chiên (Lớn)",
          "description": "Khoai Tây Chiên (Lớn) + 1 Gói tương (cà/ ớt)",
          "priceVnd": 30000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/FF-L.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41063",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Khoai Tây Chiên (Vừa)",
          "description": "Khoai Tây Chiên (Vừa) + 1 Gói tương (cà/ ớt)",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/FF-R.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "40657",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "Tặng 1 Bánh Trứng",
          "description": "Tặng 1 Bánh Trứng",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/1-eggtart.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
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
          "code": "40969",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Miễn phí 1 burger tôm cho DH 120k",
          "description": "1 Burger Tôm",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PNS-BurgerTom.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "40970",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Miễn phí 1 migaxuxi cho DH 120k",
          "description": "1 Migaxuxi",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PNS-Migaxuxi.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41021",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Miễn phí 1 bánh trứng cho DH 99k",
          "description": "1 Bánh Trứng",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PNS-Eggtart.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41022",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Miễn phí 1 khoai tây chiên (lớn) cho DH 120k",
          "description": "1 Khoai Tây Chiên",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PNS-FF.jpg?v=LNN7PL",
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
          "code": "41172",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Xô Zòn Zã 159K",
          "description": "Xô 5 Miếng Gà (Giá Ưu Đãi)",
          "priceVnd": 159000,
          "originalPriceVnd": 179000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/FS-BUCKET5COB.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41173",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Xô Zui Zẻ 139K",
          "description": "Xô 12 Gà Miếng Tenders (Giá Ưu Đãi)",
          "priceVnd": 139000,
          "originalPriceVnd": 159000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/FS-BUCKET12TE.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41174",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Xô Zòn Zã 179K",
          "description": "Xô 5 Miếng Gà",
          "priceVnd": 179000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BUCKET-5-COB_HDE.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41175",
          "category": "Ưu Đãi",
          "categoryId": "20000",
          "name": "Xô Zui Zẻ 159K",
          "description": "Xô 12 Gà Miếng Tenders",
          "priceVnd": 159000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BUCKET-12-TENDERS_HDE.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
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
          "code": "41128",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "2 Miếng Gà Lắc Tiêu Chanh",
          "description": "2 Miếng Gà Lắc Tiêu Chanh",
          "priceVnd": 79000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/2TIEUCHANH.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "41129",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "3 Miếng Gà Lắc Tiêu Chanh",
          "description": "3 Miếng Gà Lắc Tiêu Chanh",
          "priceVnd": 116000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/3TIEUCHANH.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
        },
        {
          "code": "40949",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "Khoai Lắc Phô Mai (L)",
          "description": "Khoai tây chiên giòn tan, lắc đều cùng phô mai thơm ngậy, cho vị ngon xuất shake!!!",
          "priceVnd": 32000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/KHOAI-PHO-MAI-ALC.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "40950",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "Khoai Lắc Bơ Tỏi (L)",
          "description": "Khoai tây chiên giòn tan, lắc đều cùng bơ tỏi thơm lừng, cho vị ngon xuất shake!!!",
          "priceVnd": 32000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/KHOAI-BO-TOI-ALC.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "40951",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "Gà Popcorn Lắc Phô Mai ( R)",
          "description": "Gà Popcorn giòn rụm, lắc đều cùng phô mai thơm ngậy, cho vị ngon xuất shake!!!",
          "priceVnd": 42000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GA-LAC-PHO-MAI-ALC.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "40952",
          "category": "Món Mới",
          "categoryId": "20010",
          "name": "Gà  Popcorn Lắc Bơ Tỏi ( R)",
          "description": "Gà Popcorn giòn rụm, lắc đều cùng bơ tỏi thơm lừng, cho vị ngon xuất shake!!!",
          "priceVnd": 42000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GA-LAC-BO-TOI-ALC.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
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
          "code": "41054",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "4 Phô Mai Viên",
          "description": "4 Phô Mai Viên",
          "priceVnd": 38000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/4-Chewy-Cheese.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41055",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "6 Phô Mai Viên",
          "description": "6 Phô Mai Viên",
          "priceVnd": 53000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/6-Chewy-Cheese.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41056",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Gà Viên Popcorn (Lớn)",
          "description": "Gà Viên Popcorn (Lớn) + 2 Gói tương (cà/ ớt)",
          "priceVnd": 67000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/POP-L.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41061",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Khoai Tây Chiên (Đại)",
          "description": "Khoai Tây Chiên (Đại) + 2 Gói tương (cà/ ớt)",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/FF-J.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41064",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Khoai Tây Nghiền (Đại)",
          "description": "Khoai Tây Nghiền (Đại)",
          "priceVnd": 32000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/MP-(J)-new.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41065",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Khoai Tây Nghiền (Lớn)",
          "description": "Khoai Tây Nghiền (Lớn)",
          "priceVnd": 23000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/MP-(L)-new.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41066",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Khoai Tây Nghiền (Vừa)",
          "description": "Khoai Tây Nghiền (Vừa)",
          "priceVnd": 13000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/MP-(R)-new.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41067",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Cơm trắng",
          "description": "Cơm trắng",
          "priceVnd": 12000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Rice.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41068",
          "category": "Thức Ăn Nhẹ",
          "categoryId": "20005",
          "name": "Súp Rong Biển",
          "description": "Súp Rong Biển",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Soup-Rong-Bien.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "40658",
          "category": "Thức Uống & Tráng Miệng",
          "categoryId": "20006",
          "name": "01 Khoai Tây Múi Cau (vừa)",
          "description": "01 Khoai Tây Múi Cau (vừa)",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/khoai-mui-cau-R.jpg?v=LNN7PL",
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
          "code": "41111",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Add 3 Nuggets + Vani Cone",
          "description": "",
          "priceVnd": 26000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41119",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "LOY_1PEP_M_129K",
          "description": "",
          "priceVnd": 0,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41130",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Add Cheese FF L",
          "description": "",
          "priceVnd": 32000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
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
          "code": "41132",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "Add Cheese Pop R",
          "description": "",
          "priceVnd": 42000,
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
          "code": "41160",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "LOY_KEM_VANI_0d",
          "description": "",
          "priceVnd": 7000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41161",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "LOY_PEP_S_0d",
          "description": "",
          "priceVnd": 13000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41162",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "LOY_BUG_TOM_0d",
          "description": "",
          "priceVnd": 45000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41163",
          "category": "Upsell_2",
          "categoryId": "20011",
          "name": "LOY_FF(R)_0d",
          "description": "",
          "priceVnd": 20000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        }
      ],
      "total": 111,
      "returned": 111,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"full\",\"queries\":[],\"maxpricevnd\":200000,\"partysize\":1,\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22full%22%2C%22queries%22%3A%5B%5D%2C%22maxpricevnd%22%3A200000%2C%22partysize%22%3A1%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "cc53199b237df37beb8a05e72e822fd69a910ca2a63d2d4257eef6e2754429db",
      "providerRevision": "menu-result:37d866541249c30b6ca0ab68ca90443c973fd334c0be6972e682c3be4fa9e2bd",
      "result": {
        "items": [
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
            "code": "41127",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "1 Miếng Gà Lắc Tiêu Chanh",
            "description": "1 Miếng Gà Lắc Tiêu Chanh",
            "priceVnd": 40000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/1TIEUCHANH.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41123",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "1 Cơm Gà Lắc Tiêu Chanh",
            "description": "1 Cơm Gà Lắc Tiêu Chanh",
            "priceVnd": 52000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/COMGA-TIEUCHANH.jpg?v=LNN7PL",
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
            "code": "41042",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Burger Gà Yo",
            "description": "1 phần Burger Gà Yo (cay)/1 phần Burger Gà Yo (không cay)",
            "priceVnd": 30000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BURGER-GAYO.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41043",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Burger Phi-lê Gà Quay",
            "description": "1 Burger Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
            "priceVnd": 56000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Flava.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41140",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Burger Tôm",
            "description": "1 Burger Tôm + 1 Gói tương (cà/ ớt)",
            "priceVnd": 45000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Shrimp.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41141",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Burger Gà Zinger",
            "description": "1 Burger Gà Zinger + 1 Gói tương (cà/ ớt)",
            "priceVnd": 56000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Zinger.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41046",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Mì Ý Xúc Xích Gà",
            "description": "1 Mì Ý Xúc Xích Gà",
            "priceVnd": 38000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41047",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Mì Ý Gà Viên",
            "description": "1 Mì Ý Gà Viên",
            "priceVnd": 43000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta-Popcorn.jpg?v=LNN7PL",
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
            "code": "41050",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "1 Cơm Gà Viên Nanban",
            "description": "1 Cơm Gà Viên Nanban + 1 Gói tương (cà/ ớt)",
            "priceVnd": 40000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/NANBAN.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41051",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "1 Cơm Phi-lê Gà Quay",
            "description": "1 Cơm Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
            "priceVnd": 54000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Rice-Flava.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41052",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "Salad Xốt Mè Rang",
            "description": "1 Salad Xốt Mè Rang",
            "priceVnd": 22000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/SALAD-XOT-ME-RANG.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41053",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "Salad Hạt Gà Viên",
            "description": "1 Salad Hạt Gà Viên",
            "priceVnd": 37000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/SALAD-HAT-GA-VIEN.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41057",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "Gà Viên Popcorn (Vừa)",
            "description": "Gà Viên Popcorn (Vừa) + 1 Gói tương (cà/ ớt)",
            "priceVnd": 40000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/POP-R.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41058",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "1 Bắp Cải Trộn (Đại)",
            "description": "1 Bắp Cải Trộn (Đại)",
            "priceVnd": 32000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CL-(J)-new.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41059",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "1 Bắp Cải Trộn (Lớn)",
            "description": "1 Bắp Cải Trộn (Lớn)",
            "priceVnd": 23000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CL-(L)-new.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41060",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "1 Bắp Cải Trộn (Vừa)",
            "description": "1 Bắp Cải Trộn (Vừa)",
            "priceVnd": 13000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/CL-(R)-new.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41062",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "Khoai Tây Chiên (Lớn)",
            "description": "Khoai Tây Chiên (Lớn) + 1 Gói tương (cà/ ớt)",
            "priceVnd": 30000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/FF-L.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41063",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "Khoai Tây Chiên (Vừa)",
            "description": "Khoai Tây Chiên (Vừa) + 1 Gói tương (cà/ ớt)",
            "priceVnd": 20000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/FF-R.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "40657",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "Tặng 1 Bánh Trứng",
            "description": "Tặng 1 Bánh Trứng",
            "priceVnd": 0,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/1-eggtart.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
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
            "code": "40969",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "Miễn phí 1 burger tôm cho DH 120k",
            "description": "1 Burger Tôm",
            "priceVnd": 0,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PNS-BurgerTom.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "40970",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "Miễn phí 1 migaxuxi cho DH 120k",
            "description": "1 Migaxuxi",
            "priceVnd": 0,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PNS-Migaxuxi.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41021",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "Miễn phí 1 bánh trứng cho DH 99k",
            "description": "1 Bánh Trứng",
            "priceVnd": 0,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PNS-Eggtart.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41022",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "Miễn phí 1 khoai tây chiên (lớn) cho DH 120k",
            "description": "1 Khoai Tây Chiên",
            "priceVnd": 0,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/PNS-FF.jpg?v=LNN7PL",
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
            "code": "41172",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Xô Zòn Zã 159K",
            "description": "Xô 5 Miếng Gà (Giá Ưu Đãi)",
            "priceVnd": 159000,
            "originalPriceVnd": 179000,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/FS-BUCKET5COB.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41173",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Xô Zui Zẻ 139K",
            "description": "Xô 12 Gà Miếng Tenders (Giá Ưu Đãi)",
            "priceVnd": 139000,
            "originalPriceVnd": 159000,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/FS-BUCKET12TE.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41174",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Xô Zòn Zã 179K",
            "description": "Xô 5 Miếng Gà",
            "priceVnd": 179000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BUCKET-5-COB_HDE.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41175",
            "category": "Ưu Đãi",
            "categoryId": "20000",
            "name": "Xô Zui Zẻ 159K",
            "description": "Xô 12 Gà Miếng Tenders",
            "priceVnd": 159000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BUCKET-12-TENDERS_HDE.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
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
            "code": "41128",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "2 Miếng Gà Lắc Tiêu Chanh",
            "description": "2 Miếng Gà Lắc Tiêu Chanh",
            "priceVnd": 79000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/2TIEUCHANH.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "41129",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "3 Miếng Gà Lắc Tiêu Chanh",
            "description": "3 Miếng Gà Lắc Tiêu Chanh",
            "priceVnd": 116000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/3TIEUCHANH.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
          },
          {
            "code": "40949",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "Khoai Lắc Phô Mai (L)",
            "description": "Khoai tây chiên giòn tan, lắc đều cùng phô mai thơm ngậy, cho vị ngon xuất shake!!!",
            "priceVnd": 32000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/KHOAI-PHO-MAI-ALC.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "40950",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "Khoai Lắc Bơ Tỏi (L)",
            "description": "Khoai tây chiên giòn tan, lắc đều cùng bơ tỏi thơm lừng, cho vị ngon xuất shake!!!",
            "priceVnd": 32000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/KHOAI-BO-TOI-ALC.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "40951",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "Gà Popcorn Lắc Phô Mai ( R)",
            "description": "Gà Popcorn giòn rụm, lắc đều cùng phô mai thơm ngậy, cho vị ngon xuất shake!!!",
            "priceVnd": 42000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GA-LAC-PHO-MAI-ALC.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "40952",
            "category": "Món Mới",
            "categoryId": "20010",
            "name": "Gà  Popcorn Lắc Bơ Tỏi ( R)",
            "description": "Gà Popcorn giòn rụm, lắc đều cùng bơ tỏi thơm lừng, cho vị ngon xuất shake!!!",
            "priceVnd": 42000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/GA-LAC-BO-TOI-ALC.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
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
            "code": "41054",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "4 Phô Mai Viên",
            "description": "4 Phô Mai Viên",
            "priceVnd": 38000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/4-Chewy-Cheese.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41055",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "6 Phô Mai Viên",
            "description": "6 Phô Mai Viên",
            "priceVnd": 53000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/6-Chewy-Cheese.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41056",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "Gà Viên Popcorn (Lớn)",
            "description": "Gà Viên Popcorn (Lớn) + 2 Gói tương (cà/ ớt)",
            "priceVnd": 67000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/POP-L.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41061",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "Khoai Tây Chiên (Đại)",
            "description": "Khoai Tây Chiên (Đại) + 2 Gói tương (cà/ ớt)",
            "priceVnd": 40000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/FF-J.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41064",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "Khoai Tây Nghiền (Đại)",
            "description": "Khoai Tây Nghiền (Đại)",
            "priceVnd": 32000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/MP-(J)-new.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41065",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "Khoai Tây Nghiền (Lớn)",
            "description": "Khoai Tây Nghiền (Lớn)",
            "priceVnd": 23000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/MP-(L)-new.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41066",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "Khoai Tây Nghiền (Vừa)",
            "description": "Khoai Tây Nghiền (Vừa)",
            "priceVnd": 13000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/MP-(R)-new.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41067",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "Cơm trắng",
            "description": "Cơm trắng",
            "priceVnd": 12000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Rice.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41068",
            "category": "Thức Ăn Nhẹ",
            "categoryId": "20005",
            "name": "Súp Rong Biển",
            "description": "Súp Rong Biển",
            "priceVnd": 20000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Soup-Rong-Bien.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "40658",
            "category": "Thức Uống & Tráng Miệng",
            "categoryId": "20006",
            "name": "01 Khoai Tây Múi Cau (vừa)",
            "description": "01 Khoai Tây Múi Cau (vừa)",
            "priceVnd": 0,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/khoai-mui-cau-R.jpg?v=LNN7PL",
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
            "code": "41111",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "Add 3 Nuggets + Vani Cone",
            "description": "",
            "priceVnd": 26000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41119",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "LOY_1PEP_M_129K",
            "description": "",
            "priceVnd": 0,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41130",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "Add Cheese FF L",
            "description": "",
            "priceVnd": 32000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
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
            "code": "41132",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "Add Cheese Pop R",
            "description": "",
            "priceVnd": 42000,
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
            "code": "41160",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "LOY_KEM_VANI_0d",
            "description": "",
            "priceVnd": 7000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41161",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "LOY_PEP_S_0d",
            "description": "",
            "priceVnd": 13000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41162",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "LOY_BUG_TOM_0d",
            "description": "",
            "priceVnd": 45000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41163",
            "category": "Upsell_2",
            "categoryId": "20011",
            "name": "LOY_FF(R)_0d",
            "description": "",
            "priceVnd": 20000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/no-image-vn.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          }
        ],
        "total": 111,
        "returned": 111,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"full\",\"queries\":[],\"maxpricevnd\":200000,\"partysize\":1,\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T07:49:17.256Z",
  "completedAt": "2026-07-24T07:49:17.260Z",
  "executionDurationMs": 4
}
```

## Assistant

Mình đã xác minh được các món bạn yêu cầu. Tóm tắt giỏ đề xuất:

**1. Combo Burger Gà Yo & Gà Rán (20702)** – 129.000đ
- 1 Burger Gà Yo (chọn **Cay**)
- 2 Miếng gà rán (chọn **Gà Giòn Cay**)
- 1 Khoai tây chiên (vừa)
- 2 Ly Pepsi (vừa) – mặc định theo combo

**2. Burger Gà Zinger (41141)** – 56.000đ (gồm 1 gói tương cà/ớt)

**3. Pepsi (Tiêu Chuẩn) (41074)** x 2 – 13.000đ × 2 = 26.000đ

**Tổng tạm tính món:** 211.000đ

Lưu ý nhỏ: Combo 20702 đã kèm 2 ly Pepsi vừa, không đổi được size. Bạn đang gọi thêm 2 ly Pepsi tiêu chuẩn lẻ bên ngoài (riêng 26k) – vẫn ổn nếu bạn muốn thêm để uống thoải mái. Mình giữ nguyên theo yêu cầu nhé.

Bạn xác nhận cho mình để mình soạn giỏ và báo phí giao về **Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, Tân Hưng, Quận 7**?

## User

Mình xác nhận các món và địa chỉ đó, hãy thêm vào giỏ rồi kiểm tra phí giao. Chưa tạo đơn nhé.

### Tool call: searchMenu

```json
{
  "callId": "call_function_e0o4q8nw6ane_1",
  "arguments": {
    "category": "combo",
    "maxPriceVnd": 150000,
    "mode": "search",
    "modifierQueries": [
      "Burger Gà Yo cay",
      "gà giòn cay",
      "Burger Gà Yo không cay",
      "Burger Gà Yo phô mai",
      "2 miếng gà rán",
      "khoai tây chiên vừa"
    ],
    "partySize": 1,
    "queries": [
      "Combo Burger Gà Yo & Gà Rán",
      "Burger Gà Zinger",
      "Pepsi tiêu chuẩn"
    ]
  },
  "requestedAt": "2026-07-24T07:50:15.481Z"
}
```

### Tool call: findStores

```json
{
  "callId": "call_function_e0o4q8nw6ane_2",
  "arguments": {
    "city": "Hồ Chí Minh",
    "district": "Quận 7",
    "query": "Chung cư Sunrise City 23 Nguyễn Hữu Thọ"
  },
  "requestedAt": "2026-07-24T07:50:15.495Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_function_e0o4q8nw6ane_1",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Burger Gà Yo & Gà Rán",
      "Burger Gà Zinger",
      "Pepsi tiêu chuẩn"
    ],
    "modifierQueries": [
      "Burger Gà Yo cay",
      "gà giòn cay",
      "Burger Gà Yo không cay",
      "Burger Gà Yo phô mai",
      "2 miếng gà rán",
      "khoai tây chiên vừa"
    ],
    "category": "combo",
    "maxPriceVnd": 150000,
    "partySize": 1
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Combo Burger Gà Yo & Gà Rán",
        "Burger Gà Zinger",
        "Pepsi tiêu chuẩn"
      ],
      "total": 1,
      "returned": 1,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Combo Burger Gà Yo & Gà Rán\",\"Burger Gà Zinger\",\"Pepsi tiêu chuẩn\"],\"category\":\"combo\",\"maxPriceVnd\":150000,\"partySize\":1,\"modifierQueries\":[\"Burger Gà Yo cay\",\"gà giòn cay\",\"Burger Gà Yo không cay\",\"Burger Gà Yo phô mai\",\"2 miếng gà rán\",\"khoai tây chiên vừa\"]}"
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "Burger Gà Yo cay",
              "groupId": "60258",
              "groupName": "Burger Yo Mod",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70443",
              "name": "Burger Gà Yo (Cay)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "gà giòn cay",
              "groupId": "60254",
              "groupName": "2 COB",
              "groupMin": 2,
              "groupMax": 2,
              "modifierId": "70012",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Burger Gà Yo không cay",
              "groupId": "60258",
              "groupName": "Burger Yo Mod",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70444",
              "name": "Burger Gà Yo (Không Cay)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "2 miếng gà rán",
              "groupId": "1",
              "groupName": "main",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41036",
              "name": "2 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            },
            {
              "query": "khoai tây chiên vừa",
              "groupId": "3",
              "groupName": "side 2",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41063",
              "name": "Khoai Tây Chiên (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": false
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
          "hasModifiers": true,
          "matchedModifiers": [
            {
              "query": "Burger Gà Yo cay",
              "groupId": "60258",
              "groupName": "Burger Yo Mod",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70443",
              "name": "Burger Gà Yo (Cay)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "gà giòn cay",
              "groupId": "60254",
              "groupName": "2 COB",
              "groupMin": 2,
              "groupMax": 2,
              "modifierId": "70012",
              "name": "Gà Giòn Cay",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "Burger Gà Yo không cay",
              "groupId": "60258",
              "groupName": "Burger Yo Mod",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "70444",
              "name": "Burger Gà Yo (Không Cay)",
              "priceDeltaVnd": 0,
              "default": false,
              "quantity": 0
            },
            {
              "query": "2 miếng gà rán",
              "groupId": "1",
              "groupName": "main",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41036",
              "name": "2 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            },
            {
              "query": "khoai tây chiên vừa",
              "groupId": "3",
              "groupName": "side 2",
              "groupMin": 1,
              "groupMax": 1,
              "modifierId": "41063",
              "name": "Khoai Tây Chiên (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1
            }
          ],
          "matchesAllModifierQueries": false
        }
      ],
      "total": 1,
      "returned": 1,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"combo burger gà yo & gà rán\",\"burger gà zinger\",\"pepsi tiêu chuẩn\"],\"category\":\"combo\",\"maxpricevnd\":150000,\"partysize\":1,\"modifierqueries\":[\"burger gà yo cay\",\"gà giòn cay\",\"burger gà yo không cay\",\"burger gà yo phô mai\",\"2 miếng gà rán\",\"khoai tây chiên vừa\"]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22combo%20burger%20g%C3%A0%20yo%20%26%20g%C3%A0%20r%C3%A1n%22%2C%22burger%20g%C3%A0%20zinger%22%2C%22pepsi%20ti%C3%AAu%20chu%E1%BA%A9n%22%5D%2C%22category%22%3A%22combo%22%2C%22maxpricevnd%22%3A150000%2C%22partysize%22%3A1%2C%22modifierqueries%22%3A%5B%22burger%20g%C3%A0%20yo%20cay%22%2C%22g%C3%A0%20gi%C3%B2n%20cay%22%2C%22burger%20g%C3%A0%20yo%20kh%C3%B4ng%20cay%22%2C%22burger%20g%C3%A0%20yo%20ph%C3%B4%20mai%22%2C%222%20mi%E1%BA%BFng%20g%C3%A0%20r%C3%A1n%22%2C%22khoai%20t%C3%A2y%20chi%C3%AAn%20v%E1%BB%ABa%22%5D%7D",
      "revision": "cd2ee16af365c27ceee44b00dc360c57b09090477813ade9cb48a13b986fadb2",
      "providerRevision": "menu-result:16bf6e2c208920a27484fc2932dbafd6ed374b3fa2baf536e509085989b0eabd",
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
            "hasModifiers": true,
            "matchedModifiers": [
              {
                "query": "Burger Gà Yo cay",
                "groupId": "60258",
                "groupName": "Burger Yo Mod",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "70443",
                "name": "Burger Gà Yo (Cay)",
                "priceDeltaVnd": 0,
                "default": false,
                "quantity": 0
              },
              {
                "query": "gà giòn cay",
                "groupId": "60254",
                "groupName": "2 COB",
                "groupMin": 2,
                "groupMax": 2,
                "modifierId": "70012",
                "name": "Gà Giòn Cay",
                "priceDeltaVnd": 0,
                "default": false,
                "quantity": 0
              },
              {
                "query": "Burger Gà Yo không cay",
                "groupId": "60258",
                "groupName": "Burger Yo Mod",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "70444",
                "name": "Burger Gà Yo (Không Cay)",
                "priceDeltaVnd": 0,
                "default": false,
                "quantity": 0
              },
              {
                "query": "2 miếng gà rán",
                "groupId": "1",
                "groupName": "main",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "41036",
                "name": "2 Miếng Gà Rán",
                "priceDeltaVnd": 0,
                "default": true,
                "quantity": 1
              },
              {
                "query": "khoai tây chiên vừa",
                "groupId": "3",
                "groupName": "side 2",
                "groupMin": 1,
                "groupMax": 1,
                "modifierId": "41063",
                "name": "Khoai Tây Chiên (Vừa)",
                "priceDeltaVnd": 0,
                "default": true,
                "quantity": 1
              }
            ],
            "matchesAllModifierQueries": false
          }
        ],
        "total": 1,
        "returned": 1,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"combo burger gà yo & gà rán\",\"burger gà zinger\",\"pepsi tiêu chuẩn\"],\"category\":\"combo\",\"maxpricevnd\":150000,\"partysize\":1,\"modifierqueries\":[\"burger gà yo cay\",\"gà giòn cay\",\"burger gà yo không cay\",\"burger gà yo phô mai\",\"2 miếng gà rán\",\"khoai tây chiên vừa\"]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T07:50:15.508Z",
  "completedAt": "2026-07-24T07:50:15.523Z",
  "executionDurationMs": 15
}
```

### Tool result: findStores

```json
{
  "callId": "call_function_e0o4q8nw6ane_2",
  "arguments": {
    "city": "Hồ Chí Minh",
    "district": "Quận 7",
    "query": "Chung cư Sunrise City 23 Nguyễn Hữu Thọ"
  },
  "rawResult": {
    "toolName": "findStores",
    "ok": true,
    "value": [],
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
    "toolName": "findStores",
    "ok": true,
    "value": [],
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ]
  },
  "executionStartedAt": "2026-07-24T07:50:15.530Z",
  "completedAt": "2026-07-24T07:50:15.532Z",
  "executionDurationMs": 2
}
```

### Tool call: findStores

```json
{
  "callId": "call_function_a5c3fj3ni10b_1",
  "arguments": {
    "query": "KFC Quận 7 Hồ Chí Minh"
  },
  "requestedAt": "2026-07-24T07:50:20.117Z"
}
```

### Tool result: findStores

```json
{
  "callId": "call_function_a5c3fj3ni10b_1",
  "arguments": {
    "query": "KFC Quận 7 Hồ Chí Minh"
  },
  "rawResult": {
    "toolName": "findStores",
    "ok": true,
    "value": [
      {
        "storeId": "KFCVN0199",
        "name": "KFC ĐƯỜNG NGUYỄN ẢNH THỦ 2",
        "address": "Số 787 Nguyễn Ảnh Thủ, Phường Tân Chánh Hiệp, Quận 12, Hồ Chí Minh",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0222",
        "name": "KFC TÂN HÒA ĐÔNG",
        "address": "78 C-D Tân Hòa Đông, Phường 14, Quận 6, Tp Hồ Chí Minh",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0230",
        "name": "KFC 87 ĐƯỜNG THÍCH QUẢNG ĐỨC",
        "address": "87 Đường Thích Quảng Đức, Phường 4, Quận Phú Nhuận, Tp.HCM",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0318",
        "name": "KFC PHẠM VĂN NGHỊ",
        "address": "60 Đ. Phạm Văn Nghị, Tân Phong, Quận 7",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0333",
        "name": "KFC ĐƯỜNG LÊ ĐỨC THỌ - HCMC",
        "address": "183-185 Lê Đức Thọ, Phường 17, Quận Gò Vấp (nay là Phường Gò Vấp), Thành phố Hồ Chí Minh",
        "city": "HỒ CHÍ MINH"
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
    "toolName": "findStores",
    "ok": true,
    "value": [
      {
        "storeId": "KFCVN0199",
        "name": "KFC ĐƯỜNG NGUYỄN ẢNH THỦ 2",
        "address": "Số 787 Nguyễn Ảnh Thủ, Phường Tân Chánh Hiệp, Quận 12, Hồ Chí Minh",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0222",
        "name": "KFC TÂN HÒA ĐÔNG",
        "address": "78 C-D Tân Hòa Đông, Phường 14, Quận 6, Tp Hồ Chí Minh",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0230",
        "name": "KFC 87 ĐƯỜNG THÍCH QUẢNG ĐỨC",
        "address": "87 Đường Thích Quảng Đức, Phường 4, Quận Phú Nhuận, Tp.HCM",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0318",
        "name": "KFC PHẠM VĂN NGHỊ",
        "address": "60 Đ. Phạm Văn Nghị, Tân Phong, Quận 7",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0333",
        "name": "KFC ĐƯỜNG LÊ ĐỨC THỌ - HCMC",
        "address": "183-185 Lê Đức Thọ, Phường 17, Quận Gò Vấp (nay là Phường Gò Vấp), Thành phố Hồ Chí Minh",
        "city": "HỒ CHÍ MINH"
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
  "executionStartedAt": "2026-07-24T07:50:20.126Z",
  "completedAt": "2026-07-24T07:50:20.127Z",
  "executionDurationMs": 1
}
```

## Assistant

Mình đã tìm được cửa hàng KFC Phạm Văn Nghị ở Quận 7, địa chỉ Tân Phong – gần khu vực Tân Hưng, Quận 7. Trước khi thêm vào giỏ, mình báo một điểm quan trọng:

**Lưu ý về Combo 20702:** Theo mô tả combo đã bao gồm 2 Ly Pepsi (vừa) và hệ thống cố định các lựa chọn theo nhóm:
- 2 Miếng gà rán (group min/max = 2/2) – mình chọn **Gà Giòn Cay** ✓
- 1 Khoai tây chiên (vừa) – mặc định ✓
- 1 Burger Gà Yo (group min/max = 1/1) – mình chọn **Burger Gà Yo (Cay)** ✓
- 2 Ly Pepsi vừa (mặc định theo combo, không đổi được size)

Bạn vẫn muốn mình thêm 2 Pepsi tiêu chuẩn lẻ ngoài combo đúng không? (Tổng cuối cùng sẽ có 4 ly pepsi: 2 vừa trong combo + 2 tiêu chuẩn lẻ.)

Vui lòng xác nhận để mình thêm vào giỏ và báo phí giao về Chung cư Sunrise City nhé.

## User

Đúng, giữ tổng cộng 4 ly như đã nêu. Mình xác nhận thêm đúng toàn bộ món vào giỏ và kiểm tra phí giao; chưa tạo đơn.

### Tool call: searchMenu

```json
{
  "callId": "call_function_9p7y2mbzpazi_1",
  "arguments": {
    "category": null,
    "maxPriceVnd": 200000,
    "mode": "search",
    "modifierQueries": [],
    "partySize": 1,
    "queries": [
      "Combo Burger Gà Yo & Gà Rán",
      "Burger Gà Zinger",
      "Pepsi tiêu chuẩn"
    ]
  },
  "requestedAt": "2026-07-24T07:51:07.051Z"
}
```

### Tool call: findStores

```json
{
  "callId": "call_function_9p7y2mbzpazi_2",
  "arguments": {
    "city": "Hồ Chí Minh",
    "district": "Quận 7",
    "query": ""
  },
  "requestedAt": "2026-07-24T07:51:07.059Z"
}
```

### Tool failure: findStores

```json
{
  "callId": "call_function_9p7y2mbzpazi_2",
  "arguments": {
    "city": "Hồ Chí Minh",
    "district": "Quận 7",
    "query": ""
  },
  "error": {
    "name": "Error",
    "message": "local_evidence_tool_arguments_invalid"
  },
  "completedAt": "2026-07-24T07:51:07.066Z",
  "requestedAt": "2026-07-24T07:51:07.059Z",
  "totalDurationMs": 7
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_function_9p7y2mbzpazi_1",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Burger Gà Yo & Gà Rán",
      "Burger Gà Zinger",
      "Pepsi tiêu chuẩn"
    ],
    "modifierQueries": [],
    "maxPriceVnd": 200000,
    "partySize": 1
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Combo Burger Gà Yo & Gà Rán",
        "Burger Gà Zinger",
        "Pepsi tiêu chuẩn"
      ],
      "total": 37,
      "returned": 37,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Combo Burger Gà Yo & Gà Rán\",\"Burger Gà Zinger\",\"Pepsi tiêu chuẩn\"],\"maxPriceVnd\":200000,\"partySize\":1,\"modifierQueries\":[]}"
      },
      "items": [
        {
          "code": "41141",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Gà Zinger",
          "description": "1 Burger Gà Zinger + 1 Gói tương (cà/ ớt)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Zinger.jpg?v=LNN7PL",
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
          "code": "41042",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Gà Yo",
          "description": "1 phần Burger Gà Yo (cay)/1 phần Burger Gà Yo (không cay)",
          "priceVnd": 30000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BURGER-GAYO.jpg?v=LNN7PL",
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
          "code": "41043",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Phi-lê Gà Quay",
          "description": "1 Burger Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Flava.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
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
          "code": "41046",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Mì Ý Xúc Xích Gà",
          "description": "1 Mì Ý Xúc Xích Gà",
          "priceVnd": 38000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41047",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Mì Ý Gà Viên",
          "description": "1 Mì Ý Gà Viên",
          "priceVnd": 43000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta-Popcorn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41050",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "1 Cơm Gà Viên Nanban",
          "description": "1 Cơm Gà Viên Nanban + 1 Gói tương (cà/ ớt)",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/NANBAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41051",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "1 Cơm Phi-lê Gà Quay",
          "description": "1 Cơm Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
          "priceVnd": 54000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Rice-Flava.jpg?v=LNN7PL",
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
          "code": "41141",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Gà Zinger",
          "description": "1 Burger Gà Zinger + 1 Gói tương (cà/ ớt)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Zinger.jpg?v=LNN7PL",
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
          "code": "41042",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Gà Yo",
          "description": "1 phần Burger Gà Yo (cay)/1 phần Burger Gà Yo (không cay)",
          "priceVnd": 30000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BURGER-GAYO.jpg?v=LNN7PL",
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
          "code": "41043",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Burger Phi-lê Gà Quay",
          "description": "1 Burger Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
          "priceVnd": 56000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Flava.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": true,
          "hasModifiers": true
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
          "code": "41046",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Mì Ý Xúc Xích Gà",
          "description": "1 Mì Ý Xúc Xích Gà",
          "priceVnd": 38000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41047",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "Mì Ý Gà Viên",
          "description": "1 Mì Ý Gà Viên",
          "priceVnd": 43000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta-Popcorn.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41050",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "1 Cơm Gà Viên Nanban",
          "description": "1 Cơm Gà Viên Nanban + 1 Gói tương (cà/ ớt)",
          "priceVnd": 40000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/NANBAN.jpg?v=LNN7PL",
          "available": true,
          "isCustomize": false,
          "hasModifiers": false
        },
        {
          "code": "41051",
          "category": "Burger - Cơm - Mì Ý",
          "categoryId": "20004",
          "name": "1 Cơm Phi-lê Gà Quay",
          "description": "1 Cơm Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
          "priceVnd": 54000,
          "originalPriceVnd": null,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Rice-Flava.jpg?v=LNN7PL",
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
      "total": 37,
      "returned": 37,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"combo burger gà yo & gà rán\",\"burger gà zinger\",\"pepsi tiêu chuẩn\"],\"maxpricevnd\":200000,\"partysize\":1,\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22combo%20burger%20g%C3%A0%20yo%20%26%20g%C3%A0%20r%C3%A1n%22%2C%22burger%20g%C3%A0%20zinger%22%2C%22pepsi%20ti%C3%AAu%20chu%E1%BA%A9n%22%5D%2C%22maxpricevnd%22%3A200000%2C%22partysize%22%3A1%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "7ad7242f70ddafc5212f31cde3719efaf1de537ba62a99078791525a1e3f2094",
      "providerRevision": "menu-result:dc40399c71d998d281e25a3673e73c7a964ebfecd8f5f4e82e1f57d0f8463c64",
      "result": {
        "items": [
          {
            "code": "41141",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Burger Gà Zinger",
            "description": "1 Burger Gà Zinger + 1 Gói tương (cà/ ớt)",
            "priceVnd": 56000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Zinger.jpg?v=LNN7PL",
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
            "code": "41042",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Burger Gà Yo",
            "description": "1 phần Burger Gà Yo (cay)/1 phần Burger Gà Yo (không cay)",
            "priceVnd": 30000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/BURGER-GAYO.jpg?v=LNN7PL",
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
            "code": "41043",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Burger Phi-lê Gà Quay",
            "description": "1 Burger Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
            "priceVnd": 56000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Burger-Flava.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": true,
            "hasModifiers": true
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
            "code": "41046",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Mì Ý Xúc Xích Gà",
            "description": "1 Mì Ý Xúc Xích Gà",
            "priceVnd": 38000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41047",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "Mì Ý Gà Viên",
            "description": "1 Mì Ý Gà Viên",
            "priceVnd": 43000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Sausage-Pasta-Popcorn.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41050",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "1 Cơm Gà Viên Nanban",
            "description": "1 Cơm Gà Viên Nanban + 1 Gói tương (cà/ ớt)",
            "priceVnd": 40000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/NANBAN.jpg?v=LNN7PL",
            "available": true,
            "isCustomize": false,
            "hasModifiers": false
          },
          {
            "code": "41051",
            "category": "Burger - Cơm - Mì Ý",
            "categoryId": "20004",
            "name": "1 Cơm Phi-lê Gà Quay",
            "description": "1 Cơm Phi-lê Gà Quay + 1 Gói tương (cà/ ớt)",
            "priceVnd": 54000,
            "originalPriceVnd": null,
            "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/Rice-Flava.jpg?v=LNN7PL",
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
        "total": 37,
        "returned": 37,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"combo burger gà yo & gà rán\",\"burger gà zinger\",\"pepsi tiêu chuẩn\"],\"maxpricevnd\":200000,\"partysize\":1,\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T07:51:07.078Z",
  "completedAt": "2026-07-24T07:51:07.086Z",
  "executionDurationMs": 8
}
```

### Tool call: findStores

```json
{
  "callId": "call_function_z6hxfhk91lkw_1",
  "arguments": {
    "city": "Thành phố Hồ Chí Minh",
    "district": "Quận 7",
    "query": ""
  },
  "requestedAt": "2026-07-24T07:51:12.908Z"
}
```

### Tool failure: findStores

```json
{
  "callId": "call_function_z6hxfhk91lkw_1",
  "arguments": {
    "city": "Thành phố Hồ Chí Minh",
    "district": "Quận 7",
    "query": ""
  },
  "error": {
    "name": "Error",
    "message": "local_evidence_tool_arguments_invalid"
  },
  "completedAt": "2026-07-24T07:51:12.916Z",
  "requestedAt": "2026-07-24T07:51:12.908Z",
  "totalDurationMs": 8
}
```

### Tool call: getModifierOptions

```json
{
  "callId": "call_function_z6hxfhk91lkw_2",
  "arguments": {
    "code": "20702"
  },
  "requestedAt": "2026-07-24T07:51:12.924Z"
}
```

### Tool result: getModifierOptions

```json
{
  "callId": "call_function_z6hxfhk91lkw_2",
  "arguments": {
    "code": "20702"
  },
  "rawResult": {
    "toolName": "getModifierOptions",
    "ok": true,
    "value": {
      "itemCode": "20702",
      "itemId": "20702",
      "productCode": "EC.CBO-B.GaYo-COB_",
      "name": "Combo Burger Gà Yo & Gà Rán",
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "main",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41036",
              "name": "2 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150002",
              "imageName": "2-Fried-Chicken",
              "modifierGroups": [
                {
                  "groupId": "60254",
                  "name": "2 COB",
                  "min": 2,
                  "max": 2,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70003",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "101001",
                      "imageName": "MOD-Ga-Truyen-Thong",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70012",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "102001",
                      "imageName": "MOD-Ga-Gion-Cay",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70017",
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
          "name": "side",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41042",
              "name": "Burger Gà Yo",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150012",
              "imageName": "BURGER-GAYO",
              "modifierGroups": [
                {
                  "groupId": "60258",
                  "name": "Burger Yo Mod",
                  "min": 1,
                  "max": 1,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70443",
                      "name": "Burger Gà Yo (Cay)",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "120036",
                      "imageName": "BURGER-GAYO",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70444",
                      "name": "Burger Gà Yo (Không Cay)",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "120037",
                      "imageName": "BURGER-GAYO",
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
          "name": "side 2",
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
              "posItemId": "150033",
              "imageName": "FF-R",
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
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 3000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
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
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 3000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
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
      "itemCode": "20702",
      "itemId": "20702",
      "productCode": "EC.CBO-B.GaYo-COB_",
      "name": "Combo Burger Gà Yo & Gà Rán",
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "main",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41036",
              "name": "2 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150002",
              "imageName": "2-Fried-Chicken",
              "modifierGroups": [
                {
                  "groupId": "60254",
                  "name": "2 COB",
                  "min": 2,
                  "max": 2,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70003",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "101001",
                      "imageName": "MOD-Ga-Truyen-Thong",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70012",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "102001",
                      "imageName": "MOD-Ga-Gion-Cay",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70017",
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
          "name": "side",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41042",
              "name": "Burger Gà Yo",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150012",
              "imageName": "BURGER-GAYO",
              "modifierGroups": [
                {
                  "groupId": "60258",
                  "name": "Burger Yo Mod",
                  "min": 1,
                  "max": 1,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70443",
                      "name": "Burger Gà Yo (Cay)",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "120036",
                      "imageName": "BURGER-GAYO",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70444",
                      "name": "Burger Gà Yo (Không Cay)",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "120037",
                      "imageName": "BURGER-GAYO",
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
          "name": "side 2",
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
              "posItemId": "150033",
              "imageName": "FF-R",
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
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 3000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
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
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 3000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
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
  "executionStartedAt": "2026-07-24T07:51:12.933Z",
  "completedAt": "2026-07-24T07:51:12.934Z",
  "executionDurationMs": 1
}
```

### Tool call: findStores

```json
{
  "callId": "call_function_5shvj2c19n0w_1",
  "arguments": {
    "city": "Hồ Chí Minh",
    "district": "Quận 7",
    "query": "KFC Quận 7"
  },
  "requestedAt": "2026-07-24T07:51:18.829Z"
}
```

### Tool result: findStores

```json
{
  "callId": "call_function_5shvj2c19n0w_1",
  "arguments": {
    "city": "Hồ Chí Minh",
    "district": "Quận 7",
    "query": "KFC Quận 7"
  },
  "rawResult": {
    "toolName": "findStores",
    "ok": true,
    "value": [
      {
        "storeId": "KFCVN0199",
        "name": "KFC ĐƯỜNG NGUYỄN ẢNH THỦ 2",
        "address": "Số 787 Nguyễn Ảnh Thủ, Phường Tân Chánh Hiệp, Quận 12, Hồ Chí Minh",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0222",
        "name": "KFC TÂN HÒA ĐÔNG",
        "address": "78 C-D Tân Hòa Đông, Phường 14, Quận 6, Tp Hồ Chí Minh",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0230",
        "name": "KFC 87 ĐƯỜNG THÍCH QUẢNG ĐỨC",
        "address": "87 Đường Thích Quảng Đức, Phường 4, Quận Phú Nhuận, Tp.HCM",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0318",
        "name": "KFC PHẠM VĂN NGHỊ",
        "address": "60 Đ. Phạm Văn Nghị, Tân Phong, Quận 7",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0333",
        "name": "KFC ĐƯỜNG LÊ ĐỨC THỌ - HCMC",
        "address": "183-185 Lê Đức Thọ, Phường 17, Quận Gò Vấp (nay là Phường Gò Vấp), Thành phố Hồ Chí Minh",
        "city": "HỒ CHÍ MINH"
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
    "toolName": "findStores",
    "ok": true,
    "value": [
      {
        "storeId": "KFCVN0199",
        "name": "KFC ĐƯỜNG NGUYỄN ẢNH THỦ 2",
        "address": "Số 787 Nguyễn Ảnh Thủ, Phường Tân Chánh Hiệp, Quận 12, Hồ Chí Minh",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0222",
        "name": "KFC TÂN HÒA ĐÔNG",
        "address": "78 C-D Tân Hòa Đông, Phường 14, Quận 6, Tp Hồ Chí Minh",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0230",
        "name": "KFC 87 ĐƯỜNG THÍCH QUẢNG ĐỨC",
        "address": "87 Đường Thích Quảng Đức, Phường 4, Quận Phú Nhuận, Tp.HCM",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0318",
        "name": "KFC PHẠM VĂN NGHỊ",
        "address": "60 Đ. Phạm Văn Nghị, Tân Phong, Quận 7",
        "city": "HỒ CHÍ MINH"
      },
      {
        "storeId": "KFCVN0333",
        "name": "KFC ĐƯỜNG LÊ ĐỨC THỌ - HCMC",
        "address": "183-185 Lê Đức Thọ, Phường 17, Quận Gò Vấp (nay là Phường Gò Vấp), Thành phố Hồ Chí Minh",
        "city": "HỒ CHÍ MINH"
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
  "executionStartedAt": "2026-07-24T07:51:18.839Z",
  "completedAt": "2026-07-24T07:51:18.840Z",
  "executionDurationMs": 1
}
```

### Tool call: checkStoreAvailability

```json
{
  "callId": "call_function_82szdhgxmafz_1",
  "arguments": {
    "disposition": "delivery",
    "itemCodes": [
      "20702",
      "41141",
      "41074"
    ],
    "storeId": "KFCVN0318"
  },
  "requestedAt": "2026-07-24T07:51:21.201Z"
}
```

### Tool result: checkStoreAvailability

```json
{
  "callId": "call_function_82szdhgxmafz_1",
  "arguments": {
    "disposition": "delivery",
    "itemCodes": [
      "20702",
      "41141",
      "41074"
    ],
    "storeId": "KFCVN0318"
  },
  "rawResult": {
    "toolName": "checkStoreAvailability",
    "ok": true,
    "value": {
      "20702": true,
      "41074": true,
      "41141": true
    },
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ],
    "inventoryAvailabilityAuthority": {
      "providerRevision": "inventory:4c5b4f24201b933309be4322ef3018f2f79bd171421b06f68067499b279c4246",
      "observedAt": "2026-07-24T07:51:21.212Z",
      "expiresAt": "2026-07-24T07:56:21.212Z"
    }
  },
  "modelFacingResult": {
    "toolName": "checkStoreAvailability",
    "ok": true,
    "value": {
      "20702": true,
      "41074": true,
      "41141": true
    },
    "message": "ok",
    "provenance": [
      {
        "fixtureMode": "provider_runtime",
        "sourceFile": "src/mock/createMockClients.ts",
        "sourceApi": "mock-commerce-provider"
      }
    ],
    "inventoryAvailabilityAuthority": {
      "providerRevision": "inventory:4c5b4f24201b933309be4322ef3018f2f79bd171421b06f68067499b279c4246",
      "observedAt": "2026-07-24T07:51:21.212Z",
      "expiresAt": "2026-07-24T07:56:21.212Z"
    }
  },
  "executionStartedAt": "2026-07-24T07:51:21.212Z",
  "completedAt": "2026-07-24T07:51:21.217Z",
  "executionDurationMs": 5
}
```

## Assistant

Cả 3 món đều còn tại KFC Phạm Văn Nghị. Mình sẽ chuẩn bị đề xuất giỏ cho bạn xác nhận:

🛒 **Giỏ hàng đề xuất (giao về Sunrise City, Quận 7)**

| Món | SL | Đơn giá | Thành tiền |
|---|---|---|---|
| Combo Burger Gà Yo & Gà Rán (gà giòn cay, burger yo cay) | 1 | 129.000 | 129.000 |
| Burger Gà Zinger | 1 | 56.000 | 56.000 |
| Pepsi (Tiêu Chuẩn) | 2 | 13.000 | 26.000 |
| **Tạm tính món** | | | **211.000** |

Bạn xác nhận cho mình thì mình sẽ thêm vào giỏ và báo phí giao chính xác về Chung cư Sunrise City nhé?

## User

XÁC NHẬN: thêm ngay đúng các món trong bảng vào giỏ. Đây là sự đồng ý rõ ràng để thay đổi giỏ, nhưng chưa đồng ý tạo đơn.

### Tool call: getModifierOptions

```json
{
  "callId": "call_function_uw5je2vvfz4q_1",
  "arguments": {
    "code": "20702"
  },
  "requestedAt": "2026-07-24T07:51:48.655Z"
}
```

### Tool call: getModifierOptions

```json
{
  "callId": "call_function_uw5je2vvfz4q_2",
  "arguments": {
    "code": "41141"
  },
  "requestedAt": "2026-07-24T07:51:48.664Z"
}
```

### Tool result: getModifierOptions

```json
{
  "callId": "call_function_uw5je2vvfz4q_1",
  "arguments": {
    "code": "20702"
  },
  "rawResult": {
    "toolName": "getModifierOptions",
    "ok": true,
    "value": {
      "itemCode": "20702",
      "itemId": "20702",
      "productCode": "EC.CBO-B.GaYo-COB_",
      "name": "Combo Burger Gà Yo & Gà Rán",
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "main",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41036",
              "name": "2 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150002",
              "imageName": "2-Fried-Chicken",
              "modifierGroups": [
                {
                  "groupId": "60254",
                  "name": "2 COB",
                  "min": 2,
                  "max": 2,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70003",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "101001",
                      "imageName": "MOD-Ga-Truyen-Thong",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70012",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "102001",
                      "imageName": "MOD-Ga-Gion-Cay",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70017",
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
          "name": "side",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41042",
              "name": "Burger Gà Yo",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150012",
              "imageName": "BURGER-GAYO",
              "modifierGroups": [
                {
                  "groupId": "60258",
                  "name": "Burger Yo Mod",
                  "min": 1,
                  "max": 1,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70443",
                      "name": "Burger Gà Yo (Cay)",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "120036",
                      "imageName": "BURGER-GAYO",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70444",
                      "name": "Burger Gà Yo (Không Cay)",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "120037",
                      "imageName": "BURGER-GAYO",
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
          "name": "side 2",
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
              "posItemId": "150033",
              "imageName": "FF-R",
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
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 3000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
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
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 3000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
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
      "itemCode": "20702",
      "itemId": "20702",
      "productCode": "EC.CBO-B.GaYo-COB_",
      "name": "Combo Burger Gà Yo & Gà Rán",
      "modifierGroups": [
        {
          "groupId": "1",
          "name": "main",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41036",
              "name": "2 Miếng Gà Rán",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150002",
              "imageName": "2-Fried-Chicken",
              "modifierGroups": [
                {
                  "groupId": "60254",
                  "name": "2 COB",
                  "min": 2,
                  "max": 2,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70003",
                      "name": "Gà Truyền Thống",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "101001",
                      "imageName": "MOD-Ga-Truyen-Thong",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70012",
                      "name": "Gà Giòn Cay",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "102001",
                      "imageName": "MOD-Ga-Gion-Cay",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70017",
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
          "name": "side",
          "min": 1,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "41042",
              "name": "Burger Gà Yo",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150012",
              "imageName": "BURGER-GAYO",
              "modifierGroups": [
                {
                  "groupId": "60258",
                  "name": "Burger Yo Mod",
                  "min": 1,
                  "max": 1,
                  "depth": 1,
                  "options": [
                    {
                      "modifierId": "70443",
                      "name": "Burger Gà Yo (Cay)",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "120036",
                      "imageName": "BURGER-GAYO",
                      "modifierGroups": []
                    },
                    {
                      "modifierId": "70444",
                      "name": "Burger Gà Yo (Không Cay)",
                      "priceDeltaVnd": 0,
                      "default": false,
                      "quantity": 0,
                      "posItemId": "120037",
                      "imageName": "BURGER-GAYO",
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
          "name": "side 2",
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
              "posItemId": "150033",
              "imageName": "FF-R",
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
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 3000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
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
              "modifierId": "41090",
              "name": "Pepsi (Vừa)",
              "priceDeltaVnd": 0,
              "default": true,
              "quantity": 1,
              "posItemId": "150051",
              "imageName": "PEPSI-M",
              "modifierGroups": []
            },
            {
              "modifierId": "41091",
              "name": "Pepsi (Đại)",
              "priceDeltaVnd": 3000,
              "default": false,
              "quantity": 1,
              "posItemId": "150050",
              "imageName": "PEPSI-J",
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
  "executionStartedAt": "2026-07-24T07:51:48.675Z",
  "completedAt": "2026-07-24T07:51:48.675Z",
  "executionDurationMs": 0
}
```

### Tool result: getModifierOptions

```json
{
  "callId": "call_function_uw5je2vvfz4q_2",
  "arguments": {
    "code": "41141"
  },
  "rawResult": {
    "toolName": "getModifierOptions",
    "ok": true,
    "value": {
      "itemCode": "41141",
      "itemId": "41141",
      "productCode": "Burger-Zinger",
      "name": "Burger Gà Zinger",
      "modifierGroups": [
        {
          "groupId": "60284",
          "name": "B.Zinger MOD",
          "min": 0,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "70046",
              "name": "Thêm Phô Mai",
              "priceDeltaVnd": 8000,
              "default": false,
              "quantity": 0,
              "posItemId": "",
              "imageName": "Cheese",
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
      "itemCode": "41141",
      "itemId": "41141",
      "productCode": "Burger-Zinger",
      "name": "Burger Gà Zinger",
      "modifierGroups": [
        {
          "groupId": "60284",
          "name": "B.Zinger MOD",
          "min": 0,
          "max": 1,
          "depth": 0,
          "options": [
            {
              "modifierId": "70046",
              "name": "Thêm Phô Mai",
              "priceDeltaVnd": 8000,
              "default": false,
              "quantity": 0,
              "posItemId": "",
              "imageName": "Cheese",
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
  "executionStartedAt": "2026-07-24T07:51:48.685Z",
  "completedAt": "2026-07-24T07:51:48.685Z",
  "executionDurationMs": 0
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_function_3nenzxtfp0vf_1",
  "arguments": {
    "category": "drinks",
    "maxPriceVnd": 20000,
    "mode": "search",
    "modifierQueries": [],
    "partySize": 1,
    "queries": [
      "Pepsi tiêu chuẩn"
    ]
  },
  "requestedAt": "2026-07-24T07:51:51.044Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_function_3nenzxtfp0vf_1",
  "arguments": {
    "mode": "search",
    "queries": [
      "Pepsi tiêu chuẩn"
    ],
    "modifierQueries": [],
    "category": "drinks",
    "maxPriceVnd": 20000,
    "partySize": 1
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Pepsi tiêu chuẩn"
      ],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Pepsi tiêu chuẩn\"],\"category\":\"drinks\",\"maxPriceVnd\":20000,\"partySize\":1,\"modifierQueries\":[]}"
      },
      "items": []
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
      "items": [],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"pepsi tiêu chuẩn\"],\"category\":\"drinks\",\"maxpricevnd\":20000,\"partysize\":1,\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22pepsi%20ti%C3%AAu%20chu%E1%BA%A9n%22%5D%2C%22category%22%3A%22drinks%22%2C%22maxpricevnd%22%3A20000%2C%22partysize%22%3A1%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "341a6c9187d124adffdacab3524f32818df485a13493b774bb4685dbffd60363",
      "providerRevision": "menu-result:59440161a600903d915f3967e98ece8dca355e6deecbed52070eef51b404a54b",
      "result": {
        "items": [],
        "total": 0,
        "returned": 0,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"pepsi tiêu chuẩn\"],\"category\":\"drinks\",\"maxpricevnd\":20000,\"partysize\":1,\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T07:51:51.054Z",
  "completedAt": "2026-07-24T07:51:51.056Z",
  "executionDurationMs": 2
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_function_5jwsbv0x8jn7_1",
  "arguments": {
    "category": "đồ uống",
    "maxPriceVnd": 20000,
    "mode": "search",
    "modifierQueries": [],
    "partySize": 1,
    "queries": [
      "Pepsi",
      "Pepsi nhỏ"
    ]
  },
  "requestedAt": "2026-07-24T07:51:53.586Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_function_5jwsbv0x8jn7_1",
  "arguments": {
    "mode": "search",
    "queries": [
      "Pepsi",
      "Pepsi nhỏ"
    ],
    "modifierQueries": [],
    "category": "đồ uống",
    "maxPriceVnd": 20000,
    "partySize": 1
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Pepsi",
        "Pepsi nhỏ"
      ],
      "total": 9,
      "returned": 9,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Pepsi\",\"Pepsi nhỏ\"],\"category\":\"đồ uống\",\"maxPriceVnd\":20000,\"partySize\":1,\"modifierQueries\":[]}"
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
        }
      ],
      "total": 9,
      "returned": 9,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"pepsi\",\"pepsi nhỏ\"],\"category\":\"đồ uống\",\"maxpricevnd\":20000,\"partysize\":1,\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22pepsi%22%2C%22pepsi%20nh%E1%BB%8F%22%5D%2C%22category%22%3A%22%C4%91%E1%BB%93%20u%E1%BB%91ng%22%2C%22maxpricevnd%22%3A20000%2C%22partysize%22%3A1%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "89ad60238a1b2772241a2af20720244f4f1fefb5a3f8e026e1a2361449a86457",
      "providerRevision": "menu-result:0d129b6f45a3a2070731d0869cb9d37b98ae7742d6734e906da049886cdb8214",
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
          }
        ],
        "total": 9,
        "returned": 9,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"pepsi\",\"pepsi nhỏ\"],\"category\":\"đồ uống\",\"maxpricevnd\":20000,\"partysize\":1,\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T07:51:53.597Z",
  "completedAt": "2026-07-24T07:51:53.600Z",
  "executionDurationMs": 3
}
```

### Tool call: handoff

```json
{
  "callId": "call_function_vtsz92txm35m_1",
  "arguments": {
    "reasons": [
      "Khách đã xác nhận thêm vào giỏ 3 món: 1 Combo Burger Gà Yo &amp; Gà Rán (20702) với gà giòn cay &amp; burger yo cay; 1 Burger Gà Zinger (41141); 2 Pepsi (Tiêu Chuẩn) 41074. Cần thực hiện thêm giỏ và báo phí giao về Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, Tân Hưng, Quận 7. Khách chưa đồng ý tạo đơn.",
      "Cần nhân viên hỗ trợ thao tác cập nhật giỏ hàng đúng mã món đã xác minh và báo phí giao chính xác cho địa chỉ Quận 7, đồng thời giữ quyền kiểm soát tạo đơn của khách."
    ]
  },
  "requestedAt": "2026-07-24T07:52:02.089Z"
}
```

### Tool result: handoff

```json
{
  "callId": "call_function_vtsz92txm35m_1",
  "arguments": {
    "reasons": [
      "Khách đã xác nhận thêm vào giỏ 3 món: 1 Combo Burger Gà Yo &amp; Gà Rán (20702) với gà giòn cay &amp; burger yo cay; 1 Burger Gà Zinger (41141); 2 Pepsi (Tiêu Chuẩn) 41074. Cần thực hiện thêm giỏ và báo phí giao về Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, Tân Hưng, Quận 7. Khách chưa đồng ý tạo đơn.",
      "Cần nhân viên hỗ trợ thao tác cập nhật giỏ hàng đúng mã món đã xác minh và báo phí giao chính xác cho địa chỉ Quận 7, đồng thời giữ quyền kiểm soát tạo đơn của khách."
    ]
  },
  "rawResult": {
    "toolName": "handoff",
    "ok": true,
    "value": {
      "escalationId": "handoff_live-20260724-final-minimax-s01-a1_1_Khách đã xác nhận thêm vào giỏ 3 món: 1 Combo Burger Gà Yo &amp; Gà Rán (20702) với gà giòn cay &amp; burger yo cay; 1 Burger Gà Zinger (41141); 2 Pepsi (Tiêu Chuẩn) 41074. Cần thực hiện thêm giỏ và báo phí giao về Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, Tân Hưng, Quận 7. Khách chưa đồng ý tạo đơn._Cần nhân viên hỗ trợ thao tác cập nhật giỏ hàng đúng mã món đã xác minh và báo phí giao chính xác cho địa chỉ Quận 7, đồng thời giữ quyền kiểm soát tạo đơn của khách."
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
    "toolName": "handoff",
    "ok": true,
    "value": {
      "escalationId": "handoff_live-20260724-final-minimax-s01-a1_1_Khách đã xác nhận thêm vào giỏ 3 món: 1 Combo Burger Gà Yo &amp; Gà Rán (20702) với gà giòn cay &amp; burger yo cay; 1 Burger Gà Zinger (41141); 2 Pepsi (Tiêu Chuẩn) 41074. Cần thực hiện thêm giỏ và báo phí giao về Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, Tân Hưng, Quận 7. Khách chưa đồng ý tạo đơn._Cần nhân viên hỗ trợ thao tác cập nhật giỏ hàng đúng mã món đã xác minh và báo phí giao chính xác cho địa chỉ Quận 7, đồng thời giữ quyền kiểm soát tạo đơn của khách."
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
  "executionStartedAt": "2026-07-24T07:52:02.102Z",
  "completedAt": "2026-07-24T07:52:02.102Z",
  "executionDurationMs": 0
}
```

## Assistant

Yêu cầu gặp nhân viên của bạn đã được ghi nhận và đang chờ nhân viên tiếp nhận. Hiện chưa có thời gian phản hồi được xác minh.

