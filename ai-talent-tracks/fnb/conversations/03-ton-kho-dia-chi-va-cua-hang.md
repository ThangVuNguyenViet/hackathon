# 03: Tồn kho, địa chỉ, cửa hàng và giờ cao điểm

## Metadata

- Kênh: Web Mock
- Mục tiêu demo: Kiểm tra hết món, ngoài vùng giao, địa chỉ mơ hồ, đổi địa chỉ, hết hàng lúc xác nhận và cửa hàng quá tải.
- Use case bao phủ: UC-06, UC-07, UC-08, UC-23, UC-38
- Trạng thái cuối: `needs_customer_decision`

## Hội thoại demo

| Lượt | Người nói | Nội dung | Use case |
|---:|---|---|---|
| 1 | User | Cho mình 1 burger tôm, giao về Nhà Bè được không? | UC-06, UC-08 |
| 2 | Bot | Dạ hiện Burger Tôm đang tạm hết tại cửa hàng gần bạn. Ngoài ra khu vực Nhà Bè có thể nằm ngoài phạm vi giao hàng của cửa hàng gần nhất. Bạn có muốn mình kiểm tra cửa hàng KFC gần nhất để đặt mang đi hoặc gợi ý Zinger Burger thay thế không ạ? | UC-06, UC-08 |
| 3 | User | Vậy lấy Zinger Burger, giao tới chỗ cũ nha. | UC-07 |
| 4 | Bot | Dạ mình thấy địa chỉ gần nhất của bạn là 123 Nguyễn Trãi, Quận 5. Bạn muốn giao tới địa chỉ này đúng không ạ? | UC-07 |
| 5 | User | Đúng rồi. | Filler |
| 6 | Bot | Dạ mình kiểm tra thấy cửa hàng gần địa chỉ này đang trong giờ cao điểm, thời gian giao dự kiến khoảng 45 phút. Bạn muốn tiếp tục đặt hay chọn nhận tại cửa hàng khác nhanh hơn? | UC-38 |
| 7 | User | Tiếp tục đặt. | Filler |
| 8 | Bot | Dạ mình đã giữ Zinger Burger trong giỏ. Trước khi xác nhận, hệ thống báo món này vừa tạm hết tại cửa hàng gần bạn. Mình có thể gợi ý Burger Gà Giòn thay thế hoặc kiểm tra cửa hàng khác gần đó. | UC-06 |
| 9 | User | Đổi địa chỉ giao qua Quận 3 được không? | UC-23 |
| 10 | Bot | Dạ mình sẽ kiểm tra trạng thái đơn. Vì đơn chưa được tạo, mình có thể đổi địa chỉ. Bạn cho mình xin địa chỉ mới cụ thể ở Quận 3 nhé. | UC-23 |

## Kỳ vọng kiểm thử

- Bot không nhận đơn món đã hết hàng.
- Bot không hứa giao hàng khi địa chỉ ngoài vùng hoặc chưa chắc chắn.
- Bot dùng lịch sử địa chỉ nhưng vẫn xác nhận lại với user.
- Bot báo ETA tăng khi cửa hàng quá tải.
- Nếu tồn kho thay đổi trước xác nhận, bot phải hỏi user chọn món thay thế hoặc cửa hàng khác.
- Đổi địa chỉ chỉ cập nhật khi đơn chưa được xử lý.
