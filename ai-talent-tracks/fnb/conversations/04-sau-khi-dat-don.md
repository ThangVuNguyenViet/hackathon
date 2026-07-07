# 04: Theo dõi, hủy, đặt lại và chỉnh đơn sau khi đặt

## Metadata

- Kênh: Messenger mock
- Mục tiêu demo: User hỏi trạng thái đơn, ETA, hủy đơn, thêm món sau khi đặt và đặt lại đơn cũ.
- Use case bao phủ: UC-12, UC-13, UC-25, UC-26, UC-27, UC-36, UC-37
- Trạng thái cuối: `post_order_handled`

## Hội thoại demo

| Lượt | Người nói | Nội dung | Use case |
|---:|---|---|---|
| 1 | User | Đơn của mình tới đâu rồi? | UC-13 |
| 2 | Bot | Dạ đơn KFC-1024 của bạn hiện đang được chuẩn bị tại cửa hàng KFC Nguyễn Thị Minh Khai. Thời gian dự kiến giao là khoảng 25 phút nữa. | UC-13 |
| 3 | User | Bao lâu nữa giao tới? | UC-26 |
| 4 | Bot | Dạ đơn KFC-1024 của bạn hiện đang được chuẩn bị tại cửa hàng KFC Nguyễn Thị Minh Khai. Thời gian giao dự kiến là khoảng 25 phút nữa. | UC-26 |
| 5 | User | Khoảng bao lâu tới? | UC-37 |
| 6 | Bot | Dạ thời gian giao dự kiến là 25-30 phút nữa, tùy tình trạng giao hàng thực tế. | UC-37 |
| 7 | User | Mình thêm 1 khoai nữa được không? | UC-36 |
| 8 | Bot | Dạ mình sẽ kiểm tra trạng thái đơn. Nếu đơn chưa được chuẩn bị, mình sẽ thêm 1 khoai vào đơn hiện tại. Nếu đơn đã xử lý, mình có thể tạo đơn bổ sung cho bạn. | UC-36 |
| 9 | User | Mình muốn hủy đơn vừa đặt. | UC-12 |
| 10 | Bot | Dạ đơn của bạn hiện chưa được chuẩn bị, mình có thể hỗ trợ hủy đơn. Bạn xác nhận muốn hủy đơn này không ạ? | UC-12 |
| 11 | User | Nếu đơn đã chuẩn bị hoặc đang giao rồi thì sao, mình vẫn muốn hủy. | UC-27 |
| 12 | Bot | Dạ mình sẽ kiểm tra đơn đã chuẩn bị chưa và đã giao đi chưa. Nếu đơn đang giao hoặc đã vào bếp, mình sẽ chuyển nhân viên hỗ trợ để xử lý theo đúng trạng thái đơn. | UC-27 |
| 13 | User | Chưa hủy, cho mình đặt lại đơn lần trước cho đồng nghiệp. | UC-25 |
| 14 | Bot | Dạ đơn gần nhất của bạn gồm 1 Combo Gà Cay, 1 Pepsi và 1 khoai tây chiên. Tổng tiền là 129.000đ. Bạn muốn đặt lại đơn này đúng không ạ? | UC-25 |
| 15 | User | Đúng rồi, nhưng đơn hiện tại cứ giữ nguyên. | Filler |
| 16 | Bot | Dạ mình giữ nguyên đơn KFC-1024 và tạo giỏ hàng mới từ đơn cũ để bạn xác nhận riêng, tránh ảnh hưởng đơn đang xử lý. | Filler |

## Kỳ vọng kiểm thử

- Bot lấy trạng thái và ETA từ mock OMS.
- Bot không hủy đơn nếu user chưa xác nhận hủy.
- Bot kiểm tra trạng thái trước khi thêm món sau khi đặt.
- Đặt lại đơn cũ phải tạo giỏ hàng mới và yêu cầu xác nhận.
- Bot không làm sai trạng thái đơn hiện tại khi user chuyển sang reorder.
