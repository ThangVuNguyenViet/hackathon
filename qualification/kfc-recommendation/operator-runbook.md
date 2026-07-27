# KFC recommendation Task 9 operator runbook

Run this only from a clean committed Task 9 source revision. Every generated
path below must be new; never overwrite or delete a failed attempt.

## 1. Interactive authorization blockers

Hugging Face currently requires interactive authorization:

```bash
cd services/kfc-recommendation-simulator
uv run hf auth login
uv run hf auth whoami
```

`hf auth login` asks for a token created at
`https://huggingface.co/settings/tokens`. It does not issue a one-time device
code. Do not paste the token into Codex output or save it in this repository.

Sanity currently requires interactive authorization:

```bash
cd services/kfc-recommendation-sanity
npx sanity login --provider google --no-open
npx sanity projects list
```

The login command prints a fresh, per-attempt browser URL. Open that exact URL
and complete Google login. There is no stable URL or current code to record in
source control.

Cloudflare authorization is checked separately:

```bash
cd services/kfc-agent-backend
npx wrangler whoami
```

## 2. Package the immutable local model publication

Set new artifact paths and the committed source revision:

```bash
export TASK9_SOURCE_COMMIT="$(git rev-parse HEAD)"
export TASK9_ARTIFACT_ROOT="$PWD/.artifacts/kfc-recommendation-task-9/$TASK9_SOURCE_COMMIT"
mkdir -p "$TASK9_ARTIFACT_ROOT"

cd services/kfc-recommendation-simulator
uv run kfc-rec-sim package-shadow-models \
  --smart-cross-sell-qualification /Users/vietthangvunguyen/Workspace/hackathon/.worktrees/kfc-smart-cross-sell-ranker/.artifacts/kfc-recommendation-simulator/smart-cross-sell-qualification-v1 \
  --modifier-upsell-qualification /Users/vietthangvunguyen/Workspace/hackathon/.worktrees/kfc-modifier-upsell-ranker/.artifacts/kfc-recommendation-simulator/modifier-upsell-qualification-v1 \
  --output "$TASK9_ARTIFACT_ROOT/qualified-model"

uv run kfc-rec-sim prepare-model-publication \
  --mlflow-model "$TASK9_ARTIFACT_ROOT/qualified-model" \
  --smart-cross-sell-feature-schema /Users/vietthangvunguyen/Workspace/hackathon/.worktrees/kfc-smart-cross-sell-ranker/.artifacts/kfc-recommendation-simulator/smart-cross-sell-qualification-v1/models/lightgbm/feature-schema.json \
  --modifier-upsell-feature-schema /Users/vietthangvunguyen/Workspace/hackathon/.worktrees/kfc-modifier-upsell-ranker/.artifacts/kfc-recommendation-simulator/modifier-upsell-qualification-v1/models/keras/feature-schema.json \
  --source-commit "$TASK9_SOURCE_COMMIT" \
  --output "$TASK9_ARTIFACT_ROOT/model-publication"
```

`publication-manifest.json` recursively pins every staged byte, the two
qualification-result digests, MLflow signature, bundle digest, and source
commit. `probe-request.json` contains one already-eligible row for each
placement.

## 3. Verify the Docker Space locally

```bash
docker build \
  --tag kfc-recommendation-shadow-task9:"${TASK9_SOURCE_COMMIT:0:12}" \
  services/kfc-recommendation-shadow-space

docker run --rm \
  --publish 7860:7860 \
  --env KFC_MODEL_LOCAL_PATH=/model \
  --volume "$TASK9_ARTIFACT_ROOT/qualified-model:/model:ro" \
  kfc-recommendation-shadow-task9:"${TASK9_SOURCE_COMMIT:0:12}"
```

From a second terminal:

```bash
curl --fail --silent --show-error http://127.0.0.1:7860/health
curl --fail --silent --show-error \
  --header 'content-type: application/json' \
  --data-binary "@$TASK9_ARTIFACT_ROOT/model-publication/probe-request.json" \
  http://127.0.0.1:7860/invocations
```

## 4. Create and publish the exact Hugging Face resources

The publisher derives the namespace from the authenticated CLI identity. It
creates exactly these public repositories and records the upload callback OIDs:

- `kfc-vietnam-recommendation-shadow-20260727`
- `kfc-vietnam-recommendation-shadow-space-20260727`

```bash
cd services/kfc-recommendation-simulator
uv run python scripts/publish-hugging-face.py \
  --model-publication "$TASK9_ARTIFACT_ROOT/model-publication" \
  --space-source ../kfc-recommendation-shadow-space \
  --space-publication "$TASK9_ARTIFACT_ROOT/space-publication" \
  --source-commit "$TASK9_SOURCE_COMMIT" \
  --output "$TASK9_ARTIFACT_ROOT/hugging-face-publication.json"
```

Do not copy a branch name such as `main` into a model binding. The generated
Space pins the model upload callback's immutable hexadecimal revision.

## 5. Create, deploy, seed, and publicly verify Sanity

```bash
cd services/kfc-recommendation-sanity
npx sanity projects create "kfc-vietnam-recommendation-poc" \
  --dataset production \
  --dataset-visibility public \
  --yes \
  --json > "$TASK9_ARTIFACT_ROOT/sanity-project.json"

export SANITY_PROJECT_ID="$(
  node -e "const fs=require('fs');const value=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(!value.projectId)process.exit(1);process.stdout.write(value.projectId)" \
    "$TASK9_ARTIFACT_ROOT/sanity-project.json"
)"
export SANITY_DATASET=production
export SANITY_API_VERSION=2026-07-27

npm run schema:validate
npm run schema:deploy
npm run policies:seed
npm run policies:check
```

The seed command uses the logged-in CLI user's token in memory. The check
command omits the user token and verifies the five published documents through
the public dataset.

## 6. Deploy the callback-attested backend revision

Load the public Hugging Face output without printing secrets, then place these
public values in the untracked root `.env`:

- `KFC_RECOMMENDATION_SHADOW_URL`: the actual `space.appUrl`.
- `KFC_RECOMMENDATION_SHADOW_MODEL_REVISION`: the actual `model.revision`.
- `KFC_RECOMMENDATION_OUTPUT_MODE=baseline`.
- `SANITY_PROJECT_ID`: the actual created project ID.
- `SANITY_DATASET=production`.
- `SANITY_API_VERSION=2026-07-27`.

Keep existing `OPENAI_API_KEY`, `LANGSMITH_API_KEY`,
`KFC_DEMO_ADMIN_TOKEN`, and other credentials only in `.env`/Wrangler secret
storage. Then:

```bash
export RELEASE_GIT_SHA="$TASK9_SOURCE_COMMIT"
export ALLOW_NON_MAIN_DEPLOY=true
export CF_WORKER_NAME=kfc-agent-backend-recommendation-qualification
export DEPLOYMENT_OUTPUT_FILE="$TASK9_ARTIFACT_ROOT/worker-deployment.json"
./scripts/deploy-backend-cloudflare-worker.sh
```

The deploy script applies D1 migrations, including one unique deterministic
synthetic customer authority per narrative. It passes the public
Space/revision and Sanity bindings and rejects non-baseline qualification.
`/ready?deep=1` must callback-attest the exact clean source commit.

## 7. Run direct external and LangSmith no-model probes

Set the deployed URL from the actual deployment output, then:

```bash
cd services/kfc-agent-backend
export KFC_AGENT_BACKEND_URL='<actual worker URL from worker-deployment.json>'
export KFC_SHADOW_PROBE_REQUEST="$TASK9_ARTIFACT_ROOT/model-publication/probe-request.json"
export KFC_QUALIFICATION_PROBE_OUTPUT="$TASK9_ARTIFACT_ROOT/external-probe.json"
npm run sanity:policies:check
npm run qualification:externals:probe

export KFC_LANGSMITH_PROBE_OUTPUT="$TASK9_ARTIFACT_ROOT/langsmith-no-model-probe.json"
npm run qualification:langsmith:probe
```

A LangSmith quota error is preserved as an external evidence blocker. It is not
an implementation failure and must not be hidden by retrying with a model call.

After the direct probe has produced the actual Sanity snapshot digest, create
the public provenance file with `kfc-rec-sim write-public-provenance`, passing
only the actual IDs/revisions/digests from
`hugging-face-publication.json`, `external-probe.json`, and
`TASK9_SOURCE_COMMIT`.

## 8. Run eight controller-owned Codex role-players and evaluators

The application must not role-play, evaluate, call an evaluator model, replay
the historical turns, or decide which GenUI action to submit.

For each narrative, the controller starts a fresh Codex subagent and a fresh
bridge process:

```bash
cd services/kfc-agent-backend
npm run scenario:live -- \
  --scenario qualification/kfc-recommendation/narratives/<file>.json \
  --candidate openai-gpt-4.1-mini \
  --run-id <new-unique-run-id> \
  --attempt 1 \
  --customer-id <customer-authority-named-in-the-narrative>
```

The role-player sees the emitted narrative and customer-safe assistant output,
then sends exactly one improvised JSONL command at a time. An action command may
contain only an exact previously observed
`assistantTurnId`/`attachmentId`/`actionId` tuple. Finish explicitly; never pipe
`scenario.turns` into stdin.

After each terminal evidence directory exists, launch a different fresh Codex
subagent. Give that evaluator only `codex-review-packet.md` plus the verdict
vocabulary `successful`, `partial`, `unsuccessful`, or
`insufficient_evidence`. Save its result in the shape of
`evaluation-template.json`, including:

- the actual evaluator task ID;
- SHA-256 of the exact `evidence-packet.json`;
- specific artifact/pointer citations; and
- concerns without inspecting sibling runs or implementation code.

Finally prepare a private finalize-input JSON containing the eight narrative,
evidence-directory, and evaluation paths plus the three external artifact
paths. Then:

```bash
export KFC_QUALIFICATION_FINALIZE_INPUT='<actual finalize-input JSON path>'
export KFC_QUALIFICATION_MANIFEST_OUTPUT="$TASK9_ARTIFACT_ROOT/qualification-manifest.json"
npm run qualification:finalize
```

The finalizer rejects a missing Task 8 artifact, wrong scenario inventory,
unsupported verdict, missing citation, or evaluator/evidence digest mismatch.
