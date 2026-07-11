Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by: 01-audit-runtime-evidence-available-to-customer-streaming.md, 02-research-run-scoped-streaming-across-flutter-and-backend-targets.md
Assignee: Codex

## Question

How should response composition emit customer-usable text deltas only after verified planning and tool work completes? Investigate the current OpenAI Responses integration and define start, delta, checkpoint, completion, failure, Stop, retry, and partial-text semantics. Decide whether deltas can pass through directly or require buffering or validation, how persisted final assistant text relates to transient partial text, and how the synchronous fallback remains compatible. Produce the architecture contract; do not implement it.

## Answer

The [Text-Delta Streaming And Partial-Response Contract](../assets/text-delta-streaming-and-partial-response-contract.md) rejects direct provider-delta pass-through. OpenAI streams internally, but the backend buffers the full candidate, applies deterministic graph postconditions and validation, commits one Canonical Assistant Text value, and only then emits durable word/grapheme-safe `text_delta` events. This preserves the visible incremental response without making already-visible text retractable or coupling Flutter to provider event taxonomy.

`text_started`, append-only deltas, periodic full-prefix checkpoints, completed full-text snapshots, and incomplete terminal snapshots reduce into a typed Flutter draft. Completed or retained-incomplete assistant turns are materialized exactly once; incomplete text survives reload but is excluded from authoritative business context. Provider failure before commit can fall back safely, transport loss replays the same run, Stop after a visible prefix retains only that prefix, and the synchronous routes share the same canonical text finalizer.
