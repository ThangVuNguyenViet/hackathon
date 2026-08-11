# Task 3 — bounded TinyFish evidence adapter report

## Result

The backend now has an injected, infrastructure-only TinyFish Search/Fetch adapter and generic web-evidence URL safety helpers. It contains no KFC or PVCFC hostname, prompt, evidence precedence, inventory rule, per-turn budget, or business tool. No environment variable is read by the adapter; the application must inject a nonblank API key and an explicit timeout.

The dependency is pinned exactly to `@tiny-fish/sdk@0.3.0`. Search accepts caller-owned domains and post-filters every returned URL against the normalized exact-host allowlist. Fetch accepts one scalar URL per call, validates it before the SDK request, and revalidates the returned `final_url` after redirects. Returned evidence is compact and bounded before reaching any pack.

## Installed SDK observations

The installed 0.3.0 declarations and implementation were inspected before adapter code was written:

- Construction is `new TinyFish({ apiKey, timeout, maxRetries })`.
- Search is `search.query({ query, location?, language?, include_domains? })`; `include_domains` is one comma-separated string. Results expose `title`, `snippet`, `url`, and optional `date`.
- Fetch is `fetch.getContents({ urls, format?, per_url_timeout_ms? })`; its response is `{ results, errors }`. A markup result includes the input `url`, nullable `final_url`, nullable `title`, nullable `published_date`, and nullable `text`.
- Search and Fetch public methods do not accept a caller `AbortSignal`. The SDK constructor timeout is enforced with `AbortSignal.timeout` across the request and retry sequence.
- SDK defaults are a ten-minute timeout and two retries, so the adapter overrides both with its explicit timeout (maximum 15 seconds) and `maxRetries: 0`.
- The SDK constructor has an environment fallback only when `apiKey` is absent. This adapter validates and always passes the injected key; it never reads `process.env` itself.

The adapter uses a small SDK-shaped factory seam and a clock seam. Unit tests supply an in-memory SDK shape, so CI neither needs a TinyFish key nor performs a live request.

## RED evidence

The two required test files were created before either production module existed.

```text
npx vitest run test/web/tiny-fish-client.test.ts test/web/business-web-evidence.test.ts

FAIL test/web/business-web-evidence.test.ts
Cannot find module '../../src/web/businessWebEvidence.js'

FAIL test/web/tiny-fish-client.test.ts
Cannot find module '../../src/web/tinyFishClient.js'

Test Files  2 failed (2)
Tests       no tests
exit 1
```

The failure was the intended absent behavior, not a syntax or fixture failure.

## Security and normalization behavior

The focused suite proves:

- blank keys and zero/30-second adapter timeouts fail before SDK construction;
- SDK construction receives the exact injected key, explicit timeout, and `maxRetries: 0`, while the returned client is secret-free when serialized;
- only HTTPS URLs are accepted;
- username/password URL credentials are rejected;
- IPv4 and IPv6 literals are rejected;
- caller allowlists contain hostnames only and cannot contain paths or IP literals;
- host matching is exact after URL/hostname normalization, so suffix-confusion and outside hosts fail;
- fragments are rejected rather than treated as a distinct admitted source;
- caller domains are passed to TinyFish Search and every provider result is post-filtered independently;
- Vietnamese query, language, location, title, and snippet text are preserved without ASCII conversion;
- Search returns at most five results, with titles capped at 300 characters and snippets at 800 characters;
- Fetch always sends a one-element URL array, requests Markdown, forwards the bounded per-URL timeout, and caps text at 12,000 characters;
- Fetch revalidates a provider redirect and rejects an external `final_url`;
- thrown Search provider failures are proven to become stable `tinyfish_search_failed` errors without provider diagnostics, article bodies, or API keys; the same safe normalization boundary is implemented for Fetch failures and per-URL provider errors.

Compact evidence contains source URL, final URL when fetched, title, optional published date, bounded snippet/text, and an ISO `retrievedAt` timestamp.

## GREEN verification

All commands used bundled Node 24.

```text
npx vitest run test/web/tiny-fish-client.test.ts test/web/business-web-evidence.test.ts
Test Files  2 passed (2)
Tests       15 passed (15)

npm run typecheck
exit 0

npm run lint:strict
ESLint warning budget preserved: 391 warning(s), 161 legacy file budget(s).

npm run format:check
All maintained files are formatted.

npm run check:architecture
Architecture size check passed (461 files, 900-line ceiling with no baseline growth).

npm run build
exit 0

npm run worker:deploy:dry-run
exit 0
Total Upload: 12080.00 KiB / gzip: 1236.01 KiB

git diff --check
exit 0
```

Wrangler's existing Worker entry still builds after the dependency and adapter were added. The adapter is intentionally not wired into the Worker graph until the pack-owned tools task, so this dry-run does not yet measure the SDK's reachable bundle contribution. No live TinyFish call was made.

## Timeout and cancellation caveat

Because SDK 0.3.0 does not expose an `AbortSignal` on public Search/Fetch methods, the adapter cannot link those calls to the application's remaining turn-deadline signal. It instead requires an explicit timeout no greater than 15 seconds, requires Fetch's per-URL timeout to be no greater than the client timeout, and disables SDK retries. It deliberately does not use `Promise.race`, which would return early while leaving provider work running. Pack-level call budgets and the existing 30-second turn deadline remain separate later-task responsibilities.

## Files and commit

Production and dependency files:

- `services/kfc-agent-backend/package.json`
- `services/kfc-agent-backend/package-lock.json`
- `services/kfc-agent-backend/src/web/businessWebEvidence.ts`
- `services/kfc-agent-backend/src/web/tinyFishClient.ts`

Focused tests:

- `services/kfc-agent-backend/test/web/business-web-evidence.test.ts`
- `services/kfc-agent-backend/test/web/tiny-fish-client.test.ts`

Task documentation:

- `.superpowers/sdd/2026-08-12-langchain-only-business-agents/progress.md`
- `.superpowers/sdd/2026-08-12-langchain-only-business-agents/task-3-tinyfish-adapter-report.md`

Required commit subject:

```text
feat(web): add bounded TinyFish evidence client
```

The final commit SHA is supplied in the handoff.

## Concerns for pack-owned web tools

1. KFC and PVCFC must each own their own immutable first-party allowlist; those domains must not move into this adapter.
2. Inventory admission, same-turn searched-URL admission, fixture/API precedence, citation wording, and the one-search/two-fetch turn budget remain pack policy.
3. Missing `TINYFISH_API_KEY` must be projected as a non-gating unavailable capability while canonical fixture/API tools remain usable.
4. The 15-second adapter timeout leaves room under the 30-second turn budget, but two sequential Fetch calls cannot both consume the full timeout. Pack middleware must enforce a smaller effective budget from the remaining turn time.
5. Live Search/Fetch behavior and provider quotas require a separate credentialed canary; they are intentionally not part of CI or this task.
6. The current dry-run reports a 12,080 KiB upload (1,236.01 KiB gzip), but that is the full existing Worker bundle and cannot be attributed to TinyFish while the adapter is unreachable from the Worker entry. Task 4 must compare bundle output after real wiring and treat any material size or startup regression as a release concern.
