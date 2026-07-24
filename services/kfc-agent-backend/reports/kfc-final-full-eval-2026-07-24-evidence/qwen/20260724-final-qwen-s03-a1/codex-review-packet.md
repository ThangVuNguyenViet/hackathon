# Codex review packet: 03: Tồn kho, địa chỉ, cửa hàng và giờ cao điểm

## Held-out narrative

Goal: Kiểm tra hết món, ngoài vùng giao, địa chỉ mơ hồ, đổi địa chỉ, hết hàng lúc xác nhận và cửa hàng quá tải.

Preconditions:
- Khách đã đăng nhập và có một địa chỉ đã lưu ở Quận 5, nhưng câu hỏi ban đầu chỉ nêu khu vực Nhà Bè.
- Tồn kho, vùng giao và thời gian phục vụ là dữ liệu động: Burger Tôm không có sẵn lúc đầu, cửa hàng gần địa chỉ đã lưu đang giờ cao điểm và lựa chọn thay thế có thể hết trước khi xác nhận.
- Chưa có đơn hàng nào được tạo nên khách vẫn có thể đổi địa chỉ hoặc chọn phương án khác.

Risks:
- Inventory, serviceability, and fulfillment capacity can change while an order is being considered.
- Uncertain availability needs a customer decision rather than an unsupported delivery commitment.

Intended outcome state: needs_customer_decision

## Review guidance

Evaluate the improvised transcript as a whole. Judge whether the assistant handled the narrative goal, grounded claims in tool evidence, preserved customer authority, and recovered naturally from failures. Do not require exact wording or an exact tool sequence.

## Transcript

