# LangChain-only business agents qualification

Date: 2026-08-12

Branch: `codex/langchain-tinyfish-runtime`

Base: `3008f6f210aae5aa4b75832e24193b21eed6fcf9`

This change supersedes the direction explored in
[PR #69](https://github.com/ThangVuNguyenViet/hackathon/pull/69); it does not
merge that diverged branch. The reusable agent-loop-first decision is recorded
in ADR-0002.

## Delivered architecture

- KFC and PVCFC execute through separate LangChain `createAgent` packs.
- The shared dispatch boundary contains only trusted pack identity and
  `runTurn`; it has no universal business policy.
- Direct OpenAI Agents SDK execution, application-authored LangGraph runtime,
  graph checkpointers, framework session transcript, and runtime selector are
  removed.
- D1/PostgreSQL application state remains authoritative for transcript,
  authorization, confirmation, idempotency, effects, verified state, and
  delivery.
- PVCFC retains 497 reachable fixture records across 12 collections, including
  67 products and 79 discovery-only source inventory records.
- Both packs have optional, separately governed TinyFish Search and Fetch.
  Canonical provider/API evidence remains authoritative.
- The packaged PVCFC React demo exposes nine evidence-backed scenarios and six
  suggestion pills.

## Commit inventory

- `8c8bb6c1` — design
- `a5825aa5`, `6871c506` — implementation plan and clean-cut amendment
- `c7f1428d` through `6c0fcafe` — neutral boundary, legacy demolition,
  LangChain pack rebuilds, routing, confirmation/persistence parity
- `95e706e1`, `30adf884` — bounded TinyFish adapter and URL/port safety
- `130b7451`, `d9ac1e15`, `85e9d46d` — PVCFC web evidence and review fixes
- `5528627a`, `fc386200` — KFC supplemental web evidence and review fixes
- `e2c85d40` — maintained LangChain/LangSmith observability
- `0dbfeecd`, `0ab53ade`, `0fa0fc6c` — PVCFC demo and deploy alignment
- `5c6bada1` — active CI cleanup
- `docs: qualify LangChain-only business agents` — canary, ADR, operations
  documentation, and this report
- `fix(ci): qualify the packaged PVCFC client` — Node 24 clean-install web
  qualification and same-origin packaged API endpoint (review fix)

## Deterministic qualification

All commands used Node 24.14.0.

| Surface | Command | Result |
| --- | --- | --- |
| PVCFC fixture | `npm run fixtures:pvcfc:check` | pass |
| KFC policies | `npm run policies:check` | pass |
| Backend | `npm run check` | pass; format, lint budget (383 warnings), typecheck, 2,015 passed / 1 skipped |
| Backend build | `npm run build` | pass; TypeScript plus packaged PVCFC client |
| Worker | `npm run worker:deploy:dry-run` | pass; 12,718.07 KiB raw / 1,336.81 KiB gzip |
| PVCFC web | `npm test -- --run` | pass; 10/10 |
| PVCFC web | `npm run build` | pass |
| Clean installs | backend and PVCFC web `npm ci` | pass from both lockfiles |
| Packaged route | `bash tests/deployment/pvcfc_packaged_release.test.sh` | pass |
| Canary contracts | `npx vitest run test/scripts/run-tinyfish-live-canary.test.ts test/architecture/active-qualification-workflows.test.ts` | pass; 6/6 |
| Canary disabled | `npm run test:live:tinyfish` | clean skip |
| Canary missing key | `RUN_LIVE_TINYFISH=1 npm run test:live:tinyfish` | clean skip |

The plan's repository-wide literal grep is over-broad: it also matches
historical SDD reports, negative architecture-test literals, and LangChain's
transitive lockfile dependencies. A production-surface grep over
`src`, `scripts`, `package.json`, and active workflows returned no
forbidden runtime match; the maintained architecture guards also passed.

## Live qualification

`TINYFISH_API_KEY`, `GOOGLE_API_KEY`, and `OPENAI_API_KEY` were absent in
the qualification environment. No provider request was made. This is an
external credential limitation, not a deterministic implementation failure.

The maintained TinyFish canary is opt-in with
`RUN_LIVE_TINYFISH=1 TINYFISH_API_KEY=...`. It performs at most one search
against `www.pvcfc.com.vn` and one fetch through the production adapter,
revalidates the final URL against the PVCFC allowlist, and emits only search
latency, fetch latency, and a SHA-256 content digest.

The deleted graph-era live scenario commands are not claimed as current proof.
A replacement credentialed model matrix must target the LangChain business
packs directly.

## Removed infrastructure

- local OpenAI Agents SDK runtime package, executor, SDK tools, and session
  adapters
- authored LangGraph graph/schema/runner/studio configuration and D1/Postgres
  checkpointers
- dual-runtime route/config/readiness branches
- graph/SDK-specific live probes, evaluators, proof helpers, and obsolete tests
- private LangSmith lifecycle proxy and dead direct OpenAI diagnostics
- orphan scheduled OpenAI geographic canary workflow and retired manual
  StateGraph/OpenAI qualification jobs
- obsolete PVCFC action-card components and root static demo

The branch changes 344 files before this final report, with approximately
13,535 insertions and 76,066 deletions.

## Custom code retained, with justification

- KFC and PVCFC pack prompts, tools, provider adapters, evidence precedence,
  allowlists, and presentation are business-specific.
- Authorization, confirmations, irreversible-effect reservation, idempotency,
  atomic persistence, delivery outbox, cancellation, and human handoff are
  application invariants and security boundaries.
- Fixture provider normalization keeps PVCFC's temporary data source
  replaceable by the future official API without changing agent tool contracts.
- TinyFish normalization enforces URL/redirect/size/timeout/secret boundaries
  around the maintained SDK; each pack separately decides when web evidence is
  admissible.
- No global model/tool retry or second summary-memory state was added:
  effect tools are not generically retry-safe, and the canonical bounded
  application transcript remains the single memory source.

## Remaining rollout and cleanup

1. Run the credentialed TinyFish canary from the manual workflow and retain its
   latency/hash output as external live proof.
2. Design and approve a new live model scenario matrix against the current
   LangChain packs before restoring it as a release gate.
3. After rollout observation, remove unused SDK-session/LangGraph checkpoint
   database tables through explicit D1/PostgreSQL migrations; no destructive
   schema cleanup is included here.
4. Decide whether the unscheduled historical geographic-investigation config
   and operations note should be archived; no active workflow invokes them.
5. Replace PVCFC fixtures with the official business API provider when
   available; the four canonical tool operations remain stable.
