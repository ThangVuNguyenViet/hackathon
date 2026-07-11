# Messenger And Zalo Catalog Media Delivery Decision

## Decision

Use one channel-neutral, persisted Catalog Media Intent selected from verified fixtures at a Media Decision Point. Send the assistant's authoritative text first, then best-effort media. Map the same ordered intent to direct remote-URL image attachments on Messenger and individual advisory media messages on Zalo.

Do not introduce platform buttons, reusable attachment caches, image uploads, transactional templates, or rehosted/transformed assets in this iteration.

## Official sources checked

Captured with TinyFish on 2026-07-11:

- [Meta: Send a Message](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages)
- [Meta: Generic Template](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/template/generic), updated 2026-04-22
- [Meta: Saving Assets](https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/saving-assets), updated 2026-06-17
- [Zalo: Gửi tin Tư vấn đính kèm ảnh](https://developers.zalo.me/docs/official-account/tin-nhan/tin-tu-van/gui-tin-tu-van-dinh-kem-anh), extracted by TinyFish run `2d7e4140-5d3e-4ef7-b5eb-fee659668757`
- [Zalo: Gửi tin giao dịch](https://developers.zalo.me/docs/api/official-account-api/gui-tin-va-thong-bao-qua-oa/v3/tin-giao-dich/gui-tin-giao-dich-post-7040), extracted by TinyFish run `88af0329-a6c7-4a8f-9b0d-75919240d8ec`

Meta's pages were fetched directly. Zalo's pages are client-rendered and some direct content fetches returned proxy errors, so TinyFish browser agents read the rendered official pages. Search snippets from the same official Zalo documentation independently confirmed the one-element and 1 MB limits.

## Messenger capability

The current Meta documentation uses Graph API v25.0 examples and supports:

- a single remote image with `message.attachment.type: image` and `payload.url`;
- multiple remote images in `message.attachments`, with image as the only allowed media type and a platform limit of 30 images;
- generic templates with title, optional subtitle, `image_url`, optional default action, and up to three buttons per element;
- generic carousels of up to ten elements;
- direct URL sending or optional saved/uploaded attachments;
- delivery and read webhooks for Messenger conversations.

Meta's saved-asset documentation adds these relevant constraints:

- image URL uploads are limited to 8 MB;
- URL fetches for non-video assets have a 10-second timeout;
- URL SSL, content type, file type, size, and response speed must be valid;
- saved attachment IDs expire after 90 days;
- remote URL delivery does not require saving an attachment first.

The agreed application limit of five discovery images is stricter than Meta's limits.

### Why not use a generic carousel by default

A carousel gives each image a title and buttons, but Meta recommends 1.91:1 imagery and scales or crops mismatched images. Sampled official KFC assets are:

- product images: 480x390, about 1.23:1;
- promotion images: 710x470, about 1.51:1.

Because the user prohibited editing, generating, or substituting images, direct image attachments preserve the source asset more faithfully and allow the customer to open the image. The authoritative text lists products/promotions in the same order as the image attachments.

Generic cards remain a future option only if KFC provides matching official aspect-ratio assets; this effort does not crop or transform them.

### Messenger mapping

For one item:

```json
{
  "recipient": { "id": "<PSID>" },
  "messaging_type": "RESPONSE",
  "message": {
    "attachment": {
      "type": "image",
      "payload": { "url": "<verified-official-url>" }
    }
  }
}
```

For discovery, send one message with an ordered `attachments` array of at most five image attachments. Omit `is_reusable`; do not create a 90-day attachment-cache lifecycle for publicly hosted fixture images.

## Zalo capability

The current Zalo advisory image endpoint is:

```text
POST https://openapi.zalo.me/v3.0/oa/message/cs
```

It requires `Content-Type` and `access_token` headers, a recipient `user_id`, and a media template. The rendered official page documents:

- `template_type: media`;
- one element maximum;
- `media_type: image` for static images or `gif` for animation;
- either `url` or `attachment_id`, but not both;
- remote URLs are supported without a prior upload;
- JPG and PNG for static images;
- 1 MB maximum;
- 16:9 recommended display size and a 14:9 safe zone;
- a text/title field up to 2,000 characters;
- `message_id`, `user_id`, send time, and quota information in successful responses.

Zalo advisory messages operate in the customer consultation context. From 2026-01-01, official documentation says messages inside the 48-hour interaction window are free and unlimited. This ordering assistant replies immediately to an inbound user turn, so advisory media is the matching surface.

The transactional page also exposes `image_url` or `attachment_id`, up to five elements, and buttons, but it describes a paid/verified transactional route and a migration away from Transaction UID and Personal Communication UID services starting 2026-03-01. Product discovery and modifier imagery must not depend on that surface.

### Zalo mapping

Send one request per intent item, in order, after authoritative text succeeds:

```json
{
  "recipient": { "user_id": "<ZALO_USER_ID>" },
  "message": {
    "text": "<short product or promotion label>",
    "attachment": {
      "type": "template",
      "payload": {
        "template_type": "media",
        "elements": [
          {
            "media_type": "image",
            "url": "<verified-official-url>"
          }
        ]
      }
    }
  }
}
```

Do not upload the image first. The verified official URL remains the source of truth and avoids a separate Zalo asset lifecycle.

## Current asset eligibility

The 124 URLs accepted by the media-inventory ticket were rechecked against channel-relevant binary metadata:

| Check | Result |
|---|---:|
| Total verified assets | 124 |
| JPEG assets | 124 |
| Assets over 1 MB | 0 |
| Largest asset | 502,548 bytes |
| Assets over Meta's 8 MB image URL limit | 0 |

Therefore every currently eligible asset satisfies the documented Messenger and Zalo file-type/size gates. This does not bypass per-send platform validation; an individual platform failure still triggers Text-Only Degradation.

## Channel-neutral contract

The smallest useful contract is conceptually:

```ts
type CatalogMediaDecisionPoint =
  | 'menu_discovery'
  | 'recommendation'
  | 'product_detail'
  | 'modifier_choice'
  | 'promotion_discovery'
  | 'cart_summary'
  | 'allergen_evidence';

interface CatalogMediaIntentItem {
  mediaKey: string;
  entityType: 'menu_item' | 'modifier' | 'promotion' | 'allergen_chart';
  entityId: string;
  url: string;
  title: string;
  altText: string;
  ordinal: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif';
  sizeBytes: number;
}

interface CatalogMediaIntent {
  decisionPoint: CatalogMediaDecisionPoint;
  textFirst: true;
  items: CatalogMediaIntentItem[];
}
```

Contract invariants:

- `items.length` is one for detail/modifier/cart/allergen decisions and one through five for discovery;
- items are already verified, active where lifecycle applies, and ordered to match the text response;
- the intent contains no platform payload, attachment ID, button, or fallback URL;
- the intent is persisted with the assistant turn before delivery;
- `mediaKey` is stable across retries for the same immutable assistant turn.

## Delivery ordering and outcomes

1. Persist the assistant turn, GenUI Snapshot, and Catalog Media Intent.
2. Send authoritative text.
3. If text fails or the run is stale, mark media `skipped`; send nothing else.
4. Reserve media delivery by assistant turn and `mediaKey` before calling a platform.
5. Messenger sends one attachment request; Zalo sends one ordered request per item.
6. Persist each returned message ID or error without rewriting the assistant turn.
7. On retry, skip media items already marked sent.

The Media Delivery Outcome is independent from text delivery:

```text
not_requested | pending | sent | partial | failed | skipped
```

- Messenger's batch is `sent` or `failed` as one platform call.
- Zalo can be `partial` when some ordered media calls succeed.
- A sent text plus failed/partial media remains a successfully delivered assistant reply with Text-Only Degradation.
- Media failure never selects a different image and never retries under a new media identity.

## Current-code implications

- Extend `MessengerClient` and `ZaloClient` with media delivery; do not overload `sendText`.
- Pass the persisted Catalog Media Intent into `deliverAssistantReply` after text delivery.
- Add deterministic media-delivery reservation/outcome storage rather than relying only on inbound webhook idempotency.
- Enrich dashboard/proof evidence with media intent count, decision point, per-item outcome, and platform message IDs; do not put full image binaries into events.
- Keep the current inbound Zalo attachment normalization separate from outbound catalog media.
- Do not add channel actions in the media implementation ticket. Text and first-party GenUI remain the action surfaces.
