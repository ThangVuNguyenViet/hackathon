# Task 5 — KFC supplemental TinyFish evidence tools report

## Result

The accepted LangChain-only KFC runtime now optionally exposes two KFC-owned tools, `searchKfcWeb` and `fetchKfcPage`. They reuse the approved generic TinyFish client without importing PVCFC policy or sharing business rules. Typed KFC commerce APIs remain authoritative; live web evidence is read-only and may ground only cited `source` and `policy` claims.

`TINYFISH_API_KEY` still creates one bounded 4-second/zero-retry client in server composition. The exact same client instance is injected into the PVCFC and KFC packs. Missing or blank credentials leave both web integrations absent and keep readiness non-gating.

## RED and GREEN evidence

The KFC web-tool contract was written before either KFC production module existed:

```text
npx vitest run test/business/kfc-web-tools.test.ts

FAIL test/business/kfc-web-tools.test.ts
Cannot find module '../../src/businesses/kfc/webTools.js'
Test Files  1 failed (1)
exit 1
```

After the isolated tools turned green, real `KfcAgentPack` regressions were added before pack wiring. Nine cases failed for the intended old behavior: web publications were rejected as unknown evidence; commerce claim violations and missing citations reached only the old generic evidence error; forged and late web calls ended in `script_exhausted` because no registered execution boundary existed.

Configuration tests were then captured RED: the PVCFC and Worker composition suites produced three failures because `kfcWebEvidenceClient` was absent instead of receiving the already-created shared instance.

Finally, the durable audit test was captured RED with `persistKfcWebEvidenceAudit is not a function` before the compact event writer was added.

The focused KFC web file is now 20/20 green. The required integration matrix is 11 files/122 tests green. The full maintained CI suite is 201 files passed/1 skipped and 1,983 tests passed/1 skipped.

## KFC allowlist and admission

The immutable exact-host allowlist is:

- `kfcvietnam.com.vn`
- `www.kfcvietnam.com.vn`
- `membership.kfcvietnam.com.vn`

The KFC pack owns an 11-URL direct-fetch inventory limited to anonymous public first-party background, policy, allergen, contact, store, party, large-order, and membership landing pages. It does not admit `newapi`, order tracking, invoices, static assets, third-party images, social sites, government sites, credentials, IP literals, non-HTTPS URLs, fragments, or non-default ports.

Search uses Vietnamese language and `Việt Nam` location, returns at most five results, and revalidates every injected source URL against the exact allowlist and shared 2,048-character URL cap. Fetch accepts one URL only when it is in the direct inventory or was returned by Search in the same turn closure. A URL discovered in a prior turn is rejected.

The KFC boundary independently revalidates an injected Fetch result. Its normalized `sourceUrl` must equal the admitted request, and its normalized `finalUrl` must remain allowlisted after redirects. Titles, snippets, dates, timestamps, fetched text, citations, and receipt URLs are bounded again even though the production adapter already performs its own validation.

## Count and time budgets

- Search: one call per turn, maximum five results.
- Fetch: two calls per turn, one scalar URL, 3-second per-URL timeout.
- Shared client: 4-second timeout and zero retries.
- KFC live-web deadline: 12 seconds from application-turn entry.

`runKfcApplicationTurn` creates the monotonic budget before model configuration, tracing, canonical state hydration, history, or provider setup and passes the same closure into the KFC pack. Direct pack use creates the budget before canonical history/state loading. Every Search or Fetch requires a full 4-second operation window to remain; a late call fails before invoking TinyFish. The injected clock regression advances state setup to 9 seconds and proves the client is untouched.

## Commerce authority and execution authorization

The system prompt states that typed commerce APIs are authoritative for menu/products, current prices, availability, promotions/vouchers, stores/fulfillment, membership, cart, orders, payment, and action outcomes. Live web output can supply only public background, source, or policy evidence and can never override verified state.

Publication validation maps successful web evidence IDs back to the current turn's receipts. A cited web receipt accepts only `source` and `policy`; tests reject `price`, `promotion`, `status`, `product`, and `order_id`, while the same rule also rejects modifier, payment, fulfillment, address, allergen, membership, and delivery claims. A web-grounded publication must include one exact URL returned by that receipt.

KFC's createAgent middleware now enforces dynamic authorization in both places:

- `wrapModelCall` filters advertised tools;
- `wrapToolCall` rejects a hidden forged web call before its handler or TinyFish client can run.

The web handlers repeat the current application authorization check, so direct invocation also fails closed. Scripted regressions cover a policy exposing zero tools and selected-action presentation. The selected-action model sees neither web schema, a forged call throws `kfc_web_tool_not_authorized`, and the client is not touched. Existing human-pause and confirmation suites remain green.

The real Search-to-Fetch pack test also proves that the commerce executor is never called and the verified KFC state remains deep-equal after web-only execution.

## Receipts, citations, and persistence

Web responses expose a per-turn evidence ID plus bounded exact citations. Ordered KFC tool receipts contain only tool name, provider-read effect, status, evidence mode, evidence ID, duration, and bounded source URLs. Queries, snippets, fetched bodies, provider diagnostics, and credentials are absent.

At the application boundary, web receipts are persisted as `agent:web_evidence_trace` with the neutral `business-tool-trace-v1` envelope. Run-fenced executions use `appendEventIfRunCurrent`. Tests prove the durable event contains only compact citations and no page body or TinyFish secret. Web output is never written into canonical fixtures, verified commerce state, or KFC API state.

## Shared configuration and readiness

Server composition constructs one optional infrastructure client and places the same object in `pvcfcWebEvidenceClient` and `kfcWebEvidenceClient`. This is shared capability injection only: KFC and PVCFC retain separate allowlists, inventories, prompts, evidence precedence, tool admission, and budgets.

Missing/blank key tests prove both pack fields remain undefined. Existing no-key KFC pack tests still expose exactly the commerce tool catalog, and all chat, human-loop, confirmation, GenUI, Worker, and PVCFC regressions remain green. Readiness continues to report only the non-required shared TinyFish capability and never the key or per-route invocation.

## Worker bundle delta

Accepted Task 4 baseline:

```text
Total Upload: 12709.55 KiB / gzip: 1334.03 KiB
```

Task 5 result:

```text
Total Upload: 12721.45 KiB / gzip: 1336.87 KiB
```

Reachable delta: **+11.90 KiB raw, +2.84 KiB gzip**. No second TinyFish SDK/client copy was introduced.

## Verification

All commands used bundled Node 24. No live TinyFish request was made.

```text
required 11-file matrix
Test Files  11 passed (11)
Tests       122 passed (122)

npm run test:ci -- --reporter=dot --silent=passed-only
Test Files  201 passed | 1 skipped (202)
Tests       1983 passed | 1 skipped (1984)

npm run typecheck
exit 0

npm run lint:strict
ESLint warning budget preserved: 391 warning(s), 161 legacy file budget(s).

npm run format:check
All maintained files are formatted.

npm run check:architecture
Architecture size check passed (466 files, 900-line ceiling with no baseline growth).

npm run build
exit 0

npm run worker:deploy:dry-run
exit 0
Total Upload: 12721.45 KiB / gzip: 1336.87 KiB
```

The full `npm run check` completed successfully; its CI test result is reproduced above with the concise reporter.

## Files and commit

Primary KFC production files:

- `src/businesses/kfc/webPolicy.ts`
- `src/businesses/kfc/webTools.ts`
- `src/businesses/kfc/toolReceipts.ts`
- `src/businesses/kfc/langchainTurnService.ts`
- `src/businesses/kfc/applicationTurn.ts`
- `src/businesses/kfc/instructions.ts`
- `src/agent/kfcCreateAgent.ts`

Composition changes are limited to KFC client injection and reuse of the already-created shared client in server/Worker route options. Focused tests live in `test/business/kfc-web-tools.test.ts`, with shared-client identity assertions in the existing server and Worker suites.

Required commit subject:

```text
feat(kfc): add supplemental TinyFish evidence tools
```

## Self-review and live-canary concerns

1. CI is intentionally credential-free. Real TinyFish quota, latency, regional search quality, redirect behavior, and current KFC result quality still require a later credentialed canary.
2. The web deadline is application-owned and deterministic, while in-flight cancellation remains the approved adapter's 4-second SDK timeout because TinyFish Search/Fetch do not accept caller abort signals.
3. The 11-URL inventory is intentionally small and immutable. New KFC public origins or pages require a deliberate KFC policy change; they are never learned into future turns or persisted as canonical business data.
4. The bundle increase is small because Task 4 already made the SDK reachable, but it should remain part of final release qualification.

## Review fix — KFC web evidence policy enforcement

The review findings were reproduced before production changes. The focused
suite failed 17 cases while 21 existing cases remained green:

```text
Test Files  1 failed (1)
Tests       17 failed | 21 passed (38)
```

The failures showed that a caller-provided inventory could admit an arbitrary
same-host page, same-host API/static/binary paths crossed Search and Fetch
boundaries, and an explicit web denial was ignored whenever commerce tools were
nonempty.

The KFC tool factory no longer accepts an inventory. It closes over the frozen
KFC-owned `KFC_WEB_INVENTORY_URLS`, so an extra runtime `inventoryUrls` property
cannot expand direct Fetch admission. The regression attempts to inject
`/not-in-inventory`, receives `kfc_web_url_not_admitted`, and proves the injected
Fetch client was not called.

`validateKfcPublicWebUrl` now composes the existing HTTPS/exact-host URL check
with KFC's public-page policy. It rejects API, `newapi`, invoice, static, upload,
asset, image, and img path namespaces, plus binary/static document, image,
script, data, archive, font, audio, and video extensions. The validator is
applied independently to:

- direct Fetch input before inventory/search admission;
- every injected Search result before same-turn admission;
- the Fetch result's source URL before equality validation;
- the Fetch result's final URL after redirects.

Tests cover `/newapi`, `/invoice`, `/static`, `/upload`, `/assets`, `/images`,
JavaScript, PDF, SVG, JPEG, and WebP paths at those boundaries. Approved KFC
policy and news pages, including query strings, remain searchable/fetchable.

Web capability is now an explicit trusted `enabled`/`disabled` decision and is
not inferred from `ToolName[]`. Server route composition enables it only when
the TinyFish client is configured. Application composition explicitly disables
it for a trusted selected-action turn or an explicit deny. The KFC pack then
conjoins that decision with ordinary-turn policy and at least one active
commerce tool. Both `wrapModelCall` advertisement and `wrapToolCall` execution
use the result, while each web handler repeats the capability check. A scripted
forged-call regression keeps nonempty commerce tools, explicitly denies web,
proves neither web tool is advertised, receives
`kfc_web_tool_not_authorized`, and proves TinyFish was untouched. Existing
zero-tool and selected-action regressions remain green.

No PVCFC policy, tool, prompt, or test was changed.

### Review-fix verification

```text
npx vitest run test/business/kfc-web-tools.test.ts --reporter=verbose
Test Files  1 passed (1)
Tests       38 passed (38)

focused integration
Test Files  4 passed (4)
Tests       55 passed (55)

npm run check
Test Files  201 passed | 1 skipped (202)
Tests       2001 passed | 1 skipped (2002)

npm run check:architecture
Architecture size check passed (466 files, 900-line ceiling with no baseline growth).

npm run build
exit 0

npm run worker:deploy:dry-run
exit 0
Total Upload: 12722.13 KiB / gzip: 1337.36 KiB
```

The review fix adds **+0.68 KiB raw / +0.49 KiB gzip** over the Task 5
implementation result. The final Task 5 delta from accepted Task 4 is
**+12.58 KiB raw / +3.33 KiB gzip**. No live TinyFish request was made.

Required review-fix commit subject:

```text
fix(kfc): enforce web evidence policy
```
