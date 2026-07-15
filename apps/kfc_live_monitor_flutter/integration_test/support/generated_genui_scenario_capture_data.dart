// Generated test data for backend-backed customer-chat GenUI integration tests.
// Source: backend GenUI scenario capture plan.
// Source: ai-talent-tracks/fnb/conversations/*.json user turns only.
// Generated before a counted proof. Do not edit manually.

const genUiScenarioCapturePlanJson = r'''{
  "version": 3,
  "description": "Persisted GenUI render plan for the consolidated scenarios 01-08 branch artifact. The 44 model turns are never replayed by Flutter; scenario 09 remains planner-only.",
  "scenarios": [
    {
      "fileName": "01-dat-mon-ro-rang-giao-hang.json",
      "requiredWidgetKinds": [
        "addressFulfillmentCheck",
        "orderReviewConfirm",
        "paymentOrderStatus"
      ],
      "expectedWidgetsByUserTurn": {
        "1": "addressFulfillmentCheck",
        "3": "addressFulfillmentCheck",
        "5": "orderReviewConfirm",
        "7": "paymentMethodPicker",
        "9": "orderReviewConfirm",
        "11": "paymentOrderStatus"
      }
    },
    {
      "fileName": "02-tu-van-combo-va-upsell.json",
      "requiredWidgetKinds": [
        "smartMenuPicker"
      ],
      "expectedWidgetsByUserTurn": {
        "1": "smartMenuPicker",
        "5": "modifierPicker",
        "9": "cartBuilder"
      }
    },
    {
      "fileName": "03-ton-kho-dia-chi-va-cua-hang.json",
      "requiredWidgetKinds": [
        "addressFulfillmentCheck"
      ],
      "expectedWidgetsByUserTurn": {
        "1": "addressFulfillmentCheck",
        "3": "addressFulfillmentCheck",
        "5": "orderReviewConfirm",
        "7": "orderReviewConfirm",
        "9": "addressFulfillmentCheck"
      }
    },
    {
      "fileName": "04-sau-khi-dat-don.json",
      "requiredWidgetKinds": [
        "orderTrackingStatus"
      ],
      "expectedWidgetsByUserTurn": {
        "1": "orderTrackingStatus",
        "3": "orderTrackingStatus",
        "5": "orderTrackingStatus",
        "9": "supportHandoff",
        "11": "supportHandoff",
        "15": "cartBuilder"
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
      "requiredWidgetKinds": [
        "cartBuilder"
      ],
      "acceptableWidgetsByUserTurn": {
        "1": [
          "cartBuilder",
          "chatTranscript"
        ]
      },
      "expectedWidgetsByUserTurn": {
        "1": "cartBuilder",
        "7": "cartBuilder",
        "9": "cartBuilder"
      }
    },
    {
      "fileName": "07-ca-nhan-hoa-va-loyalty.json",
      "requiredWidgetKinds": [
        "cartBuilder"
      ],
      "expectedWidgetsByUserTurn": {
        "3": "smartMenuPicker",
        "5": "cartBuilder",
        "7": "cartBuilder",
        "9": "cartBuilder"
      }
    },
    {
      "fileName": "08-thanh-toan-loi-va-don-bat-thuong.json",
      "requiredWidgetKinds": [
        "supportHandoff"
      ],
      "expectedWidgetsByUserTurn": {
        "5": "supportHandoff"
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
      "text": "Không biết ăn gì, gợi ý cho nhóm 4 người với, ngân sách khoảng 300k.",
      "useCases": [
        "UC-02",
        "UC-03",
        "UC-11",
        "UC-13"
      ]
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Không cần thêm món tráng miệng. Hôm nay có ưu đãi gì phù hợp không?",
      "useCases": [
        "UC-04",
        "UC-09"
      ]
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Món gà nào bán chạy? Nếu gọi lẻ thì cho mình 10 miếng gà rán và 4 Pepsi tiêu chuẩn.",
      "useCases": [
        "UC-12"
      ]
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Hợp lý đó, đổi sang 2 Combo Đẫy Đà 129K giúp mình.",
      "useCases": [
        "Filler"
      ]
    },
    {
      "index": 9,
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
      "text": "Cho mình 1 burger tôm, giao về Nhà Bè được không?",
      "useCases": [
        "UC-06",
        "UC-08"
      ]
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Vậy lấy Zinger Burger, giao tới địa chỉ đã lưu nha.",
      "useCases": [
        "UC-07"
      ]
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Đúng rồi.",
      "useCases": [
        "Filler"
      ]
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Tiếp tục đặt.",
      "useCases": [
        "Filler"
      ]
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Đổi địa chỉ giao qua Quận 3 được không?",
      "useCases": [
        "UC-23"
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
      "text": "Khoảng bao lâu tới?",
      "useCases": [
        "UC-21"
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
      "text": "Vậy đặt cho mình 200 combo gà, giao trong 30 phút.",
      "useCases": [
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
};
