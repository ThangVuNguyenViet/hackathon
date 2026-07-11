# Evidence Correlation And Demo Proof Contract

Research snapshot: current isolated checkout, existing KFC proof scripts/manifests, dashboard events, tracing, Flutter integration captures, and the settled customer-streaming contracts inspected on 2026-07-11.

## Decision

Use a **ledger-first proof architecture**:

1. The durable customer-run event log is the authoritative record of what the runtime committed.
2. A structured Flutter applied-event ledger proves which authoritative events the app actually reduced and what customer-visible state resulted.
3. A timestamped screen recording and checkpoint screenshots prove what a viewer could see.
4. Persisted conversation/business/action records prove final state and irreversible outcomes.
5. Dashboard events and optional LangSmith spans corroborate the run, but neither can replace missing durable customer events.

Every artifact joins through a shared **Evidence Correlation Envelope**. One fail-closed manifest validates identities, ordering, digests, scenario completeness, privacy, checksums, runtime configuration, and synchronized timestamps.

Acceptance requires the complete reviewed scenario replay plus the complete streaming-fault matrix in one proof execution. A targeted rerun may diagnose one slice, but its manifest is permanently `diagnosticOnly=true` and cannot pass the acceptance gate.

## Current repo findings

- Dashboard events currently carry `id`, `sessionId`, `type`, free-form payload, and time. Many IDs contain `Date.now()`/UUID, but events lack required `runId`, request identity, run sequence, or source-event reference.
- `DashboardEventBus` publishes live even when its asynchronous persistence fails. That is intentionally resilient for monitor UI but makes dashboard data unsuitable as authoritative streaming proof.
- Current root traces include `scenarioId`, `probeRunId`, and `clientMessageId`, but not the new customer `runId`, event sequence, draft, GenUI revision, action reservation, or terminal digest. LangSmith is sampled/optional and trace failures are swallowed by design.
- Current live GenUI proof captures screenshots, integration-test exit status, dashboard transcript/telemetry, and a `liveAi` flag. It does not capture ordered customer-run events, Flutter reductions, video synchronization, checksums, event/UI digests, Stop/reconnect states, or manifest-level causal joins.
- Current proof consolidation accepts the latest passing scenario fragments from different runs. That is useful for a screenshot catalog, but it cannot prove one synchronized runtime execution.
- The reviewed capture plan currently contains nine conversation scenarios. It covers broad ordering/GenUI behavior but not all streaming lifecycle faults.
- Current latency proof records only total greeting/menu duration and p95. It does not separate acceptance, first verified progress, canonical text commit, first visible text, GenUI revision, reconnect, Stop, or terminal consistency.

The new proof package can reuse these scripts and evaluators, but acceptance cannot be inferred from their current manifests.

## Approaches considered

### 1. Durable ledger plus correlated UI/video bundle — selected

- Proves causality from runtime evidence to customer-visible state.
- Survives missing optional traces and delayed dashboard persistence.
- Supports deterministic replay, fail-closed validation, and collaborator review.
- Requires structured Flutter observations and synchronized artifact capture.

### 2. Dashboard-first proof — rejected

- Existing monitor APIs are convenient and already used by proof scripts.
- Dashboard event persistence is best-effort and payloads are not run-sequenced.
- The monitor mixes customer-safe and technical/business evidence.
- Seeing a dashboard event does not prove Flutter received or displayed the corresponding projection.

### 3. Video/screenshots plus console logs — rejected

- Visually persuasive but cannot prove that labels were event-backed, that replay was correct, or that an irreversible action ran once.
- Timestamps and log lines can refer to different runs/builds.
- Missing data is easy to overlook and hard to evaluate automatically.

## Evidence correlation envelope

Every structured record uses the identifiers applicable to it:

```json
{
  "schemaVersion": 1,
  "proofRunId": "proof_opaque",
  "scenarioId": "01-dat-mon-ro-rang-giao-hang",
  "scenarioTurnId": "scenario_turn_11",
  "sessionId": "kfc:proof_customer",
  "clientMessageId": "proof_message_opaque",
  "runId": "run_opaque",
  "generation": 4,
  "eventId": "event_opaque",
  "sequence": 17,
  "assistantTurnId": "turn_opaque",
  "recordedAt": "2026-07-11T00:00:00.000Z"
}
```

Optional subordinate identities include:

- `draftId`, `deltaIndex`, and text digest;
- `surfaceId`, `snapshotId`, `revision`, and GenUI digest;
- `capabilityId`, `actionReservationId`, and irreversible-attempt ID;
- `dashboardEventId` and `sourceRunEventId`/`sourceSequence`;
- `traceRootId`/URL and span name;
- `flutterObservationId`, local monotonic timestamp, and UI-state digest;
- screen recording ID, frame/time offset, screenshot ID, and artifact checksum.

`proofRunId` and `scenarioId` exist only in controlled proof runs. Production runtime correctness cannot depend on them.

## Source authority hierarchy

| Claim | Authoritative evidence | Corroborating evidence |
|---|---|---|
| Run/request accepted once | Run ledger, request fingerprint, queue/outbox record | Start HTTP response, dashboard, trace |
| Progress label was allowed | Persisted customer progress event plus projection mapping version | Internal tool/state evidence, Flutter observation, video |
| Text came from committed canonical text | `text_started`/delta/checkpoint/completion ledger and text digest | Composer trace, Flutter observation, video |
| GenUI revision was valid | `genui_snapshot` event, catalog/schema result, revision/digest | Flutter observation, screenshot/video |
| UI actually displayed state | Flutter applied-event ledger and visual capture | Customer event ledger |
| Reconnect replayed rather than restarted | Same run ID, contiguous sequence, connection/applied observations | Video and request logs |
| Stop cancelled safely | Cancellation request/event, terminal sequence, side-effect ledger | UI observation/video |
| Irreversible action ran once | Action reservation, idempotency key, downstream outcome/reconciliation | Tool trace, dashboard business event, final transcript |
| Final transcript is authoritative | Immutable assistant turn and terminal run snapshot/digest | UI capture, dashboard turn view |
| Planner/composer used live OpenAI | Runtime configuration and provider call evidence | Optional LangSmith trace |

No secondary source may “fill in” a missing authoritative record. Missing required authority fails the manifest.

## Correlating customer events to runtime evidence

Each customer-safe progress event stores an internal evidence reference that is excluded from the customer payload but available to the restricted proof exporter:

```text
customer run event
  ├─ projectionVersion
  ├─ evidenceRecordId
  └─ evidenceDigest

internal evidence record
  ├─ runId / phase / stateVersion
  ├─ source fact type
  ├─ safe projection family
  ├─ verified result or execution boundary
  └─ authorized technical correlation
```

The proof evaluator must confirm:

- every semantic progress family has an allowed evidence type from the approved projection rules;
- no tool-start label was derived from a success-only event or backdated timestamp;
- failed, skipped, policy-blocked, or superseded work never appears in a deterministic completion summary;
- forbidden technical detail does not occur in any customer event or Flutter-visible copy.

Dashboard projections add `runId`, `sourceRunEventId`, `sourceSequence`, and `projectionVersion` when they represent the same fact. Dashboard-only operational events may omit source sequence but cannot be used to prove customer display.

## Flutter applied-event ledger

In proof-enabled builds, the Flutter reducer emits a sidecar observation after every meaningful state reduction:

```json
{
  "schemaVersion": 1,
  "flutterObservationId": "obs_opaque",
  "proofRunId": "proof_opaque",
  "sessionId": "kfc:proof_customer",
  "runId": "run_opaque",
  "generation": 4,
  "eventId": "event_opaque",
  "sequence": 17,
  "eventType": "text_delta",
  "localWallTime": "2026-07-11T00:00:00.250Z",
  "localMonotonicUs": 88400321,
  "visible": {
    "progressFamily": null,
    "textLength": 24,
    "textSha256": "digest",
    "genUiRevision": 2,
    "genUiSha256": "digest",
    "connectionState": "connected",
    "runStatus": "running",
    "stopAllowed": true
  },
  "uiStateSha256": "digest"
}
```

Rules:

- The ledger contains identifiers/digests/state categories, not credentials or hidden reasoning.
- Duplicate ignored events may be counted without producing a new visible-state observation.
- Gap detection, replay request, reconnect, long-poll fallback, authoritative resync, Stop tap/ack, and terminal reduction produce explicit observations.
- Reduced-motion state is recorded.
- Structured observations are written by the reducer/harness, not scraped from console prose.
- Production builds may disable the exporter; acceptance builds must enable it and declare that fact in the manifest.

## Video and screenshot synchronization

Video proves customer visibility, not backend truth. Synchronize it to the ledgers through a capture sidecar:

- recording ID, file path, codec, duration, resolution, frame rate;
- local wall-clock and monotonic start/end anchors;
- proof harness start marker and first/last Flutter observation IDs;
- checkpoint entries mapping selected observations to video time offsets and screenshots;
- recording checksum.

Do not place debug IDs, timestamps, or “demo proof” prefixes inside customer messages. A proof-only non-customer overlay may briefly show a start marker outside the transcript if needed for frame alignment, but the clean customer video remains the primary artifact.

Required visual checkpoints include:

- claim-free placeholder;
- at least two distinct verified progress families;
- first visible text and completed text;
- provisional and authoritative GenUI revision where applicable;
- reconnect secondary line and resumed state;
- Stop acknowledgement and cancelled terminal state;
- retained partial text;
- supersession before text and after partial text;
- phase-specific failure and text-only GenUI degradation;
- reduced-motion variant in automated screenshot/golden evidence.

## Clock model

Server and Flutter wall clocks may differ. Capture:

- server wall time at event persistence;
- Flutter wall time and monotonic time at receipt/reduction;
- proof-harness wall and monotonic time;
- time-sync probes before and after replay, including round-trip duration and server response time.

Use server times for backend phase durations and Flutter monotonic times for UI-local durations. For cross-host delivery latency, report the estimated offset and uncertainty; do not claim precision finer than the time-sync round-trip bound.

## Metrics

Report individual samples plus p50, p95, max, success count, and scenario labels where meaningful.

### Runtime milestones

- `request_to_run_accepted_ms`
- `accepted_to_run_started_ms`
- `accepted_to_first_verified_progress_persisted_ms`
- `request_to_response_composition_started_ms`
- `composition_started_to_canonical_text_committed_ms`
- `request_to_first_text_delta_persisted_ms`
- `first_to_last_text_delta_ms`
- `request_to_first_provisional_genui_ms`
- `request_to_authoritative_genui_ms`
- `request_to_terminal_ms`

### Customer visibility

- `send_to_claim_free_placeholder_visible_ms`
- `event_persisted_to_flutter_applied_ms`
- `request_to_first_verified_progress_visible_ms`
- `request_to_first_text_visible_ms`
- `first_text_to_completed_text_visible_ms`
- `request_to_first_genui_visible_ms`
- `terminal_persisted_to_terminal_visible_ms`
- `presentation_pacing_added_ms` reported separately from model/runtime time.

### Recovery and control

- `disconnect_detected_ms`
- `network_restored_to_stream_resumed_ms`
- `gap_detected_to_contiguous_ms`
- duplicate count, gap count, reconnect count, long-poll fallback count, authoritative-resync count;
- `stop_tap_to_request_accepted_ms`
- `stop_accepted_to_cancelled_ms`
- stale-run events ignored count;
- executor recovery count and irreversible reconciliation duration.

### Integrity

- required-event coverage;
- correlation completeness;
- sequence/digest/terminal consistency;
- progress-evidence validity;
- forbidden-detail count;
- text/turn equality;
- GenUI revision and action-capability validity;
- side-effect exactly-once result.

Exact promotion thresholds belong to **Design Test Matrix And Feature-Flagged Rollout**. This proof contract requires the raw milestones and distributions so thresholds cannot be retrofitted from one total-duration number.

## Full acceptance replay

One acceptance proof execution contains two suites under the same `proofRunId` and build/environment manifest.

### Suite A: reviewed conversation breadth

Run all nine current reviewed conversation scenarios without `KFC_GENUI_SCENARIO_FILTER` or equivalent filtering. Use live OpenAI planner and response composition when the final demo claims live AI. Each turn uses deterministic proof identities and captures run events, Flutter observations, transcript, state, GenUI, and visual checkpoints.

The manifest declares business upstream mode explicitly:

- `fixture`/`mock`: real agent/runtime behavior over mocked upstream business APIs;
- `sandbox`: real integration against a named sandbox;
- `production`: real production dependency evidence.

The proof supports only claims matching that declaration. Fixture-backed menu/order data must never be presented as KFC’s production system of record.

### Suite B: streaming lifecycle/fault matrix

Run controlled scenarios for:

1. greeting/no-tool fast response;
2. menu lookup progress → text → GenUI;
3. cart mutation and completion summary;
4. irreversible order/payment attempt success;
5. reconnect during planning;
6. reconnect during text and GenUI revision replay;
7. Stop during planning;
8. Stop during text with retained prefix;
9. supersession before text;
10. supersession after partial text;
11. new input during irreversible execution and post-commit receipt;
12. provider composition failure to deterministic fallback;
13. invalid/unsupported GenUI to text-only completion;
14. sequence duplicate, gap, replay, and authoritative resync;
15. executor crash before side effect, after reservation, during unknown outcome, and during finalization.

Fault injection is deterministic and explicitly named in the manifest. It must alter transport/provider/executor conditions, not fabricate success evidence for business actions.

Both suites must pass. Replaying one scenario, one message, only screenshots, only backend tests, or only the happy path is diagnostic—not acceptance.

## Collaborator-runnable proof command

The implementation effort should provide one orchestrating command, reserved here as:

```text
npm run proof:customer-chat:streaming
```

The command must:

1. run a fail-fast preflight for dependencies, credentials, Flutter device/browser, backend readiness, feature flags, artifact space, and clean proof build identity;
2. create one `proofRunId` and immutable artifact root;
3. capture environment/build metadata before execution;
4. run both complete suites;
5. start/stop controlled dependencies it owns and never silently switch backend mode;
6. capture ledgers, video, screenshots, transcript, state, metrics, and optional traces;
7. redact/export the shareable bundle;
8. run the manifest evaluator and checksum verifier;
9. exit nonzero on any required failure;
10. print only the final artifact root and concise pass/fail summary after detailed logs are stored.

Provide an explicitly separate diagnostic command/flag for targeted reruns. Diagnostic artifacts use a different root or manifest mode and cannot be consolidated into a passing acceptance run.

## Proof package

```text
artifacts/kfc-customer-chat-streaming-proof/<proofRunId>/
├── manifest.json
├── README.md
├── checksums.sha256
├── environment.json
├── scenario-plan.json
├── clock-sync.json
├── assertions.json
├── metrics.json
├── customer-run-events.jsonl
├── flutter-applied-events.jsonl
├── runtime-evidence.jsonl
├── dashboard-events.jsonl
├── transcript.json
├── final-run-snapshots.json
├── action-outcomes.json
├── trace-index.json
├── videos/
│   └── customer-chat.mp4
├── screenshots/
├── logs/
└── restricted/
    └── private-correlation-map.json
```

The shareable bundle excludes `restricted/` and any raw secrets/private customer data.

## Manifest fail-closed rules

`manifest.json` passes only when:

- schema/tool versions are supported;
- proof mode is `acceptance`, not diagnostic;
- all nine reviewed scenarios and all required lifecycle/fault cases ran in this same proof execution;
- no scenario filter or latest-passing-fragment consolidation was used;
- git commit/build IDs are present and the proof build’s dirty state is declared; promotion proof may require clean committed product code;
- backend URL/deployment identity and all relevant feature flags are explicit;
- planner/composer mode and business upstream mode are explicit;
- every required artifact exists, parses, and matches `checksums.sha256`;
- customer events are contiguous, digest-valid, and have exactly one terminal event per run;
- every semantic progress event links to allowed runtime evidence;
- Flutter observations consume the same event IDs/sequences and their reduced digests match checkpoints/terminal snapshots;
- completed text equals the persisted assistant turn; incomplete text is marked and retained correctly;
- GenUI revisions/digests are monotonic, atomic, and final authority matches transcript metadata;
- action reservations/outcomes prove exactly-once irreversible behavior;
- visual checkpoints map to Flutter observations and recording offsets;
- latency/clock uncertainty is reported rather than omitted;
- forbidden customer detail, capability secrets, raw prompts, and unredacted sensitive fields are absent;
- optional LangSmith absence is recorded but does not fail the base proof; if `requireLangSmith=true`, missing/uncorrelated traces fail.

An evaluator error, unknown schema, missing file, partial suite, ambiguous runtime mode, or checksum mismatch fails closed.

## LangSmith boundary

LangSmith remains optional observability, not runtime authority.

When enabled, root and child spans add safe metadata/tags for `proofRunId`, `scenarioId`, `runId`, generation, client request reference, phase, and source event range. Public/shareable indexes use a pseudonymous session reference and trace URL/ID; raw prompts, customer addresses, credentials, and capability secrets are not exported.

Sampling or trace upload failure must not change customer execution. It does make a `requireLangSmith` proof fail.

## Privacy and sharing

Create two views:

- **restricted evidence:** authorized internal IDs, downstream correlation, technical errors, and private mapping required for debugging;
- **shareable proof:** pseudonymous identities, safe scenario text, customer-safe events, redacted evidence summaries, visuals, metrics, checksums, and trace presence/index.

Never include:

- stream capabilities, bearer tokens, API keys, cookies, webhook secrets, or `.env` values;
- raw prompts/reasoning, unrestricted tool arguments/results, stack traces, or provider payloads;
- real customer IDs, addresses, payment data, memberships, or order details not intentionally created by the proof scenario.

Redaction occurs before checksums for the shareable bundle. The manifest states which view it evaluates.

## Required implementation tests

Later implementation/rollout work must cover:

1. Correlation-envelope schema and cross-record referential integrity.
2. Progress-event evidence allowlist and forbidden-detail scans.
3. Flutter observation determinism under duplicate/gap/replay/resync inputs.
4. Clock-sync uncertainty and latency calculation tests.
5. Manifest missing/unknown/corrupt/filtered/mixed-run/dirty-build/runtime-mode failures.
6. Checksums and redaction/secret scanning.
7. Optional versus required LangSmith behavior.
8. Full-suite inventory enforcement and diagnostic isolation.
9. Video/checkpoint/observation mapping validation.
10. Proof runner cleanup, nonzero exit behavior, and collaborator execution from a fresh checkout.

## Effect on later ticket

**Design Test Matrix And Feature-Flagged Rollout** is now unblocked. It must convert this proof contract and the earlier architecture decisions into layered automated tests, feature-flag states, fallback rules, deployment stages, performance thresholds, and promotion/rollback gates.

No additional child ticket is required by this decision.
