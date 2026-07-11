# Run Lifecycle, Ordering, Replay, And Recovery Contract

Decision snapshot: current isolated checkout and the previously settled transport, progress, text, and GenUI contracts reconciled on 2026-07-11.

## Decision

Use a project-owned, durable **Customer Chat Run** with:

- one lifecycle status plus one execution phase;
- one current customer-visible run per session generation;
- one append-only, monotonically sequenced customer-safe event log;
- explicit cancellation rather than treating disconnect as cancellation;
- a separate irreversible-action ledger that distinguishes execution start, committed success, known failure, and uncertain outcome;
- terminal reduction that atomically materializes completed or incomplete text, final GenUI, and exactly one terminal run event;
- cursor replay first and a full authoritative run snapshot when replay history is unavailable or inconsistent.

New customer input normally supersedes reversible work and presentation. If an irreversible attempt is in flight, the next run waits for reconciliation. If the effect committed, the newest run becomes the sole active response and must acknowledge that committed outcome before handling the follow-up. Nothing silently repeats or undoes the effect.

## Current repo findings

- Existing `AgentRunStatus` has `scheduled`, `running`, `completed`, `superseded`, and `failed`, but no accepted, cancelling, cancelled, or reconciling semantics.
- Existing Messenger/Zalo coordination has generations and a current-run guard, but first-party KFC chat does not use it.
- The coordinator marks a reversible run superseded when new input arrives, but increments session generation even when an irreversible boundary exists. This makes the old run fail its current-generation guard without defining how its committed/uncertain outcome reaches the customer.
- `recordIrreversibleBoundary` is invoked immediately before the external tool call. Its current `irreversibleSideEffectAt` field therefore proves that an irreversible attempt crossed the execution boundary, not that the side effect succeeded.
- The run guard checks currentness before irreversible tools and before delivery, but not through a durable cancellation token, execution lease, customer event sequence, or terminal snapshot.
- Current queue recovery claims due runs but has no lease-expiry recovery for an accepted/running first-party run, no event replay log, and no side-effect reconciliation state.

The new contract may reuse implementation patterns from the existing coordinator, but it must not reuse these ambiguous semantics unchanged.

## Domain model

### Request identity

`clientMessageId` is the request idempotency key within a session. The run-start request also stores a canonical request fingerprint over customer identity and exactly one trusted input: customer text or a GenUI action capability invocation.

- Same `(sessionId, clientMessageId, fingerprint)` returns the same run and capability.
- Same `(sessionId, clientMessageId)` with a different fingerprint returns `409 idempotency_conflict`.
- A lost start response is retried with the same identity; it is not a new run.
- A deliberate manual Retry after a terminal failure uses a new `clientMessageId` and creates a new run.

### Run identity and generation

- `runId` is opaque and globally unique.
- `generation` is monotonically increasing per session and determines which run may own active customer presentation.
- `currentRunId` identifies the sole current run for that session generation.
- `requestIds` records every pending customer turn coalesced into the run in original order.
- Text `draftId`, GenUI `surfaceId`, `snapshotId`, action `capabilityId`, and assistant `turnId` remain subordinate identities correlated to `runId`.

Generation is a coordination fence, not customer copy. Flutter never displays it.

## Status and phase model

Avoid a state explosion by keeping lifecycle status and execution phase orthogonal.

### Lifecycle status

```text
accepted ──────► running ──────► completed
    │               │
    │               ├─────────► failed
    │               ├─────────► superseded
    │               └─────────► cancelling ──────► cancelled
    ├─────────────────────────► superseded
    └─────────────────────────► cancelling ──────► cancelled
```

- `accepted`: durable run exists and its dispatch record/queue publication is recoverable.
- `running`: one executor lease owns the run.
- `cancelling`: an accepted Stop request is durable; execution is converging to a safe cancellation point.
- `completed`: canonical response finalization succeeded, including text-only completion when GenUI degraded.
- `failed`: the run cannot safely complete and no internal recovery remains.
- `cancelled`: Stop reached a safe terminal boundary.
- `superseded`: a newer customer intent owns presentation; any retained prefix/committed outcome has been reconciled according to this contract.

`completed`, `failed`, `cancelled`, and `superseded` are terminal. Terminal status never changes.

### Execution phase

Nonterminal runs additionally carry one of:

```text
queued
planning
read_only_tool
state_change_tool
irreversible_tool
reconciling
response_composition
text_delivery
finalizing
```

Phase supports progress projection, Stop eligibility, recovery, and observability. It is not the customer-safe label itself.

### Stop availability

Stop is allowed in:

- `queued`;
- `planning`;
- `read_only_tool`;
- `response_composition`;
- `text_delivery`.

Stop is not offered while a reversible or irreversible state-changing tool is executing, during irreversible outcome reconciliation, or while the atomic final commit is in progress. Cancellation is checked immediately before a state-changing execution boundary and again after its result is durably recorded.

This preserves the map’s settled promise—Stop during planning, read-only work, and response generation—without implying that an in-flight mutation can be rolled back.

## Irreversible attempt and outcome model

Replace the ambiguous single timestamp with a durable **Irreversible Attempt** record:

```text
reserved → executing → committed
                     ├→ failed
                     └→ unknown → reconciling → committed | failed | escalated
```

- `reserved`: exclusive action reservation and side-effect idempotency key exist.
- `executing`: the external call may have reached the downstream system. Stop and superseding execution are fenced.
- `committed`: verified downstream evidence proves the effect occurred.
- `failed`: verified evidence proves it did not commit.
- `unknown`: timeout/crash/ambiguous response means the system must not guess.
- `escalated`: bounded automated reconciliation could not resolve the outcome and a verified support handoff now owns follow-up.

The attempt record stores the capability/action identity, idempotency key, tool class, timestamps, and authorized technical outcome. Customer events expose only safe control/progress changes, not tool names or internal status.

Recovery never blindly re-executes an `executing` or `unknown` attempt. It queries the downstream system or replays the same idempotency key only when that system’s contract proves replay returns the original result.

## Run event log

Every customer event has:

```json
{
  "schemaVersion": 1,
  "eventId": "event_opaque",
  "runId": "run_opaque",
  "sequence": 17,
  "type": "text_delta",
  "occurredAt": "2026-07-11T00:00:00.000Z",
  "payload": {}
}
```

Rules:

- Sequence starts at 1 and increases by exactly one per run.
- Sequence assignment and event persistence are atomic under the run lease/compare-and-set fence.
- `eventId` is globally unique; `(runId, sequence)` is unique.
- Persist before SSE/long-poll publication.
- Heartbeats and connection comments are transport metadata and consume no sequence.
- The customer log contains only typed customer-safe payloads. Tool traces, prompts, raw errors, queue attempts, and provider events stay in technical evidence.
- A terminal run event is the last event. Metrics discovered afterward are emitted to observability, not appended to the customer run.

## Canonical event order

A normal successful run follows this partial order:

```text
run_accepted
run_started
run_control / progress_changed / verified phase events
response_composition_started
text_started
text_delta / text_checkpoint
provisional genui_snapshot revisions (when present)
atomic finalization:
  text_completed
  authoritative genui_snapshot (when present)
  run_completed
```

Text and provisional GenUI may interleave only after their individual start/validation boundaries. Their event sequences establish observation order; neither may violate the text or GenUI contract.

Atomic finalization persists:

1. the immutable assistant turn containing Canonical Assistant Text and optional authoritative GenUI Snapshot;
2. `text_completed` bound to that turn;
3. the authoritative `genui_snapshot` when present;
4. `run_completed` with the same turn ID and a terminal state digest;
5. clearing `currentRunId` only if it still points to this run.

Use one transaction where supported. Otherwise use a durable finalization record/outbox whose idempotent recovery converges to exactly the same event sequence and turn.

## Terminal event ordering

### Completed

```text
text_completed
authoritative genui_snapshot?
run_completed
```

Text-only completion omits GenUI without failing the run.

### Cancelled

```text
run_cancellation_requested
text_incomplete?       # only if a prefix was visible
genui_cleared?         # only provisional UI
run_cancelled
```

If no text appeared, no empty assistant turn is created.

### Superseded

```text
text_incomplete?       # retained old prefix
genui_cleared?         # provisional only
run_superseded
```

Committed irreversible outcomes remain in the action ledger and must be acknowledged by the new run. They are never removed by `run_superseded`.

### Failed

```text
text_incomplete?       # when a prefix exists
genui_cleared?         # provisional only
run_failed
```

`run_failed` carries a customer-safe failure phase/copy key and an opaque evidence correlation ID, never the raw exception.

All terminal sequences are committed as one recoverable unit so reconnect cannot observe a retained prefix without its terminal meaning indefinitely.

## Flutter reduction contract

Flutter maintains immutable transcript messages plus at most one active **Customer Response Block**.

For each active run stream:

1. Validate event schema and run identity.
2. If `sequence <= lastAppliedSequence`, ignore it as replay/duplicate.
3. If `sequence == lastAppliedSequence + 1`, reduce it and advance the cursor.
4. If `sequence > lastAppliedSequence + 1`, freeze advancement and request replay from `lastAppliedSequence`.
5. Never apply an event from a lower generation to current progress, current text, composer controls, or current GenUI.
6. A prior run’s terminal event may only finalize/remove that prior run’s own placeholder, partial draft, or provisional surface. It cannot modify the newer run.
7. After a terminal event, ignore later events for that run as protocol violations and resync technical evidence.

Unknown event schema/version on the active run is not silently skipped because doing so would advance across unknown semantics. Freeze and use authoritative resync or the synchronous feature-flag fallback for a future request.

## Replay, reconnect, and authoritative resync

### Connection loss

Closing Flutter, cancelling the response-body subscription, navigating away, proxy timeout, or losing connectivity is **Run Transport Loss** only.

- Execution and lifecycle continue.
- Flutter freezes the last verified UI and shows `Đang kết nối lại…` as already decided.
- Reconnect uses `after=lastAppliedSequence`.
- Exact duplicates are ignored; gaps remain frozen until filled.
- A failed SSE connection switches to long poll over the same event log, not to synchronous agent execution.
- Reconnect never replays Cue entrance animation or re-executes a side effect.

### Authoritative run snapshot

When events have expired, a conflict persists, or recovery cannot provide the gap, Flutter requests a full run snapshot:

```json
{
  "schemaVersion": 1,
  "runId": "run_opaque",
  "generation": 4,
  "isCurrent": true,
  "status": "running",
  "phase": "text_delivery",
  "snapshotSequence": 28,
  "stopAllowed": true,
  "progress": {},
  "text": {},
  "genUi": {},
  "terminal": null,
  "sha256": "digest"
}
```

The snapshot contains only customer-safe reduced state: latest progress, text draft/completion, latest valid GenUI revision, controls, terminal materialization, and transcript turn reference. It contains no tool traces or prompts.

Flutter validates identity, generation, digest, and monotonic `snapshotSequence`, then atomically replaces the run view and resumes after that sequence. A snapshot cannot roll back an already-applied higher sequence.

Terminal snapshots remain available after incremental event compaction for the retention period required by demo proof and transcript recovery.

## Stop protocol

`POST /chat/kfc/runs/{runId}/cancel` is idempotent and authorized by the run capability.

- Terminal run: return its existing terminal state.
- Non-current run: return its existing/superseded state; never cancel the newer run.
- Stop not currently safe: return a typed `stop_not_available` result and the current control snapshot; do not pretend cancellation is pending.
- Stop safe: atomically record `cancellationRequestedAt`, set status `cancelling`, append `run_cancellation_requested`, and return accepted.
- Executor checks the durable cancellation token at every safe phase boundary and aborts an internal OpenAI request/read-only operation where supported.
- Cancelling the SSE request is never substituted for this command.

During text delivery, Stop ends at a customer-delta boundary, discards the unreleased suffix, materializes `text_incomplete`, clears provisional GenUI, and terminates cancelled. It cannot resume that draft.

## New customer input and supersession

### Before state-changing execution

The new input atomically increments generation and becomes pending for a new run. The old run receives a supersession request and terminates at its next safe point.

- No old text: remove its placeholder.
- Partial old text: retain it as an Incomplete Assistant Turn with `Đã dừng câu trả lời trước.`
- Provisional old GenUI: clear it.
- Any verified reversible cart state remains real state; the new run loads it and corrects or explains it rather than silently pretending it never happened.

### During reversible mutation

Do not interrupt the external mutation midway. Record its verified result, then terminate the old presentation as superseded and let the new run operate on the resulting authoritative state. The new run may perform a compensating cart update only if the newest customer intent requests it and the tool contract allows it.

### During irreversible attempt

Do not start a competing run that could repeat the action. Persist the new customer input as a pending **Post-Commit Follow-Up** and hold it behind the attempt fence.

- `committed`: terminate old presentation as superseded, create the new run, and inject a required Committed Outcome Receipt so the new response acknowledges what occurred before handling the follow-up.
- `failed`: create the new run from known unchanged/failed state.
- `unknown`: enter `reconciling`; do not guess or retry blindly.
- unresolved after bounded reconciliation: create a verified support handoff and complete with customer-safe wording that the outcome needs checking. Any later downstream discovery becomes a new correlated follow-up, not mutation of the terminal old run.

### After committed outcome, before old response completes

The newest run owns the only active response. Do not finish a second competing old reply. Preserve the business outcome and require the newest response to state it plainly before addressing the correction.

This is the user-delegated decision for scenarios such as: order placement succeeds, then the customer immediately asks to change a drink. The new response must say the order was already placed and offer the valid post-order path; it must not imply the placed order was edited or cancelled.

## Retry and failure policy

Distinguish four operations that are often all called “retry”:

### Start retry

An ambiguous/lost run-start response retries the same request identity and returns the same run.

### Transport retry

Reconnect/replay the same run from the last contiguous sequence. Never call the model or tools again.

### Internal phase retry

A bounded transient retry may occur inside the same run when:

- no terminal event exists;
- the phase contract declares retry safe;
- the same side-effect idempotency identity is retained;
- no customer-visible canonical text needs revision.

Internal attempts and backoff remain technical evidence, not customer progress steps.

### Manual customer Retry

After a terminal failure, Retry creates a new customer request/run with a new `clientMessageId`. It never appends to an incomplete draft. The server may reuse verified session state but must reevaluate current capabilities and side-effect outcomes.

Recoverable provider/composer failure before `text_started` uses the verified deterministic fallback in the same run. It is not a terminal failure or transport fallback.

## Executor lease and crash recovery

At-least-once queue delivery requires an atomic execution lease:

- lease owner/claim token;
- claim epoch;
- lease expiry and heartbeat;
- compare-and-set updates for status, phase, next sequence, and finalization.

Only the valid lease may append run events or execute tools. Duplicate queue deliveries observe an active lease and exit.

Recovery scanner behavior:

- accepted without dispatch: republish the same run job;
- expired running lease before side effects: reclaim the same run and resume from durable phase/checkpoint;
- expired lease with reserved/executing irreversible attempt: reconcile before any further tool execution;
- finalization record without all events/turn: complete the idempotent outbox transaction;
- exhausted queue/DLQ with no safe recovery: materialize partial state as required and append `run_failed`;
- terminal run: never execute again.

Recovery does not create a replacement run unless a new customer request explicitly does so.

## Synchronous fallback boundary

The feature flag chooses streaming or legacy synchronous transport before a request is accepted.

- Streaming unsupported before acceptance: use legacy route.
- Run accepted: all network recovery stays on that run through SSE, long poll, snapshot, and idempotent start lookup.
- No timeout, disconnect, provider error, or missing event may invoke the legacy route for an accepted run.
- Legacy mode uses the same canonical response and GenUI finalization rules where applicable, but has no incremental run event UI.

This prevents double execution through “fallback.”

## Customer-safe controls and failures

The event reducer receives safe projections rather than technical reasons:

- `run_control` supplies `stopAllowed` and a customer-safe unavailable reason key when needed.
- `progress_changed` uses only the approved progress families.
- `run_failed` supplies an approved phase/copy key.
- `run_cancelled` maps to `Đã dừng.`
- `run_superseded` is never printed; Flutter removes/retains old presentation according to its text state.

Policy rules, tool identity, generation, retries, reconciliation internals, queue state, and raw errors remain in observability.

## Invariants

1. One session has at most one current run/generation and one active Customer Response Block.
2. One accepted request identity maps to exactly one run.
3. One run has exactly one terminal status/event.
4. Customer events are persisted before publication and are contiguous per run.
5. Stale run events never mutate newer active presentation.
6. Visible text is append-only Canonical Assistant Text and never corrected in place.
7. Provisional GenUI is replaceable/clearable; authoritative GenUI is immutable.
8. A side effect is never inferred from an execution-start timestamp.
9. An unknown irreversible outcome is reconciled, never blindly retried.
10. Disconnect never changes lifecycle.
11. Stop never implies rollback.
12. Final assistant turn, final text, authoritative GenUI, and terminal event converge exactly once after crashes.

## Required tests and proof

Later implementation/rollout work must cover:

1. Idempotent start, fingerprint conflict, lost start response, and duplicate queue delivery.
2. Status/phase transition table with rejection of illegal and post-terminal transitions.
3. Event sequence uniqueness, duplicates, gaps, conflicting duplicates, cursor resume, compaction, and authoritative snapshots.
4. Reconnect during every phase with no cancellation or repeated side effect.
5. Stop in every allowed phase and explicit unavailability in mutation/reconciliation/finalization.
6. New input before tools, during read-only work, during reversible mutation, during irreversible execution, after commit, during text, and after terminal state.
7. Irreversible attempt success, known failure, timeout/unknown, idempotent reconciliation, support escalation, and crash at each boundary.
8. Partial text retention, provisional GenUI clearing, authoritative snapshot immutability, and newest-run-only UI reduction.
9. Atomic/idempotent success, cancelled, superseded, and failed terminal materialization.
10. Streaming/synchronous transport selection proving an accepted run never executes the legacy route.
11. Flutter reducer property tests showing arbitrary duplicate/replay chunking reaches the same final state.
12. Runtime proof correlating request, run, sequence, draft, GenUI revision, action reservation, assistant turn, and terminal digest.

## Effect on later tickets

- **Design Evidence Correlation And Demo Proof** is now unblocked and must prove these identities/invariants across customer stream, runtime ledger, dashboard, optional traces, and captured UI.
- **Design Test Matrix And Feature-Flagged Rollout** remains blocked until that proof contract resolves, then turns these scenarios into promotion gates.

No additional child ticket is required by this decision.
