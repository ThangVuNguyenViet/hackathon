# Text-Delta Streaming And Partial-Response Contract

Research snapshot: current isolated checkout and OpenAI Responses API documentation inspected on 2026-07-11.

## Decision

The first KFC rollout must **not pass OpenAI provider deltas directly to Flutter**. The backend streams the provider response internally, buffers the complete candidate, applies deterministic KFC finalization and validation, selects one canonical customer-safe reply, and only then emits durable, append-only **Customer Text Deltas** over the run event log.

Those customer deltas are word- and grapheme-safe fragments of committed assistant text, not claims that each SSE event corresponds to an OpenAI token. The honest demo language is “the validated response streams into the chat,” not “raw model tokens are forwarded live.”

This preserves the visible Claude/Codex-style reveal while keeping the graph’s verified fallback, clarification, ordering, payment, fulfillment, and other post-composition rules ahead of anything the customer sees.

## Current repo facts

- `OpenAIResponseComposer.composeResponse` sends one non-streaming `POST /v1/responses`, parses a complete `output_text`, trims it, and returns one `string`.
- `composeAndAppendAssistantTurn` can recover to deterministic fallback text when the composer fails and can still replace the composed result for a required fulfillment-address clarification before it appends the assistant turn.
- `conversation_turns` stores one complete `text` value and has no text-draft or completion-status field. `ConversationTurnMetadata` has no incomplete-reply marker.
- `CustomerChatRepository` returns one `Future<CustomerChatResponse>`; `CustomerChatController` appends one completed `CustomerChatMessage`; `CustomerChatMessage` has only final `text` and optional GenUI.
- The existing KFC request idempotency record is written after the complete response. The run-scoped architecture already decided that the new event log must persist each event before delivery and replay by run sequence.
- The current planner `responseClaims` safety check covers selected promotion, payment-success, and allergen claims before composition; it is not a validator of the natural-language candidate produced afterward.

Therefore, changing only `stream: true` and forwarding `response.output_text.delta` would cross the graph’s correctness boundary too early.

## OpenAI streaming findings

The official [Responses streaming reference](https://platform.openai.com/docs/api-reference/responses-streaming/response/output_text/delta) defines ordered `response.output_text.delta` events, a full `response.output_text.done` value, and terminal `response.completed` and `response.incomplete` events. The [OpenAI quickstart](https://platform.openai.com/docs/quickstart) shows `stream: true` and iteration over server-sent events.

The provider stream also contains event families that are not customer answer text, including reasoning, refusal, tool-call, and error/incomplete events. Provider sequence numbers order provider events only; they do not replace the KFC run event sequence or establish customer safety.

## Approaches considered

### 1. Direct provider-delta pass-through — rejected

Forward every `response.output_text.delta` immediately.

- Lowest time to first text.
- Cannot retract a false or policy-incompatible prefix already shown.
- Bypasses current deterministic fallback and post-composition clarification logic.
- Couples Flutter to OpenAI item/content indexes and provider event taxonomy.
- Makes Stop/failure persistence ambiguous when the final provider response is incomplete.

### 2. Sentence-level speculative release — deferred

Buffer until a complete sentence, validate that sentence, then release it while later sentences are still generated.

- Can improve time to first customer text while retaining some validation.
- Sentence boundaries are not semantic safety boundaries: an earlier sentence may depend on a later correction or qualification.
- Vietnamese segmentation, cumulative-claim validation, and restart behavior require a stronger proof suite than the first rollout needs.

This may become a measured optimization only after the committed-text design ships and a separate experiment proves that every released prefix is independently safe and final.

### 3. Full candidate commit, then customer-delta reveal — selected

Buffer the full candidate, finalize it once, then expose it incrementally through the project-owned event log.

- Keeps all current and future deterministic postconditions before first visible text.
- Gives replay, Stop, duplicate suppression, persistence, and synchronous fallback one canonical string.
- Decouples KFC wire contracts from OpenAI event shapes.
- Adds no model-latency improvement; progress UI remains responsible for honestly covering planning, tool, and composition latency.
- Adds a small bounded presentation interval after validation. That interval must be measured and capped rather than stretched theatrically.

## Composition and commit pipeline

```text
verified planning/tool state
        │
        ▼
response_composition_started
        │
        ▼
OpenAI Responses stream (internal only)
        │ output_text deltas buffered
        ▼
provider terminal verification
        │
        ▼
KFC candidate normalization + deterministic validation
        │ valid                       │ invalid/provider failure
        │                             ▼
        │                    verified deterministic fallback
        └──────────────┬──────────────┘
                       ▼
             canonical assistant text
                       │ committed before exposure
                       ▼
        text_started → text_delta* → text_checkpoint* → text_completed
```

### Start boundary

`response_composition_started` may be persisted only after:

- the run is still current;
- planning and all tool work for this response are complete;
- verified state and tool outcomes have been persisted;
- the response intent, verified fallback, allowed facts, and required next action are fixed.

It drives `Đang chuẩn bị câu trả lời…` when perceptible. It contains no model prompt, tool trace, or customer text.

### Provider adapter

The response-composer adapter requests `stream: true` and consumes provider events internally.

- Accumulate only the intended assistant `output_text` content part.
- Never forward reasoning, refusal, tool-call arguments, annotations, provider errors, response IDs, or provider sequence numbers to Flutter.
- Require exactly one supported customer-text output; unexpected multiple text outputs fail closed to the verified fallback.
- Require `response.output_text.done` and a terminal response whose status is completed.
- Treat `response.incomplete`, provider error, malformed SSE, timeout, invalid UTF-8, empty output, and aggregate mismatch as composition failure.
- Abort the provider request when a valid Stop request reaches a composer cancellation safe point.
- Record provider diagnostics only in authorized technical evidence.

### Canonicalization and validation

Before public `text_started`, construct a **Canonical Assistant Text** value:

1. Normalize line endings and Unicode consistently; trim outer whitespace once.
2. Enforce the customer response length contract in code rather than relying only on the prompt.
3. Reject control characters and internal/debug vocabulary.
4. Reject unverified identifiers, amounts, URLs, promotion/payment/order claims, or food-safety certainty outside the allowlist derived from verified state.
5. Enforce the response intent’s required next action and clarification boundary.
6. Apply existing graph postconditions, including the fulfillment-address correction, before commit.
7. If any deterministic check fails, select the already-verified fallback instead of attempting to repair visible text.

The implementation must introduce a typed response contract derived from verified graph state; prompt instructions alone are not validation. This ticket does not require an LLM judge and does not allow an LLM to approve its own output.

The canonical text is immutable after `text_started`. A discovered need to change it before `text_started` produces a new candidate or fallback; after `text_started`, the system may only complete or retain an incomplete prefix.

## Customer run event contract

Every event inherits the run envelope selected by the transport ticket:

```json
{
  "schemaVersion": 1,
  "runId": "run_opaque",
  "sequence": 17,
  "type": "text_delta",
  "occurredAt": "2026-07-11T00:00:00.000Z",
  "payload": {}
}
```

The event log persists an event before SSE or long-poll can expose it.

### `text_started`

Marks that canonical assistant text exists and a customer draft identity has been committed.

```json
{
  "draftId": "draft_opaque",
  "source": "composed"
}
```

`source` is limited to `composed` or `deterministic_fallback`. It is evidence/debug metadata and does not change customer copy. Flutter does not collapse progress until the first non-empty `text_delta`.

### `text_delta`

Appends immutable customer text.

```json
{
  "draftId": "draft_opaque",
  "deltaIndex": 1,
  "text": "Mình đã "
}
```

Rules:

- `deltaIndex` starts at 1 and increases by one within the draft.
- `text` is non-empty and append-only.
- A delta never splits a Unicode grapheme cluster. Prefer word/whitespace boundaries when practical.
- Run `sequence` remains the authoritative cross-event order; `deltaIndex` detects draft-local omissions or accidental mixing.
- Provider tokens, bytes, or chunks have no one-to-one relationship with these deltas.
- Cap a first-rollout reply at 24 delta events. Short replies that fit one natural fragment may complete in one delta.
- Begin the first delta immediately after commit. Any optional pacing must add no more than 750 ms total and must be disabled in reduced-motion mode and deterministic tests.

The cap prevents a short, sub-280-character answer from creating excessive D1 writes merely to simulate token granularity.

### `text_checkpoint`

Provides a durable authoritative prefix for replay verification and future event compaction.

```json
{
  "draftId": "draft_opaque",
  "throughDeltaIndex": 8,
  "text": "Mình đã thêm Combo Hợp Gu 99K vào giỏ.",
  "sha256": "digest_of_normalized_utf8_text"
}
```

- Emit after every eight deltas or approximately 128 grapheme clusters, whichever comes first; omit redundant checkpoints for short replies.
- A checkpoint never introduces text not already represented by prior deltas.
- On a contiguous stream, Flutter verifies that the local draft equals the checkpoint.
- A mismatch or missing delta triggers replay/resync; Flutter does not silently splice conflicting text.
- A checkpoint is a transport/recovery concept, not a visible sentence boundary.

### `text_completed`

Carries the full authoritative reply and binds it to the persisted assistant turn.

```json
{
  "draftId": "draft_opaque",
  "throughDeltaIndex": 12,
  "text": "Mình đã thêm Combo Hợp Gu 99K vào giỏ.",
  "sha256": "digest_of_normalized_utf8_text",
  "assistantTurnId": "turn_opaque",
  "completionStatus": "complete"
}
```

- Persist the completed `ConversationTurn` and `text_completed` event atomically, or use an idempotent recovery record that makes either crash order converge to exactly one turn and one terminal text event.
- The event text and stored turn text must match exactly after canonical normalization.
- Flutter replaces/verifies its active draft from the full text, creates or reconciles the immutable assistant message by `assistantTurnId`, and removes the active draft.
- `text_completed` is not the whole run terminal event; GenUI or other final run evidence may follow according to the lifecycle contract.

### `text_incomplete`

Materializes a customer-visible prefix when Stop, failure, or supersession terminates a draft after at least one delta.

```json
{
  "draftId": "draft_opaque",
  "throughDeltaIndex": 5,
  "text": "Mình đã kiểm tra các combo",
  "sha256": "digest_of_normalized_utf8_text",
  "assistantTurnId": "turn_opaque",
  "completionStatus": "incomplete",
  "reason": "cancelled"
}
```

- `reason` is one of `cancelled`, `failed`, or `superseded`; Flutter maps it to the already-approved customer wording and never prints the wire value.
- Persist an incomplete assistant turn exactly once so refresh and cross-device transcript reload retain the same partial text.
- Store completion status separately from delivery status. `deliveryStatus=sent` does not mean the language generation completed.
- An incomplete turn is transcript evidence, but it is not authoritative evidence of a completed business result. Future context loading must exclude it from verified assistant facts or explicitly mark it incomplete.
- If no delta was exposed, do not create an empty assistant turn; remove the placeholder at terminal reduction.

## Flutter reduction model

Replace `isSending`-only presentation with a typed active draft alongside immutable messages. The future model needs, at minimum:

```text
ActiveAssistantDraft
  runId
  draftId
  text
  lastDeltaIndex
  completionSummary
  connectionState
  lifecycleState
```

Reduction rules:

1. Apply only events for the newest valid customer-visible run.
2. Enforce contiguous run sequence before reducing text.
3. Ignore duplicate run events and duplicate `deltaIndex` values.
4. Append `text_delta`; never reconstruct text from provider tokens.
5. Verify checkpoints; replay on gaps or mismatches.
6. Reconcile `text_completed` or `text_incomplete` by `assistantTurnId` so replay cannot duplicate the transcript message.
7. Freeze the draft during Run Transport Loss and resume from the last applied run sequence.
8. Do not animate individual text fragments; ordinary Flutter text layout renders the growing string.

## Stop, failure, and retry semantics

### Stop before first public delta

- Abort provider composition when safe.
- Emit no text draft or assistant turn.
- Continue through the lifecycle contract to durable cancellation and `Đã dừng.`

### Stop after first public delta

- Stop emitting at a delta boundary.
- Discard the unreleased suffix even though a full canonical candidate may already exist.
- Persist `text_incomplete`, retain the visible prefix, mark `Chưa hoàn tất.`, and remove provisional GenUI.
- Never resume the same draft after durable cancellation.

### Composition failure before commit

- A transient provider failure may receive at most one bounded internal retry while the run remains current and no customer text exists.
- If retry is unsafe, times out, or fails, commit the verified deterministic fallback and stream it through the same customer event contract.
- The customer sees no raw provider failure and no incomplete text.

### Delivery/replay failure after commit

- Do not call OpenAI again and do not invoke the synchronous route.
- Reconnect and replay the already-persisted customer deltas/checkpoints.
- A backend recovery failure that cannot finish the run emits `text_incomplete` when a prefix exists, then the phase-appropriate terminal run failure.

### Manual Retry after terminal failure

Manual Retry is a new run with a new `clientMessageId` unless the original start request was never accepted. It may reuse verified session state, but it does not append to or regenerate the old incomplete draft. Exact Retry eligibility remains owned by the lifecycle ticket.

## Synchronous fallback compatibility

Streaming and legacy routes must share one canonical text finalizer.

- Legacy `/chat/kfc/message` and `/chat/kfc/genui-action` return the full Canonical Assistant Text and persist the same completed turn shape.
- Streaming mode emits deltas and completion from that same value.
- Streaming disabled or explicitly unsupported before run acceptance may choose legacy sync.
- Once a run is accepted, transport errors replay or long-poll that run; they never execute the legacy route.
- Provider composition failure is not a reason to switch transports. The verified deterministic reply uses the already-selected transport.

This provides content equivalence without requiring identical latency or event histories.

## Security and privacy boundary

Only Canonical Assistant Text crosses the customer stream. The following remain internal:

- OpenAI response IDs, provider sequence numbers, model names, token counts, raw SSE events, errors, and incomplete details;
- reasoning/refusal/tool-call event bodies;
- prompts, verified state payloads, tool traces, response-contract allowlists, validator findings, and fallback reasons.

Operator/proof events may record correlation IDs and technical outcomes, but never capability secrets or private prompt/state payloads.

## Required tests and proof

Later implementation and rollout tickets must cover:

1. OpenAI SSE split across arbitrary byte/frame boundaries, duplicate provider events, malformed events, multiple content items, `response.incomplete`, and error terminals.
2. Proof that no customer event is persisted before graph tools/state and response validation complete.
3. Deterministic candidate validation for unsupported order/payment/promotion/allergen claims, unverified IDs/URLs/amounts, missing required clarification, control characters, and length.
4. Grapheme-safe Vietnamese chunking, combining marks, emoji, whitespace, and a maximum of 24 deltas.
5. Persist-before-publish, duplicate suppression, sequence gaps, checkpoint mismatch, replay, and terminal reconciliation.
6. Stop before text, Stop during staged delivery, failure after a prefix, and no empty incomplete turn.
7. Exact equality between `text_completed.text`, its digest, and the persisted completed turn.
8. Incomplete turns surviving reload while remaining excluded from authoritative business context.
9. Content equivalence between streaming and synchronous modes for the same canonical result.
10. Demo telemetry separating provider composition time, validation time, first customer delta, final customer delta, and artificial presentation pacing.

## Effect on later tickets

- **Design Versioned GenUI Structural Streaming** must not treat a text draft as authority for a GenUI revision. Text and GenUI share run order but have separate commit rules.
- **Design Run Lifecycle, Ordering, Replay, And Recovery Contracts** owns terminal event ordering around `text_incomplete`, Stop safe points, Retry eligibility, and supersession.
- **Design Evidence Correlation And Demo Proof** must prove that provider deltas never reach Flutter and that every visible prefix came from committed canonical text.
- **Design Test Matrix And Feature-Flagged Rollout** owns exact pacing thresholds, deterministic clocks, golden/widget tests, and deployed time-to-first-text measurement.

No additional child ticket is required by this decision.
