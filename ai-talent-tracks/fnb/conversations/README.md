# Bộ kịch bản hội thoại: 50 use case KFC AI Chat Ordering Assistant

Nguồn use case: Google Doc `For AI Buiild Week Only | Framework - usecase AI Chat Ordering Assistant - KFC`.

Mục tiêu của thư mục này là biến 50 use case riêng lẻ trong tài liệu gốc thành các kịch bản hội thoại dài hơn, tự nhiên hơn, dùng được cho demo và integration test. Mỗi use case trong doc gốc thường chỉ là một tình huống 1-2 lượt; các file bên dưới gom nhiều tình huống liên quan vào cùng một hành trình khách hàng.

Tất cả kịch bản đều dùng mock API. Không cần API thật của KFC, Messenger hoặc Zalo.

## Cách dùng cho demo và integration test

- Dùng phần `Hội thoại demo` làm script demo tiếng Việt.
- Dùng `Use case bao phủ` để kiểm tra coverage.
- Mỗi dòng trong bảng hội thoại phải có cột `Use case`.
- Nếu một lượt không trực tiếp kiểm thử use case nào mà chỉ giúp hội thoại tự nhiên hơn, đánh dấu là `Filler`.
- Một lượt có thể bao phủ nhiều use case, ví dụ `UC-23, UC-34`.
- Dùng `Kỳ vọng kiểm thử` để viết integration test assertions.
- Bot không được tự tạo đơn khi thiếu xác nhận cuối cùng.
- Các phản hồi có thể chỉnh câu chữ, nhưng không nên đổi ý định kiểm thử của từng UC.

## Danh sách use case từ tài liệu gốc

| UC | Tên use case |
|---|---|
| UC-01 | User đặt món rõ ràng |
| UC-02 | User đặt món mơ hồ |
| UC-03 | User đặt theo ngân sách |
| UC-04 | User hỏi menu hoặc khuyến mãi |
| UC-05 | User muốn chỉnh sửa giỏ hàng |
| UC-06 | Món user chọn đã hết hàng |
| UC-07 | User thiếu địa chỉ giao hàng |
| UC-08 | User ngoài vùng giao hàng |
| UC-09 | User từ chối upsell |
| UC-10 | User đồng ý upsell |
| UC-11 | User muốn thanh toán |
| UC-12 | User muốn hủy đơn |
| UC-13 | User muốn theo dõi đơn |
| UC-14 | User khiếu nại |
| UC-15 | User dùng tiếng lóng hoặc sai chính tả |
| UC-16 | User có yêu cầu dị ứng hoặc kiêng món |
| UC-17 | User spam hoặc nhập nội dung không liên quan |
| UC-18 | Chatbot không chắc ý định của user |
| UC-19 | User không biết ăn gì, cần tư vấn |
| UC-20 | User hỏi món bán chạy |
| UC-21 | User đặt theo ngân sách |
| UC-22 | User đặt món cho nhóm đông người |
| UC-23 | User dùng mã giảm giá |
| UC-24 | User thanh toán thất bại |
| UC-25 | User muốn đặt lại đơn cũ |
| UC-26 | User hỏi trạng thái đơn |
| UC-27 | User muốn hủy đơn sau khi đã đặt |
| UC-28 | User khiếu nại sau khi nhận đơn |
| UC-29 | User nhập địa chỉ không rõ |
| UC-30 | User muốn đổi địa chỉ sau khi tạo đơn |
| UC-31 | User hỏi phí giao hàng |
| UC-32 | User muốn ghi chú cho tài xế/cửa hàng |
| UC-33 | User bấm thanh toán bị lỗi |
| UC-34 | User muốn dùng voucher |
| UC-35 | User hỏi xuất hóa đơn |
| UC-36 | User muốn thêm món sau khi đã đặt |
| UC-37 | User hỏi thời gian giao hàng |
| UC-38 | User báo nhận sai món |
| UC-39 | User đánh giá sau đơn hàng |
| UC-40 | User yêu cầu ngoài phạm vi/an toàn thông tin |
| UC-41 | User tức giận hoặc dùng ngôn ngữ tiêu cực |
| UC-42 | Chatbot không hiểu yêu cầu |
| UC-43 | User muốn gặp nhân viên thật |
| UC-44 | User muốn đặt lại đơn cũ |
| UC-45 | User có món yêu thích |
| UC-46 | User là khách thân thiết/loyalty member |
| UC-47 | Đơn được phân về cửa hàng gần nhất |
| UC-48 | Cửa hàng hết món sau khi user đã chọn |
| UC-49 | Quá tải đơn hàng giờ cao điểm |
| UC-50 | Đơn có dấu hiệu bất thường |

## Kịch bản hội thoại

| File | Tên kịch bản | Use case bao phủ |
|---|---|---|
| [01-dat-mon-ro-rang-giao-hang.md](./01-dat-mon-ro-rang-giao-hang.md) | Đặt món rõ ràng, giao hàng, voucher, thanh toán | UC-01, UC-07, UC-11, UC-23, UC-31, UC-32, UC-34, UC-35, UC-47 |
| [02-tu-van-combo-va-upsell.md](./02-tu-van-combo-va-upsell.md) | Tư vấn combo, ngân sách, khuyến mãi, upsell | UC-02, UC-03, UC-04, UC-09, UC-10, UC-19, UC-20, UC-21, UC-22 |
| [03-ton-kho-dia-chi-va-cua-hang.md](./03-ton-kho-dia-chi-va-cua-hang.md) | Hết món, vùng giao, địa chỉ, đổi địa chỉ, quá tải | UC-06, UC-08, UC-29, UC-30, UC-48, UC-49 |
| [04-sau-khi-dat-don.md](./04-sau-khi-dat-don.md) | Theo dõi, hủy, đặt lại, thêm món sau khi đặt | UC-12, UC-13, UC-25, UC-26, UC-27, UC-36, UC-37 |
| [05-khieu-nai-va-human-handoff.md](./05-khieu-nai-va-human-handoff.md) | Khiếu nại, sai món, feedback, khách tức giận, gặp nhân viên | UC-14, UC-28, UC-38, UC-39, UC-41, UC-43 |
| [06-ngon-ngu-tu-nhien-va-an-toan.md](./06-ngon-ngu-tu-nhien-va-an-toan.md) | Tiếng lóng, dị ứng, spam, mơ hồ, an toàn thông tin | UC-15, UC-16, UC-17, UC-18, UC-40, UC-42 |
| [07-ca-nhan-hoa-va-loyalty.md](./07-ca-nhan-hoa-va-loyalty.md) | Đặt lại, món yêu thích, loyalty, chỉnh giỏ hàng | UC-05, UC-44, UC-45, UC-46 |
| [08-thanh-toan-loi-va-don-bat-thuong.md](./08-thanh-toan-loi-va-don-bat-thuong.md) | Lỗi thanh toán, thanh toán lại, đơn bất thường | UC-24, UC-33, UC-50 |

## Coverage check

Tất cả 50 use case từ Google Doc được bao phủ ít nhất một lần:

```text
UC-01 UC-02 UC-03 UC-04 UC-05 UC-06 UC-07 UC-08 UC-09 UC-10
UC-11 UC-12 UC-13 UC-14 UC-15 UC-16 UC-17 UC-18 UC-19 UC-20
UC-21 UC-22 UC-23 UC-24 UC-25 UC-26 UC-27 UC-28 UC-29 UC-30
UC-31 UC-32 UC-33 UC-34 UC-35 UC-36 UC-37 UC-38 UC-39 UC-40
UC-41 UC-42 UC-43 UC-44 UC-45 UC-46 UC-47 UC-48 UC-49 UC-50
```
