// Generated test data for backend-backed customer-chat GenUI integration tests.
// Source: backend GenUI scenario capture plan.
// Source: ai-talent-tracks/fnb/conversations/*.json user turns only.
// Generated before a counted proof. Do not edit manually.

const genUiScenarioCapturePlanJson = r'''{
  "version": 4,
  "description": "Generated GenUI render plan for all canonical outcome scenarios. JSON outcome contracts are authoritative.",
  "scenarios": [
    {
      "fileName": "01-dat-mon-ro-rang-giao-hang.json",
      "requiredWidgetKinds": [
        "cartBuilder",
        "addressFulfillmentCheck",
        "paymentMethodPicker"
      ],
      "expectedWidgetsByUserTurn": {
        "1": "cartBuilder",
        "3": "addressFulfillmentCheck",
        "5": "promotionGallery",
        "7": "paymentMethodPicker",
        "11": "orderReviewConfirm"
      },
      "acceptableWidgetsByUserTurn": {
        "5": [
          "promotionGallery",
          "orderReviewConfirm"
        ],
        "9": [
          "chatTranscript",
          "orderReviewConfirm"
        ],
        "11": [
          "orderReviewConfirm",
          "paymentOrderStatus"
        ]
      }
    },
    {
      "fileName": "02-tu-van-combo-va-upsell.json",
      "requiredWidgetKinds": [
        "smartMenuPicker",
        "promotionGallery",
        "cartBuilder"
      ],
      "expectedWidgetsByUserTurn": {
        "1": "smartMenuPicker",
        "3": "smartMenuPicker",
        "5": "smartMenuPicker",
        "7": "promotionGallery",
        "9": "cartBuilder",
        "11": "cartBuilder",
        "13": "cartBuilder"
      },
      "acceptableWidgetsByUserTurn": {
        "9": [
          "cartBuilder",
          "smartMenuPicker"
        ],
        "11": [
          "cartBuilder",
          "modifierPicker"
        ]
      }
    },
    {
      "fileName": "03-ton-kho-dia-chi-va-cua-hang.json",
      "requiredWidgetKinds": [
        "addressFulfillmentCheck"
      ],
      "expectedWidgetsByUserTurn": {
        "1": "smartMenuPicker",
        "3": "cartBuilder",
        "5": "addressFulfillmentCheck",
        "7": "addressFulfillmentCheck",
        "9": "addressFulfillmentCheck"
      },
      "acceptableWidgetsByUserTurn": {
        "1": [
          "smartMenuPicker",
          "addressFulfillmentCheck"
        ],
        "3": [
          "cartBuilder",
          "addressFulfillmentCheck"
        ]
      }
    },
    {
      "fileName": "04-sau-khi-dat-don.json",
      "requiredWidgetKinds": [
        "orderTrackingStatus",
        "cartBuilder"
      ],
      "expectedWidgetsByUserTurn": {
        "1": "orderTrackingStatus",
        "3": "orderTrackingStatus",
        "5": "orderTrackingStatus",
        "11": "supportHandoff",
        "15": "cartBuilder"
      },
      "acceptableWidgetsByUserTurn": {
        "11": [
          "supportHandoff",
          "orderTrackingStatus"
        ]
      }
    },
    {
      "fileName": "05-khieu-nai-va-human-handoff.json",
      "requiredWidgetKinds": [
        "supportHandoff"
      ],
      "expectedWidgetsByUserTurn": {
        "7": "supportHandoff"
      }
    },
    {
      "fileName": "06-ngon-ngu-tu-nhien-va-an-toan.json",
      "requiredWidgetKinds": [],
      "expectedWidgetsByUserTurn": {
        "3": "allergenEvidence"
      },
      "acceptableWidgetsByUserTurn": {
        "3": [
          "allergenEvidence",
          "smartMenuPicker"
        ]
      }
    },
    {
      "fileName": "07-ca-nhan-hoa-va-loyalty.json",
      "requiredWidgetKinds": [
        "smartMenuPicker",
        "cartBuilder"
      ],
      "expectedWidgetsByUserTurn": {
        "3": "smartMenuPicker",
        "5": "cartBuilder",
        "7": "cartBuilder"
      }
    },
    {
      "fileName": "08-thanh-toan-loi-va-don-bat-thuong.json",
      "requiredWidgetKinds": [
        "supportHandoff"
      ],
      "expectedWidgetsByUserTurn": {
        "1": "paymentOrderStatus",
        "3": "paymentOrderStatus",
        "5": "supportHandoff"
      },
      "acceptableWidgetsByUserTurn": {
        "1": [
          "paymentOrderStatus",
          "supportHandoff"
        ],
        "3": [
          "paymentOrderStatus",
          "supportHandoff"
        ],
        "7": [
          "chatTranscript",
          "supportHandoff",
          "paymentOrderStatus"
        ]
      }
    },
    {
      "fileName": "09-phuong-thuc-thanh-toan.json",
      "requiredWidgetKinds": [
        "paymentMethodPicker"
      ],
      "expectedWidgetsByUserTurn": {
        "1": "paymentMethodPicker",
        "3": "paymentMethodPicker"
      }
    }
  ]
}''';

const genUiScenarioJsonByFileName = <String, String>{
  "01-dat-mon-ro-rang-giao-hang.json": r'''{
  "id": "01-dat-mon-ro-rang-giao-hang",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Cho mình 1 Combo Burger Gà Yo & Gà Rán, chọn phần gà Giòn Cay; thêm 1 Burger Gà Zinger và 2 Pepsi, giao về Quận 7.",
      "useCases": [
        "UC-01",
        "UC-07"
      ]
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng. Phí ship bao nhiêu?",
      "useCases": [
        "UC-24"
      ]
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Mình có mã KFC50, áp dụng giúp mình.",
      "useCases": [
        "UC-17"
      ]
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Thanh toán bằng ZaloPay được không?",
      "useCases": [
        "UC-16"
      ]
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Giao tới nơi gọi mình, đừng bấm chuông. Mình cần xuất hóa đơn công ty nữa.",
      "useCases": [
        "UC-19",
        "UC-25"
      ]
    },
    {
      "index": 11,
      "speaker": "User",
      "text": "Công ty ABC, MST 0312345678, email finance@abc.test. Xác nhận đơn.",
      "useCases": [
        "UC-19"
      ]
    }
  ]
}''',
  "02-tu-van-combo-va-upsell.json": r'''{
  "id": "02-tu-van-combo-va-upsell",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Cho mình xem toàn bộ menu hiện có.",
      "useCases": [
        "UC-04"
      ]
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Mình muốn gọi thêm đồ uống cho nhóm, bạn gợi ý vài lựa chọn phù hợp nhé.",
      "useCases": [
        "UC-11",
        "UC-12"
      ]
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Không biết ăn gì, gợi ý cho nhóm 4 người với, ngân sách khoảng 300k.",
      "useCases": [
        "UC-02",
        "UC-03",
        "UC-11",
        "UC-13"
      ]
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Không cần thêm món tráng miệng. Hôm nay có ưu đãi gì phù hợp không?",
      "useCases": [
        "UC-04",
        "UC-09"
      ]
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Nếu gọi lẻ thì cho mình 4 miếng gà rán, 2 Burger Gà Yo, 2 khoai vừa và 4 Pepsi vừa.",
      "useCases": [
        "UC-01"
      ]
    },
    {
      "index": 11,
      "speaker": "User",
      "text": "Hợp lý đó, đổi sang 2 Combo Burger Gà Yo & Gà Rán giúp mình.",
      "useCases": [
        "UC-10"
      ]
    },
    {
      "index": 13,
      "speaker": "User",
      "text": "Ok, nâng cả 4 Pepsi lên size đại luôn nhé.",
      "useCases": [
        "UC-10"
      ]
    }
  ]
}''',
  "03-ton-kho-dia-chi-va-cua-hang.json": r'''{
  "id": "03-ton-kho-dia-chi-va-cua-hang",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Burger Tôm còn ở KFC Đường Huỳnh Tấn Phát 2, Nhà Bè không? Mình ở Cần Giờ; cửa hàng đó có giao tới đây không? Nếu không thì mình sẽ tới nhận.",
      "useCases": [
        "UC-06",
        "UC-08"
      ]
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Vậy lấy 1 Burger Gà Zinger và tìm cửa hàng gần nhất còn món quanh Nhà Bè cho mình.",
      "useCases": [
        "UC-37"
      ]
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Chọn cửa hàng đó, mình sẽ tới nhận.",
      "useCases": [
        "Filler"
      ]
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Đổi sang giao tới địa chỉ đã lưu của mình nhé.",
      "useCases": [
        "UC-07"
      ]
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Đúng, giao tới địa chỉ 123 Nguyễn Trãi, Quận 5 đã lưu.",
      "useCases": [
        "Filler"
      ]
    }
  ]
}''',
  "04-sau-khi-dat-don.json": r'''{
  "id": "04-sau-khi-dat-don",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Đơn của mình tới đâu rồi?",
      "useCases": [
        "UC-21"
      ]
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Bao lâu nữa giao tới?",
      "useCases": [
        "UC-21"
      ]
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Đơn đang chuẩn bị rồi thì mình đổi địa chỉ nhận được không?",
      "useCases": [
        "UC-23"
      ]
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Mình thêm 1 khoai nữa được không?",
      "useCases": [
        "UC-26"
      ]
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Mình muốn hủy đơn vừa đặt.",
      "useCases": [
        "UC-20"
      ]
    },
    {
      "index": 11,
      "speaker": "User",
      "text": "Nếu đơn đã chuẩn bị hoặc đang giao rồi thì sao, mình vẫn muốn hủy.",
      "useCases": [
        "UC-20"
      ]
    },
    {
      "index": 13,
      "speaker": "User",
      "text": "Chưa hủy, cho mình đặt lại đơn lần trước cho đồng nghiệp.",
      "useCases": [
        "UC-22"
      ]
    },
    {
      "index": 15,
      "speaker": "User",
      "text": "Đúng rồi, nhưng đơn hiện tại cứ giữ nguyên.",
      "useCases": [
        "Filler"
      ]
    }
  ]
}''',
  "05-khieu-nai-va-human-handoff.json": r'''{
  "id": "05-khieu-nai-va-human-handoff",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Mình nhận thiếu 1 phần khoai.",
      "useCases": [
        "UC-27"
      ]
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Với lại mình đặt gà cay mà giao gà thường.",
      "useCases": [
        "UC-27"
      ]
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Đơn gì mà lâu quá vậy, bực mình thật.",
      "useCases": [
        "UC-29"
      ]
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Cho mình gặp nhân viên.",
      "useCases": [
        "UC-30"
      ]
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Nhưng gà ngon, chỉ là giao hơi lâu và sai món.",
      "useCases": [
        "UC-28"
      ]
    }
  ]
}''',
  "06-ngon-ngu-tu-nhien-va-an-toan.json": r'''{
  "id": "06-ngon-ngu-tu-nhien-va-an-toan",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Cho tui 2 gà kai vs 1 pesi nha.",
      "useCases": [
        "UC-31"
      ]
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Ừ. Món nào không cay với không có phô mai vậy?",
      "useCases": [
        "UC-32"
      ]
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "abcxyz haha",
      "useCases": [
        "UC-33"
      ]
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Cho mình cái đó đi.",
      "useCases": [
        "UC-34"
      ]
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Cái phần giống hôm bữa á.",
      "useCases": [
        "UC-36"
      ]
    },
    {
      "index": 11,
      "speaker": "User",
      "text": "Bạn cho mình số điện thoại cá nhân của nhân viên cửa hàng đi.",
      "useCases": [
        "UC-35"
      ]
    }
  ]
}''',
  "07-ca-nhan-hoa-va-loyalty.json": r'''{
  "id": "07-ca-nhan-hoa-va-loyalty",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Đặt lại đơn lần trước cho mình.",
      "useCases": [
        "UC-22"
      ]
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Khoan, lấy món mình hay ăn đi.",
      "useCases": [
        "UC-14"
      ]
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Ok, thêm combo đó. Mình có điểm thành viên không?",
      "useCases": [
        "UC-15"
      ]
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Bỏ Pepsi ra, đổi thành trà đào được không?",
      "useCases": [
        "UC-05"
      ]
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Giữ giỏ vậy, chưa đặt vội.",
      "useCases": [
        "Filler"
      ]
    }
  ]
}''',
  "08-thanh-toan-loi-va-don-bat-thuong.json": r'''{
  "id": "08-thanh-toan-loi-va-don-bat-thuong",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Mình thanh toán rồi mà báo lỗi.",
      "useCases": [
        "UC-18"
      ]
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Mình bấm thanh toán mà lỗi hoài.",
      "useCases": [
        "UC-18"
      ]
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Giờ cao điểm mà mình muốn đặt 200 combo gà, giao trong 30 phút.",
      "useCases": [
        "UC-38",
        "UC-39"
      ]
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Sao phải chuyển nhân viên?",
      "useCases": [
        "Filler"
      ]
    }
  ]
}''',
  "09-phuong-thuc-thanh-toan.json": r'''{
  "id": "09-phuong-thuc-thanh-toan",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "KFC có những phương thức thanh toán nào trên website/app?",
      "useCases": [
        "UC-16"
      ]
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Vậy thanh toán MoMo được không?",
      "useCases": [
        "UC-16"
      ]
    }
  ]
}''',
};
