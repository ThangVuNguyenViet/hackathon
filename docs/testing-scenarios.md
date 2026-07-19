# KFC scenario qualification

> Generated index and count contract. Scenario inputs and outcomes live only in `ai-talent-tracks/fnb/conversations/*.json`.

## Canonical math

- 9 scenarios
- 48 customer turns
- 96 Text/GenUI dataset examples
- 3 unchanged repetitions
- 54 scenario-mode runs per provider
- 288 turn-mode evaluations per provider

The evaluator compares observable state, effects, exact verified facts and collections, provenance, receipts, persistence, latency, Text/GenUI fact parity, and cross-provider structured-fact parity. It does not grade planner routes, tool order, provider wording, or fixed customer-language phrases.

## Offline checks

```bash
cd services/kfc-agent-backend
npx tsx scripts/generate-scenario-docs.ts --check
npx vitest run test/scenarios/scenario-script.test.ts test/scenarios/scenario-coverage-ledger.test.ts test/evaluation/live-quality-dataset.test.ts test/evaluation/live-quality-runner.test.ts
```

The paid live matrix remains blocked until the provider-neutral direct `StateGraph` runtime is integrated. Do not synchronize the v2 LangSmith dataset before the reviewed corpus digest and runtime are accepted.

## Scenarios

- [01: Đặt món rõ ràng, giao hàng, voucher, thanh toán](../ai-talent-tracks/fnb/conversations/01-dat-mon-ro-rang-giao-hang.md)
- [02: Toàn bộ menu, tư vấn đồ uống, combo và upsize](../ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.md)
- [03: Tồn kho, nhận tại cửa hàng rồi chuyển sang giao hàng](../ai-talent-tracks/fnb/conversations/03-ton-kho-dia-chi-va-cua-hang.md)
- [04: Theo dõi, hủy, đặt lại và chỉnh đơn sau khi đặt](../ai-talent-tracks/fnb/conversations/04-sau-khi-dat-don.md)
- [05: Khiếu nại, feedback và chuyển nhân viên](../ai-talent-tracks/fnb/conversations/05-khieu-nai-va-human-handoff.md)
- [06: Ngôn ngữ tự nhiên, mơ hồ và an toàn hội thoại](../ai-talent-tracks/fnb/conversations/06-ngon-ngu-tu-nhien-va-an-toan.md)
- [07: Cá nhân hóa, món yêu thích, loyalty và chỉnh giỏ hàng](../ai-talent-tracks/fnb/conversations/07-ca-nhan-hoa-va-loyalty.md)
- [08: Lỗi thanh toán và đơn bất thường](../ai-talent-tracks/fnb/conversations/08-thanh-toan-loi-va-don-bat-thuong.md)
- [09: Phương thức thanh toán website/app](../ai-talent-tracks/fnb/conversations/09-phuong-thuc-thanh-toan.md)
