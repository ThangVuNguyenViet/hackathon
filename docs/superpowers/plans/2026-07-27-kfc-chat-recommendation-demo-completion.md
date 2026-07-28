# KFC Chat Recommendation Demo Completion

## Goal

Complete the KFC recommendation POC on
`codex/kfc-recommendation-poc-implementation`, preserving
`codex/kfc-kiss-model-agnostic` as its base. Phases 0–3 are complete. This
plan implements ML shadow serving, real LangChain/chat/GenUI integration,
and the evidence and qualification loop.

## Global Constraints

- The authoritative customer result remains deterministic. Qualified
  LightGBM and Keras models run in shadow mode and are visible only in
  protected technical evidence.
- Keep semantic routing, tool selection, and customer-language
  interpretation in the configured LangChain `BaseChatModel` and
  `createAgent` loop. Do not add keyword, phrase, or regular-expression
  routing, `StateGraph`, or direct OpenAI SDK orchestration.
- Recommendation tools accept only customer-authorable request fields.
  The executor injects verified session, customer, history, store, cart,
  snapshot, stage, experiment, and policy data.
- Sanity is the runtime merchandising authority. The checked-in snapshot is
  a deterministic test fixture, not a runtime fallback.
- Recommendation actions are one-shot, server-authorized mutations. Natural
  language acceptance never mutates the cart.
- Scenario narratives remain assertion-free and are evaluated independently
  from complete evidence packets.
- Do not add kiosk integration, a dashboard, Streamlit, a custom CMS, a
  fifth recommendation stage, a vector database, a generic Hugging Face
  recommender, a performance SLA, retries, or production outage engineering.
- Never describe synthetic results as real KFC uplift.

## Task 1: Reproduce and Package the Qualified Shadow Models

- Reproduce the Smart Cross-sell LightGBM and Modifier Upsell Keras
  qualification artifacts.
- Fail qualification if the result digests differ from:
  - Smart Cross-sell:
    `e76c7641d48a9f47f0da084ca77f30ceb8df6c31c2ebee65eef15d52c80cda80`
  - Modifier Upsell:
    `75f1d02a4e230e901eb222b26268b255f46842483ad77f04e2192ea74d81de26`
- Add one placement-aware MLflow PyFunc under
  `services/kfc-recommendation-simulator/src/kfc_recommendation_simulator/serving/`.
  It accepts only already-eligible candidate-feature rows and returns action
  ID, calibrated probability, expected-value score, model/calibration/schema
  IDs, and bounded feature contributions.
- Add tests for the PyFunc signature, feature-schema validation, artifact
  digest parity, placement routing, calibration, and deterministic batch
  output.

## Task 2: Add the TypeScript Shadow Scorer and Protected Provenance

- Add a `RecommendationShadowScorer` adapter and request/response contract.
- Default `baseline` mode records shadow comparison without changing customer
  output. Protected `learned_technical` mode may expose learned ordering only
  in admin evidence; no customer request can select it.
- Add:
  - `KFC_RECOMMENDATION_SHADOW_URL`
  - `KFC_RECOMMENDATION_SHADOW_MODEL_REVISION`
  - `KFC_RECOMMENDATION_OUTPUT_MODE=baseline|learned_technical`
- Ensure identical eligible rows reach baseline and shadow rankers, exact
  artifact provenance appears in protected inspection, and shadow service
  unavailability never changes the baseline decision.
- Add configuration to `.env.example`, Worker bindings, readiness output,
  and secret documentation without values.

## Task 3: Make Sanity the Runtime Merchandising Authority

- Add configuration for Sanity project, dataset, API version, and optional
  read token.
- Wire the existing Sanity repository into runtime recommendation
  construction.
- Seed the five checked-in policies through repeatable tooling.
- Keep the local snapshot solely as a deterministic test fixture; do not use
  it as a runtime fallback.
- Add tests for runtime wiring, public reads, replacement, suppression, and
  readiness/provenance reporting.

## Task 4: Replace the Legacy Generic Add-On Tool

- Remove the legacy generic add-on tool completely from types, client, schemas, executor,
  tool boundary, fixtures, prompt, publication, GenUI selection, and tests.
  Add no compatibility alias.
- Add:
  - `recommendStarter({requestKind})`
  - `recommendModifierUpsell({requestKind, parentCartLineId})`
  - `recommendSmartCrossSell({requestKind})`
- The executor injects durable recommendation context and verified domain
  state. The model cannot author those fields.
- `recommendStarter` selects For You only for a linked customer with prior
  completed history; otherwise it selects Local Favorite.
- Derive tool availability from durable recommendation state before every
  agent call. Empty or suppressed attempts consume the placement and return
  a silent typed result.
- Update the system prompt to recommend slightly proactively after genuine
  food/menu/order intent, attach one recommendation at a time, enforce the
  placement sequence, avoid interruptions, and never repeat a proactive
  placement.
- Add backend tests for schemas, availability, prompt publication, placement
  selection, and once-only state.

## Task 5: Implement Backend `recommendationOffer` GenUI and Trusted Actions

- Add `recommendationOffer` to the backend GenUI union. It carries one
  starter/modifier action or a three-to-four-product cross-sell slate,
  verified display facts, cart revision, expiry, decision/version digests,
  and one-shot authority.
- Add a server-only presentation binding that binds the recommendation,
  assistant turn, attachment, rendered positions, action digest,
  customer/session, and cart revision without exposing technical fields to
  the model.
- Publish dynamic action IDs:
  - `recommendation_select:<recommendationActionId>`
  - `recommendation_dismiss`
- Add trusted customer commands that contain only stored recommendation/action
  IDs. Reload and verify one-shot authority and cart revision, then derive
  the exact product or modifier mutation from the stored action.
- On Add, record `selected`, execute the trusted cart mutation, record success
  or failure, and allow the next durable placement.
- On No thanks, record `explicitly_dismissed`, mark all displayed actions
  rejected, and advance the durable stage.
- Record `impression_rendered` once using the exact render binding.
- An unambiguous natural-language decline may dismiss only the current
  pending recommendation; natural-language acceptance never mutates the
  cart.
- Test exact mutation, idempotency, stale/wrong-cart/forged-action rejection,
  impression-after-render, and D1 persistence.

## Task 6: Implement Flutter `recommendationOffer`

- Add `recommendationOffer` to the Flutter GenUI union and parser.
- Render a single starter/modifier card or a three-to-four-card cross-sell
  slate using existing widget chrome.
- Implement Add and No-thanks actions, once-only impression reporting, and
  loading, answered, expired, blocked, and stale-authority states.
- Add parser, unit, widget, and integration tests plus real integration
  screenshots.

## Task 7: Add Sanitized Recommendation Observability

- Add sanitized LangSmith spans for decide, enumeration, eligibility,
  baseline rank, shadow rank, Sanity resolution, persistence, impression,
  and outcome.
- Include only opaque IDs, versions, counts, durations, reason codes,
  policy/model IDs, and digests.
- Keep MLflow/feature contribution evidence as the model evidence surface;
  create no additional dashboard.
- Use protected inspection/order-flow-state APIs for explanations and D1
  Console for raw append-only events.
- Add redaction and correlation tests.

## Task 8: Convert `scenario:live` into the HTTP/D1 Stdin Bridge

- Make `scenario:live` consume:
  - `{"type":"user","text":"..."}`
  - `{"type":"action","assistantTurnId":"...","attachmentId":"...","actionId":"...","payload":{...}}`
  - `{"type":"finish","note":"..."}`
- Forward user turns, verified action references, and optional exact
  client-generated payloads to the running chat HTTP service and D1. The
  bridge validates references and payloads against the active rendered
  attachment but never chooses an action, selection, modifier, address, or
  quantity.
- Keep `recommendation_select:<action-id>` and `recommendation_dismiss`
  reference-only because their complete mutation is already bound to the
  server-issued action. Require payloads for generic menu, modifier, address,
  and cart actions because those selections are created by the client.
- Preserve complete transcript, tool calls, rendered/action references,
  recommendation events, final D1 state, LangSmith correlation,
  model/Sanity bindings, source commit, and environment manifest.
- Keep narrative JSON assertion-free.
- Add HTTP/D1 forwarding and evidence-packet tests.

Attempt-1 qualification evidence exposed three additional runtime contracts
that are part of Task 8/9 completion:

- prioritize the dynamically available `recommendStarter` tool after genuine
  ordering intent, before generic favorites/search exploration, without
  keyword routing;
- represent legitimately absent commerce lifecycle evidence as
  `status: not_applicable`, while retaining `status: missing` for durable
  order/payment state that should have lifecycle evidence; and
- seed scenario 06 store KFCVN0036 through the durable pack-state authority
  consumed by the recommendation tools, not through narrative prose.

## Task 9: Provision, Publish, and Run Live Qualification

- After interactive account authorization, create:
  - public Hugging Face model repo
    `<authenticated-namespace>/kfc-vietnam-recommendation-shadow-20260727`
  - Sanity project `kfc-vietnam-recommendation-poc` with public dataset
    `production`
- Publish immutable model artifacts/manifests at a pinned Hugging Face
  revision.
- Use the approved free runtime profile
  `local_docker_cloudflare_tunnel`: run the verified MLflow Docker image on the
  operator's Mac and expose `/health` and `/invocations` through Cloudflare
  Tunnel.
- Record that the Mac, Docker container, and tunnel process must remain
  running for the demo URL to work. This is operator-managed demo
  availability, not production availability.
- Commit only public IDs, revisions, signatures, qualification digests, and
  file hashes.
- Seed and verify the Sanity published snapshot.
- Recheck the public Cloudflare Tunnel health/inference and LangSmith no-model
  ingestion/queryability.
- Run eight fresh held-out narratives:
  1. Returning customer: For You → add → Modifier dismiss → Smart Cross-sell
     add.
  2. Anonymous customer: Local Favorite.
  3. Modifier accepted.
  4. Modifier empty and skipped.
  5. Sanity replacement.
  6. Sanity suppression.
  7. Explicit customer-requested recommendation after proactive completion.
  8. Once-only enforcement.
- For each narrative, one Codex subagent role-plays turn-by-turn and a fresh
  Codex subagent evaluates only the evidence packet as `successful`,
  `partial`, `unsuccessful`, or `insufficient_evidence`.
- Preserve evaluator citations and all evidence listed in Task 8.
- Treat LangSmith quota failure as an external evidence blocker, not an
  implementation failure.

## Full Gates

- Backend: `npm run check && npm test`.
- Simulator: Ruff, compileall, and unittest suite.
- Flutter: analyze, unit/widget tests, and integration proof.
- Sanity published-snapshot read.
- Public tunnel health and inference probe against the pinned Hugging Face
  model revision.
- LangSmith no-model ingestion/queryability probe.
- Eight Codex role-play/evaluator runs.

## Flagship Acceptance

A returning customer receives For You, adds it, dismisses one Modifier
Upsell, receives one three-to-four-item Smart Cross-sell slate, adds one
item, and receives no further proactive recommendation. Correlated
LangSmith, protected inspection/D1, Sanity, and MLflow/model evidence is
demonstrable.
