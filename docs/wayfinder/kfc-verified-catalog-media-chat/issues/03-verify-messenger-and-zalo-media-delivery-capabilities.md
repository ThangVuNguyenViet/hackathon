Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by:
Assignee: Codex

## Question

What outbound image, card, carousel, action, upload, remote-URL, size, format, count, and fallback capabilities are supported by the currently targeted Messenger Graph API and Zalo OA APIs? Decide the smallest typed channel-neutral media intent and the channel-specific mapping that satisfies the agreed decision-point and count limits while preserving text delivery when media fails.

## Answer

[Messenger And Zalo Catalog Media Delivery Decision](../assets/messenger-zalo-catalog-media-delivery-decision.md) records the current official platform capabilities, source constraints, chosen channel-neutral contract, channel mappings, delivery ordering, partial-failure semantics, and idempotency boundary.

The decision is:

- Persist one ordered `CatalogMediaIntent` per assistant turn, containing one verified item for detail/modifier/cart/allergen decisions or at most five for discovery. It contains no platform buttons or payloads.
- Deliver authoritative text first. If text fails, do not send media. If media later fails, retain the sent text and record a separate `MediaDeliveryOutcome`; never substitute another image.
- Messenger uses direct remote-URL image attachments: one attachment for single-image decisions or one `attachments` array for up to five discovery images. Do not save reusable attachment IDs in this iteration; Meta attachment IDs expire after 90 days.
- Do not use Messenger generic carousels by default. They support titles/buttons and up to ten elements, but crop non-1.91:1 source images; sampled KFC product images are 480x390. Direct attachments preserve the official source image more faithfully.
- Zalo uses the existing advisory endpoint `POST /v3.0/oa/message/cs` with one `template_type: media` element per request. It accepts either a remote `url` or an uploaded `attachment_id`; use the verified official remote URL and send at most five ordered media requests after text.
- Zalo advisory images must be JPG/PNG/GIF, at most 1 MB, with one media element. All 124 currently verified KFC assets are JPEG and at most 502,548 bytes, so they satisfy the documented format/size gate. The 16:9 recommendation and 14:9 safe zone are presentation guidance, not a reason to transform or replace official images.
- Use Messenger only inside its response-policy window and Zalo advisory media only inside its 48-hour consultation window. Do not route ordering-chat images through legacy/deprecated transactional or personal-communication templates.
- Persist deterministic per-turn/per-ordinal delivery reservations so retries skip already-sent media. Text status and media status remain separate; media may be `not_requested`, `pending`, `sent`, `partial`, `failed`, or `skipped` without changing a successfully sent assistant text turn to failed.
