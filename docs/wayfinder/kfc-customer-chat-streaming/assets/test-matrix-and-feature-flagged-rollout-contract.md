# Test Matrix And Feature-Flagged Rollout Contract

This contract resolves the acceptance, release-control, fallback, rollback, and promotion decisions for the first implementation of KFC customer-chat streaming.

## Decision

Ship the streaming experience as one server-assigned capability with a master rollout mode, one independently suppressible provisional-GenUI capability, and a client build-capability guard. Keep the existing synchronous customer-chat path available only for requests that have not been accepted as streaming runs.

Promotion is evidence-gated, not calendar-only. Every widening step requires deterministic contract tests, backend-backed Flutter integration proof, the complete credentialed live-AI Proof Run, healthy production metrics for the current cohort, and no unresolved severity-0 or severity-1 defects. A config-only rollback stops assigning new streaming runs; already accepted runs drain or terminate through the streaming lifecycle and never retry through the synchronous path.

The first release covers only the KFC first-party Flutter chat. Messenger, Zalo, formal A2UI compliance, and unrelated monitor redesign remain outside this rollout.

## Current repo findings

- The Flutter customer app currently has one compile-time backend URL, `KFC_AGENT_BACKEND_URL`; it has no streaming capability or rollout flag.
- `BackendCustomerChatRepository` exposes completed-response `Future` operations for messages and GenUI actions. This is the legacy synchronous path that the rollout retains as a pre-acceptance fallback.
- The backend has environment-driven controls for other behavior, including interruption, but no customer-chat streaming rollout policy.
- The current Flutter package uses `flutter_test` and `integration_test`; Patrol is not declared. Existing customer-chat unit, widget, golden, and integration-test surfaces should be extended rather than introducing a second end-to-end framework solely for this feature.
- The current CI workflow builds the backend, runs a selected backend regression set, analyzes Flutter, and runs `flutter test test/features/customer_chat`.
- The current manually dispatched live GenUI workflow loops through nine scenario filters as separate executions, requires LangSmith credentials, and consolidates their artifacts. That is useful current coverage but does not meet the agreed single-execution Proof Run contract.
- Cue is not yet a Flutter dependency. Its addition, reduced-motion behavior, and deterministic animation testing remain implementation work behind the client capability guard.
- The Worker has build/deploy and dry-run commands, but the repo does not currently expose a dynamic remote-config service. The first rollout therefore uses server environment/config bindings and accepts that changing the kill switch requires a config-only deployment.

## Approaches considered

### 1. Server-assigned staged rollout — selected

The server decides the path before accepting a request, using a stable persisted session assignment and client capability declaration.

Benefits:

- one authority decides whether a request becomes a streaming run;
- assignment cannot change during an active run;
- cohorts, allowlists, and rollback are observable centrally;
- old client builds naturally remain on the synchronous path;
- no duplicate agent execution is required for shadowing.

Cost:

- requires a small rollout-policy contract and persisted assignment evidence;
- the initial environment-backed kill switch is config-deploy speed rather than instant remote-config speed.

### 2. Flutter-only feature flag — rejected

This is simple but cannot centrally protect incompatible backend versions, prove cohort assignment, or stop old clients from using an unsafe streaming endpoint.

### 3. Big-bang replacement of the synchronous endpoint — rejected

This removes the safest fallback before replay, Stop, reconnection, and structural-streaming behavior have production evidence. It also makes rollback vulnerable to duplicate side effects.

## Release-control model

### Client capability guard

The new Flutter build declares whether it is capable of the complete customer-run contract. The capability defaults to false in builds until explicitly enabled. It is not a percentage rollout and it is not the source of cohort truth.

The implementation should expose a build-time capability such as `KFC_CUSTOMER_CHAT_STREAMING_CAPABLE`. The exact identifier may follow repo configuration conventions, but its semantics are fixed:

- false or absent: use the synchronous repository only;
- true: request server path selection before starting the customer operation;
- never switch an already accepted run because the local flag changes;
- include app version and supported stream schema versions in the start request and Proof Run manifest.

### Server rollout mode

One server-owned mode controls assignment for new requests:

| Mode | New eligible sessions | Existing accepted runs |
| --- | --- | --- |
| `off` | synchronous only | continue or terminate by streaming contract |
| `internal` | streaming only for an explicit internal allowlist | unchanged |
| `cohort` | stable percentage cohort plus allowlist | unchanged |
| `on` | all capable KFC-source sessions | unchanged |

The backend configuration should include:

- master mode;
- stable cohort percentage when mode is `cohort`;
- privacy-safe internal allowlist identifiers;
- minimum and maximum supported client stream schema versions;
- provisional GenUI revisions enabled/disabled;
- rollout-policy revision included in every assignment and proof artifact.

Do not add independent percentage flags for progress and text. They share one reducer and lifecycle and must roll out together. Provisional GenUI may be suppressed independently because the agreed degradation is authoritative text plus the final validated GenUI Snapshot.

### Stable assignment

Assignment is selected before run acceptance from the capable client, KFC source, allowlist, and a privacy-safe stable bucket. Persist the chosen path and policy revision with the session/request evidence.

Rules:

- one active run never changes paths;
- retries with the same request identity observe the original assignment and outcome;
- a newer request may receive a newer policy assignment only when no prior accepted run ownership is being reused;
- ineligible schema versions receive an explicit synchronous selection before streaming acceptance;
- cohort assignment must not depend on timestamps, process-local randomness, or Flutter-local choice.

### No duplicate shadow execution

`internal` and `cohort` modes select one execution path. Do not run synchronous and streaming agents in parallel to compare them: duplicate tool work could create duplicate irreversible effects. Pre-release shadow validation may emit the new evidence projection from the same legacy execution, but it must not execute a second agent run and cannot count as customer streaming acceptance.

## Streaming acceptance boundary and fallback

The backend start response must make one of three outcomes unambiguous:

1. `legacy_selected`: no streaming run was accepted; Flutter may call the existing synchronous operation with the same customer intent and request identity.
2. `stream_accepted`: a durable run identity and replay cursor exist; all further observation, reconnect, Stop, failure, and completion use that run.
3. `start_rejected`: no run was accepted and the reason is explicit; Flutter may use the synchronous path only when the rejection is classified fallback-safe.

Fallback-safe pre-acceptance reasons include disabled rollout, unsupported client schema, and unavailable stream infrastructure before any run or side-effect reservation is created.

After `stream_accepted`:

- transport loss means reconnect and replay, not synchronous retry;
- timeout means observe the same run, not start another execution;
- Stop, failure, cancellation, or supersession must reach an explicit terminal outcome;
- an uncertain irreversible attempt must be reconciled before another request can repeat it;
- the app may degrade presentation to retained text/final snapshot, but may not change execution ownership to the legacy endpoint.

## Required test layers

Here, **deterministic** means the test harness controls inputs, identifiers, timing, connection loss, and failures so the same contract case is repeatable. It does not mean production replies are hard-coded or that the production agent stops being generative. Credentialed live-AI replay remains a separate required acceptance layer.

### Backend deterministic tests

Run with fake provider/tool adapters, controllable clocks, deterministic identifiers, and fault-injectable persistence/transport boundaries.

Required suites:

- schema validation and backward/forward compatibility for start responses, customer events, snapshots, Stop, and terminal outcomes;
- customer-safe projection from only verified runtime evidence, including suppression of planner, policy, trace, tool arguments, and technical errors;
- durable contiguous sequence allocation under concurrent appends;
- request idempotency, duplicate start, duplicate event observation, and duplicate GenUI action submission;
- replay from cursor, expired cursor resync, gap detection, out-of-order rejection, and authoritative snapshot repair;
- lifecycle transition legality, phase-aware Stop availability, cancellation, supersession, failure, and committed-outcome acknowledgement;
- action reservation, irreversible-attempt fencing, reconciliation, and exactly-once customer materialization;
- canonical text validation, grapheme-safe deltas, checkpoint consistency, incomplete-turn retention, and final-text equality;
- complete GenUI revision validation, monotonic revisions, atomic replacement, capability/state-version checks, final snapshot equality, and text-only degradation;
- rollout assignment stability, allowlist precedence, unsupported schema selection, policy-revision persistence, and master-off behavior;
- metrics and evidence-envelope completeness, including fail-closed behavior when required identities are missing.

The stable backend CI command remains serial Vitest while that is the repo's reliable mode: `npm test -- --maxWorkers=1 --no-file-parallelism`. The implementation should add the streaming suites to the normal backend job rather than hiding them behind live credentials.

### Flutter unit tests

Use typed fixtures at the repository boundary. Required suites:

- decoding every supported event and rejecting unknown incompatible schema versions;
- reducer application for contiguous events and duplicate suppression;
- gap detection, cursor persistence, reconnect/backoff, replay, and authoritative resync;
- newest-run-only presentation and stale terminal-event suppression;
- progress-family projection, immediate claim-free waiting, completion-summary collapse, and forbidden-detail absence;
- append-only Customer Text Delta reduction, grapheme safety, checkpoints, incomplete text, and exact final text;
- GenUI revision ordering, atomic surface replacement, non-actionable provisional revisions, final-snapshot activation, and degradation;
- Stop availability by phase, immediate local disabled state, terminal reduction, and committed-outcome receipt;
- `legacy_selected`, fallback-safe start rejection, stream acceptance, and the prohibition on post-acceptance synchronous fallback;
- state restoration after app recreation using the same run cursor.

### Flutter widget, golden, and motion tests

Required suites:

- the Customer Response Block across claim-free waiting, verified progress, first text, complete text, provisional/final GenUI, reconnect, Stop, incomplete, failed, cancelled, and superseded states;
- compact Vietnamese customer-safe labels at narrow and wide layouts;
- no raw event names, tool names, trace identifiers, error stacks, or debug metadata in semantics or visible text;
- Cue enter/change/exit scenes under a deterministic test clock;
- no duplicate animation replay after duplicate/replayed events;
- static reduced-motion rendering with identical state and accessibility meaning;
- semantics announcements only on meaningful coalesced progress changes;
- golden coverage for the reviewed light-theme customer experience and degraded states.

Animation frame counts are not domain outcomes. Tests should assert state, opacity/position endpoints, semantics, and absence of unwanted replay rather than coupling to Cue internals.

### Backend-backed Flutter integration tests

Extend the repo's existing `integration_test` surface. Run the real Flutter repository, controller, reducer, and widgets against a deterministic local backend using the production HTTP/SSE codecs and durable event-store implementation or its contract-equivalent local adapter.

The harness must control:

- event emission timing without arbitrary sleeps;
- connection drops before and after checkpoints;
- duplicates, gaps, delayed events, and replay windows;
- process restart with durable run recovery;
- Stop at every allowed phase;
- supersession before work, during read-only work, during reversible mutation, during irreversible attempt, and after commit;
- provider/tool failures before and after visible text;
- GenUI invalid revision, stale action, duplicate action, and final degradation;
- rollout modes and pre-acceptance fallback;
- reduced-motion platform setting.

Every scenario asserts both Flutter-visible state and the backend ledger/outcome. A screenshot alone cannot pass the test.

### Credentialed live-AI Proof Run

Use the single collaborator-runnable command reserved by the evidence contract: `npm run proof:customer-chat:streaming`.

The command must run the nine reviewed conversation scenarios and the complete lifecycle/fault matrix as one Proof Run, then emit the correlated ledger, Flutter applied-event log, video/screenshots, persisted outcomes, metrics, environment/build metadata, checksums, and fail-closed manifest.

Live-AI acceptance rules:

- `OPENAI_API_KEY` is required for the credentialed run;
- LangSmith is optional corroboration and its absence cannot fail an otherwise complete authoritative bundle;
- a scenario filter marks the run `diagnosticOnly: true` and cannot pass acceptance;
- fixture, mock, sandbox, and production upstream modes are declared separately and never relabelled;
- one missing scenario, correlation edge, checksum, terminal outcome, or privacy check fails the whole bundle;
- the proof command exits non-zero on evaluation failure.

The existing per-scenario filtered live GenUI loop must be replaced or retained only as a diagnostic workflow; consolidating nine separate filtered runs does not create one acceptance Proof Run.

## Acceptance matrix

Every row requires deterministic backend coverage, Flutter reducer coverage where visible, and backend-backed integration coverage. Rows marked `Proof Run` also require synchronized credentialed evidence.

| Contract slice | Minimum passing cases | Proof Run |
| --- | --- | --- |
| Start and assignment | off/internal/cohort/on, incapable client, unsupported schema, duplicate start, fallback-safe rejection | yes |
| Verified progress | claim-free wait, every semantic family, coalescing, hidden internals, summary collapse | yes |
| Text delivery | start, multi-delta, Unicode/grapheme boundaries, checkpoint, duplicate replay, completion equality | yes |
| Partial text | Stop after first delta, provider failure, disconnect, retained incomplete turn, manual retry | yes |
| GenUI revisions | multiple valid revisions, invalid revision suppression, atomic replacement, final activation, text-only degradation | yes |
| GenUI actions | provisional disabled, valid final capability, stale version, duplicate request, reservation conflict | yes |
| Ordering/replay | duplicate, gap, out-of-order, expired cursor, snapshot resync, process restart | yes |
| Stop | planning, read-only tool, composition, before text, after text, too-late irreversible boundary | yes |
| Reconnect | before first event, mid-progress, mid-text, mid-GenUI, after terminal, repeated transport loss | yes |
| Failure | start rejection, persistence failure, tool/provider failure, invalid projection, terminal delivery recovery | yes |
| Supersession | reversible work, reversible cart correction, irreversible attempt, committed outcome, newest-run UI ownership | yes |
| Motion/accessibility | normal motion, reduced motion, semantics coalescing, replay without repeated animation | yes |
| Fallback/rollback | pre-acceptance legacy selection, master off, accepted-run drain, no duplicate side effect, next-run legacy | yes |
| Proof integrity | identity joins, clocks, checksums, redaction, upstream modes, all scenarios, non-filtered manifest | yes |

## Quantitative gates

### Deterministic gates

These are absolute for every pull request and promotion candidate:

- all required backend, Flutter unit, widget, golden, and backend-backed integration tests pass;
- static analysis and backend build pass;
- zero schema/sequence invariant failures;
- zero forbidden customer-detail leaks;
- zero duplicated irreversible effects;
- exact equality between reduced completed text/final GenUI and authoritative persisted outcomes;
- reduced-motion and accessibility checks pass;
- Proof Run manifest is complete and `acceptance: passed`.

### Latency and recovery gates

Measure from the Evidence Correlation Envelope, using p50/p95 and sample counts. For the first release candidate:

- local submit to claim-free waiting render: p95 at or below 100 ms;
- accepted backend event to Flutter-applied state: p95 at or below 250 ms on the proof network;
- start request to stream acceptance: p95 at or below 1,000 ms;
- verified progress becomes visible before first text whenever qualifying evidence exists;
- first text visibility does not regress by more than 10% versus the same build's synchronous completed-response p95;
- injected disconnect to restored authoritative UI: p95 at or below 3 seconds;
- Stop tap to locally disabled control: p95 at or below 100 ms;
- Stop receipt to terminal cancellation during reversible phases: p95 at or below 2 seconds;
- no animation exceeds the motion durations approved in the visible-progress prototype;
- no accepted run remains non-terminal beyond the configured stale-run recovery window without an alertable reason.

If the proof environment cannot support a threshold, record that limitation and fail promotion rather than silently widening the bound. Threshold changes require an explicit contract revision with before/after evidence.

### Production health gates

For each exposed cohort:

- streaming start acceptance success at least 99.5%;
- terminal completion/failure/cancellation accounting exactly 100% of accepted runs after the recovery window;
- sequence-gap or unrecoverable-resync rate below 0.1%;
- post-acceptance legacy fallback count exactly zero;
- duplicated irreversible outcome count exactly zero;
- customer-visible forbidden-detail count exactly zero;
- Flutter streaming crash-free run rate at least 99.9%;
- p95 first-text and total-completion latency no worse than 10% above the synchronous baseline unless a reviewed product exception explains added verified work;
- reconnect recovery success at least 99%;
- GenUI revision degradation is measured separately from whole-run failure.

Small cohorts may not produce statistically strong estimates. Missing sample size is not success: the promotion record must show run counts and either meet the minimum observation window below or carry a named owner waiver with the uncertainty stated.

## Promotion stages

### Gate 0 — merge-disabled

- master server mode remains `off`;
- client capability may land disabled;
- all deterministic suites and a fixture/mock proof bundle pass in CI;
- schema compatibility and migration/rollback rehearsals pass;
- security/privacy review covers customer event retention and proof artifacts.

### Gate 1 — internal allowlist

- mode `internal` for named KFC test accounts only;
- one complete credentialed live-AI Proof Run passes against the deployed candidate;
- config-only kill-switch rehearsal proves new requests return to legacy without disturbing an accepted run;
- operator can correlate a run without exposing technical detail in customer chat;
- observe at least 30 accepted runs and 24 hours, unless a named owner documents why lower traffic is sufficient for the demo environment.

### Gate 2 — 10% stable cohort

- no unresolved severity-0/1 defect from internal use;
- internal production-health gates pass;
- cohort bucketing and persisted assignment are audited;
- observe at least 100 accepted runs and 24 hours;
- rerun the complete Proof Run on the exact promoted build/configuration.

### Gate 3 — 50% stable cohort

- 10% cohort health gates pass;
- synchronous baseline comparison has enough samples and no unexplained regression;
- reconnect, Stop, failure, and degradation metrics are visible and alertable;
- observe at least 250 accepted runs and 48 hours;
- another complete Proof Run passes after any intervening code/config change.

### Gate 4 — 100% capable KFC-source traffic

- 50% cohort gates pass;
- rollback owner and command are confirmed for the release window;
- all supported deployed clients negotiate a compatible schema or remain on legacy;
- mode becomes `on`; the legacy endpoint remains available for ineligible/pre-acceptance requests.

### Legacy retirement gate

Do not remove the synchronous path in this first rollout. Retirement is a later explicit change requiring:

- at least two consecutive deployed builds at 100% capable traffic;
- at least seven days of healthy metrics or an explicitly documented demo-environment waiver;
- no supported client version that requires legacy;
- a separate migration/removal plan and rollback review.

## Rollback

### Standard rollback

1. Set server mode to `off` through a config-only deployment.
2. Verify the new rollout-policy revision from readiness/build metadata.
3. Confirm new capable-client requests receive `legacy_selected`.
4. Let accepted streaming runs drain, reconnect, or terminate through their original run contract.
5. Reconcile every irreversible attempt and ensure every accepted run reaches a terminal ledger state.
6. Compare persisted outcomes and customer transcripts before declaring rollback complete.

### Emergency presentation degradation

If provisional GenUI is unsafe but progress/text are healthy, disable provisional GenUI revisions. Continue authoritative text and final validated snapshot behavior. This is not a master rollback and must be visible in metrics/proof metadata.

If the Flutter streaming presentation is unsafe, turn the server master mode off for new runs and ship a client capability-disabled build as needed. Do not redirect already accepted runs to synchronous execution.

### Rollback success criteria

- no new `stream_accepted` decisions under the new off-policy revision;
- no duplicate customer turn or irreversible side effect;
- all pre-rollback accepted runs terminal or explicitly under reconciliation;
- legacy-selected requests complete through the existing synchronous response contract;
- rollback timestamps, configuration revision, affected cohort, and outcome counts are recorded.

## Observability and alerts

Required metric dimensions are bounded: build, schema version, rollout-policy revision, cohort, upstream mode, terminal outcome, failure family, and GenUI degradation reason. Do not use raw customer, session, request, run, or tool-argument values as metric labels.

Alert immediately on:

- duplicate irreversible outcome;
- missing terminal accounting after recovery;
- forbidden-detail projection;
- post-acceptance legacy fallback;
- corrupt or non-contiguous durable ledger;
- sustained start-acceptance, crash-free, reconnect, or latency gate breach.

Dashboards and LangSmith may help diagnosis, but alerts and promotion gates must derive from authoritative customer-run evidence and app observations.

## Implementation sequence

This is a dependency order, not implementation performed by this Wayfinder session:

1. Define versioned start/event/snapshot/Stop schemas, rollout assignment, durable run/event storage, and migrations.
2. Implement backend run acceptance, execution independence, projection, replay/long-poll, Stop, recovery, metrics, and synchronous pre-acceptance selection with master mode off.
3. Implement the typed Flutter transport and reducer behind a disabled client capability, including replay and lifecycle restoration.
4. Implement the Customer Response Block, Cue motion, reduced motion, text reduction, and GenUI revision rendering.
5. Build deterministic backend-backed integration fault injection and the unified Proof Run command/manifest.
6. Pass Gate 0, rehearse rollback, then promote sequentially through internal, 10%, 50%, and 100% gates.

Each tracer-bullet increment should cross durable backend event, real transport codec, Flutter reducer, and visible UI with tests. Do not build all backend event types first and defer end-to-end reduction until the end.

## Definition of implementation-ready

Implementation may begin when engineers accept this contract and the eight preceding ticket contracts as the source specification. No unresolved product or architecture decision remains in this map. Deviations discovered during implementation must be recorded as explicit spec revisions; they are not permission to weaken replay, evidence, privacy, or irreversible-side-effect safety silently.
