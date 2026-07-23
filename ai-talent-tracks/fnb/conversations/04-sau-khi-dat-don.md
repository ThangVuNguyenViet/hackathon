# 04: Theo dõi, hủy, đặt lại và chỉnh đơn sau khi đặt

## Metadata

- Kênh: Messenger Mock
- Mục tiêu demo: User hỏi trạng thái đơn, ETA, hủy đơn, thêm món sau khi đặt và đặt lại đơn cũ.
- Use case bao phủ: UC-20, UC-21, UC-22, UC-26
- Trạng thái cuối: `post_order_handled`

## Hội thoại demo

| Lượt | Người nói | Nội dung | Use case |
|---:|---|---|---|
| 1 | User | Đơn của mình tới đâu rồi? | UC-21 |
| 2 | Bot | Dạ đơn KFC-1024 của bạn hiện đang được chuẩn bị tại cửa hàng KFC Nguyễn Thị Minh Khai. Thời gian dự kiến giao là khoảng 25 phút nữa. | UC-21 |
| 3 | User | Bao lâu nữa giao tới? | UC-21 |
| 4 | Bot | Dạ đơn KFC-1024 của bạn hiện đang được chuẩn bị tại cửa hàng KFC Nguyễn Thị Minh Khai. Thời gian giao dự kiến là khoảng 25 phút nữa. | UC-21 |
| 5 | User | Khoảng bao lâu tới? | UC-21 |
| 6 | Bot | Dạ thời gian giao dự kiến là 25-30 phút nữa, tùy tình trạng giao hàng thực tế. | UC-21 |
| 7 | User | Mình thêm 1 khoai nữa được không? | UC-26 |
| 8 | Bot | Đơn hiện chưa được chuẩn bị nên vẫn có thể thêm 1 khoai tây chiên. Bạn xác nhận muốn thêm món này vào đơn hiện tại nhé? | UC-26 |
| 9 | User | Mình muốn hủy đơn vừa đặt. | UC-20 |
| 10 | Bot | Dạ đơn của bạn hiện chưa được chuẩn bị, mình có thể hỗ trợ hủy đơn. Bạn xác nhận muốn hủy đơn này không ạ? | UC-20 |
| 11 | User | Nếu đơn đã chuẩn bị hoặc đang giao rồi thì sao, mình vẫn muốn hủy. | UC-20 |
| 12 | Bot | Dạ mình sẽ kiểm tra đơn đã chuẩn bị chưa và đã giao đi chưa. Nếu đơn đang giao hoặc đã vào bếp, mình sẽ chuyển nhân viên hỗ trợ để xử lý theo đúng trạng thái đơn. | UC-20 |
| 13 | User | Chưa hủy, cho mình đặt lại đơn lần trước cho đồng nghiệp. | UC-22 |
| 14 | Bot | Dạ đơn gần nhất của bạn gồm 1 Combo Gà Cay, 1 Pepsi và 1 khoai tây chiên. Tổng tiền là 129.000đ. Bạn muốn đặt lại đơn này đúng không ạ? | UC-22 |
| 15 | User | Đúng rồi, nhưng đơn hiện tại cứ giữ nguyên. | Filler |
| 16 | Bot | Dạ mình giữ nguyên đơn KFC-1024 và tạo giỏ hàng mới từ đơn cũ để bạn xác nhận riêng, tránh ảnh hưởng đơn đang xử lý. | Filler |

## Kỳ vọng kiểm thử

- Bot lấy trạng thái và ETA từ mock OMS.
- Bot không hủy đơn nếu user chưa xác nhận hủy.
- Bot kiểm tra trạng thái trước khi thêm món sau khi đặt.
- Đặt lại đơn cũ phải tạo giỏ hàng mới và yêu cầu xác nhận.
- Bot không làm sai trạng thái đơn hiện tại khi user chuyển sang reorder.
