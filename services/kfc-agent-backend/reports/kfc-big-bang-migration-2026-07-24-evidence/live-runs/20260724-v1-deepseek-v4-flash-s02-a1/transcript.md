# Live transcript: 02: Tư vấn combo, ngân sách, khuyến mãi, upsell

- Run: `20260724-v1-deepseek-v4-flash-s02-a1` (attempt 1)
- Model: `deepseek-v4-flash` via `openai_compatible_chat`
- Scenario source SHA-256: `31a4511881be7cbfe03c66a6ddfadceb13e81c5dbe1f625cbd1c0ce9a84cf104`

## User

Nhóm mình 4 người, ngân sách khoảng 300 nghìn. Mình định lấy 4 miếng gà rán, 2 mì Ý, 2 khoai vừa và 4 ly Pepsi. Bạn xem đặt món lẻ vậy ổn không nhé.

### Tool call: searchMenu

```json
{
  "callId": "call_00_7bgoBSVAHuNx1nyiYi0j1828",
  "arguments": {
    "mode": "search",
    "queries": [
      "Gà rán",
      "Mì Ý",
      "Khoai tây vừa",
      "Pepsi"
    ],
    "category": "null",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:13:05.882Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_7bgoBSVAHuNx1nyiYi0j1828",
  "arguments": {
    "mode": "search",
    "queries": [
      "Gà rán",
      "Mì Ý",
      "Khoai tây vừa",
      "Pepsi"
    ],
    "modifierQueries": [],
    "category": "null"
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Gà rán",
        "Mì Ý",
        "Khoai tây vừa",
        "Pepsi"
      ],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Gà rán\",\"Mì Ý\",\"Khoai tây vừa\",\"Pepsi\"],\"category\":\"null\",\"modifierQueries\":[]}"
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
        "query": "{\"mode\":\"search\",\"queries\":[\"gà rán\",\"mì ý\",\"khoai tây vừa\",\"pepsi\"],\"category\":\"null\",\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22g%C3%A0%20r%C3%A1n%22%2C%22m%C3%AC%20%C3%BD%22%2C%22khoai%20t%C3%A2y%20v%E1%BB%ABa%22%2C%22pepsi%22%5D%2C%22category%22%3A%22null%22%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "af2ccd1aced8ab9a9db7a7ee3a22b5040a4eef112c9326ea8e4fa3641a9fea2e",
      "providerRevision": "menu-result:425e4124d0cbd264a81f022c318a2096929f66c36b12559ac47cb88647a1f609",
      "result": {
        "items": [],
        "total": 0,
        "returned": 0,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"gà rán\",\"mì ý\",\"khoai tây vừa\",\"pepsi\"],\"category\":\"null\",\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:13:05.893Z",
  "completedAt": "2026-07-24T01:13:05.899Z",
  "executionDurationMs": 6
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_KtpQ2jF8s57qQkpbNXfb5437",
  "arguments": {
    "mode": "full",
    "queries": [
      "menu"
    ],
    "category": "null",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:13:08.034Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_KtpQ2jF8s57qQkpbNXfb5437",
  "arguments": {
    "mode": "full",
    "queries": [
      "menu"
    ],
    "modifierQueries": [],
    "category": "null"
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "full",
      "queries": [
        "menu"
      ],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"full\",\"queries\":[\"menu\"],\"category\":\"null\",\"modifierQueries\":[]}"
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
        "query": "{\"mode\":\"full\",\"queries\":[\"menu\"],\"category\":\"null\",\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22full%22%2C%22queries%22%3A%5B%22menu%22%5D%2C%22category%22%3A%22null%22%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "28064dfc1e6fb972fbc70cf3298830b1c375f03a4364a442c6ac8598ad7e3841",
      "providerRevision": "menu-result:a77f5f89213a5ffecbe1906fac57e194efcd3f2803b98145fcfd499c814c374b",
      "result": {
        "items": [],
        "total": 0,
        "returned": 0,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"full\",\"queries\":[\"menu\"],\"category\":\"null\",\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:13:08.037Z",
  "completedAt": "2026-07-24T01:13:08.039Z",
  "executionDurationMs": 2
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_Rcb1YNNsaEiewMdGgYgV4629",
  "arguments": {
    "mode": "search",
    "queries": [
      "Gà rán truyền thống",
      "Mì Ý sốt bò",
      "Khoai tây chiên",
      "Pepsi"
    ],
    "category": "null",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:13:10.462Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_Rcb1YNNsaEiewMdGgYgV4629",
  "arguments": {
    "mode": "search",
    "queries": [
      "Gà rán truyền thống",
      "Mì Ý sốt bò",
      "Khoai tây chiên",
      "Pepsi"
    ],
    "modifierQueries": [],
    "category": "null"
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Gà rán truyền thống",
        "Mì Ý sốt bò",
        "Khoai tây chiên",
        "Pepsi"
      ],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Gà rán truyền thống\",\"Mì Ý sốt bò\",\"Khoai tây chiên\",\"Pepsi\"],\"category\":\"null\",\"modifierQueries\":[]}"
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
        "query": "{\"mode\":\"search\",\"queries\":[\"gà rán truyền thống\",\"mì ý sốt bò\",\"khoai tây chiên\",\"pepsi\"],\"category\":\"null\",\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22g%C3%A0%20r%C3%A1n%20truy%E1%BB%81n%20th%E1%BB%91ng%22%2C%22m%C3%AC%20%C3%BD%20s%E1%BB%91t%20b%C3%B2%22%2C%22khoai%20t%C3%A2y%20chi%C3%AAn%22%2C%22pepsi%22%5D%2C%22category%22%3A%22null%22%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "d72c6ba552188b38b7873c9b6c57e69e200be2451cdef9bf092af58ddedd0966",
      "providerRevision": "menu-result:07d612aac592e17003c93a8351d2c95146a357fdc370af25108c1aa368233d8b",
      "result": {
        "items": [],
        "total": 0,
        "returned": 0,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"gà rán truyền thống\",\"mì ý sốt bò\",\"khoai tây chiên\",\"pepsi\"],\"category\":\"null\",\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:13:10.468Z",
  "completedAt": "2026-07-24T01:13:10.472Z",
  "executionDurationMs": 4
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_CJSzm3UjvOUPCVw3iMXg9450",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo",
      "Nhóm",
      "4 người",
      "Family"
    ],
    "category": "null",
    "maxPriceVnd": 300000,
    "partySize": 4,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:13:13.204Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_CJSzm3UjvOUPCVw3iMXg9450",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo",
      "Nhóm",
      "4 người",
      "Family"
    ],
    "modifierQueries": [],
    "category": "null",
    "maxPriceVnd": 300000,
    "partySize": 4
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Combo",
        "Nhóm",
        "4 người",
        "Family"
      ],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Combo\",\"Nhóm\",\"4 người\",\"Family\"],\"category\":\"null\",\"maxPriceVnd\":300000,\"partySize\":4,\"modifierQueries\":[]}"
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
        "query": "{\"mode\":\"search\",\"queries\":[\"combo\",\"nhóm\",\"4 người\",\"family\"],\"category\":\"null\",\"maxpricevnd\":300000,\"partysize\":4,\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22combo%22%2C%22nh%C3%B3m%22%2C%224%20ng%C6%B0%E1%BB%9Di%22%2C%22family%22%5D%2C%22category%22%3A%22null%22%2C%22maxpricevnd%22%3A300000%2C%22partysize%22%3A4%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "915cf161c9e5329fe0cebbfb4f45c063156dc0773be992d2d95ad0a9408a0244",
      "providerRevision": "menu-result:dd7efbfa5dc9965ba7b16c2c1f7a84c48b4efe1321b40964d0e112bb26884520",
      "result": {
        "items": [],
        "total": 0,
        "returned": 0,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"combo\",\"nhóm\",\"4 người\",\"family\"],\"category\":\"null\",\"maxpricevnd\":300000,\"partysize\":4,\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:13:13.211Z",
  "completedAt": "2026-07-24T01:13:13.214Z",
  "executionDurationMs": 3
}
```

## Assistant

Rất tiếc, hiện tại hệ thống thực đơn của mình chưa có dữ liệu để tra cứu giá từng món lẻ hay combo. 😅

Tuy nhiên, mình có thể giúp bạn một số cách sau:

1. **Bạn có thể cho mình biết bạn muốn đặt ở cửa hàng KFC nào không?** Mình sẽ kiểm tra xem cửa hàng đó có thực đơn cụ thể không.
2. **Hoặc bạn có thể tham khảo trực tiếp tại quầy / hotline KFC** để biết giá món lẻ chính xác nhé.

Còn về combo gợi ý cho 4 người ~300k, thường KFC có các combo như **Combo Nhóm / Family Bucket** với gà rán, khoai tây, Pepsi rất phù hợp với ý bạn đó! Bạn muốn mình kiểm tra thử cửa hàng gần bạn không?

## User

Mình ở Quận 3, TP.HCM, bạn cứ tra menu hiện hành giúp mình. Nếu có combo nhóm nào gần với danh sách đó và rẻ hơn thì tư vấn cụ thể giá và thành phần nhé, mình chưa đồng ý đổi giỏ đâu.

### Tool call: searchMenu

```json
{
  "callId": "call_00_6AfioGYGbSBFs74dnBlj4724",
  "arguments": {
    "mode": "full",
    "queries": [],
    "category": "combo",
    "maxPriceVnd": null,
    "partySize": 4,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:13:40.774Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_6AfioGYGbSBFs74dnBlj4724",
  "arguments": {
    "mode": "full",
    "queries": [],
    "modifierQueries": [],
    "category": "combo",
    "partySize": 4
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "full",
      "queries": [],
      "total": 23,
      "returned": 23,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"full\",\"queries\":[],\"category\":\"combo\",\"partySize\":4,\"modifierQueries\":[]}"
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
      "total": 23,
      "returned": 23,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"full\",\"queries\":[],\"category\":\"combo\",\"partysize\":4,\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22full%22%2C%22queries%22%3A%5B%5D%2C%22category%22%3A%22combo%22%2C%22partysize%22%3A4%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "729c303a76f51109fcb336b2c95039ae3ec38cfe85a7870cf6ab379e4418498e",
      "providerRevision": "menu-result:3e686ece0deb986a10e336285680fffd11768519fb90c6e9d9e62430ee8f40e2",
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
        "total": 23,
        "returned": 23,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"full\",\"queries\":[],\"category\":\"combo\",\"partysize\":4,\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:13:40.777Z",
  "completedAt": "2026-07-24T01:13:40.780Z",
  "executionDurationMs": 3
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_o2K9SqxdNqU1yr82fveH5137",
  "arguments": {
    "mode": "search",
    "queries": [
      "Gà rán",
      "Mì ý",
      "Khoai tây chiên",
      "Pepsi"
    ],
    "category": "null",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:13:43.100Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_o2K9SqxdNqU1yr82fveH5137",
  "arguments": {
    "mode": "search",
    "queries": [
      "Gà rán",
      "Mì ý",
      "Khoai tây chiên",
      "Pepsi"
    ],
    "modifierQueries": [],
    "category": "null"
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Gà rán",
        "Mì ý",
        "Khoai tây chiên",
        "Pepsi"
      ],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Gà rán\",\"Mì ý\",\"Khoai tây chiên\",\"Pepsi\"],\"category\":\"null\",\"modifierQueries\":[]}"
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
        "query": "{\"mode\":\"search\",\"queries\":[\"gà rán\",\"mì ý\",\"khoai tây chiên\",\"pepsi\"],\"category\":\"null\",\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22g%C3%A0%20r%C3%A1n%22%2C%22m%C3%AC%20%C3%BD%22%2C%22khoai%20t%C3%A2y%20chi%C3%AAn%22%2C%22pepsi%22%5D%2C%22category%22%3A%22null%22%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "e53a859072e6e3f2af9dd7d8bebeda494051becb52eac13c60f4073f9c0d980a",
      "providerRevision": "menu-result:c0789e354f6c6df0bfbb0390a6e07c64324089302c24651a2426e89d43d33eca",
      "result": {
        "items": [],
        "total": 0,
        "returned": 0,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"gà rán\",\"mì ý\",\"khoai tây chiên\",\"pepsi\"],\"category\":\"null\",\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:13:43.104Z",
  "completedAt": "2026-07-24T01:13:43.106Z",
  "executionDurationMs": 2
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_onaE4X3VQS4XZEOTh7eh0983",
  "arguments": {
    "mode": "search",
    "queries": [
      "Gà rán (Miếng)",
      "Mì Ý xúc xích",
      "Khoai tây chiên vừa",
      "Pepsi tiêu chuẩn"
    ],
    "category": "null",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:13:45.938Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_onaE4X3VQS4XZEOTh7eh0983",
  "arguments": {
    "mode": "search",
    "queries": [
      "Gà rán (Miếng)",
      "Mì Ý xúc xích",
      "Khoai tây chiên vừa",
      "Pepsi tiêu chuẩn"
    ],
    "modifierQueries": [],
    "category": "null"
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Gà rán (Miếng)",
        "Mì Ý xúc xích",
        "Khoai tây chiên vừa",
        "Pepsi tiêu chuẩn"
      ],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Gà rán (Miếng)\",\"Mì Ý xúc xích\",\"Khoai tây chiên vừa\",\"Pepsi tiêu chuẩn\"],\"category\":\"null\",\"modifierQueries\":[]}"
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
        "query": "{\"mode\":\"search\",\"queries\":[\"gà rán (miếng)\",\"mì ý xúc xích\",\"khoai tây chiên vừa\",\"pepsi tiêu chuẩn\"],\"category\":\"null\",\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22g%C3%A0%20r%C3%A1n%20(mi%E1%BA%BFng)%22%2C%22m%C3%AC%20%C3%BD%20x%C3%BAc%20x%C3%ADch%22%2C%22khoai%20t%C3%A2y%20chi%C3%AAn%20v%E1%BB%ABa%22%2C%22pepsi%20ti%C3%AAu%20chu%E1%BA%A9n%22%5D%2C%22category%22%3A%22null%22%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "790bb6be0abeaff86dd1e5a457efc0d0c07b0e5075b97a9e572c25e568bd2a68",
      "providerRevision": "menu-result:81f09978dec45ff47891e38748c79e07ed3654c4d58cb2f500d40223878de32e",
      "result": {
        "items": [],
        "total": 0,
        "returned": 0,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"gà rán (miếng)\",\"mì ý xúc xích\",\"khoai tây chiên vừa\",\"pepsi tiêu chuẩn\"],\"category\":\"null\",\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:13:45.944Z",
  "completedAt": "2026-07-24T01:13:45.948Z",
  "executionDurationMs": 4
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_3MMxBv5H8w9LaHQ8sbFx1244",
  "arguments": {
    "mode": "search",
    "queries": [
      "Gà"
    ],
    "category": "Gà Rán",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:13:48.114Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_3MMxBv5H8w9LaHQ8sbFx1244",
  "arguments": {
    "mode": "search",
    "queries": [
      "Gà"
    ],
    "modifierQueries": [],
    "category": "Gà Rán"
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Gà"
      ],
      "total": 7,
      "returned": 7,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Gà\"],\"category\":\"Gà Rán\",\"modifierQueries\":[]}"
      },
      "items": [
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
        }
      ],
      "total": 7,
      "returned": 7,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"gà\"],\"category\":\"gà rán\",\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22g%C3%A0%22%5D%2C%22category%22%3A%22g%C3%A0%20r%C3%A1n%22%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "fd2e98b2e4e6478d3905b45809e80cde1f5c5e1d1576e5e1dfdd2fb24af207bd",
      "providerRevision": "menu-result:5c12ffce49b71349d35ce797909be6f158fbfa94e4eba21173c9798bd550ed98",
      "result": {
        "items": [
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
          }
        ],
        "total": 7,
        "returned": 7,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"gà\"],\"category\":\"gà rán\",\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:13:48.126Z",
  "completedAt": "2026-07-24T01:13:48.132Z",
  "executionDurationMs": 6
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_fSBDJQ47QIfPWmOgOW4T7553",
  "arguments": {
    "mode": "search",
    "queries": [
      "Mì Ý",
      "Khoai tây chiên",
      "Pepsi"
    ],
    "category": "null",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:13:50.371Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_fSBDJQ47QIfPWmOgOW4T7553",
  "arguments": {
    "mode": "search",
    "queries": [
      "Mì Ý",
      "Khoai tây chiên",
      "Pepsi"
    ],
    "modifierQueries": [],
    "category": "null"
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Mì Ý",
        "Khoai tây chiên",
        "Pepsi"
      ],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Mì Ý\",\"Khoai tây chiên\",\"Pepsi\"],\"category\":\"null\",\"modifierQueries\":[]}"
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
        "query": "{\"mode\":\"search\",\"queries\":[\"mì ý\",\"khoai tây chiên\",\"pepsi\"],\"category\":\"null\",\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22m%C3%AC%20%C3%BD%22%2C%22khoai%20t%C3%A2y%20chi%C3%AAn%22%2C%22pepsi%22%5D%2C%22category%22%3A%22null%22%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "ea7cb5711dfde0f6065ec173720c79f3da363f13f6d89427bbded711e819b125",
      "providerRevision": "menu-result:936461c2812213116a3196394554cf4c825c59bfe680b715a72e828d87d545a7",
      "result": {
        "items": [],
        "total": 0,
        "returned": 0,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"mì ý\",\"khoai tây chiên\",\"pepsi\"],\"category\":\"null\",\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:13:50.376Z",
  "completedAt": "2026-07-24T01:13:50.378Z",
  "executionDurationMs": 2
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_2pWewJyk0Ujc9L7oAvWx1718",
  "arguments": {
    "mode": "search",
    "queries": [
      "Mì ý",
      "Khoai tây",
      "Pepsi"
    ],
    "category": "null",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:13:52.798Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_2pWewJyk0Ujc9L7oAvWx1718",
  "arguments": {
    "mode": "search",
    "queries": [
      "Mì ý",
      "Khoai tây",
      "Pepsi"
    ],
    "modifierQueries": [],
    "category": "null"
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Mì ý",
        "Khoai tây",
        "Pepsi"
      ],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Mì ý\",\"Khoai tây\",\"Pepsi\"],\"category\":\"null\",\"modifierQueries\":[]}"
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
        "query": "{\"mode\":\"search\",\"queries\":[\"mì ý\",\"khoai tây\",\"pepsi\"],\"category\":\"null\",\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22m%C3%AC%20%C3%BD%22%2C%22khoai%20t%C3%A2y%22%2C%22pepsi%22%5D%2C%22category%22%3A%22null%22%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "5620b63f8bc7476cbb6bf29301cfaf4d67982fad48d3d2330271ebf8975f0035",
      "providerRevision": "menu-result:6ed2bb1ed7896088626320fb6b08f88fb006e03bcd040935e4d909ca379b3794",
      "result": {
        "items": [],
        "total": 0,
        "returned": 0,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"mì ý\",\"khoai tây\",\"pepsi\"],\"category\":\"null\",\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:13:52.804Z",
  "completedAt": "2026-07-24T01:13:52.805Z",
  "executionDurationMs": 1
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_ZhXTfCjb0pAAtba2Vuoy1139",
  "arguments": {
    "mode": "full",
    "queries": [],
    "category": "null",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:13:54.948Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_ZhXTfCjb0pAAtba2Vuoy1139",
  "arguments": {
    "mode": "full",
    "queries": [],
    "modifierQueries": [],
    "category": "null"
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "full",
      "queries": [],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"full\",\"queries\":[],\"category\":\"null\",\"modifierQueries\":[]}"
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
        "query": "{\"mode\":\"full\",\"queries\":[],\"category\":\"null\",\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22full%22%2C%22queries%22%3A%5B%5D%2C%22category%22%3A%22null%22%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "752cbadf2dff2b7c78eaea6f74c00b6af6f3def2cd2c08ed8ffee099acdff7c6",
      "providerRevision": "menu-result:63f1f3ef427e76f40a0b1ebc3b561b95b8112e533cc9fc7067cd10796006c954",
      "result": {
        "items": [],
        "total": 0,
        "returned": 0,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"full\",\"queries\":[],\"category\":\"null\",\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:13:54.953Z",
  "completedAt": "2026-07-24T01:13:54.955Z",
  "executionDurationMs": 2
}
```

## Assistant

Mình đã có đủ dữ liệu để phân tích cho bạn rồi! Đây là so sánh chi tiết:

---

## 🛒 Mua món lẻ (theo ý bạn)

| Món | SL | Đơn giá | Thành tiền |
|:---|---:|---:|---:|
| 1 Miếng Gà Rán (x4) | 4 | 37.000đ | **148.000đ** |
| Mì Ý xúc xích (x2) | 2 | *(chưa có giá món lẻ)* | ? |
| Khoai tây chiên vừa (x2) | 2 | *(chưa có giá món lẻ)* | ? |
| Pepsi tiêu chuẩn (x4) | 4 | *(chưa có giá món lẻ)* | ? |

Hệ thống hiện chỉ có giá món lẻ cho **Gà Rán** (1 miếng 37k), còn mì ý, khoai, Pepsi món lẻ không có trong danh mục tra cứu. Tuy nhiên, mình thấy có **combo nhóm rất gần với ý bạn** và **trong ngân sách 300k** đây:

---

## ✅ Combo đề xuất: **Combo Gà No 279k** — **279.000đ** ✅

**Thành phần:**
- 🍗 4 Miếng gà rán ✅ (đúng ý bạn)
- 🍔 2 Burger zinger (thay cho 2 mì ý)
- 🍟 1 Khoai tây chiên (vừa) (thiếu 1 so với ý bạn)
- 🥤 4 Ly Pepsi (tiêu chuẩn) ✅ (đúng ý bạn)

**Giá: 279.000đ → còn dư ~21k trong ngân sách 300k!** 🎉

### So với ý bạn:
| Món | Ý bạn | Combo 279k |
|:---|---:|:---:|
| Gà rán | 4 miếng | ✅ 4 miếng |
| Mì Ý | 2 | ❌ thay bằng 2 Burger zinger |
| Khoai vừa | 2 | ⚠️ chỉ 1 khoai |
| Pepsi | 4 ly | ✅ 4 ly |
| **Tổng** | **~300k** | **279.000đ** |

---

### Hoặc phương án gần hơn nữa: **Combo Gà Xịn 389k** — nhưng hơi quá ngân sách (389k)

Có 5 gà rán + 4 mì ý xúc xích + 3 khoai vừa + 5 Pepsi — nhiều hơn ý bạn nhưng giá cao hơn.

---

**Tóm lại:** Combo **Gà No 279k** là lựa chọn tiết kiệm nhất trong tầm ngân sách, gần với ý bạn nhất (chỉ khác 2 burger thay mì ý và thiếu 1 khoai). Bạn thấy sao? Nếu muốn mình có thể xem thử modifier (tuỳ chọn thay đổi) của combo này nhé!

## User

Được, mình đồng ý đổi sang Combo Gà No 279k. Bạn xem có thể thêm một khoai và nâng nước lên cỡ lớn không, báo phần chênh lệch trước khi cập nhật nhé.

### Tool call: searchMenu

```json
{
  "callId": "call_00_ZhYlf4Dv7rDCfYMKqowI4161",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Gà No 279k"
    ],
    "category": "null",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:14:17.512Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_ZhYlf4Dv7rDCfYMKqowI4161",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Gà No 279k"
    ],
    "modifierQueries": [],
    "category": "null"
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Combo Gà No 279k"
      ],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Combo Gà No 279k\"],\"category\":\"null\",\"modifierQueries\":[]}"
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
        "query": "{\"mode\":\"search\",\"queries\":[\"combo gà no 279k\"],\"category\":\"null\",\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22combo%20g%C3%A0%20no%20279k%22%5D%2C%22category%22%3A%22null%22%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "d94774cbb3118b265de9663221696a9f322bfe476813568460d42211fc9852b6",
      "providerRevision": "menu-result:4301e1c29a2cfec3ca46d4f21229edd64c880696141889ac2744f19aa012567c",
      "result": {
        "items": [],
        "total": 0,
        "returned": 0,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"combo gà no 279k\"],\"category\":\"null\",\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:14:17.520Z",
  "completedAt": "2026-07-24T01:14:17.524Z",
  "executionDurationMs": 4
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_rYJzBngg4gBwXnqzgQyJ1603",
  "arguments": {
    "mode": "full",
    "queries": [
      "combo"
    ],
    "category": "null",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:14:19.873Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_rYJzBngg4gBwXnqzgQyJ1603",
  "arguments": {
    "mode": "full",
    "queries": [
      "combo"
    ],
    "modifierQueries": [],
    "category": "null"
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "full",
      "queries": [
        "combo"
      ],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"full\",\"queries\":[\"combo\"],\"category\":\"null\",\"modifierQueries\":[]}"
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
        "query": "{\"mode\":\"full\",\"queries\":[\"combo\"],\"category\":\"null\",\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22full%22%2C%22queries%22%3A%5B%22combo%22%5D%2C%22category%22%3A%22null%22%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "c8297af35e1db572cda39249c270913f79889923f087b7de37cfadb99a488f24",
      "providerRevision": "menu-result:501beed5be485cbb9be64cdbfb1f65002c885200504116f66d19320099be959a",
      "result": {
        "items": [],
        "total": 0,
        "returned": 0,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"full\",\"queries\":[\"combo\"],\"category\":\"null\",\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:14:19.882Z",
  "completedAt": "2026-07-24T01:14:19.885Z",
  "executionDurationMs": 3
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_pCp8HXKUDFUY9FPOphVc0611",
  "arguments": {
    "mode": "full",
    "queries": [
      "gà",
      "combo"
    ],
    "category": "null",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:14:22.183Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_pCp8HXKUDFUY9FPOphVc0611",
  "arguments": {
    "mode": "full",
    "queries": [
      "gà",
      "combo"
    ],
    "modifierQueries": [],
    "category": "null"
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "full",
      "queries": [
        "gà",
        "combo"
      ],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"full\",\"queries\":[\"gà\",\"combo\"],\"category\":\"null\",\"modifierQueries\":[]}"
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
        "query": "{\"mode\":\"full\",\"queries\":[\"gà\",\"combo\"],\"category\":\"null\",\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22full%22%2C%22queries%22%3A%5B%22g%C3%A0%22%2C%22combo%22%5D%2C%22category%22%3A%22null%22%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "584c1fcc3f9b458739d48c25b30e20a3fc73f44db62cd364dbc10bdcd12cda9b",
      "providerRevision": "menu-result:afb883c70da3e5e394bf779ec3058f4f012e56a404dad80dd536ce7de153e947",
      "result": {
        "items": [],
        "total": 0,
        "returned": 0,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"full\",\"queries\":[\"gà\",\"combo\"],\"category\":\"null\",\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:14:22.189Z",
  "completedAt": "2026-07-24T01:14:22.191Z",
  "executionDurationMs": 2
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_yHq4DJAhqKOx3usr4LeD1240",
  "arguments": {
    "mode": "full",
    "queries": [
      ""
    ],
    "category": "null",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:14:24.234Z"
}
```

### Tool failure: searchMenu

```json
{
  "callId": "call_00_yHq4DJAhqKOx3usr4LeD1240",
  "arguments": {
    "mode": "full",
    "queries": [
      ""
    ],
    "category": "null",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "error": {
    "name": "Error",
    "message": "local_evidence_tool_arguments_invalid"
  },
  "completedAt": "2026-07-24T01:14:24.240Z",
  "requestedAt": "2026-07-24T01:14:24.234Z",
  "totalDurationMs": 6
}
```

### Tool call: searchMenu

```json
{
  "callId": "call_00_3drniJU3S8UAGtNhecHW9876",
  "arguments": {
    "mode": "full",
    "queries": [
      "menu"
    ],
    "category": "null",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:14:26.082Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_3drniJU3S8UAGtNhecHW9876",
  "arguments": {
    "mode": "full",
    "queries": [
      "menu"
    ],
    "modifierQueries": [],
    "category": "null"
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "full",
      "queries": [
        "menu"
      ],
      "total": 0,
      "returned": 0,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"full\",\"queries\":[\"menu\"],\"category\":\"null\",\"modifierQueries\":[]}"
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
        "query": "{\"mode\":\"full\",\"queries\":[\"menu\"],\"category\":\"null\",\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22full%22%2C%22queries%22%3A%5B%22menu%22%5D%2C%22category%22%3A%22null%22%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "28064dfc1e6fb972fbc70cf3298830b1c375f03a4364a442c6ac8598ad7e3841",
      "providerRevision": "menu-result:a77f5f89213a5ffecbe1906fac57e194efcd3f2803b98145fcfd499c814c374b",
      "result": {
        "items": [],
        "total": 0,
        "returned": 0,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"full\",\"queries\":[\"menu\"],\"category\":\"null\",\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:14:26.094Z",
  "completedAt": "2026-07-24T01:14:26.096Z",
  "executionDurationMs": 2
}
```

## Assistant

Có vẻ hệ thống thực đơn hiện tại chưa có dữ liệu combo cụ thể để tra cứu. Tuy nhiên, dựa vào thông tin mình đã có từ lúc nãy, mình xin tóm tắt lại:

---

**Về combo "Gà No 279k"** — mình đã đề cập lúc nãy dựa trên dữ liệu có sẵn, nhưng hiện tại hệ thống không tra cứu được chi tiết modifier (tuỳ chọn thêm khoai, nâng size nước) của combo này.

**Các phương án cho bạn:**

1. **Nếu bạn muốn đặt combo 279k + thêm 1 khoai vừa + nâng Pepsi lên lớn**, mình rất tiếc chưa có dữ liệu modifier để báo chính xác phần chênh lệch.

2. **Mình có thể giúp bạn kiểm tra combo khác** nếu bạn biết tên combo cụ thể trên menu KFC hiện tại.

3. **Hoặc mình có thể chuyển sang hỗ trợ nhân viên KFC** để tư vấn chi tiết combo và tuỳ chọn cho bạn nhé.

Bạn muốn mình làm cách nào? 😊

## User

Vậy bỏ phần thêm khoai và nâng size nhé, cứ giữ đúng Combo Gà No 279k với nước tiêu chuẩn. Mình xác nhận thêm combo này vào giỏ, không thêm món khác.

### Tool call: searchMenu

```json
{
  "callId": "call_00_W3SREOcvsmy9MWQw3BbD9366",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Gà No 279k",
      "Combo Gà No"
    ],
    "category": "combo",
    "maxPriceVnd": null,
    "partySize": null,
    "modifierQueries": []
  },
  "requestedAt": "2026-07-24T01:14:53.719Z"
}
```

### Tool result: searchMenu

```json
{
  "callId": "call_00_W3SREOcvsmy9MWQw3BbD9366",
  "arguments": {
    "mode": "search",
    "queries": [
      "Combo Gà No 279k",
      "Combo Gà No"
    ],
    "modifierQueries": [],
    "category": "combo"
  },
  "rawResult": {
    "toolName": "searchMenu",
    "ok": true,
    "value": {
      "mode": "search",
      "queries": [
        "Combo Gà No 279k",
        "Combo Gà No"
      ],
      "total": 22,
      "returned": 22,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"Combo Gà No 279k\",\"Combo Gà No\"],\"category\":\"combo\",\"modifierQueries\":[]}"
      },
      "items": [
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
        }
      ],
      "total": 22,
      "returned": 22,
      "complete": true,
      "scope": {
        "scope": "filtered",
        "query": "{\"mode\":\"search\",\"queries\":[\"combo gà no 279k\",\"combo gà no\"],\"category\":\"combo\",\"modifierqueries\":[]}"
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
      "key": "filtered:%7B%22mode%22%3A%22search%22%2C%22queries%22%3A%5B%22combo%20g%C3%A0%20no%20279k%22%2C%22combo%20g%C3%A0%20no%22%5D%2C%22category%22%3A%22combo%22%2C%22modifierqueries%22%3A%5B%5D%7D",
      "revision": "1cfd49ab9d90b5bb3f24e9bbc355d713811560dc2d2ac8077775509497d2a1bf",
      "providerRevision": "menu-result:597bb5f09e1b579761970dcd14ee67a96ff39f186f67ba1130b9b83dd64d3b88",
      "result": {
        "items": [
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
          }
        ],
        "total": 22,
        "returned": 22,
        "complete": true,
        "scope": {
          "scope": "filtered",
          "query": "{\"mode\":\"search\",\"queries\":[\"combo gà no 279k\",\"combo gà no\"],\"category\":\"combo\",\"modifierqueries\":[]}"
        }
      }
    }
  },
  "executionStartedAt": "2026-07-24T01:14:53.730Z",
  "completedAt": "2026-07-24T01:14:53.738Z",
  "executionDurationMs": 8
}
```

### Tool call: updateCart

```json
{
  "callId": "call_00_skla9yxdmAZsiytp1gtX7309",
  "arguments": {
    "changes": [
      {
        "itemCode": "20706",
        "quantity": 1,
        "modifiers": []
      }
    ]
  },
  "requestedAt": "2026-07-24T01:14:56.364Z"
}
```

### Tool result: updateCart

```json
{
  "callId": "call_00_skla9yxdmAZsiytp1gtX7309",
  "arguments": {
    "changes": [
      {
        "itemCode": "20706",
        "quantity": 1,
        "modifiers": []
      }
    ]
  },
  "rawResult": {
    "toolName": "updateCart",
    "ok": true,
    "value": {
      "id": "cart_live-20260724-v1-deepseek-v4-flash-s02-a1",
      "items": [
        {
          "itemCode": "20706",
          "name": "Combo Gà No 279k",
          "quantity": 1,
          "unitPriceVnd": 279000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-4COB-279K.jpg?v=LNN7PL",
          "category": "Combo Nhóm"
        }
      ],
      "subtotalVnd": 279000,
      "discountVnd": 0,
      "deliveryFeeVnd": 0,
      "totalVnd": 279000,
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
    "toolName": "updateCart",
    "ok": true,
    "value": {
      "id": "cart_live-20260724-v1-deepseek-v4-flash-s02-a1",
      "items": [
        {
          "itemCode": "20706",
          "name": "Combo Gà No 279k",
          "quantity": 1,
          "unitPriceVnd": 279000,
          "imageUrl": "https://static.kfcvietnam.com.vn/images/items/lg/EC.CBO-4COB-279K.jpg?v=LNN7PL",
          "category": "Combo Nhóm"
        }
      ],
      "subtotalVnd": 279000,
      "discountVnd": 0,
      "deliveryFeeVnd": 0,
      "totalVnd": 279000,
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
  "executionStartedAt": "2026-07-24T01:14:56.375Z",
  "completedAt": "2026-07-24T01:14:56.377Z",
  "executionDurationMs": 2
}
```

## Assistant

Đã thêm **Combo Gà No 279k** vào giỏ thành công! 🎉

**Giỏ hàng hiện tại:**
| Món | SL | Thành tiền |
|:---|---:|---:|
| 🍗 Combo Gà No 279k | 1 | **279.000đ** |
| **Tổng cộng** | | **279.000đ** |

**Thành phần combo:**
- ✅ 4 Miếng gà rán
- ✅ 2 Burger zinger
- ✅ 1 Khoai tây chiên (vừa)
- ✅ 4 Ly Pepsi (tiêu chuẩn)

**Ngân sách 300k → còn dư 21.000đ** 🎉

Bạn muốn đặt giao hay đến lấy? Mình cần biết cửa hàng KFC gần Quận 3 để kiểm tra nhé!

