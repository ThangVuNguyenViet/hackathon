// Generated test data for customer-chat GenUI scenario integration tests.
// Source: services/kfc-agent-backend/fixtures/genui-scenario-capture-plan.json
// Source: ai-talent-tracks/fnb/conversations/*.json

const genUiScenarioCapturePlanJson = r'''{
  "version": 1,
  "description": "Customer-chat integration screenshot plan for the current KFC GenUI scenario taxonomy. Every scripted User turn is captured; expectedWidgetsByUserTurn marks turns that must render a specific GenUI widget in the latest assistant response.",
  "scenarios": [
    {
      "fileName": "01-dat-mon-ro-rang-giao-hang.json",
      "expectedWidgetsByUserTurn": {
        "1": "cartBuilder",
        "3": "addressFulfillmentCheck",
        "5": "orderReviewConfirm",
        "7": "orderReviewConfirm",
        "9": "orderReviewConfirm",
        "11": "paymentOrderStatus"
      }
    },
    {
      "fileName": "02-tu-van-combo-va-upsell.json",
      "expectedWidgetsByUserTurn": {
        "1": "smartMenuPicker",
        "3": "smartMenuPicker",
        "5": "smartMenuPicker",
        "7": "smartMenuPicker",
        "9": "smartMenuPicker",
        "11": "smartMenuPicker",
        "13": "cartBuilder",
        "15": "cartBuilder"
      }
    },
    {
      "fileName": "03-ton-kho-dia-chi-va-cua-hang.json",
      "expectedWidgetsByUserTurn": {
        "1": "addressFulfillmentCheck",
        "3": "addressFulfillmentCheck",
        "5": "addressFulfillmentCheck",
        "7": "orderReviewConfirm",
        "9": "addressFulfillmentCheck"
      }
    },
    {
      "fileName": "04-sau-khi-dat-don.json",
      "expectedWidgetsByUserTurn": {
        "1": "orderTrackingStatus",
        "3": "orderTrackingStatus",
        "5": "orderTrackingStatus",
        "7": "orderTrackingStatus",
        "9": "orderTrackingStatus",
        "11": "orderTrackingStatus",
        "13": "orderTrackingStatus",
        "15": "orderTrackingStatus"
      }
    },
    {
      "fileName": "05-khieu-nai-va-human-handoff.json",
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
      "expectedWidgetsByUserTurn": {
        "1": "cartBuilder",
        "3": "cartBuilder",
        "7": "cartBuilder",
        "9": "cartBuilder"
      }
    },
    {
      "fileName": "07-ca-nhan-hoa-va-loyalty.json",
      "expectedWidgetsByUserTurn": {
        "1": "cartBuilder",
        "3": "cartBuilder",
        "5": "cartBuilder",
        "7": "cartBuilder",
        "9": "cartBuilder"
      }
    },
    {
      "fileName": "08-thanh-toan-loi-va-don-bat-thuong.json",
      "expectedWidgetsByUserTurn": {
        "1": "paymentOrderStatus",
        "3": "paymentOrderStatus",
        "5": "supportHandoff",
        "7": "supportHandoff"
      }
    }
  ]
}
''';

const genUiScenarioJsonByFileName = <String, String>{
  "01-dat-mon-ro-rang-giao-hang.json": r'''{
  "id": "01-dat-mon-ro-rang-giao-hang",
  "title": "01: Đặt món rõ ràng, giao hàng, voucher, thanh toán",
  "channel": "messenger_mock",
  "goal": "User đặt món rõ ràng, bot hỏi địa chỉ còn thiếu, tính phí giao hàng, áp mã, xác nhận thanh toán, ghi chú giao hàng, ghi nhận hóa đơn và tạo đơn.",
  "useCases": [
    "UC-01",
    "UC-07",
    "UC-16",
    "UC-17",
    "UC-19",
    "UC-24",
    "UC-25",
    "UC-37"
  ],
  "finalState": "order_created",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Cho mình 1 combo gà cay, 1 burger Zinger và 2 Pepsi, giao về Quận 7.",
      "useCases": [
        "UC-01",
        "UC-07"
      ]
    },
    {
      "index": 2,
      "speaker": "Bot",
      "text": "Dạ mình đã thêm vào giỏ hàng: 1 combo gà cay, 1 Zinger Burger và 2 Pepsi. Tổng tạm tính là 218.000đ. Bạn cho mình xin địa chỉ cụ thể ở Quận 7 để kiểm tra cửa hàng giao gần nhất nhé.",
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
      "index": 4,
      "speaker": "Bot",
      "text": "Dạ mình kiểm tra được cửa hàng KFC gần nhất có đủ món và có thể giao tới địa chỉ này. Phí giao hàng dự kiến là 18.000đ.",
      "useCases": [
        "UC-24",
        "UC-37"
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
      "index": 6,
      "speaker": "Bot",
      "text": "Dạ mã KFC50 áp dụng cho đơn từ 199.000đ. Đơn của bạn đủ điều kiện, mình đã áp dụng giảm 50.000đ. Tổng sau ưu đãi và phí giao hàng là 186.000đ.",
      "useCases": [
        "UC-17"
      ]
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Thanh toán bằng Momo được không?",
      "useCases": [
        "UC-16"
      ]
    },
    {
      "index": 8,
      "speaker": "Bot",
      "text": "Dạ được. Mình sẽ tạo liên kết thanh toán Momo sau khi bạn xác nhận đơn.",
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
      "index": 10,
      "speaker": "Bot",
      "text": "Dạ mình đã thêm ghi chú giao hàng: \"Gọi khách khi tới nơi, không bấm chuông\". Với hóa đơn công ty, bạn vui lòng cung cấp tên công ty, mã số thuế và email nhận hóa đơn nhé.",
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
    },
    {
      "index": 12,
      "speaker": "Bot",
      "text": "Dạ mình xác nhận đơn: 1 combo gà cay, 1 Zinger Burger, 2 Pepsi; giao tới Sunrise City Quận 7; mã KFC50 đã áp dụng; tổng 186.000đ. Đơn sẽ được xử lý tại cửa hàng KFC gần địa chỉ giao hàng nhất. Mình tạo link thanh toán Momo và Order ID KFC-MOCK-1001 nhé.",
      "useCases": [
        "UC-01",
        "UC-16",
        "UC-37"
      ]
    }
  ],
  "expectations": [
    "Bot trích xuất đúng món, số lượng, hình thức giao hàng và địa chỉ thiếu chi tiết.",
    "Bot không tạo đơn trước khi user xác nhận.",
    "Mock routing chọn cửa hàng gần nhất có đủ món.",
    "Mock voucher áp dụng đúng điều kiện đơn từ 199.000đ.",
    "Ghi chú giao hàng và thông tin hóa đơn được lưu vào order payload.",
    "Dashboard ghi nhận `order_created`, `voucher_applied`, `payment_method=momo`."
  ]
}
''',
  "02-tu-van-combo-va-upsell.json": r'''{
  "id": "02-tu-van-combo-va-upsell",
  "title": "02: Tư vấn combo, ngân sách, khuyến mãi, upsell",
  "channel": "zalo_mock",
  "goal": "User chưa biết chọn món, hỏi khuyến mãi, ngân sách, nhóm đông người; bot tư vấn, upsell vừa đủ và tôn trọng khi user từ chối.",
  "useCases": [
    "UC-02",
    "UC-03",
    "UC-04",
    "UC-09",
    "UC-10",
    "UC-11",
    "UC-12",
    "UC-13"
  ],
  "finalState": "cart_ready",
  "turns": [
    {
      "index": 1,
      "speaker": "User",
      "text": "Không biết ăn gì, gợi ý cho mình với.",
      "useCases": [
        "UC-11"
      ]
    },
    {
      "index": 2,
      "speaker": "Bot",
      "text": "Dạ bạn đặt cho một mình, cho gia đình hay cho nhóm bạn/công ty ạ? Mình có thể gợi ý theo số người, khẩu vị và ngân sách.",
      "useCases": [
        "UC-11"
      ]
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Mình đặt đồ ăn trưa cho 10 người ở công ty. Tầm 300k thì ăn được gì?",
      "useCases": [
        "UC-03",
        "UC-13"
      ]
    },
    {
      "index": 4,
      "speaker": "Bot",
      "text": "Dạ với 10 người thì 300.000đ hơi thấp nếu mỗi người một phần riêng. Mình có thể gợi ý combo nhóm tiết kiệm hơn, hoặc chia thành bucket gà, burger, khoai và nước theo ngân sách bạn muốn.",
      "useCases": [
        "UC-03",
        "UC-13"
      ]
    },
    {
      "index": 5,
      "speaker": "User",
      "text": "Hôm nay có khuyến mãi gì không?",
      "useCases": [
        "UC-04"
      ]
    },
    {
      "index": 6,
      "speaker": "Bot",
      "text": "Dạ hôm nay có ưu đãi combo nhóm và giảm giá khi nâng cấp phần nước. Bạn muốn mình gợi ý combo phù hợp với nhóm 10 người không ạ?",
      "useCases": [
        "UC-04"
      ]
    },
    {
      "index": 7,
      "speaker": "User",
      "text": "Món nào bán chạy nhất vậy?",
      "useCases": [
        "UC-12"
      ]
    },
    {
      "index": 8,
      "speaker": "Bot",
      "text": "Dạ các món được đặt nhiều gồm gà rán cay, Zinger Burger và Combo 2 người. Với nhóm đông, mình gợi ý bucket gà kèm khoai và nước để dễ chia.",
      "useCases": [
        "UC-12"
      ]
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Cho mình combo gà đi.",
      "useCases": [
        "UC-02"
      ]
    },
    {
      "index": 10,
      "speaker": "Bot",
      "text": "Dạ bạn muốn combo cho mấy người dùng ạ? Mình có combo 1 người, 2 người và combo nhóm/family.",
      "useCases": [
        "UC-02"
      ]
    },
    {
      "index": 11,
      "speaker": "User",
      "text": "Combo nhóm cho 10 người.",
      "useCases": [
        "Filler"
      ]
    },
    {
      "index": 12,
      "speaker": "Bot",
      "text": "Dạ mình gợi ý 2 bucket gà, 5 khoai tây chiên và 10 Pepsi. Nếu muốn tiết kiệm hơn, mình có thể giảm nước hoặc đổi một phần sang trà đào.",
      "useCases": [
        "Filler"
      ]
    },
    {
      "index": 13,
      "speaker": "User",
      "text": "Ok, nâng lên combo có thêm burger đi.",
      "useCases": [
        "UC-10"
      ]
    },
    {
      "index": 14,
      "speaker": "Bot",
      "text": "Dạ mình đã nâng đơn thành combo nhóm có thêm 5 Zinger Burger. Tổng tạm tính hiện tại là 890.000đ.",
      "useCases": [
        "UC-10"
      ]
    },
    {
      "index": 15,
      "speaker": "User",
      "text": "Không, giữ vậy thôi, đừng thêm burger nữa.",
      "useCases": [
        "UC-09"
      ]
    },
    {
      "index": 16,
      "speaker": "Bot",
      "text": "Dạ mình bỏ phần burger và giữ nguyên combo nhóm ban đầu. Tổng tạm tính là 690.000đ. Bạn muốn giao hàng hay đến cửa hàng nhận ạ?",
      "useCases": [
        "UC-09"
      ]
    }
  ],
  "expectations": [
    "Bot không tự chọn combo khi user nói mơ hồ.",
    "Bot hỏi số người/ngân sách trước khi đề xuất.",
    "Bot trả lời khuyến mãi rồi dẫn về hành động đặt món.",
    "Bot xử lý cả upsell accepted và upsell rejected trong cùng flow.",
    "Cart cuối không còn burger sau khi user từ chối."
  ]
}
''',
  "03-ton-kho-dia-chi-va-cua-hang.json": r'''{
  "id": "03-ton-kho-dia-chi-va-cua-hang",
  "title": "03: Tồn kho, địa chỉ, cửa hàng và giờ cao điểm",
  "channel": "web_mock",
  "goal": "Kiểm tra hết món, ngoài vùng giao, địa chỉ mơ hồ, đổi địa chỉ, hết hàng lúc xác nhận và cửa hàng quá tải.",
  "useCases": [
    "UC-06",
    "UC-07",
    "UC-08",
    "UC-23",
    "UC-38"
  ],
  "finalState": "needs_customer_decision",
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
      "index": 2,
      "speaker": "Bot",
      "text": "Dạ hiện Burger Tôm đang tạm hết tại cửa hàng gần bạn. Ngoài ra khu vực Nhà Bè có thể nằm ngoài phạm vi giao hàng của cửa hàng gần nhất. Bạn có muốn mình kiểm tra cửa hàng KFC gần nhất để đặt mang đi hoặc gợi ý Zinger Burger thay thế không ạ?",
      "useCases": [
        "UC-06",
        "UC-08"
      ]
    },
    {
      "index": 3,
      "speaker": "User",
      "text": "Vậy lấy Zinger Burger, giao tới chỗ cũ nha.",
      "useCases": [
        "UC-07"
      ]
    },
    {
      "index": 4,
      "speaker": "Bot",
      "text": "Dạ mình thấy địa chỉ gần nhất của bạn là 123 Nguyễn Trãi, Quận 5. Bạn muốn giao tới địa chỉ này đúng không ạ?",
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
      "index": 6,
      "speaker": "Bot",
      "text": "Dạ mình kiểm tra thấy cửa hàng gần địa chỉ này đang trong giờ cao điểm, thời gian giao dự kiến khoảng 45 phút. Bạn muốn tiếp tục đặt hay chọn nhận tại cửa hàng khác nhanh hơn?",
      "useCases": [
        "UC-38"
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
      "index": 8,
      "speaker": "Bot",
      "text": "Dạ mình đã giữ Zinger Burger trong giỏ. Trước khi xác nhận, hệ thống báo món này vừa tạm hết tại cửa hàng gần bạn. Mình có thể gợi ý Burger Gà Giòn thay thế hoặc kiểm tra cửa hàng khác gần đó.",
      "useCases": [
        "UC-06"
      ]
    },
    {
      "index": 9,
      "speaker": "User",
      "text": "Đổi địa chỉ giao qua Quận 3 được không?",
      "useCases": [
        "UC-23"
      ]
    },
    {
      "index": 10,
      "speaker": "Bot",
      "text": "Dạ mình sẽ kiểm tra trạng thái đơn. Vì đơn chưa được tạo, mình có thể đổi địa chỉ. Bạn cho mình xin địa chỉ mới cụ thể ở Quận 3 nhé.",
      "useCases": [
        "UC-23"
      ]
    }
  ],
  "expectations": [
    "Bot không nhận đơn món đã hết hàng.",
    "Bot không hứa giao hàng khi địa chỉ ngoài vùng hoặc chưa chắc chắn.",
    "Bot dùng lịch sử địa chỉ nhưng vẫn xác nhận lại với user.",
    "Bot báo ETA tăng khi cửa hàng quá tải.",
    "Nếu tồn kho thay đổi trước xác nhận, bot phải hỏi user chọn món thay thế hoặc cửa hàng khác.",
    "Đổi địa chỉ chỉ cập nhật khi đơn chưa được xử lý."
  ]
}
''',
  "04-sau-khi-dat-don.json": r'''{
  "id": "04-sau-khi-dat-don",
  "title": "04: Theo dõi, hủy, đặt lại và chỉnh đơn sau khi đặt",
  "channel": "messenger_mock",
  "goal": "User hỏi trạng thái đơn, ETA, hủy đơn, thêm món sau khi đặt và đặt lại đơn cũ.",
  "useCases": [
    "UC-20",
    "UC-21",
    "UC-22",
    "UC-26"
  ],
  "finalState": "post_order_handled",
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
      "index": 2,
      "speaker": "Bot",
      "text": "Dạ đơn KFC-1024 của bạn hiện đang được chuẩn bị tại cửa hàng KFC Nguyễn Thị Minh Khai. Thời gian dự kiến giao là khoảng 25 phút nữa.",
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
      "index": 4,
      "speaker": "Bot",
      "text": "Dạ đơn KFC-1024 của bạn hiện đang được chuẩn bị tại cửa hàng KFC Nguyễn Thị Minh Khai. Thời gian giao dự kiến là khoảng 25 phút nữa.",
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
      "index": 6,
      "speaker": "Bot",
      "text": "Dạ thời gian giao dự kiến là 25-30 phút nữa, tùy tình trạng giao hàng thực tế.",
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
      "index": 8,
      "speaker": "Bot",
      "text": "Dạ mình sẽ kiểm tra trạng thái đơn. Nếu đơn chưa được chuẩn bị, mình sẽ thêm 1 khoai vào đơn hiện tại. Nếu đơn đã xử lý, mình có thể tạo đơn bổ sung cho bạn.",
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
      "index": 10,
      "speaker": "Bot",
      "text": "Dạ đơn của bạn hiện chưa được chuẩn bị, mình có thể hỗ trợ hủy đơn. Bạn xác nhận muốn hủy đơn này không ạ?",
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
      "index": 12,
      "speaker": "Bot",
      "text": "Dạ mình sẽ kiểm tra đơn đã chuẩn bị chưa và đã giao đi chưa. Nếu đơn đang giao hoặc đã vào bếp, mình sẽ chuyển nhân viên hỗ trợ để xử lý theo đúng trạng thái đơn.",
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
      "index": 14,
      "speaker": "Bot",
      "text": "Dạ đơn gần nhất của bạn gồm 1 Combo Gà Cay, 1 Pepsi và 1 khoai tây chiên. Tổng tiền là 129.000đ. Bạn muốn đặt lại đơn này đúng không ạ?",
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
    },
    {
      "index": 16,
      "speaker": "Bot",
      "text": "Dạ mình giữ nguyên đơn KFC-1024 và tạo giỏ hàng mới từ đơn cũ để bạn xác nhận riêng, tránh ảnh hưởng đơn đang xử lý.",
      "useCases": [
        "Filler"
      ]
    }
  ],
  "expectations": [
    "Bot lấy trạng thái và ETA từ mock OMS.",
    "Bot không hủy đơn nếu user chưa xác nhận hủy.",
    "Bot kiểm tra trạng thái trước khi thêm món sau khi đặt.",
    "Đặt lại đơn cũ phải tạo giỏ hàng mới và yêu cầu xác nhận.",
    "Bot không làm sai trạng thái đơn hiện tại khi user chuyển sang reorder."
  ]
}
''',
  "05-khieu-nai-va-human-handoff.json": r'''{
  "id": "05-khieu-nai-va-human-handoff",
  "title": "05: Khiếu nại, feedback và chuyển nhân viên",
  "channel": "zalo_mock",
  "goal": "Nhận diện khiếu nại, sai món, thiếu món, feedback sau đơn, user tức giận và yêu cầu gặp nhân viên.",
  "useCases": [
    "UC-27",
    "UC-28",
    "UC-29",
    "UC-30"
  ],
  "finalState": "human_handoff_created",
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
      "index": 2,
      "speaker": "Bot",
      "text": "Dạ KFC rất xin lỗi vì trải nghiệm chưa tốt. Mình sẽ ghi nhận phản hồi thiếu 1 phần khoai trong đơn hàng và kiểm tra phương án xử lý cho bạn.",
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
      "index": 4,
      "speaker": "Bot",
      "text": "Dạ mình ghi nhận lỗi giao sai món: đặt gà cay nhưng nhận gà thường. Mình sẽ chuyển thông tin này đến nhân viên hỗ trợ để kiểm tra đổi món hoặc bồi hoàn.",
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
      "index": 6,
      "speaker": "Bot",
      "text": "Dạ KFC rất xin lỗi vì bạn phải chờ lâu và nhận đơn chưa đúng. Mình sẽ ưu tiên chuyển trường hợp này cho nhân viên hỗ trợ.",
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
      "index": 8,
      "speaker": "Bot",
      "text": "Dạ mình sẽ chuyển bạn đến nhân viên hỗ trợ ngay. Nhân viên sẽ thấy thông tin thiếu khoai, giao sai món và trạng thái đơn để xử lý nhanh hơn.",
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
    },
    {
      "index": 10,
      "speaker": "Bot",
      "text": "Dạ cảm ơn bạn đã phản hồi. Mình ghi nhận món ăn tốt nhưng thời gian giao hàng và độ chính xác đơn cần cải thiện.",
      "useCases": [
        "UC-28"
      ]
    }
  ],
  "expectations": [
    "Bot nhận diện complaint, không xử lý như đơn mới.",
    "Complaint payload có đủ loại lỗi: thiếu món, sai món, giao lâu.",
    "User tức giận làm tăng priority escalation.",
    "Khi user yêu cầu nhân viên, bot phải handoff ngay.",
    "Feedback tích cực/tiêu cực được ghi nhận có cấu trúc."
  ]
}
''',
  "06-ngon-ngu-tu-nhien-va-an-toan.json": r'''{
  "id": "06-ngon-ngu-tu-nhien-va-an-toan",
  "title": "06: Ngôn ngữ tự nhiên, mơ hồ và an toàn hội thoại",
  "channel": "messenger_mock",
  "goal": "Hiểu sai chính tả/tiếng lóng, xử lý yêu cầu dị ứng, spam, câu mơ hồ và yêu cầu ngoài phạm vi.",
  "useCases": [
    "UC-31",
    "UC-32",
    "UC-33",
    "UC-34",
    "UC-35",
    "UC-36"
  ],
  "finalState": "clarification_needed",
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
      "index": 2,
      "speaker": "Bot",
      "text": "Dạ mình hiểu là bạn muốn đặt 2 miếng gà cay và 1 Pepsi đúng không ạ?",
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
      "index": 4,
      "speaker": "Bot",
      "text": "Dạ mình có thể gợi ý các món không cay và không có phô mai. Tuy nhiên, để đảm bảo an toàn về thành phần, mình khuyến nghị bạn kiểm tra lại thông tin dị ứng với nhân viên cửa hàng trước khi xác nhận đơn.",
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
      "index": 6,
      "speaker": "Bot",
      "text": "Dạ mình là trợ lý đặt món KFC. Hiện mình có thể hỗ trợ bạn xem menu, gợi ý combo, đặt món, theo dõi đơn hàng hoặc kết nối nhân viên. Bạn muốn mình hỗ trợ phần nào ạ?",
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
      "index": 8,
      "speaker": "Bot",
      "text": "Dạ bạn đang muốn chọn món nào ạ? Mình thấy bạn vừa nhắc tới gà cay, Pepsi và món không cay không phô mai. Bạn muốn thêm món nào vào giỏ hàng?",
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
      "index": 10,
      "speaker": "Bot",
      "text": "Dạ bạn muốn đặt lại đơn gần nhất của mình đúng không ạ? Đơn gần nhất gồm 2 gà cay, 1 Pepsi và 1 khoai tây chiên. Bạn muốn đặt lại đơn này không?",
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
    },
    {
      "index": 12,
      "speaker": "Bot",
      "text": "Dạ mình không thể cung cấp thông tin cá nhân của nhân viên. Nếu bạn cần hỗ trợ, mình có thể kết nối bạn với kênh chăm sóc khách hàng chính thức của KFC.",
      "useCases": [
        "UC-35"
      ]
    }
  ],
  "expectations": [
    "Bot hiểu tiếng lóng/sai chính tả nhưng phải xác nhận lại.",
    "Bot không cam kết tuyệt đối về dị ứng nếu dữ liệu chưa đủ.",
    "Spam hoặc nội dung ngoài phạm vi không tạo đơn.",
    "Câu mơ hồ phải dẫn tới clarification hoặc lịch sử đơn, không tự thêm món.",
    "Bot từ chối yêu cầu thông tin cá nhân và đề xuất kênh hỗ trợ chính thức."
  ]
}
''',
  "07-ca-nhan-hoa-va-loyalty.json": r'''{
  "id": "07-ca-nhan-hoa-va-loyalty",
  "title": "07: Cá nhân hóa, món yêu thích, loyalty và chỉnh giỏ hàng",
  "channel": "zalo_mock",
  "goal": "User muốn đặt lại đơn cũ, lấy món hay ăn, kiểm tra điểm thành viên và chỉnh giỏ hàng.",
  "useCases": [
    "UC-05",
    "UC-14",
    "UC-15",
    "UC-22"
  ],
  "finalState": "cart_updated",
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
      "index": 2,
      "speaker": "Bot",
      "text": "Dạ đơn gần nhất của bạn gồm 1 combo gà cay, 1 Pepsi và 1 khoai tây chiên. Tổng tiền là 129.000đ. Bạn muốn đặt lại đơn này đúng không ạ?",
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
      "index": 4,
      "speaker": "Bot",
      "text": "Dạ bạn thường đặt Zinger Burger combo. Mình thêm combo này vào giỏ hàng cho bạn nhé?",
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
      "index": 6,
      "speaker": "Bot",
      "text": "Dạ tài khoản của bạn hiện có 120 điểm. Bạn có thể dùng điểm để đổi ưu đãi nước hoặc khoai tây chiên trong đơn này.",
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
      "index": 8,
      "speaker": "Bot",
      "text": "Dạ mình đã bỏ Pepsi và thay bằng trà đào. Giỏ hàng hiện tại gồm Zinger Burger combo với trà đào. Tổng tạm tính là 129.000đ.",
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
    },
    {
      "index": 10,
      "speaker": "Bot",
      "text": "Dạ mình giữ giỏ hàng hiện tại. Khi bạn sẵn sàng, mình sẽ tóm tắt lại đơn để bạn xác nhận trước khi đặt.",
      "useCases": [
        "Filler"
      ]
    }
  ],
  "expectations": [
    "Reorder từ đơn cũ phải hiển thị lại và hỏi xác nhận.",
    "Món yêu thích dựa trên lịch sử nhưng không tự thêm nếu chưa được đồng ý.",
    "Loyalty lookup trả về điểm và gợi ý đổi điểm.",
    "Chỉnh giỏ hàng cập nhật đúng món và tính lại tổng tiền.",
    "Không tạo đơn khi user nói chưa đặt vội."
  ]
}
''',
  "08-thanh-toan-loi-va-don-bat-thuong.json": r'''{
  "id": "08-thanh-toan-loi-va-don-bat-thuong",
  "title": "08: Lỗi thanh toán và đơn bất thường",
  "channel": "web_mock",
  "goal": "Thanh toán thất bại, bấm thanh toán lỗi và đơn số lượng lớn cần nhân viên xác nhận.",
  "useCases": [
    "UC-18",
    "UC-39"
  ],
  "finalState": "human_review_required",
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
      "index": 2,
      "speaker": "Bot",
      "text": "Dạ mình kiểm tra thấy giao dịch hiện chưa thành công. Bạn muốn thử thanh toán lại hoặc đổi sang thanh toán khi nhận hàng không ạ?",
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
      "index": 4,
      "speaker": "Bot",
      "text": "Dạ mình sẽ không xác nhận đơn là đã thanh toán khi giao dịch online chưa hoàn tất. Bạn có thể thử lại liên kết thanh toán hoặc đổi sang thanh toán khi nhận hàng.",
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
      "index": 6,
      "speaker": "Bot",
      "text": "Dạ đơn hàng của bạn có số lượng lớn và cần kiểm tra thêm về tồn kho, thời gian chuẩn bị và thông tin giao hàng. Mình sẽ chuyển thông tin đến nhân viên để xác nhận nhanh trước khi xử lý.",
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
    },
    {
      "index": 8,
      "speaker": "Bot",
      "text": "Vì đơn có số lượng bất thường, hệ thống cần tránh sai thông tin, đơn ảo hoặc cam kết thời gian không khả thi. Nhân viên sẽ xác nhận lại số lượng, thời gian và phương thức thanh toán với bạn.",
      "useCases": [
        "Filler"
      ]
    }
  ],
  "expectations": [
    "Bot không đánh dấu thanh toán thành công khi mock payment trả lỗi.",
    "Bot đề xuất retry hoặc COD.",
    "Lỗi thanh toán không được tạo order paid.",
    "Đơn số lượng rất lớn kích hoạt `human_review_required`.",
    "Dashboard escalation reason gồm `payment_failed` và `abnormal_large_order`."
  ]
}
''',
};
