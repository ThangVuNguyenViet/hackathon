Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by:
Assignee: Codex

## Question

What exact shared planner-contract and runtime-state causes produced the retained Gemini failures in scenarios 01 and 06, and which existing shared prompt, normalization, validation, behavior-guard, and replanning seams can correct those causes without a provider-specific semantic fork? Reproduce from retained evidence and current code, classify each failure at the earliest shared boundary, and produce a source-linked repair plan. Do not loosen scenario expectations or implement fixes in this ticket.

## Answer

The source-linked audit is retained in [Gemini Failures And Shared Planner Seams Audit](../assets/gemini-failures-and-shared-planner-seams-audit.md).

The earliest shared semantic boundary is `validateToolCalls`: it checks only whether a tool is known and available, so it accepts semantically unjustified discovery and handoff calls and wrong-but-present tool arguments. The existing graph review loop can carry a prior plan but is not triggered by general semantic violations. The repair is therefore a provider-neutral, typed semantic and per-tool argument validator followed by at most one shared replan; a second invalid plan fails closed. It must not synthesize tool calls or values from wording.

Two failures precede that semantic boundary. Flash-Lite's Scenario 01 final turn was an HTTP 429 and remains a provider reliability failure even if a bounded retry is permitted. Its Scenario 08 empty `catalogSuggestion.itemCode` was a raw-schema failure; the Vertex request schema should prevent the sentinel shape, while arena accounting must continue to distinguish raw adherence from normalization or retry recovery.

The retained Flash report confirms that Scenario 01 failed the exact `collectInvoice` trace assertion, but it did not retain which argument value differed. That field-level detail remains explicitly unverified and must be reproduced before a field-specific repair.
