# Bộ kịch bản hội thoại: 39 use case KFC AI Chat Ordering Assistant

Nguồn use case: Google Doc `For AI Buiild Week Only | Framework - usecase AI Chat Ordering Assistant - KFC`.

Mục tiêu của thư mục này là biến 39 use case hiện tại trong tài liệu thành các kịch bản hội thoại dài hơn, tự nhiên hơn, dùng được cho demo và integration test. Mỗi use case trong doc thường chỉ là một tình huống 1-2 lượt; các file bên dưới gom nhiều tình huống liên quan vào cùng một hành trình khách hàng.

Tất cả kịch bản đều dùng mock API. Không cần API thật của KFC, Messenger hoặc Zalo.

## Cách dùng cho demo và integration test

- Dùng phần `Hội thoại demo` làm script demo tiếng Việt.
- Dùng `Use case bao phủ` để kiểm tra coverage.
- Mỗi dòng trong bảng hội thoại phải có cột `Use case`.
- Nếu một lượt không trực tiếp kiểm thử use case nào mà chỉ giúp hội thoại tự nhiên hơn, đánh dấu là `Filler`.
- Một lượt có thể bao phủ nhiều use case, ví dụ `UC-17, UC-24`.
- Dùng `Kỳ vọng kiểm thử` để viết integration test assertions.
- Bot không được tự tạo đơn khi thiếu xác nhận cuối cùng.
- Các phản hồi có thể chỉnh câu chữ, nhưng không nên đổi ý định kiểm thử của từng UC.

## Danh sách use case từ tài liệu hiện tại

| UC | Tên use case |
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

## Kịch bản hội thoại

| File | Tên kịch bản | Use case bao phủ |
|---|---|---|
| [01-dat-mon-ro-rang-giao-hang.md](./01-dat-mon-ro-rang-giao-hang.md) | Đặt món rõ ràng, giao hàng, voucher, thanh toán | UC-01, UC-07, UC-16, UC-17, UC-19, UC-24, UC-25, UC-37 |
| [02-tu-van-combo-va-upsell.md](./02-tu-van-combo-va-upsell.md) | Tư vấn combo, ngân sách, khuyến mãi, upsell | UC-02, UC-03, UC-04, UC-09, UC-10, UC-11, UC-12, UC-13 |
| [03-ton-kho-dia-chi-va-cua-hang.md](./03-ton-kho-dia-chi-va-cua-hang.md) | Tồn kho, địa chỉ, cửa hàng và giờ cao điểm | UC-06, UC-07, UC-08, UC-23, UC-38 |
| [04-sau-khi-dat-don.md](./04-sau-khi-dat-don.md) | Theo dõi, hủy, đặt lại và chỉnh đơn sau khi đặt | UC-20, UC-21, UC-22, UC-26 |
| [05-khieu-nai-va-human-handoff.md](./05-khieu-nai-va-human-handoff.md) | Khiếu nại, feedback và chuyển nhân viên | UC-27, UC-28, UC-29, UC-30 |
| [06-ngon-ngu-tu-nhien-va-an-toan.md](./06-ngon-ngu-tu-nhien-va-an-toan.md) | Ngôn ngữ tự nhiên, mơ hồ và an toàn hội thoại | UC-31, UC-32, UC-33, UC-34, UC-35, UC-36 |
| [07-ca-nhan-hoa-va-loyalty.md](./07-ca-nhan-hoa-va-loyalty.md) | Cá nhân hóa, món yêu thích, loyalty và chỉnh giỏ hàng | UC-05, UC-14, UC-15, UC-22 |
| [08-thanh-toan-loi-va-don-bat-thuong.md](./08-thanh-toan-loi-va-don-bat-thuong.md) | Lỗi thanh toán và đơn bất thường | UC-18, UC-39 |

## Coverage check

Tất cả 39 use case từ Google Doc hiện tại được bao phủ ít nhất một lần:

```text
UC-01 UC-02 UC-03 UC-04 UC-05 UC-06 UC-07 UC-08 UC-09 UC-10
UC-11 UC-12 UC-13 UC-14 UC-15 UC-16 UC-17 UC-18 UC-19 UC-20
UC-21 UC-22 UC-23 UC-24 UC-25 UC-26 UC-27 UC-28 UC-29 UC-30
UC-31 UC-32 UC-33 UC-34 UC-35 UC-36 UC-37 UC-38 UC-39
```
