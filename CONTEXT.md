# KFC Conversational Ordering

This context defines the domain language for the KFC conversational ordering assistant, its live monitor, and operator handoff workflows.

## Language

**Commerce Environment**:
An isolated `production` or `sandbox` provider deployment with its own configuration, credentials, identities, state, evidence, and persistence under the same customer contract. A successful configured sandbox response is authoritative within sandbox and is not a lower-authority data class.
_Avoid_: Real-data flag, simulation label, shared production/sandbox state

**Catalog Observation**:
A versioned result fetched from the configured menu provider in the current Commerce Environment, identified by provider version or validators, canonical hash, retrieval time, and provider-defined expiry. It is current only within those bindings. A recommendation, cart, or proof run pins one observation for internal consistency and revalidates consequential actions when the provider reports change.
_Avoid_: Permanent menu snapshot, fixture as runtime truth, unversioned menu response

**Catalog Baseline Fixture**:
An immutable captured Catalog Observation used only for deterministic parser, compatibility, arithmetic, and drift regression tests. The fixture corpus may contain multiple observations, each retaining its own version and provenance; they are never unioned into a synthetic catalog. No baseline is runtime authority or a substitute for a current menu-provider response.
_Avoid_: Current menu, release catalog, production truth

**Lifecycle Scenario Instance**:
A unique, expiring sandbox provider execution bound by trusted server context to one scenario-definition version, release, Catalog Observation, customer, and session, with durable revisioned payment, order, and delivery state.
_Avoid_: Reusable scenario name, customer-supplied scenario ID, LangGraph thread

**Lifecycle Provider Event**:
An authenticated typed event that advances one Lifecycle Scenario Instance through a permitted guarded transition and appends its durable audit evidence.
_Avoid_: State assignment, customer wording, status-query count, elapsed wall time

**Order Stage**:
The operator-facing lifecycle position of a monitored customer session as it moves from gathering order details through cart readiness, fulfillment/payment issues, and confirmed order state.
_Avoid_: Order state, status, latest event

**AI Automation Confidence**:
The system's confidence that the AI can continue handling a monitored customer session without human takeover.
_Avoid_: Confidence, model confidence, planner confidence, customer risk

**Risk Level**:
The operator-facing severity of a monitored customer session based on current customer, payment, fulfillment, safety, or handoff conditions.
_Avoid_: Confidence, priority

**Priority Rank**:
The ordering signal used by the live monitor to decide which sessions should appear first for operator attention.
_Avoid_: Risk, confidence

**Interruption**:
A newer customer message that arrives before an assistant reply is delivered and should steer the pending response. The latest pending customer intent wins until an irreversible side effect has happened.
_Avoid_: Cancellation, retry, duplicate webhook, multi-agent routing

**Irreversible Side Effect**:
An action that the assistant must not silently undo during interruption, including placed orders, payment-link creation, handoff, confirmed voucher/reward acquisition or redemption, and delivered human-agent messages.
_Avoid_: Any tool call, cart preview, menu lookup

**Irreversible Attempt**:
A reserved external action that has crossed its execution boundary but whose committed, failed, or uncertain outcome must still be recorded or reconciled.
_Avoid_: Successful side effect, tool proposal, reversible mutation

**Committed Outcome Receipt**:
The customer-facing acknowledgement that a newer response must include when an earlier superseded run already produced an irreversible committed outcome.
_Avoid_: Duplicate action, stale reply, internal run summary

**Reversible Cart Mutation**:
A cart change that may be corrected during interruption because no irreversible side effect has happened yet. The final delivered reply should describe the corrected cart state, not the stale intermediate mutation.
_Avoid_: Order cancellation, payment cancellation

**Pre-Order Cancellation**:
A customer message that cancels the current ordering attempt before an irreversible side effect has happened. It abandons the pending ordering intent without human handoff or error handling, while preserving the transcript.
_Avoid_: Refund, post-order cancellation, webhook failure

**Post-Commit Follow-Up**:
A customer message that arrives after an irreversible side effect has happened. It does not replace the completed action; the assistant handles it in the context of the placed order, payment link, handoff, or delivered human message.
_Avoid_: Interruption replacement, silent undo

**Human-Paused Session**:
A session where a human agent has taken over. Customer messages are persisted for the human/operator flow and do not trigger normal AI interruption or coalesced AI replies until AI is explicitly resumed.
_Avoid_: Interruption, AI auto-reply

**Unsupported Attachment**:
A customer attachment that the ordering assistant cannot use as structured ordering input. It is persisted and may receive a short text-request acknowledgement, but it does not steer or cancel a pending text-based ordering response.
_Avoid_: Interruption, order evidence

**Latest Run Typing State**:
The customer-facing typing indicator for the newest valid AI run in a session. Superseded runs must not turn typing off while a newer valid run is still pending.
_Avoid_: Per-message typing state, stale run typing state

**Run Transport Loss**:
Loss of the customer's live connection to an ongoing AI run without changing that run's intent or lifecycle; reconnect observes the same run from durable evidence.
_Avoid_: Run cancellation, interruption, supersession, failure

**Customer-Safe Agent Progress**:
The single active customer-facing description of verified work for the newest valid AI run, replaced as evidence advances and collapsed to one completion summary.
_Avoid_: Step history, raw tool status, planner trace, chain-of-thought

**Customer Response Block**:
The single transcript surface for one assistant run as it moves from claim-free waiting through verified progress into partial or completed customer-facing text and GenUI.
_Avoid_: Typing bubble, progress log, separate loading message

**Canonical Assistant Text**:
The immutable customer-safe reply selected after verified work, deterministic response rules, and validation complete, before any part of that reply becomes visible.
_Avoid_: Raw model output, provider token stream, mutable draft

**Customer Text Delta**:
An append-only, grapheme-safe fragment of Canonical Assistant Text delivered through the customer run stream.
_Avoid_: OpenAI token, network chunk, speculative prefix

**Incomplete Assistant Turn**:
A durable customer-visible prefix retained when an assistant reply terminates after text became visible but before the canonical reply completed delivery.
_Avoid_: Failed delivery status, completed assistant reply, authoritative business outcome

**Natural Coalesced Reply**:
A customer-facing assistant reply that addresses the latest pending customer intent without exposing internal run coordination. It may mention a correction when useful, but must not describe supersession or coalescing mechanics.
_Avoid_: Superseded run, coalesced batch, internal steering

**Pending Customer Intent**:
The latest unresolved customer intent formed from one or more steering text messages before an assistant reply is delivered or an irreversible side effect commits.
_Avoid_: Raw webhook event, duplicate retry, individual text only

**KFC Source**:
The first-party Flutter customer chat surface for KFC-owned ordering, treated as an operator-visible conversation source with the same backend, transcript, monitor, handoff, and proof expectations as Messenger and Zalo.
_Avoid_: Retired mock-only source, fixture chat, demo chat, hidden web session

**GenUI Snapshot**:
The immutable customer-facing attachment stored with an assistant turn, including its identity, lifecycle/status, widget kind, title, data, and available actions.
_Avoid_: Widget hint, regenerated UI, current state projection

**GenUI Surface**:
The stable logical customer UI region associated with one assistant run and replaced only by ordered revisions from that run.
_Avoid_: Widget instance, transcript attachment ID, app screen

**GenUI Revision**:
A complete validated candidate state of a GenUI Surface with a monotonic revision identity; it remains provisional until one revision becomes the final GenUI Snapshot.
_Avoid_: JSON patch, partial component tree, mutable snapshot

**A2UI Compliance**:
Conformance to a declared official A2UI version across its surface messages, component catalog, data model, actions, capability negotiation, validation, and renderer behavior.
_Avoid_: Any generative UI, custom JSON widget, A2UI-inspired

**GenUI Action Capability**:
An action the customer is authorized to invoke because it was offered by a GenUI Snapshot delivered in the same session, including its allowed inputs, lifecycle, and applicable session-state version.
_Avoid_: Arbitrary client action, UI event name, trusted client payload

**Idempotent Replay**:
The repeated observation of the original completed outcome when the same session request identity and canonical intent are submitted again, without repeating assistant reasoning or side effects.
_Avoid_: New customer turn, regenerated answer, automatic retry with new identity

**Action Reservation**:
The exclusive claim that binds one single-use GenUI Action Capability to the customer request that began consuming it, preventing another request from performing the same action concurrently.
_Avoid_: Completed side effect, action result, UI disabled state

**Durable Session Fingerprint**:
The canonical identity and content summary of a persisted conversation's turns, GenUI Snapshots, evidence events, and monitor projection, used to prove that the same session survives runtime replacement without replay or recalculation.
_Avoid_: Screenshot identity, browser cache, runtime object snapshot, regenerated summary

**Evidence Correlation Envelope**:
The shared identity fields that join one customer request and run across durable events, UI observations, persisted outcomes, monitor projections, traces, and proof artifacts.
_Avoid_: Timestamp-only join, filename convention, dashboard session only

**Proof Run**:
One controlled execution of the complete acceptance scenario inventory against one declared build and runtime configuration, producing one immutable evaluated artifact bundle.
_Avoid_: Application run, agent run, selected passing screenshots

**Diagnostic Rerun**:
A targeted proof execution used to investigate one scenario or contract slice that cannot satisfy full acceptance by itself.
_Avoid_: Acceptance replay, consolidated passing proof, smoke test

**Scenario Candidate**:
A PM-curated fixed text customer-turn trajectory and its acceptance criteria, stored in a LangSmith dataset after human review of production or evaluated traces. Assistant replies and GenUI actions are observed evaluation evidence, not authored expected behavior; the candidate does not change repo-owned executable scenario contracts unless engineering ports it manually.
_Avoid_: Accepted test, executable scenario, automatic test source, demo-site record, golden assistant transcript

**Showcase Scenario**:
A Scenario Candidate published in the designated LangSmith showcase dataset and therefore listed on the public but unlinked `/demo` route. It may originate from a repo-owned scenario contract, but publication alone does not mean the current candidate is covered by executable repo tests.
_Avoid_: Tested scenario, test fixture, production trace, demo-site record

**Showcase Replay**:
A public, unauthenticated execution started from a Showcase Scenario's mode-specific Replay action, automatically feeding each fixed customer turn into a new isolated deployed-assistant session only after the preceding assistant response completes. GenUI and text-only modes use the same assistant capabilities, tools, sandbox fixtures, and customer trajectory; only response presentation differs. Only the initiating browser observes the active attempt, and a failed attempt cannot replace that mode's latest complete result. Replays do not curate scenarios or establish test acceptance.
_Avoid_: Recorded playback, mocked assistant transcript, scenario editor, acceptance run, proof run, production conversation

**Showcase Result**:
The server-persisted latest complete transcript and GenUI evidence produced by a Showcase Replay for one scenario and response mode. It loads on page open and remains visible until a newer replay completes, so an interrupted or failed browser-local attempt cannot replace the presentation-safe result; `/demo` displays its acceptance criteria without assigning a new pass/fail judgment and identifies the generation time, response mode, deployed release, model names, and LangSmith trace.
_Avoid_: Canned transcript, partial replay, accepted fixture, proof artifact, demo-generated test verdict

**Streaming Capability**:
A Flutter client build's declared ability to participate in the complete versioned customer-run streaming contract; it does not by itself grant rollout eligibility.
_Avoid_: Feature cohort, server assignment, partial streaming support

**Streaming Assignment**:
The persisted server decision, made before run acceptance, that one customer request uses either the streaming or legacy response path under a named rollout-policy revision.
_Avoid_: Flutter-local flag, per-event routing, mid-run fallback

**Streaming Acceptance**:
The durable boundary where a customer request receives a run identity and streaming ownership, after which reconnect and terminal recovery must observe that run rather than invoke the legacy response path.
_Avoid_: Open socket, first progress event, client capability

**Legacy Response Path**:
The completed-response customer-chat operation retained for requests that are not accepted as streaming runs.
_Avoid_: Post-acceptance retry, reconnect fallback, duplicate execution

**Promotion Gate**:
The required deterministic, live-proof, health, and observation evidence that must pass before a larger KFC-source cohort receives Streaming Assignment.
_Avoid_: Release date, successful screenshot, diagnostic rerun

**Verified Catalog Media**:
An official KFC-hosted image reference whose source, associated catalog entity, and current reachability have been verified before it is offered to a customer.
_Avoid_: Scraped image, inferred image, fallback artwork, generic food image

**Media Decision Point**:
A customer turn where verified imagery materially helps the customer choose or confirm a menu item, modifier, promotion, or first cart summary.
_Avoid_: Every assistant reply, decorative image, repeated product image

**Text-Only Degradation**:
The customer experience used when Verified Catalog Media is absent, invalid, or cannot be delivered; the factual text response remains available without substituted imagery.
_Avoid_: Placeholder image, invented image, generic fallback

**Catalog Media Intent**:
The ordered, persisted set of Verified Catalog Media selected for one assistant turn at one Media Decision Point, with customer text remaining authoritative.
_Avoid_: GenUI Snapshot, platform payload, image attachment, gallery

**Media Delivery Outcome**:
The per-channel result of attempting a Catalog Media Intent, tracked independently from delivery of the assistant's authoritative text.
_Avoid_: Assistant reply status, GenUI render state, image availability

### Product Recommendations

**Product Family**:
A customer-recognizable product concept that may have one or more orderable Sellable Items across catalog authorities or variants.
_Avoid_: SKU, item code, cart line

**Sellable Item**:
An orderable catalog identity with an app-owned stable identifier and typed aliases for provider item, product, POS, and catalog codes.
_Avoid_: Product Family, POS item ID, array position

**Recommendation Placement**:
A named point in an ordering journey where one recommendation mode may present ranked products or modifiers, such as local favorites, modifier upsell, smart cross-sell, or single upsell.
_Avoid_: Screen, widget, recommendation type

**Recommendation Candidate**:
A product or modifier eligible to compete for presentation at one Recommendation Placement in one ordering context.
_Avoid_: Entire catalog, displayed recommendation, arbitrary item

**Modifier Action**:
An exact orderable modifier change identified by its parent Sellable Item, recursive modifier-group path, option identity, and requested action.
_Avoid_: Bare modifier ID, modifier label, UI selection

**Commerce Snapshot Set**:
The immutable, version-bound combination of catalog, modifier graph, stores, availability, and promotion observations used to evaluate one recommendation request.
_Avoid_: Current database state, mutable fixture set, provider response

**Eligibility Policy**:
The authoritative rules that determine whether a Recommendation Candidate is valid for the current catalog, store, time, basket, promotion, modifier relationship, and dietary constraints.
_Avoid_: Model preference, ranking score, merchandising boost

**Eligibility Decision**:
The version-bound eligible or ineligible result for one Recommendation Candidate, including typed reason codes and the authoritative evidence evaluated by Eligibility Policy.
_Avoid_: Ranking result, merchandising exclusion, availability guess

**Recommendation Ranker**:
A learned or statistical decision-maker that orders eligible Recommendation Candidates by expected value for the current ordering context.
_Avoid_: Eligibility Policy, catalog search, generative explanation

**Merchandising Policy**:
An authored instruction that may exclude, boost, pin, or replace recommendations for a scoped placement, store group, time window, or campaign, while remaining subject to Eligibility Policy.
_Avoid_: Model training label, hidden prompt rule, client-side override

**Recommendation Decision Source**:
The declared authority that produced a displayed recommendation set: merchandising override, learned ranker, or fallback.
_Avoid_: Model name, UI source, undocumented heuristic

**Recommendation Decision**:
A version-bound ordered recommendation result produced for one request before any client has confirmed that it was rendered.
_Avoid_: Recommendation Impression, basket mutation, model prediction alone

**Recommendation Impression**:
The recorded presentation of a versioned recommendation set to one anonymous ordering session, including placement and candidate positions, from which selection, rejection, cart, and checkout outcomes can be attributed.
_Avoid_: API response, model prediction, page view

**Ordering Journey**:
An opaque anonymous ordering boundary that owns one cart progression, recommendation experiment assignment, impressions, and outcomes until checkout, explicit abandonment, or a declared cart reset.
_Avoid_: Chat session, customer identity, individual recommendation request

**Recommendation Non-Selection**:
The journey-end observation that a displayed candidate was not selected; it is distinct from an explicit customer rejection and from an unobserved candidate.
_Avoid_: Rejection, negative preference, missing label

**Recommendation Outcome Event**:
An append-only attributed fact after an Impression, such as selection, explicit rejection, non-selection, basket mutation result, removal, checkout, or abandonment.
_Avoid_: Mutable recommendation status, inferred conversion, API response

**Simulator Oracle**:
Synthetic-only hidden potential outcomes and response probabilities used to evaluate whether a ranker recovers the behavior planted in a versioned simulated world.
_Avoid_: Training feature, serving input, observed customer outcome
