Status: resolved
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 07-design-the-exhaustive-coverage-matrix-and-oracles.md
Assignee: Codex

## Question

How will one backend-backed first-party KFC Proof Run demonstrate the approved golden journey and all KFC branch scenarios with matching short text, GenUI actions, cart snapshots, modifier selections, fulfillment address, payment evidence, order and delivery status, persisted turns, graph/tool traces, lifecycle-provider events, latency, and screenshots/video? Define clean-session setup, backend URL fail-closed behavior, action provenance, exact per-turn assertions, artifact manifest and SHA/snapshot/environment binding, retries and failure semantics, teardown, and human-readable reporting. Local unbound repository output must be impossible to mistake for a pass against the configured backend and Commerce Environment.

## Resolution

Use one immutable **KFC Proof Run** bound to one clean deployed release, one first-party Flutter build, one sandbox Commerce Environment, and one current Catalog Observation. It contains two counted parts: the approved golden journey runs serially through the real Flutter customer surface, and scenarios 01-08 run once as the existing consolidated 44-turn live planner/GenUI matrix with unique sessions and `maxConcurrency=2`. Do not replay those 44 model turns in a second Flutter suite. Persist their GenUI Snapshots once, then launch the Flutter client against those durable sessions to render and capture the exact stored snapshots without invoking the planner again. Scenario 09 is not part of this proof; it remains planner-only payment-method coverage.

### Admission and clean setup

The counted command requires explicit KFC app URL/build, `KFC_AGENT_BACKEND_URL`, Commerce Environment, proof-control credentials, expected backend and Flutter git SHAs, deployment IDs, and expected provider fingerprint. It must not auto-start localhost, substitute repository fixtures, insert a local proxy, or silently fall back when any value is absent. Local or filtered runs are **Diagnostic Reruns** and their manifest and report must say `acceptanceEligible: false`; their exit success cannot be presented as a KFC Proof Run pass.

Before the counted clock starts, the harness:

1. verifies both releases are clean, exact-SHA deployments and deep readiness identifies the expected sandbox environment and lifecycle provider;
2. fetches the configured menu API, validates every returned item and modifier relationship, records the resulting Catalog Observation metadata and hashes, and pins that observation to the run;
3. verifies `20702` still has the approved 129,000 VND base configuration, two compatible +3,000 VND drink upsizes, and all required spicy selections; a mismatch fails preflight rather than selecting either the July 7 120/58 or July 10 118/56 Catalog Baseline Fixture;
4. creates a unique run ID and, for each golden or branch case, a unique customer, session, LangGraph thread/checkpoint namespace, Lifecycle Scenario Instance, idempotency namespace, trace ID, and artifact directory; and
5. confirms no prior durable turns, cart, order, payment, provider events, or active human pause exist for those identities.

Every captured crawl, including the July 7 120/58 and July 10 118/56 observations, remains a separate deterministic regression input only. All corpus versions are recorded as tested, but none is copied into a live session or used as runtime fallback. If the provider reports catalog expiry or a new version during the counted run, the next consequential action must re-fetch and compare all referenced item, modifier, price, and availability facts. Any relevant change fails this run and requires a fresh preflight/run under the new observation; the UI must never silently retain old values.

### Golden journey machine oracles

Drive the exact five short customer questions and structured choices resolved in [Define The Three-Minute Short-Turn Golden Journey](./02-define-the-three-minute-short-turn-golden-journey.md). At each checkpoint, assert customer text, canonical assistant text claims, GenUI Snapshot, offered capability, provider evidence, persisted state, and visible Flutter rendering agree:

| Checkpoint | Required evidence | Forbidden result |
|---|---|---|
| Discovery | Current observation supplies `20702`; `smartMenuPicker` identifies it at 129,000 VND and exposes only its current compatible item/modifier choices | Cart mutation, unavailable choice, fixture provenance, or unsupported price/claim |
| Explicit add | Trusted selections are `41036`, `41042`, `41063`, `60254:70012` twice, `60258:70443`, `4:41090`, and `5:41090`; cart revision 1 contains one `20702` totaling 129,000 VND | Mutation before action, missing required group, incompatible option, or client-invented item/value |
| Two-drink upsize | `modifierPicker` offers both current +3,000 VND replacements; the submitted action replaces `4:41090`/`5:41090` with `4:41091`/`5:41091`; cart revision 2 totals 135,000 VND | One-sided/duplicate upsize, retained medium choice, inferred delta, or total other than 135,000 VND |
| Fulfillment | Provider accepts and normalizes the approved Sunrise City address, assigns `KFCVN0058`, revalidates item availability, returns 18,000 VND fee and 25-minute ETA; `addressFulfillmentCheck` offers `accept_fulfillment` | Address/store/fee/ETA before evidence, stale-catalog continuation, or acceptance before customer action |
| Payment choice and review | Fresh methods include `zalopay_wallet`; `paymentMethodPicker` selection leads to `orderReviewConfirm` showing the exact modifiers, address, store, 135,000 VND subtotal, 18,000 VND fee, 153,000 VND total, and ZaloPay | Selecting a method creates an order/payment, hidden value change, or confirmation capability on incomplete evidence |
| Confirmation | One single-use `confirm_order` capability produces exactly one `KFC-1001`, `created`, `pending`, and the provider payment URL; identical replay observes that result without a second side effect | Placement before confirmation, duplicate order/payment link, or client-supplied identity/amount |
| Paid query | A provider callback changes `pending -> paid`; a fresh query precedes matching text and `paymentOrderStatus` | Paid inferred from wording, polling count, clock, or UI state |
| Order query | Authenticated lifecycle event changes the same instance to `preparing`; a fresh query precedes matching text and `orderTrackingStatus` | Unbound order status or payment/order contradiction |
| Delivery query | Authenticated lifecycle event changes the same instance to `delivering` with 15-minute remaining ETA; a fresh query precedes matching text and `orderTrackingStatus` | Unsupported ETA, skipped lifecycle evidence, or a terminal/regressive transition |

First visible progress must be at most two seconds, discovery at most eight seconds, each structured action/provider mutation at most three seconds, and each status query at most five seconds. Any step over ten seconds or total duration at least 180 seconds fails; the stage target remains at most 165 seconds.

### Branch matrix oracles

The Scenario Coverage Ledger is the source of truth for all 44 scenario 01-08 user turns. Each row must assert the exact source turn and use-case tags; required, allowed, and forbidden graph nodes/tools with arguments and counts; evidence versions; state before/after; cart contents, modifiers, revisions, subtotal/fee/discount/total; required and forbidden text facts; widget kind, complete validated data, and exact available/forbidden action IDs; lifecycle revision/event; durable input/assistant turns; checkpoint and monitor-event correlation; and latency. Unexpected tools, facts, mutations, widgets, or actions fail even when required values are present.

Every branch response and GenUI Snapshot is captured from that single consolidated live execution. Flutter then proves that each persisted snapshot can be rehydrated and rendered at its source turn; it captures all 44 rendered turn states plus every exercised action before/after state. Rendering never regenerates the snapshot or calls the model. Hard state/tool/provider/action oracles decide acceptance; screenshots and an uninterrupted golden-journey video prove presentation only and cannot override a machine failure.

### Action provenance and negative actions

For every offered or invoked GenUI Action Capability, record the attachment/surface ID, source assistant turn, session, environment, Catalog Observation, graph checkpoint, cart/provider revisions, action ID, server-authored value and input schema, canonical request/idempotency ID, reservation, result, and before/after hashes. The backend must resolve the stored active capability and ignore client attempts to invent item codes, prices, modifiers, method IDs, order IDs, or amounts.

The proof exercises stale revision, cross-session attachment, tampered payload/value, duplicate request, same key/different payload, and concurrent single-use confirmation. These must produce the declared rejection/replay without state mutation; only one confirmation reservation may reach the provider. Every structured action is correlated through the Evidence Correlation Envelope from Flutter request to graph path, tool/provider audit, persisted turns, monitor projection, and final GenUI Snapshot.

### Manifest and artifacts

Write an immutable directory with:

- `manifest.json`: schema/ledger versions; run identity and acceptance eligibility; command; start/end; zero-retry counters; clean git SHAs; deployment IDs/URLs/release hashes; Flutter build/device/OS; environment and redacted provider fingerprint; Catalog Observation source, validators, retrieval/expiry, raw/canonical/derived hashes; baseline fixture-corpus versions tested; model/prompt/tool/graph/ranker versions; every session/thread/lifecycle binding; and every artifact SHA-256;
- `catalog-observation.json`: redacted current observation metadata plus full validation/drift result, never a fixture substituted as current;
- `golden/result.json`, `golden/turns.json`, `golden/actions.json`, `golden/provider-audit.json`, `golden/checkpoints.json`, `golden/trace.json`, checkpoint screenshots, and one uninterrupted video;
- `branches/<scenario>/result.json`: the per-turn ledger oracles, structured GenUI payloads/actions, traces, persisted turns/events, provider audit, latencies, and links to all 44 rendered screenshots and action screenshots; and
- `report.md`, `failures.json`, redaction report, teardown result, and a checksum file covering every artifact.

Tokens, credentials, payment URLs with secrets, and raw customer PII are redacted; stable proof identities and evidence hashes remain joinable. `report.md` begins with an unambiguous `PASS`, `FAIL`, or `DIAGNOSTIC — NOT ACCEPTANCE`, then summarizes release/environment/catalog bindings, golden checkpoints, 44/44 branch status, widget/action coverage, latency p50/p95 and absolute breaches, retries/skips/manual intervention, failures, and direct artifact links.

### Retry, failure, and teardown semantics

Counted customer turns, model calls, structured actions, and provider mutations receive one attempt. Up to three readiness polls or immutable artifact reads are allowed before the counted run and are listed individually. There is no model retry, test retry, screenshot selection, state repair, or continuation after a hard oracle failure. A failure remains preserved in its manifest; investigation uses a new explicitly diagnostic run, and a later pass never overwrites it.

On completion or failure, stop capture, flush traces/events, fetch final durable projections, seal every Lifecycle Scenario Instance, close Flutter/backend connections, and verify no proof task is still running. Do not delete evidence or reset shared provider state. Teardown failure makes the run fail.

The existing checkout does not yet satisfy this contract: `run-live-genui-integration-proof.ts` can auto-start a local fixture-backed server or interpose a proof proxy, independently replays all 46 scenario 01-09 turns, and passes mostly on screenshots plus scenario-level widget presence. Its telemetry checks omit most exact data/action, provenance, persisted graph/checkpoint, provider-event, environment/catalog, latency, release, and checksum oracles. Implementation should strengthen the already consolidated 44-turn live replay and convert the Flutter path to durable-session render/action proof, not add another live-AI replay or another proof framework.
