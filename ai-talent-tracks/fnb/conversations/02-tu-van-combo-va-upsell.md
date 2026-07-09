# 02: Tư vấn combo, ngân sách, khuyến mãi, upsell

## Metadata

- Kênh: Zalo Mock
- Mục tiêu demo: User chưa biết chọn món, hỏi khuyến mãi, ngân sách, nhóm đông người; bot tư vấn, upsell vừa đủ và tôn trọng khi user từ chối.
- Use case bao phủ: UC-02, UC-03, UC-04, UC-09, UC-10, UC-11, UC-12, UC-13
- Trạng thái cuối: `cart_ready`

## Hội thoại demo

| Lượt | Người nói | Nội dung | Use case |
|---:|---|---|---|
| 1 | User | Không biết ăn gì, gợi ý cho mình với. | UC-11 |
| 2 | Bot | Dạ bạn đặt cho một mình, cho gia đình hay cho nhóm bạn/công ty ạ? Mình có thể gợi ý theo số người, khẩu vị và ngân sách. | UC-11 |
| 3 | User | Mình đặt đồ ăn trưa cho 10 người ở công ty. Tầm 300k thì ăn được gì? | UC-03, UC-13 |
| 4 | Bot | Dạ với 10 người thì 300.000đ hơi thấp nếu mỗi người một phần riêng. Mình có thể gợi ý combo nhóm tiết kiệm hơn, hoặc chia thành bucket gà, burger, khoai và nước theo ngân sách bạn muốn. | UC-03, UC-13 |
| 5 | User | Hôm nay có khuyến mãi gì không? | UC-04 |
| 6 | Bot | Dạ hôm nay có ưu đãi combo nhóm và giảm giá khi nâng cấp phần nước. Bạn muốn mình gợi ý combo phù hợp với nhóm 10 người không ạ? | UC-04 |
| 7 | User | Món nào bán chạy nhất vậy? | UC-12 |
| 8 | Bot | Dạ các món được đặt nhiều gồm gà rán cay, Zinger Burger và Combo 2 người. Với nhóm đông, mình gợi ý bucket gà kèm khoai và nước để dễ chia. | UC-12 |
| 9 | User | Cho mình combo gà đi. | UC-02 |
| 10 | Bot | Dạ bạn muốn combo cho mấy người dùng ạ? Mình có combo 1 người, 2 người và combo nhóm/family. | UC-02 |
| 11 | User | Combo nhóm cho 10 người. | Filler |
| 12 | Bot | Dạ mình gợi ý 2 bucket gà, 5 khoai tây chiên và 10 Pepsi. Nếu muốn tiết kiệm hơn, mình có thể giảm nước hoặc đổi một phần sang trà đào. | Filler |
| 13 | User | Ok, nâng lên combo có thêm burger đi. | UC-10 |
| 14 | Bot | Dạ mình đã nâng đơn thành combo nhóm có thêm 5 Zinger Burger. Tổng tạm tính hiện tại là 890.000đ. | UC-10 |
| 15 | User | Không, giữ vậy thôi, đừng thêm burger nữa. | UC-09 |
| 16 | Bot | Dạ mình bỏ phần burger và giữ nguyên combo nhóm ban đầu. Tổng tạm tính là 690.000đ. Bạn muốn giao hàng hay đến cửa hàng nhận ạ? | UC-09 |

## Kỳ vọng kiểm thử

- Bot không tự chọn combo khi user nói mơ hồ.
- Bot hỏi số người/ngân sách trước khi đề xuất.
- Bot trả lời khuyến mãi rồi dẫn về hành động đặt món.
- Bot xử lý cả upsell accepted và upsell rejected trong cùng flow.
- Cart cuối không còn burger sau khi user từ chối.
