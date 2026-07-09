# 01: Đặt món rõ ràng, giao hàng, voucher, thanh toán

## Metadata

- Kênh: Messenger Mock
- Mục tiêu demo: User đặt món rõ ràng, bot hỏi địa chỉ còn thiếu, tính phí giao hàng, áp mã, xác nhận thanh toán, ghi chú giao hàng, ghi nhận hóa đơn và tạo đơn.
- Use case bao phủ: UC-01, UC-07, UC-16, UC-17, UC-19, UC-24, UC-25, UC-37
- Trạng thái cuối: `order_created`

## Hội thoại demo

| Lượt | Người nói | Nội dung | Use case |
|---:|---|---|---|
| 1 | User | Cho mình 1 combo gà cay, 1 burger Zinger và 2 Pepsi, giao về Quận 7. | UC-01, UC-07 |
| 2 | Bot | Dạ mình đã thêm vào giỏ hàng: 1 combo gà cay, 1 Zinger Burger và 2 Pepsi. Tổng tạm tính là 218.000đ. Bạn cho mình xin địa chỉ cụ thể ở Quận 7 để kiểm tra cửa hàng giao gần nhất nhé. | UC-01, UC-07 |
| 3 | User | Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng. Phí ship bao nhiêu? | UC-24 |
| 4 | Bot | Dạ mình kiểm tra được cửa hàng KFC gần nhất có đủ món và có thể giao tới địa chỉ này. Phí giao hàng dự kiến là 18.000đ. | UC-24, UC-37 |
| 5 | User | Mình có mã KFC50, áp dụng giúp mình. | UC-17 |
| 6 | Bot | Dạ mã KFC50 áp dụng cho đơn từ 199.000đ. Đơn của bạn đủ điều kiện, mình đã áp dụng giảm 50.000đ. Tổng sau ưu đãi và phí giao hàng là 186.000đ. | UC-17 |
| 7 | User | Thanh toán bằng Momo được không? | UC-16 |
| 8 | Bot | Dạ được. Mình sẽ tạo liên kết thanh toán Momo sau khi bạn xác nhận đơn. | UC-16 |
| 9 | User | Giao tới nơi gọi mình, đừng bấm chuông. Mình cần xuất hóa đơn công ty nữa. | UC-19, UC-25 |
| 10 | Bot | Dạ mình đã thêm ghi chú giao hàng: "Gọi khách khi tới nơi, không bấm chuông". Với hóa đơn công ty, bạn vui lòng cung cấp tên công ty, mã số thuế và email nhận hóa đơn nhé. | UC-19, UC-25 |
| 11 | User | Công ty ABC, MST 0312345678, email finance@abc.test. Xác nhận đơn. | UC-19 |
| 12 | Bot | Dạ mình xác nhận đơn: 1 combo gà cay, 1 Zinger Burger, 2 Pepsi; giao tới Sunrise City Quận 7; mã KFC50 đã áp dụng; tổng 186.000đ. Đơn sẽ được xử lý tại cửa hàng KFC gần địa chỉ giao hàng nhất. Mình tạo link thanh toán Momo và Order ID KFC-MOCK-1001 nhé. | UC-01, UC-16, UC-37 |

## Kỳ vọng kiểm thử

- Bot trích xuất đúng món, số lượng, hình thức giao hàng và địa chỉ thiếu chi tiết.
- Bot không tạo đơn trước khi user xác nhận.
- Mock routing chọn cửa hàng gần nhất có đủ món.
- Mock voucher áp dụng đúng điều kiện đơn từ 199.000đ.
- Ghi chú giao hàng và thông tin hóa đơn được lưu vào order payload.
- Dashboard ghi nhận `order_created`, `voucher_applied`, `payment_method=momo`.
