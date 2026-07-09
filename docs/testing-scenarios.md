# Testing Scenarios

This is the consolidated map of scenario-style testing assets in this repo.

## Source Of Truth

- Executable conversation scripts: `ai-talent-tracks/fnb/conversations/*.json`
- Human-readable demo copies: `ai-talent-tracks/fnb/conversations/*.md`
- Backend scenario loader: `services/kfc-agent-backend/src/scenarios/scenarioScript.ts`
- Backend scenario runner: `services/kfc-agent-backend/src/scenarios/runner.ts`

The current executable loader reads JSON scripts. The Markdown files mirror the demo conversation content and are useful for review, but they are not parsed by the current runner.

The 8 conversation scripts are backend-owned scenario contracts. Patrol does not mirror these 8 scripts one-to-one; Patrol covers Flutter live-monitor UI behavior after backend sessions/events exist.

Human-needed escalation is represented by the backend `handoff_required` event. For the MVP, Flutter `warning` and `critical` severities both count as human-attention escalation; the important product state is `SessionStatus.needsHuman`.

Each JSON script has this shape:

```ts
{
  id: string;
  title: string;
  channel: 'messenger_mock' | 'zalo_mock' | 'web_mock';
  goal: string;
  useCases: string[];
  finalState: string;
  turns: Array<{
    index: number;
    speaker: 'User' | 'Bot';
    text: string;
    useCases: string[];
  }>;
  expectations: string[];
}
```

## Runnable Surfaces

### Backend Deterministic Replay

Path: `services/kfc-agent-backend/test/scenarios/scenario-replay.test.ts`

Purpose:

- Replays all 8 JSON conversation scripts.
- Uses `StaticToolPlanner` and generated KFC fixtures.
- Asserts final state, covered use cases, transcript length, tool traces, dashboard events, cart/order state, and UC-01 through UC-50 coverage.

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/scenarios/scenario-replay.test.ts
```

### Backend Live OpenAI Planner Replay

Path: `services/kfc-agent-backend/test/scenarios/live-ai-scenario-replay.test.ts`

Purpose:

- Replays the same 8 scripts with `OpenAIToolPlanner`.
- Records model-planned tools per user turn.
- Fails if required tool groups are missing or forbidden tools are selected.
- Uses mock KFC fixture clients; it does not call real KFC APIs.

Run:

```bash
cd services/kfc-agent-backend
OPENAI_API_KEY=... npm run test:live:scenarios
```

### Backend Live OpenAI GenUI Replay

Path: `services/kfc-agent-backend/test/scenarios/live-ai-genui.test.ts`

Purpose:

- Replays the same 8 scripts with live OpenAI planning.
- Checks GenUI attachments are emitted and compatible with the six-widget MVP catalog:
  `smartMenuPicker`, `cartBuilder`, `addressFulfillmentCheck`, `orderReviewConfirm`, `paymentOrderStatus`, `supportHandoff`.

Run:

```bash
cd services/kfc-agent-backend
OPENAI_API_KEY=... npm run test:live:genui
```

### Direct Live AI Replay Utility

Path: `services/kfc-agent-backend/scripts/run-live-ai-replay.ts`

Purpose:

- Replays one JSON script through `/chat/mock` using an injected Fastify server.
- Prints final state, tool trace, dashboard events, order, transcript, and session summary as JSON.
- Defaults to scenario 01 if no script path is passed.

Run:

```bash
cd services/kfc-agent-backend
OPENAI_API_KEY=... npx tsx scripts/run-live-ai-replay.ts ../../ai-talent-tracks/fnb/conversations/01-dat-mon-ro-rang-giao-hang.json
```

### Flutter Patrol Scenarios

Path: `apps/kfc_live_monitor_flutter/patrol_test/`

Patrol verifies the live monitor UI integration layer. These tests are not the source of truth for the 8 customer conversation scenarios; they prove the Flutter dashboard can render and act on backend-derived sessions, history, channels, deeplinks, and human takeover state.

Current scenario files:

- `live_monitor_primary_screen_test.dart`: renders the primary monitor, captures a catalog screenshot, and verifies a key session card.
- `live_monitor_message_history_test.dart`: hydrates persisted Messenger history, polls refreshed history, and verifies both states.
- `live_monitor_channel_parity_test.dart`: verifies Zalo and Messenger display names, history, and deeplink behavior.
- `live_monitor_angry_human_takeover_test.dart`: verifies angry handoff, human join, human reply, and resume-to-AI.

Run a target:

```bash
cd apps/kfc_live_monitor_flutter
patrol test -t patrol_test/live_monitor_message_history_test.dart -d <ios-simulator-id>
```

Current bundle note: `patrol_test/test_bundle.dart` is generated and currently imports 2 of the 4 UI Patrol scenarios: `live_monitor_message_history_test.dart` and `live_monitor_primary_screen_test.dart`. That bundle count is separate from the 8 backend conversation scripts. If the full bundled UI suite is intended to include every existing Patrol scenario, regenerate or update the bundle so it also includes `live_monitor_channel_parity_test.dart` and `live_monitor_angry_human_takeover_test.dart`.

## Generated Or Planning Artifacts

Do not treat these as source-of-truth scenario scripts:

- `services/kfc-agent-backend/dist/**`: compiled output, ignored by git, may contain stale scenario tests.
- `.scratch/**`: planning notes and issue breakdowns.
- `artifacts/**`: generated proof artifacts and exported documents.

## Script Index

| Script | Channel | Final state | Use cases |
|---|---|---|---|
| `01-dat-mon-ro-rang-giao-hang.json` | `messenger_mock` | `order_created` | UC-01, UC-07, UC-11, UC-23, UC-31, UC-32, UC-34, UC-35, UC-47 |
| `02-tu-van-combo-va-upsell.json` | `zalo_mock` | `cart_ready` | UC-02, UC-03, UC-04, UC-09, UC-10, UC-19, UC-20, UC-21, UC-22 |
| `03-ton-kho-dia-chi-va-cua-hang.json` | `web_mock` | `needs_customer_decision` | UC-06, UC-08, UC-29, UC-30, UC-48, UC-49 |
| `04-sau-khi-dat-don.json` | `messenger_mock` | `post_order_handled` | UC-12, UC-13, UC-25, UC-26, UC-27, UC-36, UC-37 |
| `05-khieu-nai-va-human-handoff.json` | `zalo_mock` | `human_handoff_created` | UC-14, UC-28, UC-38, UC-39, UC-41, UC-43 |
| `06-ngon-ngu-tu-nhien-va-an-toan.json` | `messenger_mock` | `clarification_needed` | UC-15, UC-16, UC-17, UC-18, UC-40, UC-42 |
| `07-ca-nhan-hoa-va-loyalty.json` | `zalo_mock` | `cart_updated` | UC-05, UC-44, UC-45, UC-46 |
| `08-thanh-toan-loi-va-don-bat-thuong.json` | `web_mock` | `human_review_required` | UC-24, UC-33, UC-50 |

## Full Scripts

### 01: Đặt món rõ ràng, giao hàng, voucher, thanh toán

- File: `ai-talent-tracks/fnb/conversations/01-dat-mon-ro-rang-giao-hang.json`
- Channel: `messenger_mock`
- Final state: `order_created`
- Use cases: UC-01, UC-07, UC-11, UC-23, UC-31, UC-32, UC-34, UC-35, UC-47
- Goal: User đặt món rõ ràng, bot hỏi địa chỉ còn thiếu, tính phí giao hàng, áp mã, xác nhận thanh toán, ghi chú giao hàng, ghi nhận hóa đơn và tạo đơn.

| Turn | Speaker | Text | Use cases |
|---:|---|---|---|
| 1 | User | Cho mình 1 combo gà cay, 1 burger Zinger và 2 Pepsi, giao về Quận 7. | UC-01, UC-07 |
| 2 | Bot | Dạ mình đã thêm vào giỏ hàng: 1 combo gà cay, 1 Zinger Burger và 2 Pepsi. Tổng tạm tính là 218.000đ. Bạn cho mình xin địa chỉ cụ thể ở Quận 7 để kiểm tra cửa hàng giao gần nhất nhé. | UC-01, UC-07 |
| 3 | User | Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng. Phí ship bao nhiêu? | UC-31 |
| 4 | Bot | Dạ mình kiểm tra được cửa hàng KFC gần nhất có đủ món và có thể giao tới địa chỉ này. Phí giao hàng dự kiến là 18.000đ. | UC-31, UC-47 |
| 5 | User | Mình có mã KFC50, áp dụng giúp mình. | UC-23, UC-34 |
| 6 | Bot | Dạ mã KFC50 áp dụng cho đơn từ 199.000đ. Đơn của bạn đủ điều kiện, mình đã áp dụng giảm 50.000đ. Tổng sau ưu đãi và phí giao hàng là 186.000đ. | UC-23, UC-34 |
| 7 | User | Thanh toán bằng Momo được không? | UC-11 |
| 8 | Bot | Dạ được. Mình sẽ tạo liên kết thanh toán Momo sau khi bạn xác nhận đơn. | UC-11 |
| 9 | User | Giao tới nơi gọi mình, đừng bấm chuông. Mình cần xuất hóa đơn công ty nữa. | UC-32, UC-35 |
| 10 | Bot | Dạ mình đã thêm ghi chú giao hàng: "Gọi khách khi tới nơi, không bấm chuông". Với hóa đơn công ty, bạn vui lòng cung cấp tên công ty, mã số thuế và email nhận hóa đơn nhé. | UC-32, UC-35 |
| 11 | User | Công ty ABC, MST 0312345678, email finance@abc.test. Xác nhận đơn. | UC-35 |
| 12 | Bot | Dạ mình xác nhận đơn: 1 combo gà cay, 1 Zinger Burger, 2 Pepsi; giao tới Sunrise City Quận 7; mã KFC50 đã áp dụng; tổng 186.000đ. Đơn sẽ được xử lý tại cửa hàng KFC gần địa chỉ giao hàng nhất. Mình tạo link thanh toán Momo và Order ID KFC-MOCK-1001 nhé. | UC-01, UC-11, UC-47 |

Expectations:

- Bot trích xuất đúng món, số lượng, hình thức giao hàng và địa chỉ thiếu chi tiết.
- Bot không tạo đơn trước khi user xác nhận.
- Mock routing chọn cửa hàng gần nhất có đủ món.
- Mock voucher áp dụng đúng điều kiện đơn từ 199.000đ.
- Ghi chú giao hàng và thông tin hóa đơn được lưu vào order payload.
- Dashboard ghi nhận `order_created`, `voucher_applied`, `payment_method=momo`.

### 02: Tư vấn combo, ngân sách, khuyến mãi, upsell

- File: `ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.json`
- Channel: `zalo_mock`
- Final state: `cart_ready`
- Use cases: UC-02, UC-03, UC-04, UC-09, UC-10, UC-19, UC-20, UC-21, UC-22
- Goal: User chưa biết chọn món, hỏi khuyến mãi, ngân sách, nhóm đông người; bot tư vấn, upsell vừa đủ và tôn trọng khi user từ chối.

| Turn | Speaker | Text | Use cases |
|---:|---|---|---|
| 1 | User | Không biết ăn gì, gợi ý cho mình với. | UC-19 |
| 2 | Bot | Dạ bạn đặt cho một mình, cho gia đình hay cho nhóm bạn/công ty ạ? Mình có thể gợi ý theo số người, khẩu vị và ngân sách. | UC-19 |
| 3 | User | Mình đặt đồ ăn trưa cho 10 người ở công ty. Tầm 300k thì ăn được gì? | UC-21, UC-22 |
| 4 | Bot | Dạ với 10 người thì 300.000đ hơi thấp nếu mỗi người một phần riêng. Mình có thể gợi ý combo nhóm tiết kiệm hơn, hoặc chia thành bucket gà, burger, khoai và nước theo ngân sách bạn muốn. | UC-21, UC-22 |
| 5 | User | Hôm nay có khuyến mãi gì không? | UC-04 |
| 6 | Bot | Dạ hôm nay có ưu đãi combo nhóm và giảm giá khi nâng cấp phần nước. Bạn muốn mình gợi ý combo phù hợp với nhóm 10 người không ạ? | UC-04 |
| 7 | User | Món nào bán chạy nhất vậy? | UC-20 |
| 8 | Bot | Dạ các món được đặt nhiều gồm gà rán cay, Zinger Burger và Combo 2 người. Với nhóm đông, mình gợi ý bucket gà kèm khoai và nước để dễ chia. | UC-20 |
| 9 | User | Cho mình combo gà đi. | UC-02 |
| 10 | Bot | Dạ bạn muốn combo cho mấy người dùng ạ? Mình có combo 1 người, 2 người và combo nhóm/family. | UC-02 |
| 11 | User | Combo nhóm cho 10 người. | Filler |
| 12 | Bot | Dạ mình gợi ý 2 bucket gà, 5 khoai tây chiên và 10 Pepsi. Nếu muốn tiết kiệm hơn, mình có thể giảm nước hoặc đổi một phần sang trà đào. | Filler |
| 13 | User | Ok, nâng lên combo có thêm burger đi. | UC-10 |
| 14 | Bot | Dạ mình đã nâng đơn thành combo nhóm có thêm 5 Zinger Burger. Tổng tạm tính hiện tại là 890.000đ. | UC-10 |
| 15 | User | Không, giữ vậy thôi, đừng thêm burger nữa. | UC-09 |
| 16 | Bot | Dạ mình bỏ phần burger và giữ nguyên combo nhóm ban đầu. Tổng tạm tính là 690.000đ. Bạn muốn giao hàng hay đến cửa hàng nhận ạ? | UC-09 |

Expectations:

- Bot không tự chọn combo khi user nói mơ hồ.
- Bot hỏi số người/ngân sách trước khi đề xuất.
- Bot trả lời khuyến mãi rồi dẫn về hành động đặt món.
- Bot xử lý cả upsell accepted và upsell rejected trong cùng flow.
- Cart cuối không còn burger sau khi user từ chối.

### 03: Tồn kho, địa chỉ, cửa hàng và giờ cao điểm

- File: `ai-talent-tracks/fnb/conversations/03-ton-kho-dia-chi-va-cua-hang.json`
- Channel: `web_mock`
- Final state: `needs_customer_decision`
- Use cases: UC-06, UC-08, UC-29, UC-30, UC-48, UC-49
- Goal: Kiểm tra hết món, ngoài vùng giao, địa chỉ mơ hồ, đổi địa chỉ, hết hàng lúc xác nhận và cửa hàng quá tải.

| Turn | Speaker | Text | Use cases |
|---:|---|---|---|
| 1 | User | Cho mình 1 burger tôm, giao về Nhà Bè được không? | UC-06, UC-08 |
| 2 | Bot | Dạ hiện Burger Tôm đang tạm hết tại cửa hàng gần bạn. Ngoài ra khu vực Nhà Bè có thể nằm ngoài phạm vi giao hàng của cửa hàng gần nhất. Bạn có muốn mình kiểm tra cửa hàng KFC gần nhất để đặt mang đi hoặc gợi ý Zinger Burger thay thế không ạ? | UC-06, UC-08 |
| 3 | User | Vậy lấy Zinger Burger, giao tới chỗ cũ nha. | UC-29 |
| 4 | Bot | Dạ mình thấy địa chỉ gần nhất của bạn là 123 Nguyễn Trãi, Quận 5. Bạn muốn giao tới địa chỉ này đúng không ạ? | UC-29 |
| 5 | User | Đúng rồi. | Filler |
| 6 | Bot | Dạ mình kiểm tra thấy cửa hàng gần địa chỉ này đang trong giờ cao điểm, thời gian giao dự kiến khoảng 45 phút. Bạn muốn tiếp tục đặt hay chọn nhận tại cửa hàng khác nhanh hơn? | UC-49 |
| 7 | User | Tiếp tục đặt. | Filler |
| 8 | Bot | Dạ mình đã giữ Zinger Burger trong giỏ. Trước khi xác nhận, hệ thống báo món này vừa tạm hết tại cửa hàng gần bạn. Mình có thể gợi ý Burger Gà Giòn thay thế hoặc kiểm tra cửa hàng khác gần đó. | UC-48 |
| 9 | User | Đổi địa chỉ giao qua Quận 3 được không? | UC-30 |
| 10 | Bot | Dạ mình sẽ kiểm tra trạng thái đơn. Vì đơn chưa được tạo, mình có thể đổi địa chỉ. Bạn cho mình xin địa chỉ mới cụ thể ở Quận 3 nhé. | UC-30 |

Expectations:

- Bot không nhận đơn món đã hết hàng.
- Bot không hứa giao hàng khi địa chỉ ngoài vùng hoặc chưa chắc chắn.
- Bot dùng lịch sử địa chỉ nhưng vẫn xác nhận lại với user.
- Bot báo ETA tăng khi cửa hàng quá tải.
- Nếu tồn kho thay đổi trước xác nhận, bot phải hỏi user chọn món thay thế hoặc cửa hàng khác.
- Đổi địa chỉ chỉ cập nhật khi đơn chưa được xử lý.

### 04: Theo dõi, hủy, đặt lại và chỉnh đơn sau khi đặt

- File: `ai-talent-tracks/fnb/conversations/04-sau-khi-dat-don.json`
- Channel: `messenger_mock`
- Final state: `post_order_handled`
- Use cases: UC-12, UC-13, UC-25, UC-26, UC-27, UC-36, UC-37
- Goal: User hỏi trạng thái đơn, ETA, hủy đơn, thêm món sau khi đặt và đặt lại đơn cũ.

| Turn | Speaker | Text | Use cases |
|---:|---|---|---|
| 1 | User | Đơn của mình tới đâu rồi? | UC-13 |
| 2 | Bot | Dạ đơn KFC-1024 của bạn hiện đang được chuẩn bị tại cửa hàng KFC Nguyễn Thị Minh Khai. Thời gian dự kiến giao là khoảng 25 phút nữa. | UC-13 |
| 3 | User | Bao lâu nữa giao tới? | UC-26 |
| 4 | Bot | Dạ đơn KFC-1024 của bạn hiện đang được chuẩn bị tại cửa hàng KFC Nguyễn Thị Minh Khai. Thời gian giao dự kiến là khoảng 25 phút nữa. | UC-26 |
| 5 | User | Khoảng bao lâu tới? | UC-37 |
| 6 | Bot | Dạ thời gian giao dự kiến là 25-30 phút nữa, tùy tình trạng giao hàng thực tế. | UC-37 |
| 7 | User | Mình thêm 1 khoai nữa được không? | UC-36 |
| 8 | Bot | Dạ mình sẽ kiểm tra trạng thái đơn. Nếu đơn chưa được chuẩn bị, mình sẽ thêm 1 khoai vào đơn hiện tại. Nếu đơn đã xử lý, mình có thể tạo đơn bổ sung cho bạn. | UC-36 |
| 9 | User | Mình muốn hủy đơn vừa đặt. | UC-12 |
| 10 | Bot | Dạ đơn của bạn hiện chưa được chuẩn bị, mình có thể hỗ trợ hủy đơn. Bạn xác nhận muốn hủy đơn này không ạ? | UC-12 |
| 11 | User | Nếu đơn đã chuẩn bị hoặc đang giao rồi thì sao, mình vẫn muốn hủy. | UC-27 |
| 12 | Bot | Dạ mình sẽ kiểm tra đơn đã chuẩn bị chưa và đã giao đi chưa. Nếu đơn đang giao hoặc đã vào bếp, mình sẽ chuyển nhân viên hỗ trợ để xử lý theo đúng trạng thái đơn. | UC-27 |
| 13 | User | Chưa hủy, cho mình đặt lại đơn lần trước cho đồng nghiệp. | UC-25 |
| 14 | Bot | Dạ đơn gần nhất của bạn gồm 1 Combo Gà Cay, 1 Pepsi và 1 khoai tây chiên. Tổng tiền là 129.000đ. Bạn muốn đặt lại đơn này đúng không ạ? | UC-25 |
| 15 | User | Đúng rồi, nhưng đơn hiện tại cứ giữ nguyên. | Filler |
| 16 | Bot | Dạ mình giữ nguyên đơn KFC-1024 và tạo giỏ hàng mới từ đơn cũ để bạn xác nhận riêng, tránh ảnh hưởng đơn đang xử lý. | Filler |

Expectations:

- Bot lấy trạng thái và ETA từ mock OMS.
- Bot không hủy đơn nếu user chưa xác nhận hủy.
- Bot kiểm tra trạng thái trước khi thêm món sau khi đặt.
- Đặt lại đơn cũ phải tạo giỏ hàng mới và yêu cầu xác nhận.
- Bot không làm sai trạng thái đơn hiện tại khi user chuyển sang reorder.

### 05: Khiếu nại, feedback và chuyển nhân viên

- File: `ai-talent-tracks/fnb/conversations/05-khieu-nai-va-human-handoff.json`
- Channel: `zalo_mock`
- Final state: `human_handoff_created`
- Use cases: UC-14, UC-28, UC-38, UC-39, UC-41, UC-43
- Goal: Nhận diện khiếu nại, sai món, thiếu món, feedback sau đơn, user tức giận và yêu cầu gặp nhân viên.

| Turn | Speaker | Text | Use cases |
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

Expectations:

- Bot nhận diện complaint, không xử lý như đơn mới.
- Complaint payload có đủ loại lỗi: thiếu món, sai món, giao lâu.
- User tức giận làm tăng priority escalation.
- Khi user yêu cầu nhân viên, bot phải handoff ngay.
- Feedback tích cực/tiêu cực được ghi nhận có cấu trúc.

### 06: Ngôn ngữ tự nhiên, mơ hồ và an toàn hội thoại

- File: `ai-talent-tracks/fnb/conversations/06-ngon-ngu-tu-nhien-va-an-toan.json`
- Channel: `messenger_mock`
- Final state: `clarification_needed`
- Use cases: UC-15, UC-16, UC-17, UC-18, UC-40, UC-42
- Goal: Hiểu sai chính tả/tiếng lóng, xử lý yêu cầu dị ứng, spam, câu mơ hồ và yêu cầu ngoài phạm vi.

| Turn | Speaker | Text | Use cases |
|---:|---|---|---|
| 1 | User | Cho tui 2 gà kai vs 1 pesi nha. | UC-15 |
| 2 | Bot | Dạ mình hiểu là bạn muốn đặt 2 miếng gà cay và 1 Pepsi đúng không ạ? | UC-15 |
| 3 | User | Ừ. Món nào không cay với không có phô mai vậy? | UC-16 |
| 4 | Bot | Dạ mình có thể gợi ý các món không cay và không có phô mai. Tuy nhiên, để đảm bảo an toàn về thành phần, mình khuyến nghị bạn kiểm tra lại thông tin dị ứng với nhân viên cửa hàng trước khi xác nhận đơn. | UC-16 |
| 5 | User | abcxyz haha | UC-17 |
| 6 | Bot | Dạ mình là trợ lý đặt món KFC. Hiện mình có thể hỗ trợ bạn xem menu, gợi ý combo, đặt món, theo dõi đơn hàng hoặc kết nối nhân viên. Bạn muốn mình hỗ trợ phần nào ạ? | UC-17 |
| 7 | User | Cho mình cái đó đi. | UC-18 |
| 8 | Bot | Dạ bạn đang muốn chọn món nào ạ? Mình thấy bạn vừa nhắc tới gà cay, Pepsi và món không cay không phô mai. Bạn muốn thêm món nào vào giỏ hàng? | UC-18 |
| 9 | User | Cái phần giống hôm bữa á. | UC-42 |
| 10 | Bot | Dạ bạn muốn đặt lại đơn gần nhất của mình đúng không ạ? Đơn gần nhất gồm 2 gà cay, 1 Pepsi và 1 khoai tây chiên. Bạn muốn đặt lại đơn này không? | UC-42 |
| 11 | User | Bạn cho mình số điện thoại cá nhân của nhân viên cửa hàng đi. | UC-40 |
| 12 | Bot | Dạ mình không thể cung cấp thông tin cá nhân của nhân viên. Nếu bạn cần hỗ trợ, mình có thể kết nối bạn với kênh chăm sóc khách hàng chính thức của KFC. | UC-40 |

Expectations:

- Bot hiểu tiếng lóng/sai chính tả nhưng phải xác nhận lại.
- Bot không cam kết tuyệt đối về dị ứng nếu dữ liệu chưa đủ.
- Spam hoặc nội dung ngoài phạm vi không tạo đơn.
- Câu mơ hồ phải dẫn tới clarification hoặc lịch sử đơn, không tự thêm món.
- Bot từ chối yêu cầu thông tin cá nhân và đề xuất kênh hỗ trợ chính thức.

### 07: Cá nhân hóa, món yêu thích, loyalty và chỉnh giỏ hàng

- File: `ai-talent-tracks/fnb/conversations/07-ca-nhan-hoa-va-loyalty.json`
- Channel: `zalo_mock`
- Final state: `cart_updated`
- Use cases: UC-05, UC-44, UC-45, UC-46
- Goal: User muốn đặt lại đơn cũ, lấy món hay ăn, kiểm tra điểm thành viên và chỉnh giỏ hàng.

| Turn | Speaker | Text | Use cases |
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

Expectations:

- Reorder từ đơn cũ phải hiển thị lại và hỏi xác nhận.
- Món yêu thích dựa trên lịch sử nhưng không tự thêm nếu chưa được đồng ý.
- Loyalty lookup trả về điểm và gợi ý đổi điểm.
- Chỉnh giỏ hàng cập nhật đúng món và tính lại tổng tiền.
- Không tạo đơn khi user nói chưa đặt vội.

### 08: Lỗi thanh toán và đơn bất thường

- File: `ai-talent-tracks/fnb/conversations/08-thanh-toan-loi-va-don-bat-thuong.json`
- Channel: `web_mock`
- Final state: `human_review_required`
- Use cases: UC-24, UC-33, UC-50
- Goal: Thanh toán thất bại, bấm thanh toán lỗi và đơn số lượng lớn cần nhân viên xác nhận.

| Turn | Speaker | Text | Use cases |
|---:|---|---|---|
| 1 | User | Mình thanh toán rồi mà báo lỗi. | UC-24 |
| 2 | Bot | Dạ mình kiểm tra thấy giao dịch hiện chưa thành công. Bạn muốn thử thanh toán lại hoặc đổi sang thanh toán khi nhận hàng không ạ? | UC-24 |
| 3 | User | Mình bấm thanh toán mà lỗi hoài. | UC-33 |
| 4 | Bot | Dạ mình sẽ không xác nhận đơn là đã thanh toán khi giao dịch online chưa hoàn tất. Bạn có thể thử lại liên kết thanh toán hoặc đổi sang thanh toán khi nhận hàng. | UC-33 |
| 5 | User | Vậy đặt cho mình 200 combo gà, giao trong 30 phút. | UC-50 |
| 6 | Bot | Dạ đơn hàng của bạn có số lượng lớn và cần kiểm tra thêm về tồn kho, thời gian chuẩn bị và thông tin giao hàng. Mình sẽ chuyển thông tin đến nhân viên để xác nhận nhanh trước khi xử lý. | UC-50 |
| 7 | User | Sao phải chuyển nhân viên? | Filler |
| 8 | Bot | Vì đơn có số lượng bất thường, hệ thống cần tránh sai thông tin, đơn ảo hoặc cam kết thời gian không khả thi. Nhân viên sẽ xác nhận lại số lượng, thời gian và phương thức thanh toán với bạn. | Filler |

Expectations:

- Bot không đánh dấu thanh toán thành công khi mock payment trả lỗi.
- Bot đề xuất retry hoặc COD.
- Lỗi thanh toán không được tạo order paid.
- Đơn số lượng rất lớn kích hoạt `human_review_required`.
- Dashboard escalation reason gồm `payment_failed` và `abnormal_large_order`.
