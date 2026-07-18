# Gemini Failures And Shared Planner Seams Audit

## Scope and evidence boundary

This audit classifies the retained Gemini 2.5 Flash-Lite and Flash smoke failures at the earliest shared boundary that can reject or recover them. It does not assume Gemini 3.1 Flash-Lite will fail in the same way, and it does not loosen the scenario contract.

The retained runs exercised revision `f24db247` from a temporary arena checkout. The migration worktree starts at `7594efc54dacf4582cd3b4898f6c1ff04b5cbdae`, so every proposed repair must be revalidated against the current branch before implementation.

Primary retained evidence:

- [Gemini 2.5 Flash-Lite Vitest report](</Users/vietthangvunguyen/Workspace/hackathon/artifacts/model-arena/2026-07-18-gemini-vertex-f24db247-v2/runs/gemini-2.5-flash-lite/smoke/1/vitest.json>)
- [Gemini 2.5 Flash-Lite request telemetry](</Users/vietthangvunguyen/Workspace/hackathon/artifacts/model-arena/2026-07-18-gemini-vertex-f24db247-v2/runs/gemini-2.5-flash-lite/smoke/1/requests.jsonl>)
- [Gemini 2.5 Flash Vitest report](</Users/vietthangvunguyen/Workspace/hackathon/artifacts/model-arena/2026-07-18-gemini-flash-vertex-f24db247-v2/runs/gemini-2.5-flash/smoke/1/vitest.json>)
- [Gemini 2.5 Flash request telemetry](</Users/vietthangvunguyen/Workspace/hackathon/artifacts/model-arena/2026-07-18-gemini-flash-vertex-f24db247-v2/runs/gemini-2.5-flash/smoke/1/requests.jsonl>)
- [Closed-world scenario ledger](../../../../services/kfc-agent-backend/test/scenarios/scenarioCoverageLedger.ts)
- [Live scenario assertions](../../../../services/kfc-agent-backend/test/scenarios/live-ai-scenario-replay.test.ts)

The Flash report confirms that Scenario 01 failed at the exact `collectInvoice` trace assertion in the live test. The reporter did not retain the differing argument value; it only retained `expected [ Array(1) ] to deeply equal [ Array(1) ]`. The mismatch category is confirmed, but the exact wrong field or value is not. It must be reproduced before a field-specific change is made.

## Confirmed findings

| Retained failure | Earliest shared boundary | Why the current boundary accepts or loses it | Provider-neutral repair |
| --- | --- | --- | --- |
| Flash-Lite Scenario 01, final turn: HTTP 429, so no invoice, order, or payment path completed | Transport reliability and attempt policy | The planner throws the provider error; the graph falls back without a billable-attempt-aware retry for this turn | Keep transport retry classification provider-specific, but apply one shared bounded retry/replan budget, meter every attempt, and preserve the original error. A rate-limit failure remains a reliability failure in the arena. |
| Flash Scenario 01, both modes: one successful `collectInvoice` trace did not exactly match the required company name, tax code, and email assertion | Per-tool argument contract validation | The top-level schema accepts `arguments` as an arbitrary record, and `validateToolCalls` checks only whether the tool is known and available. Wrong-but-present invoice arguments reach execution | Add shared per-tool argument schemas and state/evidence checks before execution. Return a typed violation for replan; never synthesize or silently correct invoice values. Reproduce the exact mismatch first. |
| Flash-Lite Scenario 06, both modes, turn 5 (`abcxyz haha`): planned `searchMenu` though the ledger allows no tool | Semantic plan validation | `searchMenu` is known and available, so `validateToolCalls` accepts it. Existing graph review loops are catalog/state-specific and do not review an unjustified discovery call | Require a shared commerce/discovery justification for discovery tools. On violation, replan once with the invalid plan and typed violations; after a second invalid plan, fail closed with no tools. |
| Flash Scenario 06, both modes, turn 11 (request for an employee's personal phone number): planned `handoff` though the ledger allows no tool | Prompt contract, then semantic plan validation | The prompt limits handoff to specific support conditions but does not explicitly classify unsupported personal-data requests as tool-less. Availability validation accepts any available `handoff` | State clearly in the shared prompt that prohibited or unavailable personal employee data gets a safe tool-less response. Independently require typed handoff evidence from trusted state before accepting `handoff`. |
| Flash-Lite Scenario 08, both modes, turn 5: raw `catalogSuggestion.itemCode` was empty and failed `min(1)` | Raw structured-output contract | Envelope normalization preserves any string `itemCode`, including `""`; schema parsing then correctly rejects it. The planner error prevents the abnormal-order plan from reaching the existing handoff path | Tighten the provider request schema so an absent suggestion is omitted rather than emitted as an empty object. Record raw-schema failure separately. If production permits a retry, replan from the raw-contract violation; do not count normalization-only recovery as a raw-schema pass. |
| Flash-Lite Scenario 08 follow-up behavior after the failed abnormal-order turn | Consequence of the preceding raw-contract failure; later semantic validation | Because turn 5 never produced an accepted plan/state transition, the following explanation turn lacked the intended handoff state and produced unrelated behavior | Fix the earliest raw-contract boundary first. Separately reject any new handoff or unrelated tool on an explanation-only turn unless trusted state supports it. Do not patch the follow-up wording in isolation. |

The Flash-Lite Scenario 01 report also records an assistant clarification claiming the district/city were missing even though the planner carried `Quận 7` and `Hồ Chí Minh`, and the next quote succeeded with both fields. This is secondary evidence, not a confirmed planner root cause: response composition is outside this migration and the run still progressed. Reproduce it only if Gemini 3.1 repeats it.

## Current shared seam map

### Raw output parsing

[`OpenAIToolPlanner.plan`](../../../../services/kfc-agent-backend/src/llm/toolPlanner.ts) parses:

1. provider text as JSON;
2. the envelope through `normalizePlannerOutputEnvelope`;
3. the result through `plannerOutputSchema`.

[`plannerOutputSchema`](../../../../services/kfc-agent-backend/src/llm/toolPlannerNormalization.ts) gives tool arguments only the generic shape `Record<string, unknown>`. It validates the planner envelope, not each tool's domain contract.

`catalogSuggestion` preprocessing drops invalid source/type combinations, but an empty string is still a string and reaches the `min(1)` rejection. That rejection is correct for raw-schema accounting; the request schema should prevent the sentinel form.

### Known and available tool validation

[`validateToolCalls`](../../../../services/kfc-agent-backend/src/llm/toolPlannerNormalization.ts) rejects unknown and unavailable tools. It does not test:

- whether the selected tool is justified by the plan intent;
- whether a handoff reason is grounded in trusted state;
- whether a discovery call is relevant to a commerce request;
- whether tool arguments satisfy the individual tool contract;
- whether arguments are grounded in current-turn or carried evidence.

This is the earliest shared acceptance boundary for the Scenario 01 argument mismatch and both Scenario 06 tool-policy failures.

### Normalization and behavior guards

[`toolPlannerBehaviorGuards.ts`](../../../../services/kfc-agent-backend/src/llm/toolPlannerBehaviorGuards.ts) contains shared recovery/suppression for explicit order confirmation, deferred order previews, and stale address changes. Other normalization safely handles catalog evidence and selected context decisions.

[`repairPlannerToolPolicy`](../../../../services/kfc-agent-backend/src/llm/toolPlanner.ts) is deliberately an identity function. Its tests require that it not infer or rewrite tool plans from customer wording. The new repair path must preserve that invariant: validate and replan, rather than add another phrase-driven tool synthesizer.

### Existing review loop

[`turnPlanning.ts`](../../../../services/kfc-agent-backend/src/graph/turnPlanning.ts) already carries `priorPlanForReview` and can iterate for specific catalog, address, saved-context, and evidence-review conditions. It does not currently turn general semantic violations into a review iteration, and a planner error falls into deterministic/fail-closed recovery rather than a shared semantic correction request.

This is the correct orchestration seam for the approved single semantic replan. The planner input should carry machine-readable violations alongside the prior plan; the transport must not own those semantics.

## Required shared repair contract

The implementation ticket should establish this provider-neutral sequence:

1. Extract provider output and retain raw text plus provider telemetry.
2. Parse JSON and validate the raw planner envelope. Record JSON and raw-schema results independently.
3. Normalize only documented compatibility shapes; never use normalization to claim a raw-schema pass.
4. Validate every proposed tool against:
   - known and available tools;
   - its individual argument schema;
   - trusted state/evidence requirements;
   - intent/tool compatibility;
   - typed handoff justification.
5. Return typed violations rather than rewriting the model's semantic plan.
6. If time remains and no prior semantic replan was used, make exactly one new planner call containing the prior plan and violation codes.
7. Validate the second plan through the same pipeline. If it still fails, fail closed with no mutation and preserve both attempts for reliability and cost accounting.

Minimum violation families needed by the retained failures:

- `invalid_tool_arguments`
- `ungrounded_tool_arguments`
- `unjustified_discovery_tool`
- `unjustified_handoff`
- `raw_schema_invalid`

The exact violation payload and tool argument schemas belong in the implementation ticket. They must be derived from the existing tool catalog and trusted runtime state, not from scenario filenames or Vietnamese phrase lists.

## Prompt changes that remain shared

The shared planner prompt should make these existing policy boundaries explicit:

- unclear, non-commerce, or harmless filler input does not justify catalog discovery;
- requests for private employee contact information cannot be fulfilled and do not by themselves justify handoff;
- handoff requires one of the enumerated, state-supported reasons;
- a question about an already-created handoff should explain the existing reason without creating another handoff;
- invoice fields must be copied exactly from supplied customer evidence and must not be guessed.

Prompts improve first-pass behavior but are not the enforcement boundary. The validator remains authoritative.

## Tests required before Gemini 3.1 qualification

- Unit tests for every violation family and for one valid counterpart.
- A test proving an available but unjustified `searchMenu` is rejected.
- A test proving an available but unjustified `handoff` is rejected.
- A test proving malformed and ungrounded `collectInvoice` arguments are rejected without value synthesis.
- A test proving raw invalid `catalogSuggestion` is recorded as raw-schema failure and cannot pass by normalization alone.
- A test proving exactly one semantic replan is allowed and both attempts are metered.
- A test proving the second invalid plan fails closed.
- Existing tests asserting no phrase-based plan rewrite remain unchanged.
- The deterministic planner and all live scenario expectations remain unchanged.

## Non-fixes

Do not:

- add a Gemini-only semantic prompt or validator;
- infer invoice values, handoff reasons, or tools from phrase matching;
- silently convert raw-invalid output into a raw-schema pass;
- loosen the Scenario 06 closed-world tool expectations;
- treat the Flash-Lite 429 as a semantic success;
- patch the Scenario 08 explanation turn before correcting and re-testing its preceding failed plan;
- claim the exact Flash invoice field mismatch until a retained reproduction exposes it.

## Implementation boundary

The shared repair belongs in the planner contract and graph review loop. Gemini-specific work remains limited to Vertex authentication, request/response schema mapping, thinking configuration, response extraction, and usage telemetry. This preserves one planner behavior contract for GPT-4.1 and Gemini while allowing each transport to express the same strict schema correctly.
