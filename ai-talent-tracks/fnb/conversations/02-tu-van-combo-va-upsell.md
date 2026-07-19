# 02: Tư vấn combo, ngân sách, khuyến mãi, upsell

## Metadata

- Kênh: Zalo Mock
- Mục tiêu demo: Khách đặt nhiều món lẻ cho nhóm; AI nhận ra combo tương đương tiết kiệm hơn, chờ khách đồng ý đổi đơn, rồi upsell tăng size nước và cập nhật giỏ hàng theo lựa chọn của khách.
- Use case bao phủ: UC-02, UC-03, UC-04, UC-09, UC-10, UC-11, UC-12, UC-13
- Trạng thái cuối: `cart_ready`

## Hội thoại demo

| Lượt | Người nói | Nội dung | Use case |
|---:|---|---|---|
| 1 | User | Không biết ăn gì, gợi ý cho nhóm 4 người với, ngân sách khoảng 300k. | UC-02, UC-03, UC-11, UC-13 |
| 2 | Bot | Dạ mình sẽ tìm các lựa chọn cho 4 người trong khoảng 300.000đ. Bạn thích gà rán, burger hay món cơm? Nếu muốn mình cũng có thể gợi ý thêm món tráng miệng. | UC-02, UC-03, UC-11, UC-13 |
| 3 | User | Không cần thêm món tráng miệng. Cho mình xem toàn bộ menu trước; hôm nay có ưu đãi gì phù hợp không? | UC-04, UC-09 |
| 4 | Bot | Dạ mình sẽ lấy menu theo danh mục để bạn xem và kiểm tra các ưu đãi đang áp dụng cho đơn nhóm dưới 300.000đ. Mình chỉ đề xuất những ưu đãi phù hợp với nhu cầu của bạn. | UC-04, UC-09 |
| 5 | User | Món gà nào bán chạy? Nếu gọi lẻ thì cho mình 10 miếng gà rán và 4 Pepsi tiêu chuẩn. | UC-12 |
| 6 | Bot | Dạ 10 miếng gà rán và 4 Pepsi tiêu chuẩn gọi lẻ tạm tính 404.000đ. Mình thấy 2 Combo Đẫy Đà 129K có đúng 10 miếng gà rán và 4 Pepsi tiêu chuẩn, tổng 258.000đ, tiết kiệm 146.000đ và phù hợp ngân sách hơn. Mình chưa đổi giỏ; bạn có muốn đổi sang 2 combo này không? | UC-12 |
| 7 | User | Hợp lý đó, đổi sang 2 Combo Đẫy Đà 129K giúp mình. | Filler |
| 8 | Bot | Dạ mình đã bỏ các món lẻ và đổi sang 2 Combo Đẫy Đà 129K, tổng 258.000đ. Bạn có muốn nâng cả 4 Pepsi tiêu chuẩn lên size đại, thêm 7.000đ mỗi ly và 28.000đ tổng cộng không? Nếu đồng ý, tổng mới sẽ là 286.000đ. | Filler |
| 9 | User | Ok, nâng cả 4 Pepsi lên size đại luôn nhé. | UC-10 |
| 10 | Bot | Dạ mình đã nâng cả 4 Pepsi lên size đại. Giỏ hàng cuối gồm 2 Combo Đẫy Đà 129K với 4 Pepsi size đại, tổng tạm tính 286.000đ. | UC-10 |

## Kỳ vọng kiểm thử

- Khi user hỏi toàn bộ menu, bot phải tra menu và trình bày lựa chọn có cấu trúc thay vì chỉ trả lời phần ưu đãi.
- Bot dựa trên thành phần và giá đã xác minh để gợi ý combo tương đương, tiết kiệm 146.000đ.
- Bot không tự đổi món lẻ sang combo trước khi khách đồng ý.
- Khi đổi sang 2 Combo Đẫy Đà 129K, giỏ cuối không còn các mã món lẻ 41037, 41035 và 41074.
- Bot không tự tăng size nước trước khi khách chấp nhận upsell.
- Giỏ cuối có 2 combo 20752, 4 Pepsi size đại và tổng tạm tính 286.000đ.
