# KFC Image-Rich GenUI Decision Points Design

## Status

Approved interactively on 2026-07-11. This document defines the prototype target for [Prototype Image-Rich GenUI Decision Points](../../wayfinder/kfc-verified-catalog-media-chat/issues/05-prototype-image-rich-genui-decision-points.md).

## Goal

Enhance KFC customer GenUI with verified official product and campaign imagery at useful decision points while preserving the existing compact chat flow, actions, transcript replay, and Text-Only Degradation.

The prototype covers:

- menu discovery and recommendations;
- single-product detail;
- modifier selection;
- promotion discovery;
- product-specific ingredient/allergen answers;
- the first cart summary and order review.

## Settled constraints

- Use only Verified Catalog Media from official KFC-hosted URLs.
- Never invent, generate, crop into a new asset, mirror, rehost, or substitute fallback artwork.
- Missing or failed media collapses to text and existing actions.
- Discovery shows at most five images.
- Detail, modifier, cart, and allergen decisions show one image.
- Expired promotions never render as available.
- The work must preserve concurrent payment-method, cart-action, session-update, and human-handoff changes already present in the checkout.

## Chosen approach

Progressively enhance existing GenUI widgets with one reusable verified-media component. Add focused widget kinds only where the existing catalog cannot express the decision safely.

Rejected alternatives:

- A shared gallery above every widget weakens the image-to-entity relationship.
- Replacing the catalog with image-specific widget variants duplicates actions and broadens the migration unnecessarily.
- Messenger-style carousel assumptions do not belong in first-party GenUI and would force cropping of current official source ratios.

## Component model

### VerifiedMediaFrame

One reusable presentation component owns image loading and accessibility behavior.

Inputs:

- typed Verified Catalog Media;
- Vietnamese semantics/alt text;
- intended presentation role: thumbnail or hero;
- optional dimensions/aspect ratio from verified metadata.

Behavior:

- preserves the official source ratio;
- uses `BoxFit.contain` and never crops into a replacement composition;
- reserves its intended layout space with a neutral shimmer while loading;
- removes its entire media area on load/decode failure;
- never renders a broken-image icon or replacement artwork;
- excludes decorative repeated media from accessibility focus.

### Existing widgets enhanced

#### Smart Menu Picker

- Keeps its compact vertical list, but replaces per-item add actions with one batch confirmation action.
- Adds an 88×72 thumbnail to the left of each item.
- Shows at most five image-bearing choices.
- Every item starts at quantity zero and exposes only minus, quantity, and plus controls.
- Minus is disabled at zero; plus caps the quantity at 99.
- Keeps product name, up-to-two-line description, price, and quantity controls readable without horizontal scrolling.
- A single footer shows the selected unit count and estimated subtotal.
- The single `Xác nhận món` action is disabled until at least one item has a non-zero quantity.
- Confirmation emits one ordered batch containing only selected item codes and quantities; changing quantities does not mutate the cart before confirmation.
- A one-item result acts as the product-detail surface with a larger full-width hero above its existing controls.

#### Cart Builder

- Shows one full-width image above line items on the first cart-summary Snapshot only.
- Uses the first customer-selected main item.
- Excludes drinks and add-ons when selecting that image.
- Keeps the selected image stable through quantity edits.
- Later cart Snapshots omit the repeated image unless a new cart lifecycle begins.

#### Order Review Confirm

- May replay the already-selected first-cart image when the immutable Snapshot requires it for continuity.
- Does not independently choose a different or more expensive item.
- Existing totals, fulfillment details, confirmation actions, and promotion context remain authoritative.

### New focused widget kinds

#### Modifier Picker

- Displays one product hero above modifier groups.
- Modifier controls remain text-first and grouped by existing min/max rules.
- The hero changes to a modifier-specific verified image only after the customer selects that option.
- Selecting an option without verified media retains the parent product image.
- It never searches for or invents a visually similar modifier.

#### Promotion Picker

- Displays image-first campaign cards ordered consistently with the assistant text.
- Each card includes title, validity dates, and key eligibility beneath the image.
- Shows one through five active/scheduled campaigns.
- Excludes expired or unknown-date campaigns from the runtime surface.
- A promotion without verified media remains a text-only promotion result rather than an empty card.

#### Allergen Evidence

- Shows the verified parent-product image for an exactly matched menu item.
- Exposes the verified KFC allergen chart through a secondary `Xem bảng dị ứng` action.
- Does not render the dense chart inline in the conversation.
- When no exact product association exists, shows text and the chart action only.
- Never creates standalone ingredient imagery from product descriptions.

## Typed data flow

1. The fixture layer associates entities with nullable `mediaKey` values.
2. Backend ordering services resolve keys through the central verified media registry.
3. GenUI selection receives typed media objects; it does not accept arbitrary raw URLs.
4. The immutable GenUI Snapshot persists the selected media identity and exact verified URL with the assistant turn.
5. Flutter parses typed media data and renders it through `VerifiedMediaFrame`.
6. Transcript replay renders the persisted Snapshot rather than selecting media again from current graph state.

Conceptual client model:

```dart
final class KfcVerifiedMedia {
  const KfcVerifiedMedia({
    required this.mediaKey,
    required this.entityType,
    required this.entityId,
    required this.url,
    required this.altText,
    required this.mimeType,
    required this.sizeBytes,
    this.width,
    this.height,
  });
}
```

Required properties:

- `mediaKey`;
- entity type and stable entity ID;
- exact verified official URL;
- meaningful Vietnamese alt text;
- MIME type and size;
- dimensions when known.

Flutter does not repeat source-host or reachability policy. Backend fixture generation and validation establish eligibility.

## Selection rules

### Menu and recommendations

- Preserve backend order.
- Render the first five eligible items.
- An item without media remains in the list as a text-only row and still counts toward the five-item choice limit.

### Product detail

- Use the selected item's media only.
- Never borrow an image from another size, combo, or similarly named product.

### Modifiers

- Start with the parent product image.
- Switch only after an explicit selection with its own verified media.
- Restore the parent image when the selected modifier is removed.

### Promotions

- Require active or scheduled lifecycle status and verified dates.
- Preserve the order used by assistant text.
- Render only verified campaign media; text-only offers remain usable.

### Cart

- Determine the first customer-selected main item from durable cart-selection order.
- Ignore drinks and add-ons for image selection.
- Persist the chosen `mediaKey` in the first cart Snapshot so repricing and quantity changes cannot switch it.

### Allergen evidence

- Join an exact menu item to its existing product media.
- Keep the allergen chart as a secondary action target.

## Loading, failure, and replay

### Loading

- Thumbnail and hero areas reserve their final dimensions.
- A neutral surface shimmer appears without branding or food illustration.
- Text, prices, and actions render immediately and remain usable.

### Failure

- Network, timeout, non-image response, or decode failure collapses only the media frame.
- No broken-image icon, placeholder, retry CTA, or alternative image appears.
- The assistant text and GenUI actions remain unchanged.
- A failed local render does not mutate the persisted GenUI Snapshot.

### Replay

- Historical Snapshots retain their selected media reference.
- Replay does not choose a newer product or campaign image.
- If the historical URL later fails, the historical Snapshot degrades to text only.

## Accessibility

- Product alt text names the exact menu item.
- Modifier alt text names the exact option and parent product.
- Promotion alt text names the campaign, not promotional fine print.
- The allergen chart action has a descriptive Vietnamese label.
- Repeated media is marked decorative when adjacent text already communicates the same identity and the image provides no additional navigational function.
- Loading shimmer is excluded from semantics.

## Visual specification

### Menu list

- Thumbnail: 88×72 logical pixels.
- Fit: contain.
- Each row contains one zero-based quantity stepper and no add/confirm button.
- One batch-confirm footer belongs to the chooser, not to any individual row.
- The footer remains visible after a long list expands and communicates selected units plus estimated subtotal.
- Name remains primary; image never displaces price or quantity controls.

### Detail and modifiers

- One full-width hero constrained by the verified source ratio.
- Fit: contain.
- Modifier groups begin below the hero with existing GenUI chrome and action hierarchy.

### Promotions

- Original campaign ratio, constrained to conversation width.
- Title, dates, and eligibility sit below the image.
- No text is burned into newly generated assets.

### Cart and review

- One compact full-width hero above line items.
- No per-line thumbnails.

## Concurrent-work boundary

The inspected checkout already contains uncommitted work for:

- `paymentMethodPicker`;
- cart quantity/remove action validation;
- budget and party-size menu context;
- KFC session updates and first-party human control.

Image-rich work must preserve these changes, extend the current widget/action catalog, and avoid reverting or restyling them. The prototype may reference their current layout but does not redesign them.

## Proof strategy

### Backend

- Typed media schema and registry resolution.
- Menu/detail/add-on/modifier/promotion/allergen/cart projection.
- Five-image and one-image limits.
- Active/scheduled promotion filtering.
- Stable first-cart media selection.
- Immutable media-bearing Snapshot persistence and replay.
- Missing media produces valid text/action Snapshots.

### Flutter unit and widget tests

- Smart Menu Picker initializes every quantity at zero.
- Minus is disabled at zero, plus caps at 99, and no per-item add action is rendered.
- Batch confirmation is disabled for an empty selection.
- One confirmation emits selected items once, in displayed order, with exact quantities and no zero-quantity rows.
- Image failure does not change selection or confirmation behavior.
- Parse typed media objects.
- Render thumbnail and hero roles.
- Inject deterministic successful, delayed, failed, and malformed image responses.
- Assert neutral shimmer while loading.
- Assert complete media collapse on failure.
- Assert text/actions persist through failure.
- Assert Vietnamese semantics.
- Assert modifier image changes only after explicit selection.

### Goldens

- Smart Menu Picker with five thumbnails.
- One-item product detail.
- Modifier Picker parent and selected-option states.
- Promotion Picker.
- Allergen Evidence.
- First Cart Builder image and subsequent text-only cart state.

### Backend-backed integration proof

- Exercise the existing full scripted scenario set.
- Verify real official URLs render at selected decision points.
- Verify media never exceeds agreed count limits.
- Verify failed media does not suppress text or actions.
- Verify transcript replay uses the persisted Snapshot.
- Preserve existing widget-kind, action, payment, handoff, durability, and proof-manifest gates.

## Out of scope

- Image generation, editing, cropping, mirroring, or rehosting.
- Product image search in Flutter.
- Channel-specific Messenger/Zalo payload implementation.
- New payment, handoff, session-update, or cart semantics outside the approved atomic menu-selection confirmation.
- Video, GIF animation, customer-uploaded image recognition, zoom galleries, or image-only ordering.
- Membership images until an eligible official source exists.

## Prototype acceptance

The reviewable prototype is accepted when the user can inspect these states and confirm the visual hierarchy:

1. five-item compact menu with thumbnails, per-dish zero-based quantity controls, and one batch-confirm button;
2. one-item product detail;
3. modifier parent image and selected-option change;
4. active promotion cards;
5. parent-product allergen answer with chart action;
6. first cart summary with one stable main-item image;
7. loading shimmer and complete media collapse on failure.

The prototype is illustrative and must not modify production runtime files.
