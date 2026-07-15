Status: resolved
Type: task
Labels: wayfinder:task
Parent: ../map.md
Blocked by: 10-design-deployed-release-gates-rehearsal-and-recorded-fallback.md
Assignee: Codex

## Question

Assemble the resolved contracts into an implementation-ready sequence and operator-ready demo runbook. Identify narrowly staged code/test slices, ownership boundaries, dependency order, safe handling of the existing dirty checkout, catalog-observation fetch/pin/revalidation points, versioned fixture-corpus maintenance, Commerce Environment and lifecycle-provider setup, deterministic and live command order, evidence locations, deployment freeze, rehearsal procedure, on-stage prompts/actions/narration, failure decision tree, and exact acceptance checklist. The output must let a separate implementation effort execute without reopening product or architecture decisions; do not implement product code in this ticket.

## Resolution

Implement this as one ordered migration on the existing runtime and proof seams. Do not build a second agent runtime, fixture loader, proof framework, or release driver. Merge each green code-and-test slice before starting its dependents.

### Non-negotiable target

- One native LangGraph `StateGraph` is the runtime. `runAgentTurn` may assemble trusted dependencies and invoke the compiled graph, but may not call a parallel legacy turn implementation.
- One `Annotation.Root` graph state carries node-to-node state. Typed domain values may remain nested, but there is no second mutable whole-turn envelope passed to a monolithic core.
- Keep the public trace topology: `load_context`, `classify_turn`, `route_turn`, `social_response` or `structured_action` or `plan_tools`, `manage_journey`, `execute_tools`, `enforce_invariants`, `compose_response`, `persist_turn`, and `monitor`. Each node owns its named work; no node secretly executes the remaining turn.
- Compile with an injected LangGraph `BaseCheckpointSaver`. `MemorySaver` is test/Studio-only. The Worker uses a minimal D1 saver through the already installed `@langchain/langgraph-checkpoint` contract, keyed by trusted `thread_id` and checkpoint namespace; add no checkpoint dependency.
- Interrupt before single-use irreversible confirmation. Resume the same durable thread only after re-reading current catalog, cart, fulfillment, payment-method, environment, scenario, and provider revisions. Stale binding fails closed; duplicate resume produces exactly one provider mutation.
- LangGraph checkpoints orchestrate the agent. The environment-scoped lifecycle provider remains the commerce system of record.
- Runtime truth always comes from the configured menu API. A proof/recommendation/cart pins its Catalog Observation; cart mutation and checkout revalidate it. Historical crawls are regression fixtures only.

### Checkout and ownership

The current main checkout is dirty and contains user and concurrent-agent work. Its owner must first create a stable named commit containing the intended changes; do not stash, clean, reset, or commit unrelated files on the user's behalf. Create one implementation worktree from that exact commit. A worktree avoids blocking normal use, but does not make overlapping edits merge-safe.

| Owner | Exclusive files while active | Coordination rule |
|---|---|---|
| Runtime | `src/graph/**`, `src/api/routeHandlers.ts`, `src/api/serverOptions.ts`, `src/config/env.ts`, `src/worker.ts`, checkpoint migrations | No concurrent edits to these bootstrap/runtime files |
| Commerce | `src/clients/**`, catalog/recommendation/fact/lifecycle modules, their migrations/tests | Land shared provider types before runtime integration |
| Proof | ledger, scenario tests, proof evaluators/scripts, Flutter integration proof | Messenger and Flutter may split only after the projection schema lands |
| Release | `package.json`, `docs/testing-scenarios.md`, root deployment/acceptance scripts, artifact library | Work last, after proof command/manifests settle |

If Runtime and Commerce both need `routeHandlers.ts`, `worker.ts`, or migrations, land the shared contract first and rebase. Merge to main only when its dirty-state fingerprint still matches the baseline or after the checkout owner reconciles it.

### Ordered implementation slices

| Slice | Minimum change on existing seams | Required check | Depends on |
|---:|---|---|---|
| 0 | Record dirty-tree baseline and failures; owner makes the stable commit and worktree. | Exact base SHA and unchanged user files recorded | None |
| 1 | Manifest separately versioned Catalog Baseline Fixtures. Preserve July 7 120/58, add July 10 118/56, validate both exhaustively, and assert `20751`/`20752` removal plus `41160` drift without unioning versions. Keep `fixtures:build`; make it copy/validate the corpus. | Fixture corpus/drift tests, then `npm run fixtures:build` | 0 |
| 2 | Add Catalog Observation parsing/validation beside existing commerce clients. Explicit startup and proof preflight fetch the configured menu API, validate its entire payload, record environment/provider validators/times/hashes/counts, and pin it. Remove default fixture commerce; missing/invalid provider configuration fails startup/readiness. | Config rejection and provider-agnostic catalog invariant tests | 1 |
| 3 | Make one environment-bound Verified Commerce Projection feed KFC and social presentation. Enforce evidence bindings/conflicts/freshness, isolate customer fixture/default fallbacks, and add deterministic eligibility -> scored rank -> safety rerank with current-revision ordinal consent. | Fact, recommendation, safety, money, cart-before/after, and no-fallback tests | 2 |
| 4 | Finish native node decomposition in `src/graph/**`: explicit graph channels, real phase ownership, and `runAgentTurn` only invoking the graph. Split a file only when the node gains an independent test. | `state-graph-migration.test.ts` plus focused branch/phase tests | 3 |
| 5 | Add D1 checkpoint tables and a minimal `BaseCheckpointSaver`; inject it into the Worker graph. Add native interrupt/resume at confirmation and provider/observation re-read on resume. | Restart/resume, stale binding, duplicate resume, and concurrent confirmation prove one irreversible call | 4 |
| 6 | Implement the durable sandbox Lifecycle Scenario Instance and ordinary provider contract on existing client/API/persistence seams. Register authenticated controls only in sandbox. Replace `simulated` proof classification with environment/provider provenance, without customer labels. | Exhaustive transitions/guards, isolation, revision/idempotency, faults, clock, seal/reset/expiry | 2, 5 |
| 7 | Materialize the Scenario Coverage Ledger and completeness test. Strengthen `live-ai-scenario-replay.test.ts`: scenarios 01-08 are the one 44-turn live planner/GenUI execution using `it.concurrent.each` and `maxConcurrency=2`; scenario 09 stays planner-only; the three boundaries stay separate. | Complete `npm test`, then existing live scenario/boundary commands | 3, 6 |
| 8 | Convert `run-live-genui-integration-proof.ts` from local auto-start/proxy and duplicate model replay into the deployed KFC Proof Run. Run golden serially; render/action-test persisted 44-turn snapshots without another model call. Bind capabilities, evidence, teardown, and report. | Existing script test, Flutter integration test, then `test:live:genui:integration` | 7 |
| 9 | Complete `demo-reset` across every session/checkpoint/scenario store; add deterministic Messenger projection parity, one real 14-turn journey, and duplicate/coalescing probes. Reuse webhook reservation, queue/coordinator, presenter, D1, Graph API, and monitor seams. | Existing Messenger tests, projection parity, then the new Messenger proof command | 7 |
| 10 | Extend deep readiness and manifests with release, environment/provider, observation, lifecycle, graph/checkpoint, model/prompt/tool/ranker/ledger, retry, latency, and hashes. | Readiness/manifest/schema tests and existing 40-sample latency command | 8, 9 |
| 11 | Modify `scripts/run-kfc-deployed-acceptance.sh`; do not replace it. Remove obsolete nine-browser-scenario acceptance, invoke KFC/Messenger proofs, preserve deploy/durability/secret/checksum/publication gates, and record five-golden/three-matrix streaks plus relevance resets. Update scripts/docs/contracts last. | Deployment contract, dry run, then complete deployed qualification | 10 |

For each slice: make one focused test red, fix the shared root seam, make it green, then run the complete deterministic suite. Do not defer a failing sibling caller.

### Command contract

**Existing** means present now. **Must add** means it cannot be used until its slice lands.

| Purpose | Repository-root command | Status |
|---|---|---|
| Backend build/test/dry-run | `cd services/kfc-agent-backend && npm run build && npm test && npm run worker:deploy:dry-run` | existing; keep normal deterministic parallelism |
| Deployment helper contracts | `bash tests/deployment/deploy_scripts.test.sh` | existing |
| Flutter gates | `cd apps/kfc_live_monitor_flutter && flutter pub get && flutter analyze && flutter test && flutter build web --release --pwa-strategy=none --target lib/main_customer.dart && flutter build web --release --pwa-strategy=none --target lib/main_live.dart` | existing CLIs |
| Scenarios 01-08 | `cd services/kfc-agent-backend && npm run test:live:scenarios` | existing |
| Scenario 09 | its focused planner test under `npm test` | existing; no GenUI replay |
| Three boundaries | `cd services/kfc-agent-backend && npm run test:live:small-talk-router && npm run test:live:direct-catalog && npm run test:live:interruption` | existing |
| Deployed KFC/Flutter proof | `cd services/kfc-agent-backend && npm run test:live:genui:integration` | existing name; semantics change in slice 8 |
| Real Messenger proof | `cd services/kfc-agent-backend && npm run proof:live:messenger` | **must add in slice 9** |
| Deployed latency | `cd services/kfc-agent-backend && npm run proof:production:latency` | existing |
| Full deploy/qualification | `bash scripts/run-kfc-deployed-acceptance.sh` | existing name; phases change in slice 11 |
| Day-of preflight | `cd services/kfc-agent-backend && npm run worker:preflight` | existing name; checks expand in slice 10 |

`docs/testing-scenarios.md` still names removed `live-ai-genui.test.ts` and `test:live:genui`; slice 11 replaces that stale instruction with the consolidated/durable-render flow.

### Evidence locations

Keep the existing immutable root `artifacts/kfc-deployed-proof/<run-id>/`. The candidate manifest links child evidence rather than copying it:

- release metadata, Worker/Pages deployments, canonical release files, and readiness;
- `catalog-observation.json`, fixture-corpus results, and semantic relevance diff;
- `kfc/manifest.json`, `kfc/golden/**`, `kfc/branches/**`, report, screenshots, and video;
- `messenger/manifest.json`, parity, journey, boundaries, and client/monitor captures;
- latency, durability, streak ledger, rehearsal manifests, recording manifest/media, failures, redaction, `SHA256SUMS`, and bundle.

Every failed or diagnostic attempt gets a new run ID. Never overwrite or promote an old local artifact. A report starts with `PASS`, `FAIL`, or `DIAGNOSTIC — NOT ACCEPTANCE`.

### Qualification and freeze

1. On one clean pushed SHA, run build, deterministic, Worker dry-run, deployment-contract, Flutter, secret/PII, and migration gates.
2. Deploy Worker and admitted migrations, then both Pages surfaces through existing helpers. Verify matching exact release identity, canonical Pages, callback/queue/D1/outbound/monitor/provider reachability, and same-release durability.
3. Fetch and exhaustively validate the current menu API. Verify current `20702` golden compatibility and create fresh identities plus a sandbox Lifecycle Scenario Instance. A fixture never satisfies this gate.
4. Run the existing 40-sample latency probe.
5. Run three complete cycles: a separately counted KFC golden, the 44-turn replay, durable Flutter rendering/actions, deterministic Messenger parity, one real 14-turn journey, and duplicate/coalescing probes. Use fresh identities each cycle.
6. Run two more fresh KFC golden attempts. Readiness requires independent consecutive streaks of five golden and three complete matrix passes.
7. Relevant catalog drift resets the affected streak. Unrelated drift preserves it only with a machine relevance diff. Any release/config/provider/lifecycle/model/prompt/graph/tool/ranker/ledger/oracle/harness change resets both.
8. Freeze code, dependencies, configuration, secrets, models/prompts, provider/lifecycle definitions, migrations, deployed artifacts, routing, ledger/oracles, proof scripts, and stage builds from the first counted cycle through presentation. Do not freeze menu data.
9. After qualification, record one uninterrupted golden rehearsal bound to its own observation/checksum. Complete two consecutive cue-checked rehearsals on the stage setup; the final one is within 24 hours and includes full fallback playback.

Counted turns, model calls, actions, provider mutations, and Messenger sends have one attempt. At most three recorded readiness polls occur before admission. Investigation uses a new diagnostic run.

### On-stage runbook

Immediately before stage, run the non-mutating preflight and verify exact release, readiness, current catalog relevance, empty session, lifecycle control, primary/backup network, display/audio/capture, and local recording playback/checksum. Do not smoke-test the stage session.

| Target | Action | Required result/cue |
|---:|---|---|
| 0:00-0:10 | Say `Một hành trình đặt món hoàn chỉnh; mọi giá và trạng thái đều đến từ môi trường hiện tại.` Ask `Có combo gà cay không?` | Current verified `20702`; menu control; no mutation |
| 0:10-0:35 | Select required spicy chicken, spicy burger, and two medium Pepsi; add | Revision 1, one `20702`, current provider price (golden expectation 129,000 VND) |
| 0:35-0:50 | Accept both drink upsizes | Both medium selections replaced; revision 2 (golden expectation 135,000 VND) |
| 0:50-1:20 | Submit full approved address; accept after quote | Accepted address/store/availability/fee/ETA; expected 153,000 VND only if current provider returns it |
| 1:20-1:40 | Ask `ZaloPay được không?`; choose it | Verified support; no order or paid claim |
| 1:40-1:55 | Review; invoke single-use confirmation | One provider order, pending payment, URL; no duplicate |
| 1:55-2:15 | Complete sandbox checkout; operator sends approved payment event | Provider advances payment; wording does not |
| 2:15-2:28 | Ask `Thanh toán xong chưa?` | Fresh read says `paid` |
| 2:28-2:40 | Advance order; ask `Đơn đang làm chưa?` | Fresh read says `preparing` |
| 2:40-2:52 | Advance delivery; ask `Bao giờ giao tới?` | Fresh read says `delivering` with current ETA |
| by 2:55 | Say `AI tìm đúng món; khách kiểm soát mọi thay đổi và xác nhận; giá, thanh toán và giao hàng đều được kiểm tra lại.` | End by 165 seconds; 180 is failure |

First progress is due within two seconds, discovery within eight, mutation within three, status within five, and every turn within ten.

### Failure tree

```text
Preflight/release/catalog/session/lifecycle/recording check fails
  -> do not start live
  -> disclose that live preflight failed
  -> play the verified recording with capture time and observation

Live deadline/connectivity/capture/fact/contradiction/mutation/environment failure
  -> stop once; do not retry or repair
  -> preserve failure
  -> switch to verified recording

Recording checksum/playback fails
  -> claim neither live nor recorded proof
  -> present only the already-qualified scoped architecture/evidence
```

Live: `Đây là lượt chạy trực tiếp trên bản phát hành đã kiểm chứng, dùng menu API hiện tại và môi trường thương mại sandbox.`

Fallback: `Lượt chạy trực tiếp không vượt qua kiểm tra trước giờ trình bày, nên tôi sẽ không gọi nó là bằng chứng trực tiếp.`

Recording: `Đây là bản ghi liền mạch của cùng bản phát hành, chụp lúc <time> với phiên bản menu <observation>. Nó minh họa hành trình đã kiểm chứng tại thời điểm ghi, không khẳng định giá, khả dụng hay trạng thái hiện tại.`

Scope: `Thanh toán, đơn hàng và giao hàng được xác minh trong môi trường sandbox đã cấu hình; đây không phải tuyên bố tích hợp hệ thống KFC production.`

### Acceptance checklist

- [ ] Clean pushed SHA; matching Worker/customer/monitor releases and immutable manifest.
- [ ] One native decomposed StateGraph; no legacy wrapper; durable Worker checkpointer and interrupt/resume.
- [ ] Current API observation exhaustively validated, pinned, revalidated; no fixture runtime fallback.
- [ ] Every crawl remains a separate exhaustively tested fixture version.
- [ ] Explicit production/sandbox environment; environment-scoped provider; sandbox controls authenticated and absent in production.
- [ ] Fact, recommendation, consent, money, lifecycle, environment, idempotency, concurrency, fault, persistence, and surface hard oracles pass.
- [ ] Ledger complete; 44/44 turns once at `maxConcurrency=2`; scenario 09 and three boundaries separate.
- [ ] KFC golden/Flutter durable-render and Messenger parity/14-turn/transport proofs pass without duplicate model replay.
- [ ] No skip, quarantine, hidden retry, repair, fallback, unsupported fact, missing reply, duplicate mutation/send, or contradiction.
- [ ] Forty-sample latency and all absolute deadlines pass.
- [ ] Five consecutive golden and three consecutive matrix passes hold with catalog-relevance evidence.
- [ ] Secret/PII, schemas, hashes, durability, teardown, and publication pass.
- [ ] Observation-bound recording and two consecutive rehearsals pass; final rehearsal is within 24 hours; stage preflight passes.

When every box is checked, no product or architecture question remains. A failed box is an execution defect or release stop, not permission to invent fallback behavior.
