# Two-Pages Deployment and Provenance Runbook

This runbook deploys one backend Worker and two Flutter Pages projects from one clean commit:

- customer chatbot: `kfc-ai-chatbot`
- operations monitor: `kfc-ai-live-monitor`

Both Pages artifacts contain the same `/release.json` values: `gitSha`, `releaseBuiltAt`, and `dirty: false`. The deployment helper refuses a dirty worktree and builds with `--pwa-strategy=none`, preventing an old service worker from hiding a newly deployed release.

## Prerequisites

Authenticate Wrangler and configure the Worker secrets described in `hackathon-free-deploy.md`. The two Pages projects must already exist. Run every command from the repository root.

The checked-in `services/kfc-agent-backend/wrangler.toml` is sandbox-only. For production, copy `wrangler.production.toml.example` to an untracked `wrangler.production.toml`, provision a distinct D1 database and queues, replace the placeholder database ID, and set `KFC_WRANGLER_CONFIG` plus `KFC_D1_DATABASE_NAME`. Deployment fails closed if production would reuse the sandbox config.

## 1. Verify a clean source commit

```bash
git status --short
git rev-parse HEAD
```

Do not continue unless `git status --short` is empty. The Pages script enforces this because the release contract requires `dirty=false`.

## 2. Deploy the backend Worker

```bash
DEPLOYMENT_OUTPUT_FILE=artifacts/deployment/worker-deployment.json \
  ./scripts/deploy-backend-cloudflare-worker.sh
```

The script builds the Worker, applies remote D1 migrations, deploys it, derives the actual `workers.dev` URL from Wrangler output, checks `/health` and `/ready`, and writes machine-readable deployment metadata.

If Wrangler does not print the URL for the account configuration, provide the verified URL explicitly:

```bash
CF_WORKER_URL=https://verified-worker.example.workers.dev \
  ./scripts/deploy-backend-cloudflare-worker.sh
```

## 3. Deploy both Pages projects

Read the Worker target from the previous deployment artifact and deploy both Pages surfaces:

```bash
export KFC_AGENT_BACKEND_URL="$(jq -r .workerUrl artifacts/deployment/worker-deployment.json)"
DEPLOYMENT_OUTPUT_FILE=artifacts/deployment/pages-deployment.json \
  ./scripts/deploy-dashboard-cloudflare-pages.sh
```

The helper uses one `gitSha` and one `releaseBuiltAt` for both builds. It updates the `KFC_AGENT_BACKEND_URL` Pages secret for each project before deploying, so no backend URL is committed into `_worker.js`.

The chatbot proxy permits `/ready`, `/chat/kfc/message`, and `/chat/kfc/genui-action`. The monitor proxy permits `/ready` and `/dashboard/*`, including the `/dashboard/socket` live WebSocket transport. Other requests are served as static Flutter assets.

## 4. Verify provenance and routing

```bash
CHATBOT_URL="$(jq -r .deployments.chatbot.url artifacts/deployment/pages-deployment.json)"
MONITOR_URL="$(jq -r .deployments.monitor.url artifacts/deployment/pages-deployment.json)"

curl -fsS "$CHATBOT_URL/release.json" | jq .
curl -fsS "$MONITOR_URL/release.json" | jq .
curl -fsS "$CHATBOT_URL/ready" | jq .
curl -fsS "$MONITOR_URL/ready" | jq .

diff \
  <(curl -fsS "$CHATBOT_URL/release.json") \
  <(curl -fsS "$MONITOR_URL/release.json")
```

The `diff` must be empty. Confirm that both responses match the current `git rev-parse HEAD`, share the same `releaseBuiltAt`, and report `dirty` as `false`.

## 5. Run deployed qualification

The acceptance runner owns the complete release gate in two resumable phases: exact Worker/Pages identities, current deep-readiness bindings, three consolidated 44-turn matrix cycles, separate boundary tests, durable Flutter rendering, three Messenger journeys, two additional golden-only passes, the production latency report, same-release durability, stage evidence, secret scanning, checksums, and publication.

```bash
export KFC_QUALIFICATION_INPUT_DIR=/absolute/path/to/approved-cycle-inputs
export KFC_GENUI_FLUTTER_DEVICE=macos
./scripts/run-kfc-deployed-acceptance.sh
```

Cycle inputs provide only the approved golden operations and Messenger tester identity. The runner creates and resets fresh deployed branch/golden sessions, creates their lifecycle instance, replays all 44 source turns against the deployed Worker, and generates a schema-bound, hashed catalog relevance diff from consecutive readiness observations. Relevant drift conservatively resets the affected streak; qualification requires independent final streaks of five golden and three matrix passes.

On success, qualification stops before stage capture and writes `qualification-gate.json` plus `qualification-digests.json`. The digest manifest covers the fixed qualification artifact allowlist and every approved input; publication recomputes both sets, while explicitly named publication retry outputs remain outside the qualification root. The latency report is copied into the proof bundle and binds its Pages endpoint, exact release identity, start, completion, and trace run. Qualification, latency, and the gate must each be no more than 24 hours old. Copy the gate's unpredictable `gateId` into the `qualificationGateId` field of every new stage evidence record. Capture the recording only after both qualification and latency finish, then rehearsal 1, rehearsal 2, preflight, and final run in that strict order. Resume the same run explicitly with the same qualification inputs available for digest verification:

```bash
export KFC_STAGE_EVIDENCE_DIR=/absolute/path/to/stage-evidence
export KFC_QUALIFICATION_INPUT_DIR=/absolute/path/to/approved-cycle-inputs
KFC_ACCEPTANCE_PHASE=publish KFC_PROOF_RUN_ID=<qualified-run-id> \
  ./scripts/run-kfc-deployed-acceptance.sh
```

`KFC_STAGE_EVIDENCE_DIR` must contain `recording-manifest.json`, `rehearsal-1.json`, `rehearsal-2.json`, `final-run.json`, and `stage-preflight.json`, all release-bound PASS records bound to the current gate. The recording manifest points to a checksum-bound recording of at least five minutes and records the qualified catalog observation ID/hash plus the seven expected GenUI states. Rehearsals 1 and 2 must be zero-retry, zero-repair consecutive passes, both proving fallback playback. Publication rejects a gate or stage record that is missing, over 24 hours old, out of order, or future-dated. Immediately before publication it rechecks the Worker and both canonical Pages release identities with at most three observations each.

Accepted evidence is secret-scanned, indexed by `proof-manifest.json`, verified in `SHA256SUMS`, and published as `proof-bundle.tar.gz`.

The proof run ID is used as an artifact-directory name and must contain only ASCII letters, digits, `.`, `_`, or `-`; slashes, traversal segments, and control characters are rejected. Release metadata is serialized as JSON, and publication hygiene scans binary screenshots as well as text artifacts.

Finally, open the monitor to confirm session polling and the live socket. Preserve `worker-deployment.json` and `pages-deployment.json` with the demo proof artifacts.
