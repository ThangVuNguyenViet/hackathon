What you implemented
- Added `ChannelUserProfile` plus `getProfile()` to the Messenger and Zalo client interfaces.
- Implemented Messenger profile lookup via Graph API and persisted successful profile data during inbound webhook handling.
- Kept Zalo profile lookup unconfigured on purpose and continued using webhook sender profile data only.
- Enriched `/dashboard/sessions` summaries with `displayName`, `externalUserId`, `avatarUrl`, and unverified deeplink metadata.
- Updated Fastify and Worker route callers to await async `dashboardSessions()`.
- Added RED/GREEN webhook tests for Messenger and Zalo dashboard session profile summaries.
- Updated mock channel client defaults/tests so the new interface compiles cleanly.

Tests run and exact results
- `cd services/kfc-agent-backend && npm test -- test/channels/messenger-webhook.test.ts test/channels/zalo-webhook.test.ts`
  - RED: failed with 2 expected assertion failures because dashboard session profile fields were absent.
- `cd services/kfc-agent-backend && npm test -- test/channels/messenger-webhook.test.ts test/channels/zalo-webhook.test.ts test/api/health.test.ts`
  - GREEN: 3 passed, 3 total test files; 19 passed, 19 total tests.
- `cd services/kfc-agent-backend && npx tsc --noEmit`
  - GREEN: exited successfully with no TypeScript errors.

TDD Evidence: RED/GREEN
- RED: added Messenger and Zalo dashboard session summary tests first, then confirmed both failed for missing `displayName`, `externalUserId`, `avatarUrl`, and `deeplink`.
- GREEN: implemented profile enrichment and reran the required suite until the new tests plus health checks passed.

Files changed and files staged
- Changed:
  - `services/kfc-agent-backend/src/clients/interfaces.ts`
  - `services/kfc-agent-backend/src/channels/messenger.ts`
  - `services/kfc-agent-backend/src/channels/zalo.ts`
  - `services/kfc-agent-backend/src/api/routeHandlers.ts`
  - `services/kfc-agent-backend/src/api/routes.ts`
  - `services/kfc-agent-backend/src/worker.ts`
  - `services/kfc-agent-backend/src/mock/createMockClients.ts`
  - `services/kfc-agent-backend/test/channels/messenger-webhook.test.ts`
  - `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`
  - `services/kfc-agent-backend/test/mock/mock-clients.test.ts`
- Staged:
  - `.superpowers/sdd/task-4-report.md`
  - `services/kfc-agent-backend/src/clients/interfaces.ts`
  - `services/kfc-agent-backend/src/channels/messenger.ts`
  - `services/kfc-agent-backend/src/channels/zalo.ts`
  - `services/kfc-agent-backend/src/api/routeHandlers.ts`
  - `services/kfc-agent-backend/src/api/routes.ts`
  - `services/kfc-agent-backend/src/worker.ts`
  - `services/kfc-agent-backend/src/mock/createMockClients.ts`
  - `services/kfc-agent-backend/test/channels/messenger-webhook.test.ts`
  - `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`
  - `services/kfc-agent-backend/test/mock/mock-clients.test.ts`

Commit created
- `feat: expose channel display profiles`

Self-review findings
- Messenger webhook tests needed to account for two fetches now: profile lookup plus outbound send.
- Zalo handling stays within the brief: no guessed profile endpoint, webhook profile only, explicit unconfigured fallback.
- Async `dashboardSessions()` required route caller updates in both Fastify and Worker to keep runtime behavior aligned with types.

Any issues or concerns
- No blocking issues after the final GREEN run.
- The task required two compile-fallout files outside the initial owned list in mock client helpers/tests because `getProfile()` became required on channel clients.
