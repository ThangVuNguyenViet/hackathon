# KFC Customer-Service Production Readiness

This is the implementation and sales-truth companion to the customer proposal. A gate is complete only when its named evidence exists; mocked behavior is not production evidence.

## Current product position

The existing system already provides verified commerce projections, confirmation and revision checks, irreversible-operation fencing, rapid-turn coalescing, human pause/resume, structured commerce UI, three-channel presentation, monitoring, and deterministic/live proof surfaces.

The persistence layer now enforces one agent-run claim per `(session_id, generation)`. OpenAI requests use versioned prompt cache keys per stable prompt family, and diagnostics record input, cached input, cache-write input, uncached input, output, and total tokens so real model cost can replace forecast assumptions.

Catalog discovery uses a TTL-bound in-isolate cache plus Cloudflare's shared Cache API when available. Cache identity includes commerce environment and a hash of the normalized provider URL. Consequential cart, order, and confirmation paths bypass this discovery cache and revalidate directly against the configured provider.

## Production gates

| Gate | Current state | Completion evidence |
|---|---|---|
| KFC account linking and cross-channel identity | Blocked on KFC identity contract | Approved OTP/token flow; subject-bound web, Messenger, and Zalo tests; revocation and expiry tests |
| KFC commerce systems | Gateway contracts exist; several runtime clients remain mock/unavailable | Approved sandbox and production contract tests for catalog, order, membership, promotion, invoice, loyalty, payment, and profile |
| CRM/case handoff | Manual dashboard takeover exists | Case creation, ownership, SLA, status, transcript sync, failure fallback, and operator acceptance proof |
| Workforce SSO and RBAC | Demo bearer token only | KFC identity-provider integration, server-derived operator identity, least-privilege roles, assignment and audit tests |
| Messenger authenticity | Implemented | Valid, invalid, missing, and rotated-secret webhook tests plus controlled channel proof |
| Zalo authenticity | Not complete | KFC/Zalo-approved signature specification, captured signed fixtures, reject-by-default implementation, replay tests, and controlled channel proof |
| Atomic agent-run claim | Implemented | Concurrent claim test and unique database constraint applied in every deployed environment |
| Outcome and cost measurement | Prompt cache keys and token telemetry implemented; durable billable-outcome ledger pending pilot policy approval | Aggregated model usage, cache-read/write rate, evaluator versioning, 72-hour recontact join, exclusions, invoice reconciliation, and KFC sample audit |
| Production monitoring | Deterministic monitor exists | Scheduled canaries and dashboards/alerts for outcome, SLA, containment, CSAT, recontact, latency, provider and tool failures |
| Proactive exception recovery | Lifecycle state model exists in sandbox | Authenticated provider event adapter, customer consent/policy, outbound recovery workflow, idempotency, operator timeline, opt-out tests |

Do not implement guessed KFC, CRM, SSO, or Zalo contracts. Their authoritative specifications and credentials are acceptance inputs.

## Runtime cost measurement

Planning volume is 10,000 conversations and approximately 60,000 customer turns per month.

The current Cloudflare architecture should remain near its included-usage floor at that traffic. Model inference is expected to dominate runtime cost. The working forecast is **$300–$1,200 per month**, with a central estimate near **$460**, until production telemetry is available.

Aggregate every `openai_api_response` event by component and model:

```text
cost = uncached_input_tokens * uncached_input_rate
     + cached_input_tokens   * cached_input_rate
     + output_tokens         * output_rate
```

Rates must come from the provider price sheet on the invoice date. Do not hard-code them into runtime behavior.

At pilot review, replace all token-shape forecasts with observed p50/p95 tokens per turn, cache-hit rate, model call count per conversation, cost per conversation, and cost per verified outcome.

## OpenClaw comparison for internal use

OpenClaw is a capable personal-agent Gateway with broad tools and channel adapters. Its documented trust model uses one trusted-operator boundary per Gateway; shared mutually untrusted users are not an authorization boundary, and isolated hosting requires separate Gateway cells. Its Gateway also owns local session state.

For equivalent KFC customer service, OpenClaw would still require the external customer identity, authorization, durable queue, idempotency, commerce APIs, audit store, operator ownership, and outcome controls already represented by this platform. It would therefore add a stateful execution tier rather than replace the CS control plane.

Indicative infrastructure comparison before model inference:

| Architecture | Low-volume managed floor | Important qualification |
|---|---:|---|
| Current Cloudflare control plane | about **$5/month** | Usage-based Worker, D1, Queue, and Durable Object services |
| OpenClaw Gateway cell | about **$12–$15.60/month/cell** | Before high availability and external CS control-plane services |

If both systems use the same model and token volume, inference cost is materially the same. Compare measured token totals and equivalent reliability boundaries, not a VPS price against a complete platform.

Primary references:

- [OpenClaw security model](https://docs.openclaw.ai/gateway/security)
- [OpenClaw multi-tenant hosting](https://docs.openclaw.ai/gateway/multi-tenant-hosting)
- [OpenClaw Gateway locking](https://docs.openclaw.ai/gateway/gateway-lock)
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [OpenAI GPT-4.1 pricing](https://openai.com/index/gpt-4-1/)
- [Intercom outcome pricing](https://www.intercom.com/help/en/articles/8205718-fin-ai-agent-outcomes)

## Rollout rule

Expand traffic only when the relevant gate is complete, its controlled proof passes against the declared release, and rollback has been exercised. Missing external access delays the gate; it does not permit a mock or undocumented assumption to be presented as production-ready.
