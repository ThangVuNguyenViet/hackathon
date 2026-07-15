Status: resolved
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 08-design-the-kfc-genui-live-proof.md, 09-design-the-messenger-commerce-parity-proof.md
Assignee: Codex

## Question

What exact release, deployment, consecutive-pass, latency, rehearsal, and fallback gates must pass before the demo is called ready? Define clean exact-SHA and current Catalog Observation binding, build and full-suite requirements, Worker/Pages deployment and deep readiness, five consecutive golden passes, three consecutive full live branch-matrix passes, failure-count reset, forbidden hidden retries/manual repairs, KFC/Messenger evidence convergence, three-minute stage timing, network/runtime preflight, code/deployment freeze window, and a cue-checked recording bound to its own observed catalog version. Specify when catalog change requires revalidation or streak reset, immediate abort/fallback conditions, and truth-safe presenter wording that never presents a recording as current API evidence.

## Resolution

Call the demo **ready** only when one release-candidate manifest proves every gate below. The manifest is bound to one clean pushed git SHA; one Worker deployment; the customer and monitor Pages deployments built together; their release metadata; the sandbox Commerce Environment and redacted provider fingerprint; model, prompt, graph, tool, ranker, ledger, fixture-corpus, and lifecycle-scenario versions; and the immutable evidence for every counted pass. A green CI run, an LLM outcome score, a local proof, an older release, or a recording cannot substitute for a failed hard gate.

### Release-candidate admission

Before deployment, require:

1. `HEAD` is clean, pushed, and equals the selected `origin/main` commit. Lockfiles and generated migrations are committed. The release candidate records `dirty: false` and one `releaseBuiltAt`.
2. Backend Node 22 install from lockfile, TypeScript build, the complete deterministic Vitest suite, and Worker dry-run all pass. Deterministic catalog tests exhaust every separately versioned Catalog Baseline Fixture and the provider-agnostic invariants; they never union crawls or declare one historical crawl current.
3. Flutter stable dependency resolution, `flutter analyze`, the complete Flutter test suite, and both customer and monitor release-web builds pass. The deployment-script contract test and migration classification pass; destructive or ambiguous D1 migration requires a separate explicit operator workflow and cannot ride the demo deployment.
4. The consolidated scenario contract is intact: scenarios 01-08 are one 44-turn live replay at `maxConcurrency=2`; scenario 09 remains planner-only; small-talk, direct-catalog streaming, and Worker interruption remain separate boundary tests. No old nine-scenario browser loop or second Flutter model replay may count.
5. Secret/PII scanning, artifact-schema validation, and checksum verification pass. LLM judges remain supplemental; only deterministic tool, provider, state, persistence, delivery, GenUI, and timing oracles decide acceptance.

Use the existing `run-kfc-deployed-acceptance.sh`, deployment helpers, and proof artifact library as the implementation seam. They already enforce clean provenance, build/test/dry-run gates, Worker/Pages deployment, deep readiness, durability, secret scanning, checksums, and immutable publication. Replace their obsolete nine-browser-scenario phase with the resolved KFC Proof Run and Messenger parity phases; do not build a second release framework.

### Deployment and deep-readiness gate

Deploy the Worker first, apply only the admitted migrations, then build and deploy both Pages surfaces against that Worker. Acceptance requires all of the following:

- Worker `/health` and `/ready?deep=1` are successful and identify the expected exact SHA, build timestamp, clean state, sandbox Commerce Environment, lifecycle provider, storage/queue bindings, and redacted provider configuration.
- Customer and monitor canonical URLs return identical `/release.json` values matching the Worker candidate and return successful proxied readiness. Cache-bypassed requests and a fresh browser profile must see those values; a preview URL cannot stand in for the canonical stage URL.
- Messenger callback verification, signed-webhook ingestion, queue consumption, D1 writes, Graph API outbound send, monitor polling/socket, proof-control authentication, and provider reachability pass. The same-release Worker redeploy durability check must preserve the selected turns/events.
- The current configured menu API is fetched and exhaustively validated. The resulting Catalog Observation records provider version/ETag when supplied, retrieval and expiry, raw/canonical/derived hashes, item/modifier counts, and drift from prior observations. `20702` and its required current modifier paths are verified for the golden run; failure stops qualification rather than selecting a baseline fixture.
- Devices are on external power, notifications and automatic updates are suppressed, the approved browser/app build is preloaded, screen capture has free space, and both primary and backup networks can reach the exact canonical URLs. The recording is locally preloaded, checksum-verified, seeked to its first frame, audible, and playable without network.

Readiness polling may make at most three recorded attempts before a counted run. Once a run is admitted, customer turns, model calls, actions, provider mutations, Messenger sends, and evidence capture receive exactly one attempt.

### Counted qualification sequence

Qualification uses five consecutive deployed golden-journey passes and three consecutive complete live branch-matrix passes on the exact same release candidate and provider configuration. The cheapest valid ordering is three complete cycles followed by two golden-only passes:

1. In each complete cycle, create fresh proof identities and a current Catalog Observation; run one separately counted KFC golden attempt, then the one consolidated 44-turn scenarios 01-08 replay, Flutter durable-snapshot render/action proof, deterministic Messenger projection parity from those same captured projections, one 14-turn real-Messenger journey, and the duplicate/coalescing transport probes as one branch-matrix attempt. Each streak advances or resets independently under the rules below.
2. After three complete cycles pass consecutively, run two more fresh KFC golden journeys. They increment only the golden streak. Five golden passes and three matrix passes therefore use five golden model journeys, three 44-turn replays, and three Messenger journeys—not duplicated Flutter or Messenger model replays.
3. Every pass has a unique run, session, customer, thread/checkpoint, lifecycle scenario, idempotency, trace, and artifact identity. Every counted pass starts from proven-empty durable state and ends sealed; skipped rows, filtered scenarios, reused state, manual choice correction, screenshot selection, or post-failure continuation make it ineligible.

The KFC and Messenger evidence must converge on the same Verified Commerce Projection for shared ledger rows: entity/modifier identity, consent boundary, cart revision and totals, fulfillment, payment availability, order/lifecycle status, and permitted next actions. Channel-specific rendering may differ; an unsupported fact, text/GenUI contradiction, missing guaranteed Messenger reply, duplicate mutation/send, or monitor/persistence mismatch is a hard failure.

### Catalog change and streak relevance

The catalog is expected to change. Never freeze the API response across the qualification window; pin and record the observation used by each run, then revalidate before cart mutation and checkout.

When a newly fetched observation differs, first validate the whole response and compute a semantic diff. A version/ETag/hash change by itself does not erase evidence. Apply these explicit rules:

- Reset the **golden streak** to zero when the change affects `20702`, any selected or required modifier group/option, availability, base price, modifier delta, verified media used on stage, or the golden recommendation ordering/claims. Reapprove the golden script before restarting.
- Reset the **branch-matrix streak** to zero when the change affects any representative entity/modifier/media used by the matrix, an eligibility/ranking result asserted by a ledger row, or any required/forbidden fact or action for those rows. Update the ledger expectations before restarting.
- Reset both when catalog validation fails, relevant drift cannot be classified, or the runtime continues with a stale observation instead of showing the change and requiring renewed selection/confirmation.
- Preserve an unaffected streak only when the machine-produced diff proves every fact and derived result used by that streak is unchanged, and attach that proof to every later pass. Added, removed, or changed unrelated products still require full payload validation but do not invalidate unrelated evidence.
- Adding a newly crawled baseline fixture or changing only deterministic fixture-corpus metadata never changes runtime truth and does not reset a deployed streak unless it exposes a product bug in the candidate; that bug is an ordinary release failure.

Any release SHA, Worker/Pages deployment, environment/provider configuration, lifecycle definition, model, prompt, graph/tool/ranker, scenario ledger, proof harness, or acceptance-oracle change creates a new candidate and resets both streaks. A same-SHA Worker redeploy performed only by the approved durability check preserves the candidate when release metadata, bindings, and behavior match exactly; any other redeploy resets both.

### Failure and reset semantics

Before admission, a failed preflight produces no pass and pauses qualification. It resets a streak only under the catalog-relevance rules above or when it proves the candidate/configuration changed. After admission, any hard-oracle, timing, delivery, teardown, evidence-integrity, or infrastructure failure resets the streak for every counted component included in that run:

- a golden failure resets only the golden streak; a separately completed branch-matrix attempt retains its own result;
- a 44-turn, Flutter, Messenger parity/journey, or transport-boundary failure resets only the branch-matrix streak; a separately completed golden attempt retains its own result;
- a cross-channel contradiction or shared provider/state defect resets both.

Preserve the failed artifact and increment explicit model/action/send/recovery/manual-intervention counters. There are no hidden model retries, framework retries, refreshed browser attempts, state repairs, regenerated screenshots, edited messages, or replacement artifacts inside a counted run. Investigation happens in a separately labelled `DIAGNOSTIC — NOT ACCEPTANCE` run; a later pass never overwrites a failure.

### Latency and stage-duration gates

Run the existing 40-sample deployed production latency probe on the candidate: 20 greetings and 20 menu turns, 100% HTTP/reply success, nearest-rank greeting p95 below 6 seconds, menu p95 below 8 seconds, and overall p95 below 8 seconds, with complete correlated agent/monitor/router traces and the expected planner routing. Also enforce the stricter per-proof deadlines already resolved:

- first visible progress and Messenger webhook acknowledgement: at most 2 seconds;
- discovery/recommendation reply: at most 8 seconds;
- structured action/provider mutation: at most 3 seconds;
- payment/order/delivery status reply: at most 5 seconds;
- any individual customer turn: at most 10 seconds;
- uninterrupted on-stage golden segment: below 180 seconds, with a target of at most 165 seconds.

A p95 pass cannot excuse an absolute breach, a missing reply, or a stage run over time. Record client-observed latency, not only backend execution time.

### Freeze and rehearsal gate

The **release freeze** begins when the candidate is deployed for the first counted qualification cycle and ends after the presentation. It freezes code, dependencies, configuration, secrets, model selection, prompts, provider/lifecycle definitions, migrations, Worker/Pages artifacts, canonical routing, ledger/oracles, proof scripts, and stage device/app versions. It does **not** freeze menu API data. A required mutation creates a new candidate and restarts qualification; operational credential rotation is allowed only by declaring a new provider configuration and restarting both streaks.

After qualification, require two consecutive cue-checked rehearsals on the exact candidate, primary device, presentation display, and venue-equivalent network. The final rehearsal must finish within 24 hours of the presentation. Each rehearsal starts with the day-of preflight, runs the five-turn/GenUI golden stage script in at most 165 seconds, exercises operator lifecycle cues at the approved points, verifies monitor visibility without exposing credentials, and immediately follows with a complete playback of the fallback recording. A missed cue, presenter repair, unexpected customer-facing label/debug text, recording fault, hard-oracle contradiction, or 180-second overrun fails the rehearsal; fix/requalify as dictated above, then restart the two-rehearsal count.

Immediately before going on stage, repeat the non-mutating preflight: release identities, deep readiness, current catalog validation and golden relevance diff, empty fresh session, lifecycle control, primary/backup network, display/audio/capture, and local recording checksum/playback. Do not run a counted customer turn as a “smoke test” in the stage session.

### Recording contract

Record one uninterrupted successful golden rehearsal after the candidate has qualified. The recording manifest binds its capture time, exact release/deployment identities, sandbox environment/provider fingerprint, its own Catalog Observation and golden relevance result, device/app version, lifecycle events, expected checkpoints/cues, duration, media checksum, and source proof artifacts. It must show the same customer-facing journey and truth boundaries and pass the same visual/cue review, but it never increments a streak.

The recording is evidence of what that release did against the catalog observation captured then. It is not evidence that the menu API, price, availability, payment, order, or delivery state is current at presentation time. A later unrelated catalog change need not invalidate playback; a relevant change requires a new recording or explicit narration that the shown item/details were valid only at capture. Never edit together separate attempts or conceal a wait, retry, repair, contradiction, or failed mutation.

### On-stage abort and fallback

Do not start live when any day-of preflight check fails, the current catalog no longer verifies the golden journey, the stage session is not empty, the exact release cannot be proven, lifecycle control is unavailable, or the recording is not ready. During the live segment, stop interaction and switch once—without retrying—when any applicable per-step deadline is missed; connectivity/readiness or capture is lost; an unsupported price/menu/store/fee/ETA/payment/status claim appears; text, GenUI, provider, persisted state, or monitor contradicts another; an action mutates unexpectedly or twice; the wrong session/environment appears; or the presenter would need to repair state manually. Preserve the live failure after the presentation.

Approved presenter wording:

- Live: `Đây là lượt chạy trực tiếp trên bản phát hành đã kiểm chứng, dùng menu API hiện tại và môi trường thương mại sandbox.`
- Preflight fallback: `Lượt chạy trực tiếp không vượt qua kiểm tra trước giờ trình bày, nên tôi sẽ không gọi nó là bằng chứng trực tiếp.`
- Recording handoff: `Đây là bản ghi liền mạch của cùng bản phát hành, chụp lúc <time> với phiên bản menu <observation>. Nó minh họa hành trình đã kiểm chứng tại thời điểm ghi, không khẳng định giá, khả dụng hay trạng thái hiện tại.`
- Scope: `Thanh toán, đơn hàng và giao hàng được xác minh trong môi trường sandbox đã cấu hình; đây không phải tuyên bố tích hợp hệ thống KFC production.`

Do not say `the API is live now`, `current menu`, `same current data`, `real payment/order`, or equivalent while a recording is playing unless a separate current live check actually proves that exact claim and is clearly distinguished from the recording.

### Confirmed implementation gaps

The repository already supplies the narrow foundation: clean exact-SHA deployment helpers, matching Pages release assets, deep readiness, D1 durability, immutable proof directories, checksum/secret scans, and a 40-sample production latency probe. It is not ready under this contract yet. `run-kfc-deployed-acceptance.sh` still runs the obsolete nine-scenario browser proof and a supplemental outcome judge; the GenUI proof can locally auto-start/interpose fixture-backed infrastructure; the real-Messenger 14-turn proof and deterministic full projection parity do not exist; and current readiness/artifacts do not carry all environment, lifecycle, catalog-observation, pass-streak, reset, rehearsal, or recording bindings. Ticket 11 must sequence the minimum edits to close these gaps rather than adding a parallel harness.
