# Versioned GenUI Structural Streaming Contract

Research snapshot: current isolated checkout and official A2UI/Flutter GenUI documentation inspected on 2026-07-11.

## Decision

The first KFC rollout uses a **project-owned complete-snapshot protocol**. One run owns one primary **GenUI Surface**. The backend may publish increasing, fully validated **GenUI Revisions** for that surface, and Flutter atomically replaces the whole rendered revision. Revisions are never JSON patches or partially valid component trees.

Provisional revisions are customer-safe and may be displayed, but they cannot execute actions or become transcript history. Exactly one final authoritative revision may be committed as the immutable **GenUI Snapshot** stored with the assistant turn. Only that authoritative snapshot can offer active **GenUI Action Capabilities**.

The current `KfcGenUiAttachment` is not A2UI. Its business widgets and data are conceptually adaptable to an A2UI custom catalog, but formal A2UI adoption is deferred beyond this rollout.

## Current repo facts

- Backend and Flutter share eight fixed `widgetKind` names, but there is no schema version, catalog version, run ID, surface ID, revision, digest, authority state, or source-state version.
- `selectKfcGenUiAttachment` selects one complete attachment after tool work. Its ID contains `Date.now()`, so repeated selection has no stable logical surface identity.
- Backend validation checks only top-level shape and known `widgetKind`; it does not validate `status`, per-kind `data`, action IDs, sizes, URLs, or nested values completely.
- Flutter parses `data` as `Map<String, Object?>`. Unknown status values default to `active`, which is not safe for a versioned action surface.
- Flutter selects one handwritten widget from `widgetKind`; it does not interpret a server-provided component tree or data-binding model.
- The final attachment is persisted in `ConversationTurnMetadata.genUi`. There is no provisional storage model.
- An action currently targets `attachmentId` and `actionId`. The server reloads the attachment from transcript history, verifies that the action exists and the attachment is active, and reconstructs trusted values for selected menu/cart/payment inputs. This is a useful trust boundary, but it does not bind the action to a revision, current state version, expiration, or single-use reservation.

## Approaches considered

### 1. Complete versioned KFC snapshots — selected

Wrap a typed evolution of `KfcGenUiAttachment` in a run/surface/revision envelope and atomically replace complete revisions.

- Fits the current fixed business-widget renderer and immutable turn metadata.
- Gives replay, duplicate suppression, validation, text-only degradation, and action staleness explicit boundaries.
- Avoids exposing an incomplete cart, order, payment, or confirmation surface.
- Preserves a clean later mapping to an A2UI custom catalog.

### 2. JSON Patch or field-level deltas — rejected

Send operations against `data`, `actions`, or widget fields.

- Smaller messages, but KFC snapshots are already bounded.
- A missing/reordered patch can create a semantically invalid confirmation or payment UI.
- Requires patch-specific validation, rollback, base-revision negotiation, and focus recovery.
- Makes an exact immutable final attachment harder to prove.

### 3. Formal A2UI v0.9.1 now — deferred

Replace the KFC model and renderer with A2UI surfaces, component/data messages, catalogs, and action events.

- Gains an open protocol, Flutter renderer ecosystem, catalogs, data binding, and portable UI structure.
- Requires a component/catalog redesign rather than a small evolution of the current eight business widgets.
- Introduces a second action/data-model trust model that must preserve KFC capability and side-effect safeguards.
- The official protocol is still evolving: the A2UI site lists v0.9.1 as current and v1.0 as candidate, while Flutter GenUI documents v0.9 support.
- Adds migration risk without being necessary to prove customer-visible structural streaming.

## Canonical snapshot envelope

Every `genui_snapshot` event inherits `schemaVersion`, `runId`, `sequence`, and `occurredAt` from the project-owned run envelope. Its payload is a complete immutable revision:

```json
{
  "surfaceId": "surface_opaque",
  "snapshotId": "snapshot_opaque",
  "revision": 2,
  "authority": "provisional",
  "catalogVersion": "kfc-genui-v1",
  "stateVersion": 41,
  "widgetKind": "cartBuilder",
  "lifecycleStage": "cart",
  "status": "active",
  "title": "Giỏ hàng của bạn",
  "summary": null,
  "data": {
    "cart": {}
  },
  "actions": [],
  "sha256": "digest_of_canonical_snapshot_json"
}
```

### Identity

- `runId` identifies the accepted customer run and comes from the event envelope.
- `surfaceId` is stable for the logical primary UI region of that run. First rollout allows one primary surface per run.
- `revision` starts at 1 and increases by exactly one for that surface.
- `snapshotId` uniquely identifies one immutable `(surfaceId, revision)` value.
- `sha256` covers canonical serialized content excluding transport sequence/time and the digest field itself.
- `stateVersion` identifies the verified session/business state from which the revision was derived. An actionable authoritative snapshot must bind to the state version its capabilities expect.

The legacy synchronous response may continue returning `KfcGenUiAttachment.id = snapshotId` during migration, but new streaming and action code must not treat a timestamp-derived attachment ID as surface identity.

### Catalog and typed content

`catalogVersion` versions the KFC-owned widget catalog independently of the run event schema. `kfc-genui-v1` retains the eight current business widget kinds.

Each `widgetKind` must have a discriminated backend and Dart payload type rather than accepting an unbounded `Map<String, Object?>` at the wire boundary. The catalog schema defines:

- required and optional data fields;
- allowed status/lifecycle values;
- allowed action names and input shapes;
- list and string size limits;
- numeric ranges and currency rules;
- URL schemes/hosts where applicable;
- customer-safe fields and explicitly forbidden internal fields.

Unknown catalog versions, widget kinds, enum values, or fields that violate a closed schema fail validation. Flutter must not default an unknown status to `active`.

## Revision and render rules

1. Persist every revision event before it is visible through SSE or long poll.
2. Validate the complete envelope and per-kind payload on the backend before persistence.
3. Flutter validates again before reduction.
4. Accept only the current run, expected surface, and next revision.
5. An exact duplicate `(revision, digest)` is ignored.
6. The same revision with a different digest is a protocol conflict and triggers authoritative resync.
7. A revision gap freezes the last valid surface and triggers replay. Flutter never applies a later snapshot across a gap.
8. A valid revision atomically replaces the whole surface model in one state update. Widgets never observe a mixture of old data and new actions.
9. A provisional revision may be replaced by a later provisional or authoritative revision.
10. After the authoritative revision, no later revision or clear event may mutate that persisted surface.

Flutter may crossfade/resize whole revisions according to the approved Cue prototype, but render state changes remain atomic. Animation never defines correctness.

## Relationship to response text

- A valid revision may be persisted once verified structure exists, but Flutter does not reveal a new response surface before the first customer text delta creates the response block.
- If provisional revisions arrive earlier, Flutter retains only the latest contiguous valid revision and reveals it beneath the first visible response text.
- Text and GenUI share run sequence but have independent validation and reduction rules.
- The final assistant-turn transaction persists Canonical Assistant Text and, when available, the authoritative GenUI Snapshot together.
- `text_completed` and the authoritative `genui_snapshot` may be adjacent events from that same durable commit. Delivery order does not alter the stored turn.
- If no authoritative GenUI revision is ready at final turn commit, the run completes text-only. The first rollout does not attach a late GenUI snapshot by mutating an already-immutable turn.

This tight final-commit rule prevents transcript reload from producing a different attachment than the one proved during the run.

## Provisional and authoritative lifecycle

### Provisional GenUI Revision

- Complete and safe to render.
- Derived only from verified backend state, never from unfinished model JSON.
- Stored in the run event log, not conversation-turn metadata.
- Displayed as part of the active response block.
- May be replaced or cleared.
- Contains no executable action capability. It may show disabled action presentation when layout stability matters, but no `capabilityId` is issued and Flutter cannot submit it.

### Authoritative GenUI Snapshot

- Final complete revision for the run.
- Persisted immutably with the assistant turn.
- Must correspond to the final verified business state and canonical response.
- May contain available action capabilities.
- Replayed from both the run log and transcript without regeneration.
- Cannot be cleared by cancellation, supersession, or a later run. A later customer action produces a new run and a new surface.

### Clearing provisional UI

Use a durable `genui_cleared` event containing `surfaceId`, the next revision, and an internal reason such as `cancelled`, `superseded`, `invalid`, or `text_only`.

- It may clear only a provisional surface.
- It follows normal sequence/gap rules.
- Flutter removes the provisional widget without deleting text.
- Internal reason values never appear as customer copy.
- An authoritative persisted snapshot is never deleted by this event.

## Action capability contract

An action is available only from an authoritative snapshot and must be represented as a server-owned **GenUI Action Capability**, not just a label and arbitrary client payload.

```json
{
  "capabilityId": "cap_opaque",
  "actionId": "confirm_order",
  "label": "Đặt đơn 145.000đ",
  "intent": "primary",
  "availability": "available",
  "inputSchemaVersion": "confirm-order-v1",
  "singleUse": true,
  "expiresAt": "2026-07-11T00:10:00.000Z"
}
```

The action request carries:

```json
{
  "sessionId": "kfc:customer",
  "clientMessageId": "customer_action_opaque",
  "surfaceId": "surface_opaque",
  "snapshotId": "snapshot_opaque",
  "revision": 3,
  "capabilityId": "cap_opaque",
  "actionId": "confirm_order",
  "input": {}
}
```

The server must verify:

- session, persisted assistant turn, surface, snapshot, revision, and digest association;
- authoritative status and matching capability/action;
- expiry, current business `stateVersion`, allowed input schema, and customer ownership;
- single-use reservation before an irreversible effect;
- any action-specific confirmation and tool safety gates.

Labels, values, prices, item names, item codes, payment methods, and other trusted fields are reconstructed from the persisted capability/snapshot and current verified state. Client input is accepted only where the capability schema explicitly allows it.

Stale/expired/unavailable capability responses disable the old action and resync the current authoritative surface or degrade to text. They never silently execute against a newer cart/order state.

## Validation boundary

### Backend

Before persisting a revision:

- validate the envelope and strict per-kind schema;
- verify every displayed business value against the referenced `stateVersion`;
- reject internal reasons, traces, credentials, raw tool data, and unsupported media;
- verify action presentation against allowed capability types;
- enforce payload and event-size limits;
- canonicalize and digest only after validation.

### Flutter

Before reducing a revision:

- validate schema/catalog versions and strict typed payload;
- verify run/surface/revision/digest consistency;
- reject unknown kinds/statuses rather than guessing;
- construct the widget off-state, then atomically publish it;
- report a technical validation event without placing raw error text in chat.

Backend acceptance is authoritative; Flutter validation is defense in depth and a text-only degradation trigger.

## Failure and text-only degradation

GenUI is additive. Canonical Assistant Text remains the authoritative customer response.

- Invalid, unsupported, oversized, or out-of-order provisional revisions do not fail text streaming. Keep the last valid provisional revision or clear it after resync fails.
- If the final revision cannot validate or persist, complete the assistant turn without GenUI.
- If Flutter cannot render a valid server snapshot because its catalog is unsupported, show text only and record technical evidence.
- A failed GenUI action retains the authoritative snapshot but disables or refreshes the affected capability according to the server result. Never optimistically claim a business mutation.
- Stop/cancellation removes provisional GenUI. It does not remove an earlier authoritative snapshot from transcript history.
- Reconnect replays revision events; it never regenerates GenUI from current state.

For confirmations and other critical actions, the text response must state a safe textual next step so loss of GenUI does not trap the customer.

## Formal A2UI compatibility assessment

The official A2UI site currently identifies [v0.9.1 as the current production release and v1.0 as a candidate](https://a2ui.org/). Its v0.9 family uses versioned `createSurface`, `updateComponents`, `updateDataModel`, and `deleteSurface` messages, a `surfaceId`, a component catalog, an adjacency-list component model, JSON Pointer data binding, and separate action/error messages. The official [actions guide](https://a2ui.org/concepts/actions/) also requires version-correct action payloads, catalog/schema validation feedback, renderer capability advertisement, and server-side integrity checks.

The [Flutter GenUI SDK](https://github.com/flutter/genui) says it uses A2UI internally, provides `genui_a2a` for A2UI backends, currently supports A2UI v0.9, and requires Flutter 3.35.7 or newer. The current KFC checkout uses a sufficiently new Flutter toolchain, but does not depend on that SDK.

### What qualifies as formal A2UI here

KFC may claim A2UI only when the customer surface:

1. emits a declared official A2UI protocol version;
2. uses official surface/component/data message schemas and lifecycle;
3. declares a catalog ID and renders only catalog-valid components;
4. uses A2UI component IDs/tree references and data-model bindings;
5. processes version-correct A2UI actions and validation errors;
6. advertises renderer capabilities and respects supported catalogs;
7. passes the applicable A2UI conformance/examples with a compliant Flutter renderer or a demonstrably compliant implementation;
8. preserves KFC server-side action capability, state-version, and side-effect safeguards around the A2UI action boundary.

Using terms such as “surface,” “component,” “revision,” “streaming UI,” or “GenUI” does not satisfy this definition.

### Conceptual mapping

| Current/first-rollout KFC concept | Likely A2UI mapping | Compatibility gap |
|---|---|---|
| Run-scoped `surfaceId` | A2UI surface | KFC event envelope is not an A2UI message stream |
| High-level `widgetKind` | Custom catalog component or composition of basic components | No catalog schema or component adjacency list today |
| Per-kind `data` | Surface data model | No JSON Pointer bindings or data-update messages |
| Complete GenUI Revision | Materialized complete state of one A2UI surface | A2UI streams component/data updates rather than KFC snapshot envelopes |
| Action capability | A2UI action event plus KFC server authorization | Current action lacks A2UI source component/context/data-model semantics |
| Flutter handwritten renderer | Custom native catalog renderer | Not an A2UI message processor or GenUI SDK integration |

The mapping is plausible, especially through a KFC custom catalog. It is not wire compatibility and cannot be described as A2UI support.

### Later adoption path

A later, separately approved effort should:

1. choose an exact stable A2UI version rather than following `latest`;
2. define a KFC custom catalog or map each business widget to basic catalog components;
3. build an adapter from authoritative KFC state/capabilities to A2UI surface messages;
4. integrate and theme the Flutter GenUI SDK or prove another renderer compliant;
5. map A2UI action/context payloads back into KFC capabilities without trusting client state;
6. run side-by-side semantic and action-parity tests against the project-owned snapshot path;
7. migrate behind a separate feature flag and remove the old protocol only after parity proof.

Formal A2UI adoption is outside this map’s first-rollout destination, so this decision does not create an A2UI implementation child ticket.

## Required tests and proof

Later implementation/rollout work must cover:

1. Cross-language golden fixtures for every `kfc-genui-v1` kind and action shape.
2. Strict rejection of unknown schema/catalog/kind/status/action/data fields and nested type errors.
3. Stable surface identity, increasing revisions, exact duplicates, conflicting duplicates, gaps, replay, and resync.
4. Atomic reducer updates proving data and actions never mix across revisions.
5. Provisional replacement/clear, authoritative finalization, and rejection of post-authoritative mutation.
6. Final turn text and authoritative snapshot committed exactly once and surviving reload.
7. Action capability ownership, revision/state staleness, expiry, input validation, reservation, duplicate submission, and irreversible idempotency.
8. Stop, supersession, reconnect, backend validation failure, Flutter render failure, and text-only completion.
9. Cue transitions at whole-snapshot boundaries and static reduced-motion behavior.
10. Proof artifacts showing the exact backend revision event, Flutter-rendered revision/digest, final persisted snapshot, and action result correlation.

## Effect on later tickets

- **Design Run Lifecycle, Ordering, Replay, And Recovery Contracts** owns event ordering between text completion, authoritative GenUI finalization, terminal run state, Stop, and supersession.
- **Design Evidence Correlation And Demo Proof** must correlate every rendered `(surfaceId, revision, digest)` with verified source state and the final turn.
- **Design Test Matrix And Feature-Flagged Rollout** owns catalog contract tests, atomic widget/golden tests, action security tests, and text-only fallback promotion gates.

No additional child ticket is required by this first-rollout decision.
