# 07: Cá nhân hóa, món yêu thích, loyalty và chỉnh giỏ hàng

## Metadata

- Kênh: Zalo Mock
- Mục tiêu demo: User muốn đặt lại đơn cũ, lấy món hay ăn, kiểm tra điểm thành viên, đổi và dùng voucher có xác nhận, rồi chỉnh giỏ hàng.
- Use case bao phủ: UC-05, UC-14, UC-15, UC-22
- Trạng thái cuối: `cart_updated`

## Hội thoại demo

| Lượt | Người nói | Nội dung | Use case |
|---:|---|---|---|
| 1 | User | Đặt lại đơn lần trước cho mình. | UC-22 |
| 2 | Bot | Dạ đơn gần nhất của bạn gồm 1 combo gà cay, 1 Pepsi và 1 khoai tây chiên. Tổng tiền là 129.000đ. Bạn muốn đặt lại đơn này đúng không ạ? | UC-22 |
| 3 | User | Khoan, lấy món mình hay ăn đi. | UC-14 |
| 4 | Bot | Dạ bạn thường đặt Zinger Burger combo. Mình thêm combo này vào giỏ hàng cho bạn nhé? | UC-14 |
| 5 | User | Ok, thêm combo đó. Mình có bao nhiêu điểm, lịch sử điểm gần đây ra sao, và hiện hỗ trợ đổi hay dùng voucher thế nào? | UC-15 |
| 6 | Bot | Dạ tài khoản của bạn hiện có 120 điểm. Mình đã kiểm tra các phần thưởng, voucher trong ví và những thao tác thành viên có thể dùng; mọi thao tác đổi hoặc dùng voucher đều cần bạn xác nhận. | UC-15 |
| 7 | User | Bỏ Pepsi ra, đổi thành trà đào. Mình muốn đổi 3.000 điểm lấy Mã Giảm 10k, nhưng chưa xác nhận đổi. | UC-05 |
| 8 | Bot | Dạ mình đã bỏ Pepsi và thay bằng trà đào. Mã Giảm 10k cần 3.000 điểm; mình chưa đổi vì bạn chưa xác nhận. | UC-05 |
| 9 | User | Mình xác nhận đổi Mã Giảm 10k. Đồng thời dùng Ưu Đãi Chào Bạn Mới trong ví trên Zalo Miniapp; mình xác nhận cả hai. | Filler |
| 10 | Bot | Dạ hệ thống đã ghi nhận đổi Mã Giảm 10k và dùng Ưu Đãi Chào Bạn Mới trên Zalo Miniapp. Giỏ vẫn chưa được đặt; mình sẽ tóm tắt lại để bạn xác nhận trước khi tạo đơn. | Filler |

## Kỳ vọng kiểm thử

- Reorder từ đơn cũ phải hiển thị lại và hỏi xác nhận.
- Món yêu thích dựa trên lịch sử nhưng không tự thêm nếu chưa được đồng ý.
- Loyalty lookup trả về điểm, phần thưởng, ví voucher và thao tác thành viên đang hỗ trợ.
- Đổi và dùng voucher đều phải giữ ở trạng thái xem trước khi chưa có xác nhận rõ ràng.
- Sau xác nhận, gọi đúng `acquireVoucher` cho Mã Giảm 10k và `redeemReward` cho Ưu Đãi Chào Bạn Mới.
- Chỉnh giỏ hàng cập nhật đúng món và tính lại tổng tiền.
- Không tạo đơn chỉ vì user xác nhận thao tác thành viên.
