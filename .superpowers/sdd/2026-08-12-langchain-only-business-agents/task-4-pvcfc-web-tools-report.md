# Task 4 — PVCFC official-site TinyFish evidence tools report

## Result

The PVCFC business pack now optionally exposes two LangChain tools, `searchPvcfcWeb` and `fetchPvcfcPage`, backed by the approved Task 3 `TinyFishClient`. The policy is owned entirely by `businesses/pvcfc`; no KFC tool, state, GenUI, confirmation dependency, shared business allowlist, or alternate search vendor was added.

The four canonical PVCFC provider tools remain available with or without `TINYFISH_API_KEY`. Web tools are created per turn only when a nonblank key produced an injected client. LangChain middleware shows only the four provider tools on the first model call and unlocks the two web tools only after a provider tool attempt has been recorded. A fixture/provider hit can therefore answer without making any web request.

## TDD evidence

The web-tool contract was written before the production modules existed.

```text
npx vitest run test/business/pvcfc-web-tools.test.ts

FAIL test/business/pvcfc-web-tools.test.ts
Cannot find module '../../src/businesses/pvcfc/webTools.js'
Test Files  1 failed (1)
exit 1
```

The provider-first agent tests were then written before pack wiring. Their first run kept all model calls on the original four tools, so both new assertions failed because `searchPvcfcWeb` and `fetchPvcfcPage` never became visible after provider execution.

Configuration/readiness tests were also captured RED before implementation: three files produced six expected failures because the optional client, readiness capability, Worker projection, and Worker readiness check did not exist.

Additional boundary tests were observed RED before their fixes: a fake client could return six Search results and 20,000 characters of Fetch content, and a 3,075-character receipt URL was not bounded. The PVCFC tool boundary now caps Search at five, Fetch text at 8,000 characters, receipt URL count at five, and each receipt URL at 2,048 characters even if an injected client violates the adapter contract.

The deadline test was also captured RED before its fix: Fetch still received a 4,000 ms per-URL timeout, an operation begun after the intended shared budget resolved instead of failing fast, and the server-options test could not observe the configured client timeout. The final implementation injects a deterministic clock into the per-turn budget and proves that, after Search at 0 ms and Fetch at 4,000 ms, a second Fetch attempted at 8,001 ms is rejected before the client is invoked.

## PVCFC allowlist and URL admission

The immutable exact-host allowlist is:

- `pvcfc.com.vn`
- `www.pvcfc.com.vn`
- `shop.pvcfc.com.vn`
- `thamquannhamay.pvcfc.com.vn`
- `muavangthanglon.pvcfc.com.vn`

The bundled fixture currently yields 178 unique admitted page URLs across four of those hosts. URLs are derived only from record `sourceUrl` and provenance `sourceUrl`, normalized through the generic Task 3 HTTPS/exact-host/default-port validator, and frozen. App stores, social sites, linked external sources, IP literals, credentials, fragments, non-HTTPS URLs, and non-default ports are excluded.

`fetchPvcfcPage` admits a URL only when it is in that canonical inventory or was returned by `searchPvcfcWeb` in the same per-turn closure. A searched URL does not carry into the next turn. The adapter remains responsible for redirect revalidation; the PVCFC integration test constructs the real adapter with an escaping `final_url` and proves the tool rejects it.

## Fixed budgets and evidence order

- Search: Vietnamese language, `Việt Nam` location, all five approved hosts, at most one call and five returned results per turn.
- Fetch: one scalar URL, 3-second per-URL timeout, at most two calls per turn, and 8,000 returned text characters.
- SDK construction: 4-second client timeout and zero retries, as enforced by the approved Task 3 adapter.
- Shared live-web deadline: 12 seconds per turn. Every web operation requires at least one full 4-second operation window to remain, so a late Search or Fetch fails before calling TinyFish.
- First model call: exactly the four canonical provider tools, with provider evidence required.
- Later model calls: web tools become visible only after a recorded provider attempt.

The prompt labels provider/fixture evidence as canonical and live web output as untrusted current evidence. If any live web operation succeeds, the final answer is rejected unless it includes at least one returned live source URL. Live evidence is never written back into the fixture/provider.

## Audit and citation behavior

The neutral `business-tool-trace-v1` schema is retained. Receipts include only tool name, success/error status, duration, `canonical` or `live_web` evidence mode, and bounded source URLs. Queries, snippets, fetched page bodies, provider diagnostics, and API keys are not persisted. Tests prove a fetched body marker and TinyFish secret do not enter receipts/readiness.

## Configuration and readiness

`TINYFISH_API_KEY` is optional in Node configuration, `WorkerEnv`, Worker projection, server composition, and Worker routes. Missing or whitespace-only values create no client. Fixture-only PVCFC remains usable and all four provider tools remain available.

Readiness is non-gating and reports only capability state plus fixed identity:

```json
{
  "configured": false,
  "provider": "tinyfish",
  "mode": "search-fetch"
}
```

HTTP readiness adds the ordinary `ok: true` and `required: false` check fields. Neither readiness path serializes the key. `wrangler.toml` contains only a comment explaining `wrangler secret put TINYFISH_API_KEY`; it contains no secret value.

## Worker bundle measurement

Task 3 baseline before reachable pack wiring:

```text
Total Upload: 12080.00 KiB / gzip: 1236.01 KiB
```

Task 4 after reachable Worker wiring:

```text
Total Upload: 12708.20 KiB / gzip: 1333.64 KiB
```

Actual delta: **+628.20 KiB raw, +97.63 KiB gzip**. This is the reachable TinyFish SDK/client and PVCFC pack wiring contribution. It is a release-size concern to monitor when KFC web tools are added, but the Worker build and dry run remain green.

## Verification

All commands used bundled Node 24. No live TinyFish request or live CI was run.

```text
npx vitest run \
  test/business/pvcfc-web-tools.test.ts \
  test/business/pvcfc-langchain-agent.test.ts \
  test/api/pvcfc-server-options.test.ts \
  test/worker/worker-route-options.test.ts \
  test/worker/worker.test.ts \
  test/worker/worker-pvcfc-route.test.ts \
  test/fixtures/pvcfc-public-data-repository.test.ts \
  test/architecture/pvcfc-agent-import-boundary.test.ts \
  test/architecture/langchain-only-production-runtime.test.ts

Test Files  9 passed (9)
Tests       40 passed (40)

npm run check
Test Files  200 passed | 1 skipped (201)
Tests       1955 passed | 1 skipped (1956)

npm run lint:strict
ESLint warning budget preserved: 391 warning(s), 161 legacy file budget(s).

npm run typecheck
exit 0

npm run format:check
All maintained files are formatted.

npm run check:architecture
Architecture size check passed (463 files, 900-line ceiling with no baseline growth).

npm run build
exit 0

npm run worker:deploy:dry-run
exit 0
Total Upload: 12708.20 KiB / gzip: 1333.64 KiB
```

## Files and commit

Primary production changes:

- `src/businesses/pvcfc/webPolicy.ts`
- `src/businesses/pvcfc/webTools.ts`
- `src/businesses/pvcfc/pack.ts`
- `src/businesses/pvcfc/instructions.ts`
- `src/businesses/pvcfc/tools.ts`
- Node/Worker config, route composition, readiness, and `wrangler.toml`

Focused tests:

- `test/business/pvcfc-web-tools.test.ts`
- `test/business/pvcfc-langchain-agent.test.ts`
- `test/api/pvcfc-server-options.test.ts`
- Worker route/readiness tests and the PVCFC architecture boundary

Required commit subject:

```text
feat(pvcfc): add official-site TinyFish evidence tools
```

## Self-review and follow-up concerns

1. The integration is credential-free in CI; Search/Fetch latency, provider quotas, and real result quality still require the later credentialed canary.
2. With zero retries, a 4-second SDK timeout, 3-second Fetch timeout, and code-enforced 12-second shared live-web deadline, web operations cannot consume the full 30-second turn deadline. Deterministic clock coverage proves later operations fail before invoking the client when less than one 4-second window remains, reserving about 18 seconds for the provider lookup and model calls. The existing outer turn deadline remains the final guard.
3. The +97.63 KiB gzip Worker increase should be compared again after KFC-owned web tools. No second SDK/client copy should be introduced.
4. Fixture inventory derivation is intentionally temporary. When PVCFC switches to its official API provider, server composition must inject that provider's canonical source inventory rather than retain fixture-derived admission.
