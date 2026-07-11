# Define KFC Source Identity And Session Semantics

## Status

Closed on 2026-07-10.

## Labels

wayfinder:grilling

## Blocks

None.

## Question

What is the canonical domain and wire contract for the first-party Flutter customer chat as a `kfc` source?

Resolve:

- whether the public source name is exactly `kfc`;
- the canonical session ID shape, such as `kfc:<customer-or-device-id>`;
- how `customerId`, `externalUserId`, display name, avatar, and profile records should work for KFC-owned chat;
- whether the retired mock-only source remains only a fixture/test channel or is replaced by `kfc`;
- how `kfc` relates to the existing backend `Channel` type, `ConversationEvent`, `ConversationTurn`, `ConversationProfile`, and dashboard session target language.

The answer should produce the naming and identity rules other tickets must follow.

## Resolution

The first-party Flutter customer chat is a real `kfc` conversation source, peer to `messenger` and `zalo`.

Canonical identity rules:

- The source/channel value is exactly `kfc`.
- The retired mock-only source must be removed as a channel/source value. Mocking belongs in repositories, clients, and tests, not in the conversation source model.
- Session IDs use `kfc:<stable-customer-id>`.
- `customerId` and `externalUserId` use the same stable value for the first release.
- Anonymous KFC chat generates a durable identity per client install/browser profile.
- Later authenticated KFC accounts may replace the anonymous stable value with a KFC-owned customer/account id.
- KFC uses the existing backend `Channel` model; do not introduce a separate `Source` abstraction in this effort.

Profile and transcript rules:

- KFC sessions support `ConversationProfile` records keyed by `kfc` plus `externalUserId`.
- Anonymous profiles are minimal first-party profiles with nullable display name/avatar.
- KFC customer text turns and GenUI actions send a stable `clientMessageId`; the backend stores it as `externalMessageId` for idempotency.
- KFC GenUI actions become customer-role transcript turns with readable derived text and structured action metadata preserved.

Ingress and delivery rules:

- KFC does not use `webhook_deliveries`; that table remains for third-party webhook ingress such as Messenger and Zalo.
- First-party KFC ingress uses source-specific routes: `POST /chat/kfc/message` and `POST /chat/kfc/genui-action`.
- KFC human/operator outbound delivery means customer-readable persisted turns plus app sync, not Messenger/Zalo API delivery.

Monitor and product rules:

- `kfc:<stable-id>` sessions are operator-visible by default through the same dashboard session target path as Messenger and Zalo.
- The live monitor includes a real `KFC` or `KFC Chat` filter/source option.
- The monitor deeplink/open-chat button is disabled for KFC sessions in the first release.
- Customer chat and live monitor remain separate Flutter entrypoints.
- KFC source parity includes the existing shared graph behaviors: ordering, cart, fulfillment, payment, GenUI actions, and human handoff. It does not add new KFC-only business capabilities.
