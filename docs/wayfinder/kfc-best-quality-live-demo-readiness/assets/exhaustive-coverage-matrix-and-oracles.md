# Exhaustive Coverage Matrix And Oracles

## Acceptance definition

The **Scenario Coverage Ledger** is the finite, versioned inventory of named demo behaviors and failure invariants. Each active ledger row owns an input, preconditions and evidence bindings, allowed/required/forbidden tools, permitted state transition, required/forbidden customer claims, surface expectations, provider and persistence evidence, latency limit, and artifact oracle.

Coverage is 100% only when every active ledger row maps to a required deterministic check and each stochastic or deployed behavior also maps to its declared representative live proof. Every required gate must pass on the exact release with no counted skip, quarantine, hidden retry, or manual repair. This is named-contract coverage, not line coverage, every possible utterance, or every catalog permutation through an LLM.

Hard machine oracles decide acceptance. AI judging and screenshots are supplemental and cannot override a failed tool, state, evidence, money, consent, lifecycle, persistence, delivery, or latency oracle.

## Closed-world matrix

| Layer | Required coverage | Hard oracle |
|---|---|---|
| Schema and source guards | Strict provider request/response parsing; explicit environment/provider startup; catalog manifest; production control-plane absence | Reject missing, unknown, malformed, cross-environment, or unbound evidence without coercion or fallback; exact source/version/hash |
| Catalog fixture corpus | Every product and modifier tree in every versioned crawl, including July 7 120/58 and July 10 118/56 | Per-observation raw/canonical hashes; unique IDs; existing parents; complete ancestor paths; exact group min/max/default/quantity, compatibility, prices, and deltas; no cross-version union |
| Current catalog observation | Every item and modifier returned by the configured API for the live/deployed run | Generic schema and relationship invariants pass; observation metadata is recorded and pinned; consequential actions revalidate on change or expiry |
| Price deltas | Every option in each baseline and the current run observation | Exact per-observation arithmetic; standalone prices never substitute for compatible modifier deltas; cross-observation price changes are expected drift, not silent overrides |
| Recommendation | Eligibility, ambiguity, score/fallback, safety rerank, ordinal lifetime, combo equivalence, upsizes, mutation consent | Ineligible candidates never score; at most three choices; no LLM-created candidate/score; exact compatible deltas; no mutation before complete current consent |
| Verified commerce facts | Missing, partial, malformed, stale, conflicting, superseding, outage, startup failure | One environment-bound Verified Commerce Projection; valid independent groups may survive; dependents block; stale is historical only; no surface may infer, upgrade, or contradict |
| Environment isolation | Provider config, identities, state, persistence, idempotency, scenario binding | Cross-environment access is not found; sandbox provider facts are authoritative in sandbox without a customer simulation label |
| Lifecycle provider | Every valid and invalid payment/order/delivery event and cross-machine guard | Exhaust all declared transition edges and all other event/state pairs; invalid input never mutates; terminal states never regress; guarded and atomic transitions hold |
| Idempotency/concurrency | Same key/same input, same key/different input, stale revision, concurrent commands, seal/reset/expiry | Replay original result; fingerprint conflict `409`; one revision winner; no duplicate side effect; expired/sealed `410`; reset creates a new identity |
| Faults/logical clock | Before-commit and after-commit-before-response faults, timeout, malformed/partial response, clock advance | Deterministic scoped fault; commit semantics preserved; logical clock monotonic; wording, queries, retries, and wall time never advance commerce state |
| StateGraph/tools | Twelve-node topology; social, structured-action, commerce, invariant, compose, persist, and monitor paths; every named tool | Exact required/forbidden node and tool sets, arguments, order, and counts; tool evidence precedes claims; social turns do not enter commerce |
| Checkpointing | Confirmation interrupt, crash/resume, duplicate resume, binding change on resume | Durable same-thread resume; re-read current provider/cart/address evidence; stale resume fails closed; exactly one irreversible side effect |
| Persistence | Transcript, graph state, provider audit, dashboard projection, external-message idempotency | Contiguous revisions/events; exactly-once external identity; restart reconstruction; provider/projection agreement; no secret or raw-PII leakage |
| Scenarios 01-08 | The consolidated 44 customer turns execute once through the live planner/composer with GenUI assertions | Exact transcript and UC coverage; per-turn tools, facts, state before/after, cart totals, widget data/actions, and forbidden claims/actions |
| Scenario 09 | Two payment-method turns | Planner and verified method claims only; no cart/order/payment mutation and no `paymentOrderStatus` widget |
| Live boundaries | Small talk, direct-catalog streaming, Worker interruption | No commerce on small talk; verified streamed catalog choices; stale Worker presentation is suppressed and only the winning run persists/delivers |
| Messenger | Same projections as KFC plus signed webhook, queue, outbound delivery, duplicate handling | Semantic fact parity without GenUI assumptions; no second 44-turn LLM replay: feed captured projections through the deterministic Messenger presenter |
| Flutter/backend GenUI | Schemas, trusted actions, golden journey, failure/handoff rendering | Exact item/modifier/money/address/status data; action bound to originating revision; stale action rejected; backend telemetry proves the result |
| Deployment/readiness | Exact clean release, deep readiness, deployed golden and branch runs | SHA, deployment, catalog, environment, and provider bindings agree; five consecutive golden passes and three consecutive branch-matrix passes; any failure resets its count |
| Latency | Every golden step and deployed sample | First progress <=2s; discovery <=8s; structured action/provider mutation <=3s; status <=5s; no step >10s; total <180s with <=165s target; report p50/p95 without replacing absolute gates |

Generate lifecycle cases from the declared transition table with existing Vitest loops: every valid edge once and every other event/state pair as a no-mutation rejection. No new property-testing dependency is needed.

## Representative stochastic catalog cases

Deterministic checks exhaust every versioned baseline and the current proof observation. Live AI uses these six representatives only when current preflight verifies their required contracts:

1. `20702`: nested spicy chicken and burger, two independent +3,000 VND Pepsi groups, and 129,000 -> 135,000 VND.
2. `41141`: one-item burger with the verified +8,000 VND cheese modifier.
3. `20691`: group recommendation with the unique +27,000 VND popcorn option.
4. `41074`: a simple leaf product with no modifier inference.
5. `41140` with a required spicy constraint: it cannot satisfy the request because its verified modifier is cheese.
6. An ambiguous group-combo request: show at most three without mutation; accept a direct current ordinal reply and reject it after a relevant revision change.

Removed `20751`/`20752` and corrected `41160` at 5,000 VND are deterministic drift gates, not additional live permutations.

## Short-paraphrase policy

Do not add a second replay. Tag examples inside the single 44-turn scenarios 01-08 corpus so it contains three genuinely distinct short forms for each of eight families: discovery/recommendation; exact/ambiguous/ordinal/pronoun selection; required modifier/incompatibility; add/replace/upsize consent; full/saved/incomplete address; payment method/status/negated confirmation; order/delivery status/cancel/reorder; and allergen/safety/complaint/handoff.

The 24 tagged examples remain part of the 44 turns. Each family includes a fragment, a natural question or imperative, and a colloquial or context-dependent form; punctuation-only or synonym-only rewrites do not count. Scenario 09 remains two additional planner-only payment-method turns.

## Oracle record

Every ledger row declares: input; preconditions and evidence bindings; allowed, required, and forbidden tools with argument constraints; state before and permitted transition; required and forbidden text facts; GenUI widget/data/actions and forbidden actions; Messenger projection; provider state/revision/audit; checkpoint and persistence revisions; latency; and required trace/artifact files. Tool and commerce-claim checks are closed-world: an unexpected tool or fact fails even when all required ones are present.

## Execution rules

- Deterministic gates and counted live/deployed passes have zero test-level or model/provider retries.
- Pre-run readiness and idempotent artifact reads may retry at most three times before the counted journey; every attempt is recorded. A retry belongs inside acceptance only when it is the named injected-fault case.
- Live suites may stay opt-in during ordinary `npm test`; the release command fails if any required test is skipped.
- Quarantine never counts. It requires an owner, reason, expiry, and replacement ticket.
- Any flake, timeout, hidden retry, manual repair, incomplete artifact, unsupported fact, fallback, or contradiction fails the run and resets the applicable consecutive-pass count.
- Run live scenario cases with `it.concurrent.each` and `maxConcurrency=2`. Each owns a unique session, customer binding, Lifecycle Scenario Instance, idempotency namespace, trace ID, and artifact directory. Keep normal deterministic Vitest parallelism; `maxWorkers` is not the general live-case control.

## Judges, screenshots, and artifacts

Code oracles decide release readiness. AI judges may score tone, helpfulness, concise Vietnamese, or semantic quality only after hard oracles pass; record judge model, prompt, rubric, input hash, and raw result. Screenshots prove rendering, while structured widget data, action telemetry, and backend/provider state remain authoritative.

One immutable run manifest records schema and coverage-contract versions; run ID/command/times/concurrency; git SHA and clean-tree flag; deployment ID/URL and release hash; Commerce Environment and redacted provider fingerprint; catalog source/version/validators/raw/canonical/derived hashes; scenario/prompt/tool/graph/ranker/model versions; Lifecycle Scenario Instance and logical clock; every ledger ID/result; tool traces, provider audit/revisions, checkpoints and persisted event ranges; per-turn latency and p50/p95; retries/skips/quarantine/manual intervention; GenUI payloads/actions, Messenger delivery IDs, Flutter build/device; trace URLs and screenshot hashes; readiness, pass-streak position, failures, redaction, and shutdown. Replace obsolete `dependencyClass: simulated` with environment plus provider implementation/provenance metadata.

## Confirmed checkout gaps

- The current fixture set is the July 7 120/58 observation, while the later researched capture is 118/56. They are not yet modeled as a versioned fixture corpus, so scenarios can accidentally treat historical `20751`/`20752` as current.
- The consolidated live replay correctly runs the scenarios 01-08 44 turns once, keeps scenario 09 planner-only, and uses `it.concurrent.each` with `maxConcurrency=2`.
- Live GenUI mostly asserts scenario-level widget presence; exact per-turn data/action/forbidden-state contracts are incomplete.
- The Flutter capture plan still expects a payment widget for scenario 09 and disagrees with live expectations elsewhere.
- The twelve-node graph still uses `MemorySaver`; durable confirmation interrupt/resume proof is absent.
- Current commerce proof is process-local and labeled `simulated`; it is not the durable environment-scoped lifecycle provider.
- Runtime still defaults commerce mode to fixtures instead of failing startup on missing explicit provider configuration.
- Messenger covers adapter/auth/idempotency and isolated output, not the complete projection-parity matrix.
- Proof scripts contain internal HTTP/trace retries that must be separated from counted attempts and reported.

## Smallest implementation sequence

1. Introduce a versioned catalog-observation/fixture-corpus contract; preserve the July 7 120/58 fixture, add the July 10 118/56 fixture, test their drift, and make runtime/live proofs fetch and pin the configured API observation instead of selecting either fixture as current.
2. Materialize the Scenario Coverage Ledger and one deterministic completeness test for unmapped active rows.
3. Implement deterministic environment/fact/lifecycle/recommendation matrices with existing Vitest and transition tables.
4. Add durable LangGraph confirmation checkpoint/resume and exactly-once checks.
5. Align scripts with the approved golden facts and strengthen the existing consolidated live replay; do not add another live matrix.
6. Feed the same Verified Commerce Projections into Messenger and Flutter proof surfaces, retaining only their small external boundaries.
7. Complete deployment/readiness/manifest gates, then run the required consecutive pass streaks on one exact release.

## Primary references

- [LangSmith evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts)
- [LangSmith evaluation types](https://docs.langchain.com/langsmith/evaluation-types)
- [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- [Vitest maxConcurrency](https://vitest.dev/config/maxconcurrency)
- [Vitest concurrent tests](https://vitest.dev/api/test#test-concurrent)
- [XState testing](https://stately.ai/docs/testing)
