# 08: Lỗi thanh toán và đơn bất thường

## Metadata

- Kênh: Website chat mock
- Mục tiêu demo: Thanh toán thất bại, bấm thanh toán lỗi và đơn số lượng lớn cần nhân viên xác nhận.
- Use case bao phủ: UC-24, UC-33, UC-50
- Trạng thái cuối: `human_review_required`

## Hội thoại demo

| Lượt | Người nói | Nội dung | Use case |
|---:|---|---|---|
| 1 | User | Mình thanh toán rồi mà báo lỗi. | UC-24 |
| 2 | Bot | Dạ mình kiểm tra thấy giao dịch hiện chưa thành công. Bạn muốn thử thanh toán lại hoặc đổi sang thanh toán khi nhận hàng không ạ? | UC-24 |
| 3 | User | Mình bấm thanh toán mà lỗi hoài. | UC-33 |
| 4 | Bot | Dạ mình sẽ không xác nhận đơn là đã thanh toán khi giao dịch online chưa hoàn tất. Bạn có thể thử lại liên kết thanh toán hoặc đổi sang thanh toán khi nhận hàng. | UC-33 |
| 5 | User | Vậy đặt cho mình 200 combo gà, giao trong 30 phút. | UC-50 |
| 6 | Bot | Dạ đơn hàng của bạn có số lượng lớn và cần kiểm tra thêm về tồn kho, thời gian chuẩn bị và thông tin giao hàng. Mình sẽ chuyển thông tin đến nhân viên để xác nhận nhanh trước khi xử lý. | UC-50 |
| 7 | User | Sao phải chuyển nhân viên? | Filler |
| 8 | Bot | Vì đơn có số lượng bất thường, hệ thống cần tránh sai thông tin, đơn ảo hoặc cam kết thời gian không khả thi. Nhân viên sẽ xác nhận lại số lượng, thời gian và phương thức thanh toán với bạn. | Filler |

## Kỳ vọng kiểm thử

- Bot không đánh dấu thanh toán thành công khi mock payment trả lỗi.
- Bot đề xuất retry hoặc COD.
- Lỗi thanh toán không được tạo order paid.
- Đơn số lượng rất lớn kích hoạt `human_review_required`.
- Dashboard escalation reason gồm `payment_failed` và `abnormal_large_order`.
