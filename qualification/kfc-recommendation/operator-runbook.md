# KFC recommendation Task 9 operator runbook

Runtime profile: `local_docker_cloudflare_tunnel`.

Run only from a clean committed Task 9 revision. Every evidence directory must
be new. Never overwrite a failed attempt, print a credential, or modify an
unrelated Cloudflare DNS route, Sanity project, or Hugging Face repository.

The Hugging Face model repository is artifact authority. The public runtime is
an operator-managed Cloudflare transport to a local MLflow container. The Mac,
Docker container, and `cloudflared` process must remain running for the demo
URL to work. This is not production availability.

## 1. Verify authoritative public resources

The approved resources are:

- model repository:
  `thangvu132/kfc-vietnam-recommendation-shadow-20260727`;
- model revision:
  `129754a17b513b93efb3071ca4af9f42bb2a2f9c`;
- model publication digest:
  `605d6ac494154e9d316985aa72c56de51f10679826f5878ba5115fe1fbd5dfc6`;
- served model revision (`trustedArtifactManifestDigest`):
  `10da1b47f6d744e0b1f118950a77de9811c90ab44a2b876f6a62e7cce56e537a`;
- Sanity project: `09hoxft9`;
- public Sanity dataset: `production`;
- Sanity snapshot digest:
  `87c4f52022e3090119d7261eff13c5afd3cd763a7366428bb74eb4479514fcb2`.

Verify without printing credentials:

```bash
cd services/kfc-recommendation-simulator
uv run hf auth whoami

cd ../kfc-recommendation-sanity
export SANITY_PROJECT_ID=09hoxft9
export SANITY_DATASET=production
export SANITY_API_VERSION=2026-07-27
npx sanity datasets visibility get production
npm run policies:check

cd ../kfc-agent-backend
npx wrangler whoami
docker version
cloudflared --version
```

## 2. Prepare the pinned local runtime publication

From the repository root:

```bash
export TASK9_SOURCE_COMMIT="$(git rev-parse HEAD)"
export TASK9_ARTIFACT_ROOT="$PWD/.artifacts/kfc-recommendation-task-9/$TASK9_SOURCE_COMMIT"
mkdir -p "$TASK9_ARTIFACT_ROOT"

cd services/kfc-recommendation-simulator
uv run kfc-rec-sim prepare-local-runtime-publication \
  --source ../kfc-recommendation-shadow-runtime \
  --source-commit "$TASK9_SOURCE_COMMIT" \
  --model-repository-id thangvu132/kfc-vietnam-recommendation-shadow-20260727 \
  --model-revision 129754a17b513b93efb3071ca4af9f42bb2a2f9c \
  --output "$TASK9_ARTIFACT_ROOT/runtime-publication"

uv run hf download \
  thangvu132/kfc-vietnam-recommendation-shadow-20260727 \
  probe-request.json \
  --revision 129754a17b513b93efb3071ca4af9f42bb2a2f9c \
  --local-dir "$TASK9_ARTIFACT_ROOT/model-probe"
```

`runtime-publication-manifest.json` hashes the Docker runtime, pins the exact
model revision, declares operator-managed availability, and contains no
credential.

## 3. Build and start the local MLflow container

Use a commit-specific name. Do not replace another running container:

```bash
export KFC_SHADOW_IMAGE="kfc-recommendation-shadow-task9:${TASK9_SOURCE_COMMIT:0:12}"
export KFC_SHADOW_CONTAINER="kfc-recommendation-shadow-${TASK9_SOURCE_COMMIT:0:12}"

docker build \
  --tag "$KFC_SHADOW_IMAGE" \
  "$TASK9_ARTIFACT_ROOT/runtime-publication"

docker run --detach \
  --name "$KFC_SHADOW_CONTAINER" \
  --publish 127.0.0.1:7860:7860 \
  "$KFC_SHADOW_IMAGE"

docker inspect "$KFC_SHADOW_CONTAINER" \
  > "$TASK9_ARTIFACT_ROOT/shadow-container-inspect.json"
docker inspect --format '{{.LogPath}}' "$KFC_SHADOW_CONTAINER" \
  > "$TASK9_ARTIFACT_ROOT/shadow-container-log-path.txt"
```

Verify both local routes:

```bash
curl --fail --silent --show-error http://127.0.0.1:7860/health
curl --fail --silent --show-error \
  --header 'content-type: application/json' \
  --data-binary "@$TASK9_ARTIFACT_ROOT/model-probe/probe-request.json" \
  http://127.0.0.1:7860/invocations
```

## 4. Start the free Cloudflare Tunnel

First inspect existing named tunnels and local configuration. Reuse a named
tunnel only when it is already owned by the user and already routes this exact
shadow service without any DNS or ingress change:

```bash
cloudflared tunnel list
```

Otherwise use a TryCloudflare quick tunnel:

```bash
export KFC_TUNNEL_LOG="$TASK9_ARTIFACT_ROOT/cloudflared-quick-tunnel.log"
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:7860 \
  > "$KFC_TUNNEL_LOG" 2>&1 &
export KFC_TUNNEL_PID=$!
printf '%s\n' "$KFC_TUNNEL_PID" \
  > "$TASK9_ARTIFACT_ROOT/cloudflared-quick-tunnel.pid"
```

Read the generated `https://*.trycloudflare.com` URL from the log and set:

```bash
export KFC_RECOMMENDATION_SHADOW_URL='<actual generated HTTPS origin>'
export KFC_RECOMMENDATION_SHADOW_RUNTIME_PROFILE=local_docker_cloudflare_tunnel
export KFC_RECOMMENDATION_SHADOW_MODEL_REVISION=10da1b47f6d744e0b1f118950a77de9811c90ab44a2b876f6a62e7cce56e537a
export KFC_RECOMMENDATION_OUTPUT_MODE=baseline
```

A quick-tunnel URL is ephemeral. If `cloudflared` restarts, obtain the new URL,
rerun public probes, and redeploy the Worker binding.

Verify the public transport:

```bash
curl --fail --silent --show-error \
  "$KFC_RECOMMENDATION_SHADOW_URL/health"
curl --fail --silent --show-error \
  --header 'content-type: application/json' \
  --data-binary "@$TASK9_ARTIFACT_ROOT/model-probe/probe-request.json" \
  "$KFC_RECOMMENDATION_SHADOW_URL/invocations"
```

## 5. Write safe public provenance

Capture the image digest without its `sha256:` prefix and write only public
runtime, model, and Sanity identifiers:

```bash
export KFC_SHADOW_IMAGE_DIGEST="$(
  docker image inspect --format '{{.Id}}' "$KFC_SHADOW_IMAGE" |
    sed 's/^sha256://'
)"
export KFC_RUNTIME_PUBLICATION_DIGEST="$(
  node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(p.contentDigest)" \
    "$TASK9_ARTIFACT_ROOT/runtime-publication/runtime-publication-manifest.json"
)"

cd services/kfc-recommendation-simulator
uv run kfc-rec-sim write-public-provenance \
  --source-commit "$TASK9_SOURCE_COMMIT" \
  --model-repository-id thangvu132/kfc-vietnam-recommendation-shadow-20260727 \
  --model-revision 129754a17b513b93efb3071ca4af9f42bb2a2f9c \
  --model-publication-digest 605d6ac494154e9d316985aa72c56de51f10679826f5878ba5115fe1fbd5dfc6 \
  --runtime-profile local_docker_cloudflare_tunnel \
  --runtime-public-url "$KFC_RECOMMENDATION_SHADOW_URL" \
  --runtime-publication-digest "$KFC_RUNTIME_PUBLICATION_DIGEST" \
  --runtime-container-image-digest "$KFC_SHADOW_IMAGE_DIGEST" \
  --runtime-served-model-revision 10da1b47f6d744e0b1f118950a77de9811c90ab44a2b876f6a62e7cce56e537a \
  --runtime-tunnel-kind trycloudflare_quick_tunnel \
  --sanity-project-id 09hoxft9 \
  --sanity-dataset production \
  --sanity-snapshot-digest 87c4f52022e3090119d7261eff13c5afd3cd763a7366428bb74eb4479514fcb2 \
  --output "$TASK9_ARTIFACT_ROOT/public-provenance.json"
```

## 6. Deploy the callback-attested Worker

Load credentials from the untracked parent `.env` only into the process. Never
print or copy their values into evidence:

```bash
cd services/kfc-agent-backend
set -a
source /Users/vietthangvunguyen/Workspace/hackathon/.env
set +a

export RELEASE_GIT_SHA="$TASK9_SOURCE_COMMIT"
export ALLOW_NON_MAIN_DEPLOY=true
export CF_WORKER_NAME=kfc-agent-backend-recommendation-qualification
export DEPLOYMENT_OUTPUT_FILE="$TASK9_ARTIFACT_ROOT/worker-deployment.json"
export KFC_RECOMMENDATION_SHADOW_URL
export KFC_RECOMMENDATION_SHADOW_RUNTIME_PROFILE=local_docker_cloudflare_tunnel
export KFC_RECOMMENDATION_SHADOW_MODEL_REVISION=10da1b47f6d744e0b1f118950a77de9811c90ab44a2b876f6a62e7cce56e537a
export KFC_RECOMMENDATION_OUTPUT_MODE=baseline
export SANITY_PROJECT_ID=09hoxft9
export SANITY_DATASET=production
export SANITY_API_VERSION=2026-07-27

../../scripts/deploy-backend-cloudflare-worker.sh
```

`KFC_DEMO_ADMIN_TOKEN` is the protected bridge credential mechanism. It is
loaded from the untracked `.env` and written to Wrangler secret storage by the
deployment script. Only its variable name and presence may be reported.

## 7. Run public and backend probes

Load the Worker URL from `worker-deployment.json`, then:

```bash
export KFC_AGENT_BACKEND_URL='<actual workers.dev URL>'
export KFC_SHADOW_PROBE_REQUEST="$TASK9_ARTIFACT_ROOT/model-probe/probe-request.json"
export KFC_QUALIFICATION_PROBE_OUTPUT="$TASK9_ARTIFACT_ROOT/external-probe.json"
export KFC_RECOMMENDATION_SHADOW_URL
export KFC_RECOMMENDATION_SHADOW_RUNTIME_PROFILE=local_docker_cloudflare_tunnel
export KFC_RECOMMENDATION_SHADOW_MODEL_REVISION=10da1b47f6d744e0b1f118950a77de9811c90ab44a2b876f6a62e7cce56e537a
export RELEASE_GIT_SHA="$TASK9_SOURCE_COMMIT"
export SANITY_PROJECT_ID=09hoxft9
export SANITY_DATASET=production
export SANITY_API_VERSION=2026-07-27

npm run qualification:externals:probe
```

The LangSmith no-model probe remains independent. Preserve HTTP 429 quota
evidence and continue without claiming LangSmith queryability.

## 8. Controller role-player and evaluator handoff

Do not start the eight runs until all of these exist:

- actual `KFC_AGENT_BACKEND_URL`;
- `KFC_DEMO_ADMIN_TOKEN` present in the controller process, never printed;
- live `cloudflared` PID and log path;
- live Docker container ID and Docker log path;
- `public-provenance.json`;
- `external-probe.json`; and
- a new evidence root under
  `$TASK9_ARTIFACT_ROOT/controller-qualification/`.

The controller starts one fresh bridge and role-player per narrative:

```bash
npm run scenario:live -- \
  --scenario qualification/kfc-recommendation/narratives/<file>.json \
  --candidate openai-gpt-4.1-mini \
  --run-id <new-unique-run-id> \
  --attempt 1 \
  --customer-id <customer-authority-named-in-the-narrative>
```

The application never role-plays, evaluates, chooses GenUI actions, or replays
the narrative turns deterministically. A different fresh evaluator receives
only the run's `codex-review-packet.md`.

### Attempt-2 action input contract

Copy `assistantTurnId`, `attachmentId`, and `actionId` from the latest active
rendered attachment. The bridge rejects stale/forged references, malformed
payloads, selections outside the rendered attachment, and omitted payloads for
client-generated actions. It forwards an accepted payload unchanged; it never
fills in an item, modifier, address, or quantity.

Recommendation actions are reference-only because the server-issued action
already binds the full mutation:

```json
{"type":"action","assistantTurnId":"...","attachmentId":"...","actionId":"recommendation_select:<server-action-id>"}
{"type":"action","assistantTurnId":"...","attachmentId":"...","actionId":"recommendation_dismiss"}
```

Generic rendered actions carry the exact client-generated payload:

```json
{"type":"action","assistantTurnId":"...","attachmentId":"...","actionId":"add_items","payload":{"items":[{"itemCode":"<rendered-code>","quantity":1}]}}
{"type":"action","assistantTurnId":"...","attachmentId":"...","actionId":"apply_modifiers","payload":{"itemCode":"<rendered-code>","selections":[{"groupId":"<rendered-group>","modifierId":"<rendered-option>"}]}}
{"type":"action","assistantTurnId":"...","attachmentId":"...","actionId":"update_cart","payload":{"items":[{"itemCode":"<every-rendered-cart-code>","quantity":1}]}}
{"type":"action","assistantTurnId":"...","attachmentId":"...","actionId":"submit_address","payload":{"recipientName":null,"phone":null,"addressLine":null,"provinceCode":null,"provinceName":null,"communeCode":null,"communeName":null,"deliveryInstructions":null,"rawAddress":"<customer-entered-address>","legacyDistrictText":null}}
```

`continue_to_fulfillment` uses the same complete cart payload as
`update_cart`. `add_item` uses
`{"itemCode":"<rendered-code>","quantity":1}`. Cart payloads contain each
currently rendered cart line exactly once; quantity zero is the explicit
remove operation.

The proof envelope reports commerce lifecycle as one of `complete`, `missing`,
or `not_applicable`. Recommendation/menu-only sessions without lifecycle-backed
order or payment state are `not_applicable` and can be complete. If durable
order/payment state or a successful lifecycle-backed tool exists, absent
lifecycle evidence remains `missing` and the proof remains incomplete.

Migration `0027_recommendation_qualification_store_authority.sql` seeds
scenario 06's verified pickup store as KFCVN0036 in
`pack_state_projections`. Run attempt 2 against a fresh qualification data
plane so attempt-1 turns and order-flow state cannot contaminate the fresh
sessions; retain the complete attempt-1 artifact root unchanged.

## 9. Lifecycle and shutdown

During the demo, verify:

```bash
kill -0 "$KFC_TUNNEL_PID"
docker inspect --format '{{.State.Running}}' "$KFC_SHADOW_CONTAINER"
```

After the controller confirms that qualification and the demo are finished:

```bash
kill "$KFC_TUNNEL_PID"
docker stop "$KFC_SHADOW_CONTAINER"
```

Stopping either process makes the public shadow URL unavailable. Baseline
customer decisions remain authoritative and shadow failure remains isolated,
but live qualification evidence must record the outage rather than hiding it.
