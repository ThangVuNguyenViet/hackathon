# PVCFC Zalo OA Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the KFC-bound Zalo integration with a dedicated, secure, durable PVCFC Zalo OA channel on `chatbot.pvcfc.com.vn`.

**Architecture:** Keep the shared conversation runtime and PostgreSQL store, but bind Zalo ingress explicitly to the PVCFC verified business context. Authenticate raw webhook bodies before persistence, reserve each message transactionally, acknowledge immediately, and process through PostgreSQL-backed leased jobs. Store encrypted OAuth credentials per app/OA and resolve a fresh access token for every outbound send.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Vitest, Node.js crypto/WebCrypto, PM2, Caddy, Zalo OA OpenAPI.

## Global constraints

- Preserve the existing `/chat/pvcfc/message` request contract and KFC/Messenger behavior.
- Only `user_send_text` is in scope for Zalo v1.
- Never log or commit app secrets, OA secrets, setup tokens, refresh tokens, access tokens, or encryption keys.
- The operator must personally accept Zalo legal agreements and submit app creation.
- Use OA `4225933857518051795`; reject missing or different recipients.

### Task 1: Shared PVCFC context and strict Zalo normalization

- [ ] Add failing tests for shared context injection and missing/wrong recipient rejection.
- [ ] Extract the verified PVCFC business context into a reusable module.
- [ ] Inject it in both web chat and Zalo worker execution.
- [ ] Run focused tests.

### Task 2: Authenticated, bounded webhook ingress

- [ ] Add failing tests for raw-body signature verification, malformed payloads, unsigned requests, and payload limits.
- [ ] Implement `X-ZEvent-Signature` verification using the documented Zalo digest inputs and constant-time comparison.
- [ ] Reject unauthenticated or oversized requests before store/model calls.
- [ ] Return HTTP 200 with queued status for accepted unique deliveries.

### Task 3: Durable webhook jobs and lease recovery

- [ ] Add failing integration tests for duplicate reservation, immediate acknowledgement, restart recovery, and failed-send retry.
- [ ] Add typed PostgreSQL Zalo webhook job records and atomic reserve/lease/complete/fail operations.
- [ ] Add a bounded worker loop that reclaims expired leases after restart.
- [ ] Preserve session IDs as `zalo:<userId>` and persist outbound delivery evidence.

### Task 4: OAuth credentials, encryption, and refresh

- [ ] Add failing tests for AES-GCM encryption, state/PKCE, refresh-before-expiry, concurrent refresh locking, prior-token retention, and redaction.
- [ ] Add typed credential/refresh records keyed by app and OA.
- [ ] Add PostgreSQL encrypted credential persistence and advisory/row locking.
- [ ] Add `GET /auth/zalo/start` and `GET /auth/zalo/callback`, protected by an operator setup token and disabled after authorization.
- [ ] Extend `createZaloClient` with an asynchronous access-token provider.

### Task 5: Environment, readiness, and runtime composition

- [ ] Add failing configuration/readiness tests.
- [ ] Add Zalo secret, public URL, OAuth, encryption, and worker settings to typed env parsing.
- [ ] Compose the token manager and durable worker in the Node/PostgreSQL runtime without changing Worker/KFC defaults.
- [ ] Check PostgreSQL, OA ID, webhook secret, usable token state, refresh configuration, and HTTPS public URL in deep readiness.

### Task 6: Regression and security verification

- [ ] Run focused Zalo/PVCFC tests under Node 24.
- [ ] Run type checking and the backend CI test suite.
- [ ] Verify secret redaction and scan the diff for credentials.
- [ ] Review the final diff against this plan.

### Task 7: SCloud deployment and Zalo console setup

- [ ] Update the SCloud runbook for Node 24, PostgreSQL, Caddy, PM2, `/etc/pvcfc-backend.env` mode `600`, and DNS/TLS.
- [ ] Deploy and verify HTTPS health/readiness without exposing credentials.
- [ ] Configure the app domain, callback, OA authorization, webhook retry, and only `user_send_text` in Chrome.
- [ ] Capture the operator's personal legal acceptance and app submission at the required Zalo checkpoint.
- [ ] Perform live inbound/outbound, replay, restart, persistence, and token-refresh acceptance proof.
