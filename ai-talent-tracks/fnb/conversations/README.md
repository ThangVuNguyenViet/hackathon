# KFC outcome scenario corpus

> Generated from `*.json`. JSON is the only authored scenario and outcome source.

The corpus contains 9 scenarios and 48 customer turns. Text and GenUI modes produce 96 dataset examples.

## Authoritative use-case taxonomy

| UC | Observable intent |
|---|---|
| UC-01 | User đặt món rõ ràng |
| UC-02 | User đặt món mơ hồ |
| UC-03 | User đặt món theo ngân sách hoặc số người |
| UC-04 | User hỏi menu hoặc khuyến mãi |
| UC-05 | User muốn chỉnh sửa giỏ hàng |
| UC-06 | Món user chọn đã hết hàng |
| UC-07 | User thiếu hoặc nhập không rõ địa chỉ giao hàng |
| UC-08 | User ngoài vùng giao hàng |
| UC-09 | User từ chối upsell |
| UC-10 | User đồng ý upsell |
| UC-11 | User không biết ăn gì và cần chatbot tư vấn |
| UC-12 | User hỏi món bán chạy hoặc món được đề xuất |
| UC-13 | User đặt món cho nhóm đông người |
| UC-14 | User có món yêu thích |
| UC-15 | User là khách thân thiết hoặc loyalty member |
| UC-16 | User muốn thanh toán |
| UC-17 | User dùng mã giảm giá hoặc voucher |
| UC-18 | User thanh toán online thất bại |
| UC-19 | User hỏi xuất hóa đơn công ty |
| UC-20 | User muốn hủy đơn |
| UC-21 | User muốn theo dõi đơn hàng và ETA |
| UC-22 | User muốn đặt lại đơn cũ |
| UC-23 | User muốn đổi địa chỉ sau khi đã tạo đơn |
| UC-24 | User hỏi phí giao hàng |
| UC-25 | User muốn ghi chú cho tài xế hoặc cửa hàng |
| UC-26 | User muốn thêm món sau khi đã đặt |
| UC-27 | User khiếu nại thiếu, sai hoặc trễ đơn |
| UC-28 | User đánh giá sau đơn hàng |
| UC-29 | User tức giận hoặc dùng ngôn ngữ tiêu cực |
| UC-30 | User muốn gặp nhân viên thật |
| UC-31 | User dùng tiếng lóng hoặc sai chính tả |
| UC-32 | User có yêu cầu dị ứng hoặc kiêng món |
| UC-33 | User spam hoặc nhập nội dung không liên quan |
| UC-34 | Chatbot không chắc ý định của user |
| UC-35 | User yêu cầu ngoài phạm vi hoặc liên quan an toàn thông tin |
| UC-36 | Chatbot không hiểu yêu cầu |
| UC-37 | Đơn được phân về cửa hàng gần nhất |
| UC-38 | Quá tải đơn hàng giờ cao điểm |
| UC-39 | Đơn có dấu hiệu bất thường |

## Scenarios

- [01: Đặt món rõ ràng, giao hàng, voucher, thanh toán](./01-dat-mon-ro-rang-giao-hang.md) — 6 customer turns
- [02: Toàn bộ menu, tư vấn đồ uống, combo và upsize](./02-tu-van-combo-va-upsell.md) — 7 customer turns
- [03: Tồn kho, nhận tại cửa hàng rồi chuyển sang giao hàng](./03-ton-kho-dia-chi-va-cua-hang.md) — 5 customer turns
- [04: Theo dõi, hủy, đặt lại và chỉnh đơn sau khi đặt](./04-sau-khi-dat-don.md) — 8 customer turns
- [05: Khiếu nại, feedback và chuyển nhân viên](./05-khieu-nai-va-human-handoff.md) — 5 customer turns
- [06: Ngôn ngữ tự nhiên, mơ hồ và an toàn hội thoại](./06-ngon-ngu-tu-nhien-va-an-toan.md) — 6 customer turns
- [07: Cá nhân hóa, món yêu thích, loyalty và chỉnh giỏ hàng](./07-ca-nhan-hoa-va-loyalty.md) — 5 customer turns
- [08: Lỗi thanh toán và đơn bất thường](./08-thanh-toan-loi-va-don-bat-thuong.md) — 4 customer turns
- [09: Phương thức thanh toán website/app](./09-phuong-thuc-thanh-toan.md) — 2 customer turns
