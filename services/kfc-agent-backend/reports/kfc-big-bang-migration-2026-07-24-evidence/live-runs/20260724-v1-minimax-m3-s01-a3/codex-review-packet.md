# Codex review packet: 01: Đặt món rõ ràng, giao hàng, voucher, thanh toán

## Held-out narrative

Goal: User đặt món rõ ràng, bot hỏi địa chỉ còn thiếu, tính phí giao hàng, áp mã, xác nhận thanh toán, ghi chú giao hàng, ghi nhận hóa đơn và tạo đơn.

Preconditions:
- Khách đang ở một phiên mua hàng mới, chưa có giỏ hàng hoặc đơn hàng đang chờ xác nhận.
- Dữ liệu menu, vùng giao hàng, phí giao hàng, mã ưu đãi và phương thức thanh toán hiện hành có thể được tra cứu từ nguồn nghiệp vụ.

Risks:
- Order creation requires a clear customer confirmation.
- Delivery, vouchers, payment, invoices, and delivery notes must stay grounded in authoritative business state.

Intended outcome state: order_created

## Review guidance

Evaluate the improvised transcript as a whole. Judge whether the assistant handled the narrative goal, grounded claims in tool evidence, preserved customer authority, and recovered naturally from failures. Do not require exact wording or an exact tool sequence.

## Transcript

