# 07: Cá nhân hóa, món yêu thích, loyalty và chỉnh giỏ hàng

## Metadata

- Kênh: Zalo mock
- Mục tiêu demo: User muốn đặt lại đơn cũ, lấy món hay ăn, kiểm tra điểm thành viên và chỉnh giỏ hàng.
- Use case bao phủ: UC-05, UC-44, UC-45, UC-46
- Trạng thái cuối: `cart_updated`

## Hội thoại demo

| Lượt | Người nói | Nội dung | Use case |
|---:|---|---|---|
| 1 | User | Đặt lại đơn lần trước cho mình. | UC-44 |
| 2 | Bot | Dạ đơn gần nhất của bạn gồm 1 combo gà cay, 1 Pepsi và 1 khoai tây chiên. Tổng tiền là 129.000đ. Bạn muốn đặt lại đơn này đúng không ạ? | UC-44 |
| 3 | User | Khoan, lấy món mình hay ăn đi. | UC-45 |
| 4 | Bot | Dạ bạn thường đặt Zinger Burger combo. Mình thêm combo này vào giỏ hàng cho bạn nhé? | UC-45 |
| 5 | User | Ok, thêm combo đó. Mình có điểm thành viên không? | UC-46 |
| 6 | Bot | Dạ tài khoản của bạn hiện có 120 điểm. Bạn có thể dùng điểm để đổi ưu đãi nước hoặc khoai tây chiên trong đơn này. | UC-46 |
| 7 | User | Bỏ Pepsi ra, đổi thành trà đào được không? | UC-05 |
| 8 | Bot | Dạ mình đã bỏ Pepsi và thay bằng trà đào. Giỏ hàng hiện tại gồm Zinger Burger combo với trà đào. Tổng tạm tính là 129.000đ. | UC-05 |
| 9 | User | Giữ giỏ vậy, chưa đặt vội. | Filler |
| 10 | Bot | Dạ mình giữ giỏ hàng hiện tại. Khi bạn sẵn sàng, mình sẽ tóm tắt lại đơn để bạn xác nhận trước khi đặt. | Filler |

## Kỳ vọng kiểm thử

- Reorder từ đơn cũ phải hiển thị lại và hỏi xác nhận.
- Món yêu thích dựa trên lịch sử nhưng không tự thêm nếu chưa được đồng ý.
- Loyalty lookup trả về điểm và gợi ý đổi điểm.
- Chỉnh giỏ hàng cập nhật đúng món và tính lại tổng tiền.
- Không tạo đơn khi user nói chưa đặt vội.
