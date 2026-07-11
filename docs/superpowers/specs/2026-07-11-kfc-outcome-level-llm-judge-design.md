# KFC Outcome-Level LLM Judge

## Goal

Add an LLM-based outcome judge to the deployed KFC proof loop. The judge evaluates whether each scripted scenario achieved its intended business outcome, rather than only checking that requests, tools, UI screenshots, and persistence succeeded.

## Scope

The first version evaluates the nine existing F&B scenarios in `ai-talent-tracks/fnb/conversations`. It produces one structured judgment per scenario and adds those judgments to the proof artifacts. It does not change customer-facing responses, tool execution, persistence, or monitor behavior.

## Evidence boundary

For each scenario, the judge receives only evidence collected for that scenario:

- scenario metadata: `id`, `finalState`, `useCases`, and `expectations`;
- ordered customer and assistant turns from the durable transcript;
- observed tool trace and tool results when available;
- delivered GenUI attachment metadata and action IDs;
- durable monitor event types and relevant payload summaries.

The judge must treat the evidence bundle as authoritative. It must not infer an action, order, handoff, payment, or customer outcome that is not present in the supplied evidence.

## Judge contract

The model must return strict JSON matching this shape:

```json
{
  "passed": true,
  "score": 87,
  "achievedOutcome": "...",
  "missedExpectations": [],
  "safetyIssues": [],
  "rationale": "..."
}
```

Validation rules:

- `passed` is boolean;
- `score` is an integer from 0 through 100;
- `achievedOutcome`, `rationale`, and each list item are non-empty strings;
- unknown fields are rejected or ignored through the typed boundary;
- malformed output fails the scenario judgment rather than being repaired by guesswork.

The prompt requires the model to reference observed evidence in its rationale and to distinguish missing evidence from a failed business outcome.

## Gating and scoring

The existing hard gates remain authoritative: deployed release provenance, HTTP success, durable turns, durable events, monitor session visibility, and D1 survival must pass independently.

The LLM judgment adds business-outcome quality:

- `passed=false` blocks acceptance of the scenario judgment artifact;
- `score` supports hackathon reporting and comparison across scenarios;
- safety issues are reported separately and are never hidden by a high score;
- one malformed or unavailable judge response makes the judge phase fail closed.

The judge phase does not silently downgrade to fixture-only or local evidence.

## Artifact and privacy rules

Each proof run writes a redacted `outcome-judgments.json` containing the release identity, scenario IDs, structured judgments, model identifier, and judge timestamp. It excludes API keys, authorization headers, and unnecessary raw customer identifiers. The existing secret scan and checksum steps cover this artifact before publication.

## Testing

Tests will cover:

- strict schema parsing and score bounds;
- prompt construction from scenario evidence;
- malformed, incomplete, and model-error responses failing closed;
- successful judgment artifact generation with deterministic mocked model output;
- release-run integration wiring without requiring a live model in the default test suite.

The opt-in live suites remain separate. A live outcome-judge run will use the workspace `.env`, an explicit model name, and the same deployed proof evidence rather than local fixtures.
