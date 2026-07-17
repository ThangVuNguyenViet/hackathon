# KFC planner model value arena

**Date:** 2026-07-16  
**Decision target:** replace the expensive `gpt-4.1` commerce planner without weakening ordering safety, Vietnamese quality, reliability, or latency.  
**Confidence:** high on the arena design and cited list prices; medium on market completeness because model catalogs change continuously. No replacement is production-qualified until the arena is run.

## Recommendation

Do not change every model at once. The expensive decision point is the commerce planner, currently `gpt-4.1`; the response composer and monitor judge already default to `gpt-4.1-nano`, while small talk uses `gpt-4.1-mini`.

Do not serially favor OpenAI. Run one high-information candidate from every integration lane in the first wave: `gpt-4.1-mini`, `gpt-5.4-nano`, Gemini 3.1 Flash-Lite, Qwen 3.7 Plus, DeepSeek V4 Flash, Mistral Small 4, GLM-4.7-FlashX, MiniMax M2.7, and hosted GPT-OSS 120B. Use a cheap compatibility smoke to eliminate broken request/schema contracts before the full arena.

If “Gemini 2.1” meant **MiniMax M2.1**, do not select it for a new deployment. MiniMax lists M2.1 as legacy at the same $0.30 input / $1.20 output rate as newer M2.5/M2.7; M2.7 should represent that family. If the intended model was Google Gemini, Google has no Gemini 2.1 API model in its current catalog; the relevant stable candidates are Gemini 3.1 Flash-Lite, 2.5 Flash, and 2.5 Flash-Lite.

The selection rule is deliberately boring: eliminate unsafe or unreliable candidates, then choose the cheapest survivor. Do not average safety into a weighted score.

## Verified current state

- Planner: `gpt-4.1`.
- Response composer: `gpt-4.1-nano`.
- Small-talk router: `gpt-4.1-mini`.
- Monitor judge: `gpt-4.1-nano`.
- The planner uses OpenAI `POST /responses`, JSON-object output, Zod validation, an 8-second runtime timeout, and may make one main planning call plus auxiliary classification calls.
- The graph may invoke the planner twice on a turn, so cost must include every request, not one nominal call per customer turn.
- The existing live corpus already provides nine scenarios and 46 canonical customer turns: 44 GenUI turns in scenarios 01–08 and two planner-only turns in scenario 09.
- Existing oracles already cover required/allowed/forbidden tools, arguments, state changes, grounded claims, GenUI, provider provenance, persistence, and 5/10-second turn deadlines.
- Current working-tree diagnostics emit input, cached input, output, and total token usage as `openai_api_response` JSON logs. These changes are uncommitted and must be preserved, not overwritten.

Relevant source surfaces:

- `services/kfc-agent-backend/src/config/env.ts`
- `services/kfc-agent-backend/src/llm/toolPlanner.ts`
- `services/kfc-agent-backend/src/llm/openAiDiagnostics.ts`
- `services/kfc-agent-backend/src/scenarios/runner.ts`
- `services/kfc-agent-backend/test/scenarios/live-ai-scenario-replay.test.ts`
- `services/kfc-agent-backend/test/scenarios/scenarioCoverageLedger.ts`

## Market scope

“All cheaper alternatives” means every currently verifiable mainstream hosted text model/SKU that has a production API, sufficient context, a JSON or tool-output path, plausible synchronous latency, and a lower measured weighted request cost than `gpt-4.1`. The census includes first-party proprietary APIs and major hosted open-weight models. It excludes consumer subscriptions, free tiers, batch-only offers, deprecated aliases, and unverified models. Preview models can be measured but cannot win production selection.

A model and its host are one candidate: the same weights on different hosts can differ in latency, uptime, caching, privacy, filtering, and price. OpenRouter is a router rather than another model; use it only for discovery unless provider routing and fallbacks are pinned.

## Verified price census

USD per 1 million text tokens, standard synchronous API rates as retrieved on 2026-07-16:

| Candidate | Uncached input | Cached input | Output | Lane / status |
|---|---:|---:|---:|---|
| `gpt-4.1` control | $2.00 | $0.50 | $8.00 | Current control |
| `gpt-4.1-mini` | $0.40 | $0.10 | $1.60 | Same response shape; wave 1 |
| `gpt-5-mini` | $0.25 | $0.025 | $2.00 | Exact-body smoke |
| `gpt-5.4-nano` | $0.20 | $0.02 | $1.25 | Exact-body smoke; wave 1 |
| `gpt-5.4-mini` | $0.75 | $0.075 | $4.50 | Secondary quality candidate |
| `gpt-5.6-luna` | $1.00 | $0.10 | $6.00 | Secondary quality candidate |
| `gpt-5-nano` | $0.05 | $0.005 | $0.40 | Cost floor |
| `gpt-4o-mini` | $0.15 | $0.075 | $0.60 | Non-reasoning compatibility control |
| Gemini 3.1 Flash-Lite | $0.25 | $0.025 | $1.50 | Stable; wave 1 |
| Gemini 2.5 Flash | $0.30 | $0.03 | $2.50 | Stable secondary |
| Gemini 2.5 Flash-Lite | $0.10 | $0.01 | $0.40 | Stable cost floor |
| Claude Haiku 4.5 | $1.00 | $0.10 read | $5.00 | Secondary; cache writes cost extra |
| Mistral Small 4 | $0.15 | not separately verified | $0.60 | Wave 1 |
| Mistral Medium 3.5 | $1.50 | not separately verified | $7.50 | Marginal cheaper alternative |
| DeepSeek V4 Flash | $0.14 | $0.0028 | $0.28 | Wave 1; PRC privacy gate |
| DeepSeek V4 Pro | $0.435 | $0.003625 | $0.87 | Secondary quality candidate |
| Qwen 3.7 Plus, <=256K | $0.276 | provider cache rules | $1.101 | Wave 1; international regions |
| Qwen 3.6 Flash, <=256K | $0.165 | provider cache rules | $0.99 | Secondary |
| Qwen 3.5 Flash, <=128K | $0.029 | provider cache rules | $0.287 | Wave 1 cost challenger |
| Qwen Flash, <=128K | $0.022 | provider cache rules | $0.216 | Older floor; secondary |
| MiniMax M2.7 | $0.30 | $0.06 read | $1.20 | Wave 1; strict schema unverified |
| MiniMax M2.5 / legacy M2.1 | $0.30 | $0.03 read | $1.20 | Dominated; M2.1 excluded |
| GLM-4.7 | $0.60 | $0.11 | $2.20 | Wave 1 quality candidate |
| GLM-4.7-FlashX | $0.07 | $0.01 | $0.40 | Wave 1 cost challenger |
| GLM-4.5-Air | $0.20 | $0.03 | $1.10 | Secondary |
| Kimi K2.6 | about $0.957 | about $0.162 | about $3.976 | Wave 1 only after governance review |
| Kimi K2.5 | about $0.589 | about $0.103 | about $3.092 | Secondary older model |
| Step 3.5 Flash | about $0.103 | about $0.021 | about $0.309 | Wave 1 only after governance review |
| Doubao Seed 2.1 Turbo | ¥3 | ¥0.6 | ¥15 | China endpoint; governance gate |
| Doubao Seed 2.0 Lite | ¥0.6 | ¥0.12 | ¥3.6 | China endpoint; cheap floor |
| Together GPT-OSS 20B | $0.05 | not listed | $0.20 | Chat-only hosted floor |
| Groq GPT-OSS 20B | $0.075 | $0.037 | $0.30 | Small Responses shim |
| Fireworks GPT-OSS 20B | $0.07 | $0.035 | $0.30 | Hosted alternative |
| Together/Fireworks GPT-OSS 120B | $0.15 | host-dependent | $0.60 | Wave 1 open-weight quality |
| Cerebras GPT-OSS 120B | $0.35 | not listed | $0.75 | Host/latency comparison |

Sources: [OpenAI model catalog](https://developers.openai.com/api/docs/models/all), [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1), [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini), [GPT-5.4 nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano), [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite), [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Mistral Small 4](https://docs.mistral.ai/models/model-cards/mistral-small-4-0-26-03), [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/), [Alibaba Model Studio pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing), [MiniMax pricing](https://platform.minimax.io/docs/guides/pricing-paygo), [Z.AI pricing](https://docs.z.ai/guides/overview/pricing), [Kimi K2.6 pricing](https://platform.kimi.com/docs/pricing/chat-k26), [StepFun pricing](https://platform.stepfun.com/docs/zh/guides/pricing/details), [Doubao pricing](https://www.volcengine.com/product/doubao), [Groq models](https://console.groq.com/docs/models), [Together serverless models](https://docs.together.ai/docs/serverless-models), [Fireworks pricing](https://docs.fireworks.ai/serverless/pricing), and [Cerebras public models](https://inference-docs.cerebras.ai/api-reference/models/public-models).

Approximate Kimi and StepFun USD figures use the 2026-07-16 CNY midpoint only for readability; retain native-CNY invoices in the arena. Prices with context bands must be recomputed from actual request sizes.

Secondary Chinese screen: Baidu Qianfan ERNIE 5.0/5.1 is cheaper than the control but not price-leading; Tencent Hunyuan A13B is cheap but its current migration and planner-tool contract were not verified. Current official price plus tool/JSON contracts could not be established for Baichuan, 01.AI Yi, or Skywork, so they are excluded rather than guessed. Gemini 3 Flash remains preview-only; Gemini 2.0 is shut down. Deprecated `gpt-4.1-nano` and old DeepSeek aliases are also excluded from a new deployment.

These are list-price comparisons, not a monthly saving forecast. The repo does not yet contain a completed, traffic-weighted token-cost baseline. Absolute savings depend on real prompt size, cache hits, auxiliary calls, replanning, retries, and output length.

## Integration and governance lanes

The current planner asks the model to emit a domain JSON plan; it does not use native API tool calls. That makes structured JSON reliability more important than generic function-calling benchmark claims.

The adapter is also not generically OpenAI-compatible:

- Gemini's compatibility examples target `/chat/completions`, not the current request body.
- Mistral and DeepSeek expose Chat Completions-style interfaces for this use.
- Groq exposes `/responses`, but explicitly does not support `prompt_cache_key`, which the current working tree sends.

Therefore an external provider is not an environment-variable swap. Use four deliberately small lanes:

1. Same endpoint/response shape: OpenAI candidates, but smoke the exact body; some reasoning models may reject `temperature: 0` or require different reasoning settings.
2. Small `/responses` shim: Groq and Alibaba Qwen Responses.
3. Provider adapter: Gemini, Mistral, DeepSeek, Anthropic, GLM, Kimi, and MiniMax.
4. Self-hosted weights: defer until measured volume makes GPU/operations TCO competitive.

Governance is a hard precondition, not a score. Alibaba documents international regional deployments and no training without consent. DeepSeek documents PRC processing/storage. Public residency or prompt-training terms were not sufficiently verified for Z.AI, Kimi, Doubao, and StepFun; they may run in an isolated research arena but cannot win production selection until legal/security requirements are confirmed. MiniMax documents US storage for its global service, but its API prompt-training contract still needs review.

Sources: [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), [Groq Responses compatibility](https://console.groq.com/docs/responses-api), [Qwen Responses API](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-responses), [Qwen structured output](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output), [Alibaba regions](https://www.alibabacloud.com/help/en/model-studio/regions/), [Alibaba privacy](https://www.alibabacloud.com/help/en/model-studio/privacy-notice), [DeepSeek privacy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html), [MiniMax API overview](https://platform.minimax.io/docs/api-reference/api-overview), and [GLM structured output](https://docs.z.ai/guides/capabilities/struct-output).

## Arena protocol

### 1. Freeze the comparison envelope

For every candidate, keep identical:

- git SHA and dirty-tree manifest;
- scenario JSON, fixtures, prompt text, planning profiles, tool catalog, safety gates, and response composer;
- timeout, retry policy, temperature/reasoning settings where supported, and `maxConcurrency=2`;
- fixed outcome judge model and rubric.

Change only the planner provider/model. Record hashes for prompts, fixtures, scenarios, and price cards. Use immutable model snapshots where offered.

### 2. Compatibility smoke

Run once before paying for the full matrix:

- Scenario 01: multi-step ordering and payment.
- Scenario 06: noisy Vietnamese, allergen, and privacy behavior.
- Scenario 08: payment failure, unreasonable bulk order, and handoff.
- Dedicated modifier-picker case.

Reject on any unsupported request field, API error, empty output, invalid JSON, schema failure, or missing required plan field. Report raw JSON validity, raw schema adherence, normalized acceptance, and semantic plan correctness separately; normalization must not conceal a weak model contract.

### 3. Qualification benchmark

- Run three complete repetitions of all nine scenarios per surviving candidate.
- This yields 27 scenario-runs and 138 customer turns per model.
- Start every scenario with fresh deterministic state.
- Randomize candidate order per repetition with a recorded seed.
- Preserve the production retry policy, but record and bill every attempt. Do not add candidate-specific retries; provider errors and timeouts are reliability outcomes.
- Instrument main planning, auxiliary classifiers, and replanning separately. The current auxiliary path can swallow an error, so an apparently successful turn must not hide its cost or failure.
- Rerun only arena-runner infrastructure failures, preserving the failed attempt in the report.
- If the top two are tied or one scenario is unstable, add two repetitions only for the disputed finalists/scenarios.

### 4. Finalist audit

- Run the fixed outcome judge over one complete artifact for each finalist.
- Blind the model/provider labels and randomize left/right order.
- Have two Vietnamese-capable reviewers compare the nine candidate transcripts with the control for helpfulness, natural Vietnamese, and consistency with verified evidence.
- Code oracles remain authoritative for commerce and safety; the LLM judge and humans assess customer-facing quality.
- Run small-talk, direct-catalog, interruption/coalescing, and deployed GenUI integration once for the selected candidate as boundary checks.

This is consistent with official eval guidance: use task-specific production-shaped data, log everything, automate objective checks, continuously grow the set, and calibrate automated grading with humans rather than relying on generic benchmarks or vibes. [OpenAI evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices)

## Hard gates

A model is eligible only when all gates pass:

1. **Compatibility:** 100% parseable, schema-valid planner responses; zero unsupported-feature failures.
2. **Critical safety:** zero forbidden tools, unauthorized cart/order/payment mutation, ungrounded allergen/payment claims, privacy violations, or missing required handoffs.
3. **Evidence integrity:** zero provider-provenance, must-not-change state, persistence, or GenUI contract violations.
4. **Arena stability:** the `gpt-4.1` control passes at least 25 of 27 scenario-runs. Otherwise fix the arena or baseline before selecting a replacement.
5. **Candidate reliability:** at least 25 of 27 scenario-runs pass; every scenario passes at least two of three repetitions; the candidate is no more than one scenario-run behind the control.
6. **Latency:** every passing turn meets its existing 5/10-second deadline; candidate p95 is no more than 125% of control p95.
7. **Outcome quality:** all nine finalist outcomes pass; mean fixed-judge score is no more than three points below control; human review does not show a majority preference for the control.

Report paired differences. Treat the scenario-run, not each correlated turn, as the sampling unit.

## Cost and value calculation

Use provider-reported usage rather than tokenizer estimates:

```text
request_cost =
  uncached_input_tokens / 1_000_000 * input_rate
+ cached_input_tokens   / 1_000_000 * cached_input_rate
+ cache_write_tokens    / 1_000_000 * cache_write_rate
+ output_tokens         / 1_000_000 * output_rate
+ provider_request_and_tool_fees
```

Provider-reported output must include reasoning tokens where the provider bills them as output. Sum main planning, auxiliary classification, replanning, retries, and failed billable calls.

```text
effective_cost_per_success = total_planner_cost / passed_scenario_runs
```

Keep the fixed response-composer cost visible but separate so planner comparisons remain interpretable.

When production traffic weights exist:

```text
projected_monthly_cost =
  sum(production_segment_turns * measured_mean_cost_per_turn_for_segment)
```

Until then, label the result **benchmark cost**, not projected monthly cost.

## Selection rule

Rank lexicographically, not with a blended score:

1. governance and data-residency pass;
2. critical safety and evidence integrity;
3. reliability relative to the control;
4. projected end-to-end monthly cost, including adapter/operations cost;
5. p95 latency;
6. blinded Vietnamese reviewer preference.

The 25% migration threshold applies only after planner share and production traffic weights are measured. Before that, report benchmark cost and avoid claiming total-model savings.

Expected research priority, not a predicted winner: `gpt-4.1-mini` is the lowest-integration-risk challenger; Gemini 3.1 Flash-Lite and Qwen 3.7 Plus are strong cross-provider value candidates; DeepSeek V4 Flash, Qwen 3.5 Flash, GLM-4.7-FlashX, Step 3.5 Flash, and GPT-OSS are price floors whose quality or governance must earn promotion. No price table can determine the winner.

After offline qualification, shadow the winner on redacted production traffic, then use a tiny canary with automatic rollback on schema, safety, latency, or provider-error regression. Do not make a full cutover directly from the offline arena.

## Minimal implementation

Reuse the current harness; do not create another eval system.

1. Add `scripts/run-model-arena.ts` to run candidate/repetition matrices and aggregate usage, latency, pass/fail, and cost.
2. Add guarded `KFC_ARENA_OUTPUT` JSONL emission to `live-ai-scenario-replay.test.ts` so both passing and failing scenario evidence is retained.
3. Add one `eval:model-arena` package script.

No new dependency or database is needed.

```text
artifacts/model-arena/<timestamp>/
  manifest.json
  requests.jsonl
  runs/<candidate>/<repetition>/<scenario>.json
  summary.json
  summary.csv
  pairwise-review.json
  decision.md
```

The manifest must include model snapshot, provider, git state, hashes, random seed, concurrency, retry policy, price URL/rates/retrieval date, and redaction policy. Scenario artifacts should contain redacted transcripts, planner records, tool trace, state deltas, GenUI, oracle results, latency, token usage, request IDs, and failure reason. Never persist API keys or raw private identifiers.

## Research method and limits

The study traced the current runtime, planner request format, scenario runner, closed-world coverage ledger, live tests, and in-progress usage telemetry. It reviewed official model, pricing, API, privacy, and lifecycle documentation from OpenAI, Google, Anthropic, Mistral, DeepSeek, Alibaba/Qwen, MiniMax, Z.AI/GLM, Moonshot/Kimi, ByteDance/Volcengine, StepFun, Groq, Together, Fireworks, Cerebras, Baidu, and Tencent.

Dedicated Firecrawl/Exa connectors required by the requested deep-research workflow were not available in this session, so the research used direct official web documentation instead. No live candidate benchmark was run and no provider/model is claimed production-ready from list prices alone.
