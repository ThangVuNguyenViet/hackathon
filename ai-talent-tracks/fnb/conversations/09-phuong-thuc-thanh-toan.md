# 09: Phương thức thanh toán website/app

## Metadata

- Kênh: Web Mock
- Mục tiêu demo: User hỏi các phương thức thanh toán, bot tra cứu fixture chính sách thanh toán đã crawl và phân biệt MoMo không được liệt kê cho checkout website/app.
- Use case bao phủ: UC-16
- Trạng thái cuối: `payment_methods_answered`

## Hội thoại demo

| Lượt | Người nói | Nội dung | Use case |
|---:|---|---|---|
| 1 | User | KFC có những phương thức thanh toán nào trên website/app? | UC-16 |
| 2 | Bot | Trên website và ứng dụng KFC, bạn có thể thanh toán khi nhận hàng, dùng thẻ ATM nội địa, thẻ Visa/Master hoặc ví ZaloPay. | UC-16 |
| 3 | User | Vậy thanh toán MoMo được không? | UC-16 |
| 4 | Bot | Hiện website và ứng dụng KFC không hỗ trợ thanh toán bằng MoMo. Bạn có thể chọn thanh toán khi nhận hàng, thẻ ATM nội địa, thẻ Visa/Master hoặc ZaloPay nhé. | UC-16 |

## Kỳ vọng kiểm thử

- Bot dùng tool `listPaymentMethods` để trả lời, không suy diễn từ bộ nhớ hoặc heuristic.
- Bot nêu đúng các phương thức đang được liệt kê trong fixture chính sách thanh toán.
- Bot trả lời trực tiếp rằng website/app KFC không hỗ trợ MoMo.
- Bot không tạo order hoặc payment link cho MoMo.
