# Direct OpenAI SDK KFC agent — live report

Date: 2026-07-22  
Runtime: real Fastify `/chat/kfc/message` route, fixture commerce backend, real OpenAI API  
Model: `gpt-4.1-mini`  
Session: `kfc:openai_kiss_20260722`

## Agent shape

The first-party KFC route uses the official OpenAI Node SDK and Responses API directly. Every model request receives the conversation's persisted user/assistant turns and all 29 canonical KFC function tools with `tool_choice: "auto"`. A small loop executes requested functions, appends `function_call_output`, and asks the model to continue until it returns text.

There is no StateGraph, LangGraph checkpoint, planner, router, classifier, response composer, monitor judge, approval graph, LangSmith trace, or custom safety/guardrail layer in this path. Successful direct tool evidence is projected through the existing GenUI selector. The commerce fixture keeps only operational business state such as cart and order; it is not a second conversation memory.

Capabilities exposed on every turn:

- Catalog and offers: `searchMenu`, `getItemDetails`, `getModifierOptions`, `recommendAddOns`, `searchPromotions`, `explainPromotion`, `validateVoucher`
- Cart, store, and checkout: `updateCart`, `previewCart`, `findStores`, `checkStoreAvailability`, `quoteFulfillment`, `previewOrder`, `placeOrder`, `getOrderStatus`
- Membership and payment: `getMembershipProfile`, `listMembershipRewards`, `listMembershipWallet`, `getMembershipPointHistory`, `listMembershipTools`, `listPaymentMethods`, `acquireVoucher`, `redeemReward`, `createPaymentLink`, `checkPaymentStatus`, `collectInvoice`
- Knowledge and support: `searchContentPolicy`, `answerAllergenQuestion`, `handoff`

## Initial baseline live conversation

This 11-turn run predates the later verified-session snapshot, server-owned fulfillment item codes, direct GenUI projection, and `searchMenu` improvement documented below. It is retained as the honest baseline that motivated those small fixes.

### Turn 1

User: “Không biết ăn gì, gợi ý cho nhóm 4 người với, ngân sách khoảng 300k.”

Assistant:

> Hiện tại trong thực đơn không có combo đặc biệt cho nhóm 4 người trong khoảng ngân sách 300k. Bạn có thể chọn các món gà và ăn kèm lẻ phù hợp với ngân sách này. Bạn muốn tôi gợi ý một set gọi món riêng lẻ cho 4 người với 300k không?

Tool: `searchMenu({"query":"combo 4 người"})` → no matches.  
Usage: 2,867 input / 88 output tokens. HTTP: 4.089 s.

### Turn 2

User: “Có, bạn tự chọn giúp mình một set đủ cho 4 người, ưu tiên gà rán và có nước nhé.”

Assistant:

> Mình gợi ý set combo này khá hợp với nhóm 4 người và ưu tiên gà rán kèm nước:
>
> Combo Gà No 279k gồm có:
> - 4 Miếng gà rán (có thể chọn vị cay, không cay hoặc truyền thống)
> - 2 Burger gà Zinger
> - 1 phần Khoai tây chiên (vừa)
> - 4 ly Pepsi tiêu chuẩn
>
> Set này ăn no đủ cho 4 người, đủ món gà rán và có nước uống, vừa đủ trong ngân sách 300k của bạn. Bạn muốn mình đặt combo này luôn không?

Tool: `searchMenu({"query":"gà rán"})` → found fixture item `20706`, Combo Gà No 279k.  
Usage: 25,200 input / 151 output tokens. HTTP: 6.706 s.

### Turn 3

User: “Được, thêm 1 Combo Gà No 279k vào giỏ giúp mình. Chọn gà không cay và Pepsi thường nhé.”

Assistant:

> Đã thêm Combo Gà No 279k vào giỏ hàng cho bạn với 4 miếng gà giòn không cay và 4 ly Pepsi thường. Bạn cần mình hỗ trợ gì thêm không?

Tools: searched Combo Gà No; first `updateCart` used an invalid nested argument shape; the model read the error and retried with the valid `modifiers` shape. The fixture cart then contained item `20706`, total 279,000 VND.  
Usage: 13,876 input / 356 output tokens. HTTP: 10.880 s.

### Turn 4

User: “Cho mình xem lại giỏ hàng. Có khuyến mãi hay voucher nào dùng được không?”

Assistant:

> Hiện giỏ hàng của bạn có 1 Combo Gà No 279k gồm 4 miếng gà giòn không cay và 4 ly Pepsi tiêu chuẩn, tổng giá là 279.000 VND.
>
> Hiện tại chưa có khuyến mãi hay voucher áp dụng riêng cho combo này. Bạn muốn mình tiếp tục hỗ trợ gì khác không?

Tools: `previewCart({})` → correct cart; `searchPromotions({"query":"Combo Gà No"})` → no matches.  
Usage: 3,977 input / 123 output tokens. HTTP: 5.107 s.

### Turn 5

User: “Giao tới 60 Phạm Văn Nghị, Tân Phong, Quận 7, TP.HCM giúp mình. Phí và thời gian giao khoảng bao nhiêu?”

Assistant:

> Xin lỗi bạn, hiện tại mình không tìm thấy cửa hàng KFC gần địa chỉ 60 Phạm Văn Nghị, Tân Phong, Quận 7, TP.HCM. Bạn có thể cung cấp thêm địa chỉ hoặc khu vực gần hơn để mình kiểm tra giúp bạn phí và thời gian giao hàng chính xác hơn không?

Tool: `findStores` with the exact address → no matches.  
Usage: 3,757 input / 105 output tokens. HTTP: 4.633 s.

### Turn 6

User: “Bạn thử tìm cửa hàng ở Quận 7 rồi báo giá giao đến địa chỉ đó nhé.”

Assistant:

> Mình đã tìm được cửa hàng KFC gần Quận 7 là KFC Phạm Văn Nghị. Phí giao hàng đến địa chỉ 60 Phạm Văn Nghị, Tân Phong, Quận 7 là 18.000 VND, thời gian giao hàng dự kiến khoảng 35 phút.
>
> Bạn muốn mình đặt giao hàng cho bạn không?

Tools: `findStores` returned other stores; `quoteFulfillment` returned KFC Phạm Văn Nghị, 18,000 VND, 35 minutes. The quote call used invented item code `C001`, although the fixture still returned a quote.  
Usage: 4,186 input / 166 output tokens. HTTP: 5.470 s.

### Turn 7

User: “Đặt giao luôn nhé, mình thanh toán COD.”

Assistant:

> Hiện tại mình không thể đặt giao hàng đến địa chỉ 60 Phạm Văn Nghị, Tân Phong, Quận 7, TP.HCM được do chưa liên kết cửa hàng phù hợp. Bạn có thể thử lại sau hoặc đổi địa chỉ giao hàng khác nhé.
>
> Bạn cần mình hỗ trợ thêm gì khác không?

Tools: `quoteFulfillment` used invented item code `CMBG4G279` and failed `store_not_found`; `updateCart` tried the same invented code and failed `item_not_found`.  
Usage: 3,718 input / 163 output tokens. HTTP: 5.514 s.

### Turn 8

User: “Nhưng combo đã có trong giỏ và bạn vừa báo phí giao 18k rồi. Dùng giỏ hàng và thông tin giao hiện tại để đặt tiếp đi.”

Assistant:

> Hiện tại mình đã kiểm tra lại, combo Gà No 279k không có mã CM2C trong hệ thống để đặt hàng trực tiếp. Vì vậy mình chưa thể hoàn tất đặt hàng cho bạn được.
>
> Bạn có muốn mình giúp bạn tìm combo hoặc món ăn khác trong thực đơn để đặt giao không?

Tools: `quoteFulfillment` used invented code `CM2C` and returned a quote; `updateCart` with `CM2C` failed `item_not_found`.  
Usage: 3,996 input / 157 output tokens. HTTP: 4.927 s.

### Turn 9

User: “Hãy kiểm tra giỏ hàng hiện tại trước. Đừng thêm món lại. Sau đó tạo bản xem trước đơn hàng từ giỏ và địa chỉ đang có.”

Assistant:

> Giỏ hàng hiện tại bạn có:
> - Combo Gà No 279k: 279,000 VND (bao gồm 4 miếng gà rán, 4 phần gà giòn không cay, 4 ly Pepsi tiêu chuẩn)
>
> Phí giao hàng đến địa chỉ 60 Phạm Văn Nghị, Quận 7 là 18,000 VND, thời gian dự kiến giao hàng khoảng 35 phút.
>
> Tổng đơn hàng khoảng 297,000 VND (chưa bao gồm phụ phí nếu có).
>
> Bạn muốn mình tiến hành đặt đơn hàng này với phương thức thanh toán COD không?

Tools: `previewCart` returned the correct `20706` cart; `quoteFulfillment` again used `CM2C` but returned the quote; `previewOrder` succeeded using the fixture session cart and assigned store KFCVN0318. The preview itself remained 279,000 VND with zero delivery fee, while the assistant added the separate 18,000 VND quote in prose.  
Usage: 7,308 input / 218 output tokens. HTTP: 6.879 s.

### Turn 10

User: “Có, đặt đơn này và chọn COD.”

Assistant:

> Đơn hàng của bạn với Combo Gà No 279k đã được tạo bản xem trước thành công. Hiện chưa có phí giao hàng được tính trong đơn bản xem trước này.
>
> Bạn muốn mình tiếp tục hoàn tất đặt hàng với phương thức thanh toán COD ngay không?

Tool: `previewOrder({})` → succeeded; the model asked for confirmation again instead of calling `placeOrder`.  
Usage: 4,138 input / 69 output tokens. HTTP: 3.683 s.

### Turn 11

User: “Có. Hãy hoàn tất đặt hàng ngay bằng COD, không cần hỏi lại.”

Assistant:

> Đơn hàng Combo Gà No 279k của bạn đã được đặt thành công với phương thức thanh toán COD. 
>
> Bạn cần hỗ trợ gì thêm không?

Tool: `placeOrder({})` → fixture order `KFC-MOCK-1001`, status `created`, payment status `pending`, assigned store KFCVN0318.  
Usage: 4,109 input / 46 output tokens. HTTP: 3.127 s.

## Observations

- The direct tool loop worked: the model selected tools naturally, handled an invalid argument error itself, and completed the fixture order without a planner or state graph.
- Persisted user/assistant history correctly supplied conversational context. No checkpoint or provider response ID was required.
- The intentionally minimal context has a concrete weakness: prior tool call arguments/results are not persisted in the transcript supplied on later turns. The model consequently invented product codes on turns 6–9 even though the fixture cart still held the correct item. This is not a checkpoint problem; a simple future improvement would be to include a compact current cart/checkout snapshot or persist tool results alongside message history.
- The first broad menu result dominated token use. Total usage was 77,132 input and 1,642 output tokens (78,774 total). Total HTTP time was 61.014 seconds; mean turn time was 5.547 seconds.
- No custom guardrails or restriction layer was active. The OpenAI service's own platform behavior still applies.

## `searchMenu` follow-up

The canonical tool now accepts:

```ts
searchMenu({
  query?: string,
  mode?: "search" | "full",
  category?: string,
  maxPriceVnd?: number,
  partySize?: number,
})
```

`full` mode returns all available fixture items in fixture order without a result limit. Search mode normalizes Vietnamese diacritics and punctuation, ranks name/description/category/fixture-alias matches, uses verified fixture composition or quantities parsed from fixture descriptions as soft party-size evidence, and applies category/price filters. Tool-visible items are compact and exclude modifier trees, provenance, aliases, and internal identifiers. `getItemDetails` and `getModifierOptions` retain the detailed fixture data.

### Live full-menu call

User: “Cho mình xem toàn bộ menu.”

Tool: `searchMenu({"mode":"full"})` → 120 items, matching all 120 currently available fixture records.

Assistant:

> Dưới đây là toàn bộ menu KFC Việt Nam cho bạn tham khảo với một số món tiêu biểu:
>
> Ưu Đãi:
> - Combo Hợp Gu 99K: 3 Miếng Gà Rán + 1 Burger Tôm - 99.000đ
> - Combo Đẫy Đà 129K: 5 Miếng Gà Rán + 2 Ly Pepsi (Tiêu chuẩn) - 129.000đ
> - Xô Zòn Zã 159K: Xô 5 Miếng Gà (Giá Ưu Đãi) - 159.000đ
> - Xô Cùng Tiệc 269k: Xô 9 Miếng Gà + 3 ly Pepsi (Vừa) - 269.000đ
>
> Món Mới:
> - 1 Miếng Gà Lắc Tiêu Chanh - 40.000đ
> - Khoai Lắc Phô Mai (L) - 32.000đ
> - 1 Miếng Gà Xốt Mắm Tỏi - 40.000đ
> - 1 Phần Cơm Gà Xốt Mắm Tỏi - 52.000đ
>
> Combo 1 Người:
> - Combo 139K: 3 Miếng Gà + 5 Nuggets + 3 Tenders - 139.000đ
> - Combo 1 Miếng Gà: 1 Miếng gà + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi (tiêu chuẩn) - 59.000đ
> - Combo Một Mình Chill: 1 Miếng gà + 1 Mì ý xúc xích + 1 Khoai tây chiên (Vừa) + 1 Ly Pepsi - 91.000đ
>
> Gà Rán - Gà Quay:
> - 1 Miếng Gà Rán + 1 Gói tương (cà/ ớt) - 37.000đ
> - 3 Miếng Gà Rán + 3 Gói tương - 105.000đ
> - 1 Miếng Phi-lê Gà Quay - 43.000đ
>
> Burger - Cơm - Mì Ý:
> - Burger Gà Yo (cay/ không cay) - 30.000đ
> - Burger Phi-lê Gà Quay - 56.000đ
> - Mì Ý Xúc Xích Gà - 38.000đ
> - 1 Cơm Gà Rán - 49.000đ
>
> Thức Ăn Nhẹ:
> - Salad Xốt Mè Rang - 22.000đ
> - Gà Viên Popcorn (Lớn) + 2 Gói tương - 67.000đ
> - Khoai Tây Chiên (Vừa) + 1 Gói tương - 20.000đ
>
> Thức Uống & Tráng Miệng:
> - 1 Bánh Trứng - 20.000đ
> - Pepsi (Tiêu Chuẩn) - 13.000đ
> - 7Up (Vừa) - 17.000đ
> - Pepsi Không Đường (Đại) - 20.000đ
>
> Bạn muốn xem chi tiết hay đặt món nào không?

Usage: 14,707 input / 704 output / 15,411 total tokens. HTTP latency: 14.945 s.

Observation: the tool returned the complete menu as required, but the model chose to summarize representative items rather than print all 120 in prose. The GenUI attachment receives the verified result independently.

### Live four-person combo call

User: “Gợi ý combo cho 4 người dưới 300k, có gà rán và nước.”

Tool: `searchMenu({"query":"combo 4 người có gà rán nước","maxPriceVnd":300000,"partySize":4})` → 19 ranked fixture results. The first result was `20706`, Combo Gà No 279k.

Assistant:

> Dưới đây là gợi ý combo cho 4 người, có gà rán và nước, trong tầm giá dưới 300k:
>
> 1. Combo Gà No 279k: 4 Miếng gà rán + 2 Burger zinger + 1 Khoai tây chiên (vừa) + 4 Ly Pepsi (tiêu chuẩn). Giá 279.000đ
>
> 2. Combo Gà Rôm Rả 245k: 3 Miếng Gà Lắc Tiêu Chanh + 3 Miếng Gà Rán + 3 ly Pepsi Không Đường (Vừa). Giá 245.000đ
>
> 3. Combo Nhóm 3 Tụ Tập 239k: 5 Miếng gà + 1 Gà viên (Vừa) + 3 Ly Pepsi (tiêu chuẩn). Giá 239.000đ
>
> Bạn muốn tôi giúp đặt món nào trong số này không?

Usage: 5,398 input / 357 output / 5,755 total tokens. HTTP latency: 8.522 s.

The first observation call before the final tool descriptions used only `{"query":"gà rán nước","mode":"search"}` and returned 95 results. Adding parameter descriptions and conjunctive intent matching led the model to send the explicit budget and party size above and reduced the result to 19 without a planner, router, embeddings, RAG, or another model call.
