// Generated test data for backend-backed customer-chat GenUI integration tests.
// Source: backend GenUI scenario capture plan.
// Source: ai-talent-tracks/fnb/conversations/*.json user turns only.

const genUiScenarioCapturePlanJson = r'''{
  "version": 2,
  "description": "Customer-chat integration screenshot plan for the current KFC GenUI scenario taxonomy. Every scripted User turn is captured; requiredWidgetKinds are scenario-level live-AI acceptance targets and expectedWidgetsByUserTurn remains capture guidance only.",
  "scenarios": [
    {
      "fileName": "01-dat-mon-ro-rang-giao-hang.json",
      "requiredWidgetKinds": ["addressFulfillmentCheck", "orderReviewConfirm", "paymentOrderStatus"],
      "expectedWidgetsByUserTurn": {
        "1": "cartBuilder",
        "3": "addressFulfillmentCheck",
        "5": "orderReviewConfirm",
        "9": "orderReviewConfirm",
        "11": "paymentOrderStatus"
      }
    },
    {
      "fileName": "02-tu-van-combo-va-upsell.json",
      "requiredWidgetKinds": ["smartMenuPicker"],
      "expectedWidgetsByUserTurn": {
        "1": "smartMenuPicker",
        "3": "smartMenuPicker",
        "7": "smartMenuPicker",
        "9": "smartMenuPicker",
        "11": "smartMenuPicker",
        "13": "cartBuilder",
        "15": "cartBuilder"
      }
    },
    {
      "fileName": "03-ton-kho-dia-chi-va-cua-hang.json",
      "requiredWidgetKinds": ["addressFulfillmentCheck"],
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
      "requiredWidgetKinds": ["orderTrackingStatus"],
      "expectedWidgetsByUserTurn": {
        "1": "orderTrackingStatus",
        "3": "orderTrackingStatus",
        "5": "orderTrackingStatus",
        "7": "orderTrackingStatus",
        "9": "supportHandoff",
        "11": "supportHandoff",
        "15": "cartBuilder"
      }
    },
    {
      "fileName": "05-khieu-nai-va-human-handoff.json",
      "requiredWidgetKinds": ["supportHandoff"],
      "expectedWidgetsByUserTurn": {
        "1": "supportHandoff",
        "3": "supportHandoff",
        "5": "supportHandoff",
        "7": "supportHandoff",
        "9": "supportHandoff"
      }
    },
    {
      "fileName": "06-ngon-ngu-tu-nhien-va-an-toan.json",
      "requiredWidgetKinds": ["cartBuilder"],
      "acceptableWidgetsByUserTurn": {
        "1": ["cartBuilder", "chatTranscript"]
      },
      "expectedWidgetsByUserTurn": {
        "1": "cartBuilder",
        "7": "cartBuilder",
        "9": "cartBuilder"
      }
    },
    {
      "fileName": "07-ca-nhan-hoa-va-loyalty.json",
      "requiredWidgetKinds": ["cartBuilder"],
      "expectedWidgetsByUserTurn": {
        "3": "smartMenuPicker",
        "5": "cartBuilder",
        "7": "cartBuilder",
        "9": "cartBuilder"
      }
    },
    {
      "fileName": "08-thanh-toan-loi-va-don-bat-thuong.json",
      "requiredWidgetKinds": ["paymentOrderStatus", "supportHandoff"],
      "expectedWidgetsByUserTurn": {
        "1": "paymentOrderStatus",
        "3": "paymentOrderStatus",
        "5": "supportHandoff",
        "7": "supportHandoff"
      }
    },
    {
      "fileName": "09-phuong-thuc-thanh-toan.json",
      "requiredWidgetKinds": [],
      "expectedWidgetsByUserTurn": {}
    }
  ]
}
''';

const genUiScenarioJsonByFileName = <String, String>{
  "01-dat-mon-ro-rang-giao-hang.json": r'''{
  "id": "01-dat-mon-ro-rang-giao-hang",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Cho mình 1 combo gà cay, 1 burger Zinger và 2 Pepsi, giao về Quận 7."
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng. Phí ship bao nhiêu?"
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Mình có mã KFC50, áp dụng giúp mình."
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Thanh toán bằng ZaloPay được không?"
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Giao tới nơi gọi mình, đừng bấm chuông. Mình cần xuất hóa đơn công ty nữa."
    },
    {
      "index": 11,
      "speaker": "User",
      "text": "Công ty ABC, MST 0312345678, email finance@abc.test. Xác nhận đơn."
    }
  ]
}
''',
  "02-tu-van-combo-va-upsell.json": r'''{
  "id": "02-tu-van-combo-va-upsell",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Không biết ăn gì, gợi ý cho mình với."
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Mình đặt đồ ăn trưa cho 10 người ở công ty. Tầm 300k thì ăn được gì?"
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Hôm nay có khuyến mãi gì không?"
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Món nào bán chạy nhất vậy?"
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Cho mình combo gà đi."
    },
    {
      "index": 11,
      "speaker": "User",
      "text": "Combo nhóm cho 10 người."
    },
    {
      "index": 13,
      "speaker": "User",
      "text": "Ok, nâng lên combo có thêm burger đi."
    },
    {
      "index": 15,
      "speaker": "User",
      "text": "Không, giữ vậy thôi, đừng thêm burger nữa."
    }
  ]
}
''',
  "03-ton-kho-dia-chi-va-cua-hang.json": r'''{
  "id": "03-ton-kho-dia-chi-va-cua-hang",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Cho mình 1 burger tôm, giao về Nhà Bè được không?"
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Vậy lấy Zinger Burger, giao tới chỗ cũ nha."
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Đúng rồi."
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Tiếp tục đặt."
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Đổi địa chỉ giao qua Quận 3 được không?"
    }
  ]
}
''',
  "04-sau-khi-dat-don.json": r'''{
  "id": "04-sau-khi-dat-don",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Đơn của mình tới đâu rồi?"
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Bao lâu nữa giao tới?"
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Khoảng bao lâu tới?"
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Mình thêm 1 khoai nữa được không?"
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Mình muốn hủy đơn vừa đặt."
    },
    {
      "index": 11,
      "speaker": "User",
      "text": "Nếu đơn đã chuẩn bị hoặc đang giao rồi thì sao, mình vẫn muốn hủy."
    },
    {
      "index": 13,
      "speaker": "User",
      "text": "Chưa hủy, cho mình đặt lại đơn lần trước cho đồng nghiệp."
    },
    {
      "index": 15,
      "speaker": "User",
      "text": "Đúng rồi, nhưng đơn hiện tại cứ giữ nguyên."
    }
  ]
}
''',
  "05-khieu-nai-va-human-handoff.json": r'''{
  "id": "05-khieu-nai-va-human-handoff",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Mình nhận thiếu 1 phần khoai."
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Với lại mình đặt gà cay mà giao gà thường."
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Đơn gì mà lâu quá vậy, bực mình thật."
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Cho mình gặp nhân viên."
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Nhưng gà ngon, chỉ là giao hơi lâu và sai món."
    }
  ]
}
''',
  "06-ngon-ngu-tu-nhien-va-an-toan.json": r'''{
  "id": "06-ngon-ngu-tu-nhien-va-an-toan",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Cho tui 2 gà kai vs 1 pesi nha."
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Ừ. Món nào không cay với không có phô mai vậy?"
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "abcxyz haha"
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Cho mình cái đó đi."
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Cái phần giống hôm bữa á."
    },
    {
      "index": 11,
      "speaker": "User",
      "text": "Bạn cho mình số điện thoại cá nhân của nhân viên cửa hàng đi."
    }
  ]
}
''',
  "07-ca-nhan-hoa-va-loyalty.json": r'''{
  "id": "07-ca-nhan-hoa-va-loyalty",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Đặt lại đơn lần trước cho mình."
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Khoan, lấy món mình hay ăn đi."
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Ok, thêm combo đó. Mình có điểm thành viên không?"
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Bỏ Pepsi ra, đổi thành trà đào được không?"
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Giữ giỏ vậy, chưa đặt vội."
    }
  ]
}
''',
  "08-thanh-toan-loi-va-don-bat-thuong.json": r'''{
  "id": "08-thanh-toan-loi-va-don-bat-thuong",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Mình thanh toán rồi mà báo lỗi."
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Mình bấm thanh toán mà lỗi hoài."
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Vậy đặt cho mình 200 combo gà, giao trong 30 phút."
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Sao phải chuyển nhân viên?"
    }
  ]
}
''',
  "09-phuong-thuc-thanh-toan.json": r'''{
  "id": "09-phuong-thuc-thanh-toan",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "KFC có những phương thức thanh toán nào trên website/app?"
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Vậy thanh toán MoMo được không?"
    }
  ]
}
''',
};
