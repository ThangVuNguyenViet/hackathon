# 05: Khiếu nại, feedback và chuyển nhân viên

## Metadata

- Kênh: Zalo mock
- Mục tiêu demo: Nhận diện khiếu nại, sai món, thiếu món, feedback sau đơn, user tức giận và yêu cầu gặp nhân viên.
- Use case bao phủ: UC-14, UC-28, UC-38, UC-39, UC-41, UC-43
- Trạng thái cuối: `human_handoff_created`

## Hội thoại demo

| Lượt | Người nói | Nội dung | Use case |
|---:|---|---|---|
| 1 | User | Mình nhận thiếu 1 phần khoai. | UC-14 |
| 2 | Bot | Dạ KFC rất xin lỗi vì trải nghiệm chưa tốt. Mình sẽ ghi nhận phản hồi thiếu 1 phần khoai trong đơn hàng và kiểm tra phương án xử lý cho bạn. | UC-14 |
| 3 | User | Với lại mình đặt gà cay mà giao gà thường. | UC-28, UC-38 |
| 4 | Bot | Dạ mình ghi nhận lỗi giao sai món: đặt gà cay nhưng nhận gà thường. Mình sẽ chuyển thông tin này đến nhân viên hỗ trợ để kiểm tra đổi món hoặc bồi hoàn. | UC-28, UC-38 |
| 5 | User | Đơn gì mà lâu quá vậy, bực mình thật. | UC-41 |
| 6 | Bot | Dạ KFC rất xin lỗi vì bạn phải chờ lâu và nhận đơn chưa đúng. Mình sẽ ưu tiên chuyển trường hợp này cho nhân viên hỗ trợ. | UC-41 |
| 7 | User | Cho mình gặp nhân viên. | UC-43 |
| 8 | Bot | Dạ mình sẽ chuyển bạn đến nhân viên hỗ trợ ngay. Nhân viên sẽ thấy thông tin thiếu khoai, giao sai món và trạng thái đơn để xử lý nhanh hơn. | UC-43 |
| 9 | User | Nhưng gà ngon, chỉ là giao hơi lâu và sai món. | UC-39 |
| 10 | Bot | Dạ cảm ơn bạn đã phản hồi. Mình ghi nhận món ăn tốt nhưng thời gian giao hàng và độ chính xác đơn cần cải thiện. | UC-39 |

## Kỳ vọng kiểm thử

- Bot nhận diện complaint, không xử lý như đơn mới.
- Complaint payload có đủ loại lỗi: thiếu món, sai món, giao lâu.
- User tức giận làm tăng priority escalation.
- Khi user yêu cầu nhân viên, bot phải handoff ngay.
- Feedback tích cực/tiêu cực được ghi nhận có cấu trúc.
