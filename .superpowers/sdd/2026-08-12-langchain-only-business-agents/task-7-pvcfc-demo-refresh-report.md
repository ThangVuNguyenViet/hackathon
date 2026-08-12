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
