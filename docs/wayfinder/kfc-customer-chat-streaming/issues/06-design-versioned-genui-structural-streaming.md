Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by: 01-audit-runtime-evidence-available-to-customer-streaming.md, 02-research-run-scoped-streaming-across-flutter-and-backend-targets.md
Assignee: Codex

## Question

How should the existing `KfcGenUiAttachment` and Flutter renderer evolve to support complete, versioned GenUI snapshots during a run? Define snapshot identity, run association, revision ordering, atomic replacement, validation, provisional versus authoritative lifecycle, action availability, persistence of the final immutable GenUI Snapshot, replay, failure, and text-only degradation. Establish what would qualify as formal A2UI in this repo, assess compatibility with likely A2UI component/delta models, and decide whether adoption belongs in this rollout or later. Do not claim that A2UI already exists and do not implement the contract.

## Answer

The [Versioned GenUI Structural Streaming Contract](../assets/versioned-genui-structural-streaming-contract.md) selects project-owned, complete `kfc-genui-v1` snapshot revisions. One stable run surface receives strictly increasing, fully validated revisions that Flutter replaces atomically. Provisional revisions are display-safe but non-actionable; exactly one final authoritative snapshot is persisted immutably with the assistant turn and may expose server-owned, revision/state-bound action capabilities. Invalid or unsupported GenUI degrades to authoritative text without failing the response.

The current fixed `widgetKind`/`data`/`actions` model is conceptually adaptable to an A2UI custom catalog, but it is not A2UI: it has no official protocol messages, catalog, component tree, data bindings, renderer capability handshake, or version-correct action model. Formal A2UI v0.9.x adoption is deferred to a later separately flagged migration; the first rollout must not claim it.
