# Task 7 — PVCFC evidence-backed demo refresh report

## Result

The PVCFC React application now presents cited text only. Its suggestions and replay scenarios are sourced from one immutable typed module built around the 497-record public-data provider. Seven scenarios remain fully usable with fixture/provider data alone. The two scenarios that need current official-web evidence are visibly marked as requiring the optional TinyFish capability.

The stale standalone HTML application and the five PVCFC GenUI/approval components are deleted. The backend serves the compiled React application when present and otherwise returns only the minimal `<h1>PVCFC Backend</h1>` placeholder.

## Scenario and suggestion inventory

`PVCFC_DEMO_SCENARIOS` contains nine stable, unique IDs:

| Scenario ID | Provider collection or capability | Fixture inventory | Evidence mode |
| --- | --- | ---: | --- |
| `exact-product` | Exact official product lookup | 67 products | `provider` |
| `product-comparison` | Comparison of two exact official product records | 67 products | `provider` |
| `certificate-traceability` | Certificate/document record and original-document traceability | 249 certificates/documents | `provider` |
| `dealer-contact-freshness` | Dealer/contact lookup with source-date and freshness caveat | 18 dealer/contact records | `provider` |
| `urban-agriculture` | 2Nông and urban-agriculture products/services/solutions | 15 urban-agriculture records | `provider` |
| `corporate-facilities` | Plants, facilities, and corporate footprint | 7 corporate/facility records | `provider` |
| `public-reports` | Annual and sustainability report traceability | 3 public reports | `provider` |
| `current-official-news` | Provider lookup followed by allowlisted Search/Fetch when current evidence is needed | current official news | `provider_then_live_web` |
| `current-official-catalogue` | Provider lookup followed by an inventoried or same-turn discovered official page fetch | current official catalogue | `provider_then_live_web` |

The module exports six Vietnamese suggestion pills. Every pill explicitly asks for a source, citation, or source URL. Exactly two pills disclose that direct web evidence is needed. Provider-only scenarios do not mention or depend on TinyFish.

All replay turns are nonempty, scenario IDs are unique, titles are at most 48 characters, and only the news/catalogue scenarios use `provider_then_live_web`.

## Unsupported-copy removal

The executable PVCFC UI no longer contains or offers:

- a response-mode toggle or `Generative UI` presentation;
- GenUI response metadata, parsing, rendering, or card dispatch;
- booking an engineer or site/pH visit;
- automated fertilizer reminders;
- autonomous diagnosis or an exact dosage without source evidence;
- order/purchase actions or live/current inventory promises;
- PDF export or Zalo sharing;
- confirmed store hours without a source;
- private, internal, or dealer-system access; or
- OpenAI-specific replay copy.

The welcome message now describes public-data lookup with verifiable sources. Replay copy refers to the LangChain assistant only as runtime identity, not as a product capability.

Deleted component files:

- `apps/pvcfc_chat_web/src/components/ApprovalCard.tsx`
- `apps/pvcfc_chat_web/src/components/DealerLocatorCard.tsx`
- `apps/pvcfc_chat_web/src/components/DiagnosticProtocolCard.tsx`
- `apps/pvcfc_chat_web/src/components/DosageCalculatorCard.tsx`
- `apps/pvcfc_chat_web/src/components/FertilizerScheduleCard.tsx`

The executable-source banned-copy scan and obsolete-component reference scan both returned clean.

## Standalone fallback deletion proof

The tracked root `pvcfc_website.html` file (1,137 lines) was deleted. Both standalone fallback candidates were removed from `src/api/routes.ts`.

`loadPvcfcWebsiteHtml` now checks only compiled React candidates:

1. `dist/client/index.html`
2. `client/index.html`
3. `../../apps/pvcfc_chat_web/dist/index.html`
4. `../pvcfc_chat_web/dist/index.html`

The new route test creates both a compiled React index and an obsolete standalone file and proves the compiled React content wins. A second test proves an empty deployment returns only `<h1>PVCFC Backend</h1>`.

## TDD evidence

All commands used bundled Node 24.

### Scenario module RED/GREEN

Initial RED:

```text
npm test -- --run src/demoScenarios.test.ts
FAIL: Cannot find module './demoScenarios.js'
```

After the initial module implementation, one contract remained RED because the current-news prompt did not explicitly say `URL nguồn`. The production prompt was corrected and the suite passed.

A second copy-support cycle was also captured RED before its fixes:

```text
Test Files  1 failed (1)
Tests       2 failed | 4 passed (6)
```

The failures proved that the comparison scenario did not name the 67-record product inventory and one dealer pill did not request a citation. The prompt-only fixes then produced:

```text
Test Files  1 passed (1)
Tests       6 passed (6)
```

### Route RED/GREEN

Route RED:

```text
npx vitest run test/api/routes.test.ts
Test Files  1 failed (1)
Tests       2 failed (2)
TypeError: loadPvcfcWebsiteHtml is not a function
```

After extracting the React-only resolver and deleting the fallback candidates:

```text
npx vitest run test/api/routes.test.ts test/architecture/langchain-only-production-runtime.test.ts
Test Files  2 passed (2)
Tests       3 passed (3)
```

## Verification

PVCFC web application:

```text
npm test
Test Files  1 passed (1)
Tests       6 passed (6)

npm run build
1591 modules transformed
dist/assets/index-BpSGBoCe.js 212.31 kB, 66.50 kB gzip
exit 0
```

Backend required gates:

```text
npx vitest run test/api/routes.test.ts test/architecture/langchain-only-production-runtime.test.ts
Test Files  2 passed (2)
Tests       3 passed (3)

npm run typecheck
exit 0

npm run check:architecture
Architecture size check passed (464 files, 900-line ceiling with no baseline growth).
```

Because backend route and test files changed, the full maintained check also ran:

```text
npm run check
format:check: passed
lint: 0 errors, 383 warnings within the preserved 161-file budget
typecheck: passed
Test Files  201 passed | 1 skipped (202)
Tests       2009 passed | 1 skipped (2010)
exit 0
```

The web package production dependency audit also passed: `npm audit --omit=dev` found zero vulnerabilities. The install-time audit still reports one development-tool vulnerability; no unrelated forced dependency upgrade was performed in this task.

## Files and commit

Created:

- `apps/pvcfc_chat_web/src/demoScenarios.ts`
- `apps/pvcfc_chat_web/src/demoScenarios.test.ts`
- `services/kfc-agent-backend/test/api/routes.test.ts`
- this report

Modified:

- `apps/pvcfc_chat_web/src/App.tsx`
- `apps/pvcfc_chat_web/package.json`
- `apps/pvcfc_chat_web/package-lock.json`
- `services/kfc-agent-backend/src/api/routes.ts`

Deleted:

- the five obsolete PVCFC action/GenUI components listed above
- `pvcfc_website.html`

Commit subject: `feat(pvcfc): refresh evidence-backed demo scenarios`

## Demo caveats

1. The seven `provider` scenarios are deterministic demonstrations over the temporary 497-record fixture/provider and remain available without `TINYFISH_API_KEY`.
2. The current-news and current-catalogue scenarios require TinyFish to be configured for live Search/Fetch. Without it, the canonical provider remains available but the assistant cannot claim that current web content was checked.
3. No credentialed live TinyFish request was made in this task. Live provider latency, quotas, and result quality remain covered by the later gated canary.
4. Dealer/contact records may age. The scenario asks the assistant to expose source dates and avoid confirming hours absent official evidence.
5. The fixture layer is temporary. When the official PVCFC API replaces it, scenario IDs and evidence modes can remain stable while the provider implementation changes.

## Review fix: packaged backend release

The review correctly identified that the React source application was not yet a normal backend release artifact. The backend build now owns a deterministic final packaging step:

1. `clean:dist` removes the prior backend output.
2. TypeScript compiles the active backend into `dist/src`.
3. `package:pvcfc-client` runs the existing PVCFC Vite build and copies its generated `dist` into backend-owned `dist/client`.

Dependency installation remains explicit. The packaging script does not run `npm install` or `npm ci`, and `npm_config_offline=true npm run build` passed after the two lockfile installs. This keeps release builds deterministic and avoids hiding registry access in the build step.

The backend resolver checks `dist/client/index.html` first. A deploy-layout integration test copies only that packaged client into a temporary backend release directory, with no `apps/pvcfc_chat_web/dist` source-tree fallback, then proves `/`, `/demo`, and `/pvcfc` all return the React root marker. Pages deployment remains unchanged because `apps/pvcfc_chat_web` still has its independent Vite build.

The service-only `Dockerfile.pvcfc` consumes an already-built `dist`, fixtures, and knowledge corpus. A real Docker build from `services/kfc-agent-backend` succeeded, and an isolated container inspection found `dist/src/index.js`, `dist/client/index.html`, the React marker, and a JavaScript asset. The SCloud runbook now installs both lockfiles, builds the packaged backend, verifies both artifacts, starts `dist/src/index.js`, and explicitly labels the new packaged release as not yet deployed.

## Review fix: fixture-backed dealer scenario

The prior Kiên Giang wording was not supported by a matching generated dealer record. The scenario now targets `dealer-khanh-my-ca-mau`, and its test reads the generated provider fixture rather than duplicating an unverified claim. The asserted record is:

- `Cửa hàng phân bón Khánh My`
- `Xã Hòa Bình, Tỉnh Cà Mau`

The test also proves the displayed prompt contains the exact fixture name and address.

## Review-fix TDD evidence

RED was captured before implementation:

```text
PVCFC web scenario test: 1 failed, 6 passed
Expected the dealer prompt to target the fixture-backed Cà Mau record; it still named Kiên Giang.

backend build-output test: failed
Expected dist/client/index.html to exist after npm run build.

deploy-layout route test: TypeScript failed
registerPvcfcWebsiteRoutes was not exported.

packaged-release shell contract: failed
Dockerfile.pvcfc and its service-context contract did not exist.
```

GREEN after the review fix:

```text
apps/pvcfc_chat_web: npm test
Test Files  1 passed (1)
Tests       7 passed (7)

apps/pvcfc_chat_web: npm run build
1591 modules transformed
dist/assets/index-*.js 212.34 kB, 66.53 kB gzip
exit 0

services/kfc-agent-backend: npm_config_offline=true npm run build
TypeScript compiled; PVCFC client built and copied to dist/client
exit 0

focused backend route/build/architecture tests
Test Files  3 passed (3)
Tests       4 passed (4)

services/kfc-agent-backend: npm run typecheck
exit 0

services/kfc-agent-backend: npm run check:architecture
Architecture size check passed (465 files, 900-line ceiling with no baseline growth).

services/kfc-agent-backend: npm run check
format:check: passed
lint: 0 errors, 383 warnings within the preserved warning budget
typecheck: passed
Test Files  201 passed | 1 skipped (202)
Tests       2009 passed | 1 skipped (2010)
exit 0

bash tests/deployment/pvcfc_packaged_release.test.sh
passed

docker build -f Dockerfile.pvcfc -t pvcfc-backend:task7-review .
exit 0

container artifact inspection
packaged-container-artifact-ok
```

## Review-fix caveats

1. The runbook is updated, but this commit has not been deployed to SCloud and no live post-deploy smoke result is claimed.
2. `npm audit --omit=dev` in the backend currently reports three existing high-severity production dependency advisories through `fast-uri`, `find-my-way`, and `js-yaml`. No unrelated forced dependency upgrade was included in this focused review fix.
3. Docker verification inspected the packaged release without starting the network service, because a real runtime boot also requires deployment database and provider credentials.

## Maintained deployment-contract cleanup

The initially red `tests/deployment/deploy_scripts.test.sh` was not historical: `scripts/run-kfc-deployed-acceptance.sh` invokes it. Its first failure asserted a deleted direct-OpenAI live script, and its later executable section imported another deleted qualification module and identified the runtime as LangGraph.

The active deployment contract now matches the approved runtime:

- Cloudflare Worker and Cloud Run releases accept the maintained LangChain KFC target: Google with `gemini-3.1-flash-lite`.
- Direct OpenAI provider validation and secret publication/binding were removed from these two deployment scripts.
- Google provider authentication, LangSmith, main-branch/dirty-release checks, confirmation-secret handling, commerce-mode safety, D1, and Cloud Run authentication bindings remain covered.
- The Worker script optionally publishes PVCFC-owned `PVCFC_ASTRAFLOW_API_KEY` and `TINYFISH_API_KEY` secrets without coupling them to KFC.
- `openai_agent_target.test.sh` was replaced by `langchain_agent_target.test.sh`.
- The obsolete 500-line deployment test was replaced with the maintained shell syntax, provider/model preflight, secret safety, Pages, and packaged-PVCFC release contracts.
- The deployed latency proof marker now expects `langchain-create-agent`, not the retired LangGraph runtime name.
- Free-deploy and PVCFC SCloud documentation no longer instruct operators to use the retired direct OpenAI/standalone-server paths.

RED:

```text
bash tests/deployment/deploy_scripts.test.sh
exit 1
First failure: expected removed KFC_AGENT_PROVIDER=openai live-interruption script.
After that assertion was removed, the executable check also failed importing deleted kfc-live-text-qualification.mjs.
```

GREEN:

```text
bash tests/deployment/deploy_scripts.test.sh
Cloud Run deployment profile preflight passed.
Cloudflare Worker deployment preflight passed.
LangChain agent target tests passed.
PVCFC packaged release contract passed.
Maintained deployment contracts passed.
exit 0
```

The final post-cleanup backend gate retained the same result: 201 test files passed with one skipped, and 2,009 tests passed with one skipped.

## Third review fix: aligned deploy targets and restored safeguards

### Cloud Run release target

The old Cloud Run helper used `gcloud run deploy --source services/kfc-agent-backend`. That source directory contains the separately owned recommendation-service `Dockerfile`, whose qualified-bundle entrypoint is `dist/src/recommendations/serving/aws-main.js`. Source auto-detection could therefore deploy the wrong service.

The corrected path is explicit:

1. `cloudbuild.cloud-run.yaml` receives the repository-root context.
2. It builds the dedicated multi-stage `Dockerfile.cloud-run`.
3. The builder installs both lockfiles, compiles only `tsconfig.runtime.json`, and packages the React client.
4. The runtime image contains production dependencies, fixtures, knowledge, `dist/src/index.js`, and `dist/client`.
5. `deploy-backend-cloud-run.sh` submits that build and deploys the immutable `CLOUD_RUN_IMAGE_URI` with `--image`; it never uses `--source`.

The recommendation-service `Dockerfile` remains unchanged. A fake-gcloud contract executes the full deploy helper and proves the exact Cloud Build config, image URI, and `gcloud run deploy --image` arguments.

The shared Node entrypoint no longer overwrites KFC readiness identity with the optional PVCFC AstraFlow identity. PVCFC still has its own isolated pack and credential, while the shared KFC server reports the configured LangChain KFC model.

### Worker direct-deploy target

The checked-in sandbox `wrangler.toml`, which is also used by direct `npm run worker:deploy` and `worker:deploy:dry-run`, now declares:

- `KFC_AGENT_PROVIDER = "google"`
- `KFC_AGENT_MODEL = "gemini-3.1-flash-lite"`

The direct Wrangler dry-run reported those exact bindings and no OpenAI default.

### Safeguard coverage map from `a5825aa5`

The second review fix had over-compressed the base deployment test. This round restored independent executable safeguards by subject:

| Base safeguard | Current coverage | Treatment |
| --- | --- | --- |
| chatbot vs monitor Pages route separation | generate both `_worker.js` files and assert mutually exclusive route sets | restored |
| shared Pages release identity and clean provenance | parse both generated `release.json` files; verify shared SHA/time, distinct project/origin, `dirty=false` | restored |
| no committed/hard-coded Worker URL | scan generated proxies and Pages deploy script | restored |
| qualification artifact/input digest | create, verify, mutate input, and require rejection | restored |
| qualification and latency age/order | execute `verify-ages` with valid ordered evidence | restored |
| secret artifact scanning | execute clean and leaking artifact scans | restored |
| atomic failure evidence handling | execute failure finalization and prove stale checksum/bundle removal | restored |
| publication identity, phase ordering, checksum, and release creation | focused static contracts over the maintained acceptance runner | restored |
| direct OpenAI provider/model and secret expectations | no maintained deployment subject | retired |
| deleted live-interruption/qualification producer modules | subject removed in LangChain migration | retired |
| LangGraph runtime marker | replaced by `langchain-create-agent` | migrated |

### Third-round TDD and runtime proof

RED:

```text
bash tests/deployment/deploy_scripts.test.sh
exit 1
Missing Dockerfile.cloud-run/cloudbuild.cloud-run.yaml;
wrangler.toml still selected openai/gpt-4.1-mini.

docker build -f services/kfc-agent-backend/Dockerfile.cloud-run ...
exit 1
Full test TypeScript compilation referenced a repository-root contract absent from the image context.

bash tests/deployment/deploy_scripts.test.sh
exit 1
Independent deployment_integrity.test.sh did not exist.
```

GREEN:

```text
bash tests/deployment/deploy_scripts.test.sh
LangChain agent target tests passed.
PVCFC packaged release contract passed.
Deployment integrity safeguards passed.
Maintained deployment contracts passed.

npm run worker:deploy:dry-run
KFC_AGENT_PROVIDER ("google")
KFC_AGENT_MODEL ("gemini-3.1-flash-lite")
exit 0

docker build -f services/kfc-agent-backend/Dockerfile.cloud-run \
  -t kfc-langchain-cloud-run:task7 .
exit 0
```

The final image was started against an isolated PostgreSQL 16 container. Runtime proof:

```text
image CMD: ["node","dist/src/index.js"]
GET /health: HTTP 200, ok=true
GET /ready?deep=1: HTTP 200, ok=true
database: ok
agent: google / gemini-3.1-flash-lite
monitor: google / gemini-3.1-flash-lite
dist/src/index.js: present
dist/client/index.html: present
```

The temporary application, database container, and Docker network were removed after verification. No Cloud Build, Cloud Run deployment, Worker deployment, Pages deployment, or SCloud deployment was performed.

Final post-fix gates:

```text
apps/pvcfc_chat_web: 7 tests passed; Vite build passed
services/kfc-agent-backend npm run check:
  format passed
  lint passed with the preserved warning budget
  typecheck passed
  201 test files passed, 1 skipped
  2,009 tests passed, 1 skipped
services/kfc-agent-backend npm run check:architecture:
  465 files, 900-line ceiling, no baseline growth
npm run worker:deploy:dry-run:
  passed with Google / gemini-3.1-flash-lite bindings
bash tests/deployment/deploy_scripts.test.sh:
  all maintained deployment contracts passed
git diff --check:
  passed
```
