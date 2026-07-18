Status: resolved
Type: task
Labels: wayfinder:task
Parent: ../map.md
Blocked by: 01-audit-gemini-failures-and-shared-planner-seams.md
Assignee: Codex

## Question

Implement the smallest model-agnostic prompt, schema, normalization, validation, or behavior-guard changes that address the audited semantic root causes for every provider. Add at most one shared semantic replan inside the existing deadline, meter every attempt, and fail closed when the second plan is invalid. What focused deterministic tests prove the corrected contract without encoding scenario phrases or Gemini-only behavior?

## Answer

`toolPlannerSemanticContract.ts` now defines the provider-neutral violation codes, validates raw tool schemas and grounded final semantics, and owns the single bounded replan. The retry carries the rejected plan and typed violations through the shared request contract; a second invalid plan returns a tool-less clarification. OpenAI and Vertex retain the same planner behavior and transport telemetry, so every provider request remains metered without a Gemini-only prompt or validator.

The contract rejects malformed tool arguments, invoice fields absent from customer evidence, active-checkout menu discovery with neither catalog evidence nor a distinct grounded query, and handoff reasons without matching structured/state evidence. Raw JSON/schema failures enter the same one-replan path. Existing safe normalization remains shared and does not synthesize rejected commerce values.

Checks:

- Focused semantic and existing planner tests passed 99/99.
- `npm run build` passed.
- `npm run check:architecture` passed at 255 files with the 900-line ceiling; `toolPlanner.ts` is 897 lines.
- `git diff --check` passed.
- The full deterministic suite was intentionally not rerun because the response owner reported an inherited 200-failure harness regression and is preparing a follow-up checkpoint.
