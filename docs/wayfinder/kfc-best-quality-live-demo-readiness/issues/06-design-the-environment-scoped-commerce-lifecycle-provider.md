Status: resolved
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 02-define-the-three-minute-short-turn-golden-journey.md, 05-design-fail-closed-verified-commerce-facts.md
Assignee: Codex

## Question

What explicit environment-scoped lifecycle-provider contract can truthfully and deterministically drive supported payment from pending to paid and order/delivery from created through preparing and out-for-delivery without leaking test controls into ordinary sessions? Define Commerce Environment and scenario identity, initialization, reset, transition authorization, state machine, provider API and proof-harness control surface, idempotency, persistence, concurrency isolation, environment/provenance metadata, ordering/payment tool responses, invalid-transition behavior, failure injection, audit events, and proof correlation. Successful provider responses are authoritative facts within their environment and receive no customer-facing simulation label. Never derive transitions from customer wording, elapsed query count, or implicit fallback values.

## Decisions captured

- Lifecycle controls exist only on a separately authenticated sandbox proof-control plane bound to a scenario instance. Production exposes no lifecycle-control routes, and customer-facing tools may only invoke the ordinary provider contract; they can never request or authorize proof transitions.
- Initialization creates a unique scenario-instance ID bound to sandbox, scenario-definition version, release, catalog snapshot, customer, session, and expiry. Trusted server context supplies that ID; customer or model input never does.

## Resolution

Use one durable Lifecycle Scenario Instance containing independent payment-attempt, order, and delivery state machines with cross-machine guards. The configured sandbox provider owns these facts; LangGraph owns agent orchestration, approval, and resume only. After any pause, the agent must re-read current provider evidence before a consequential action. Successful sandbox responses use the same customer contract as production and receive no customer-facing mock or simulation label.

Exact transitions:

```text
PaymentAttempt:
  absent -> pending -> paid | failed | expired | cancelled
  retry after a terminal result creates a new attempt ID

Order:
  absent -> accepted | rejected
  accepted -> preparing -> ready -> completed
  accepted | preparing -> cancelled

DeliveryAttempt:
  absent -> pending_dispatch -> assigned -> delivering -> delivered
  pending_dispatch | assigned -> cancelled
  assigned | delivering -> failed
  retry after a terminal result creates a new attempt ID
```

Terminal states never regress. A prepaid order may enter `preparing` only with current `paid` evidence; delivery assignment requires a `ready` delivery order; `delivered` and order `completed` commit atomically. Customer wording, query count, retries, and wall-clock passage cannot transition any machine. The provider or authenticated proof harness submits typed lifecycle events; arbitrary state assignment is forbidden.

The ordinary provider API covers fulfillment quote, order preview/place/read/cancel, payment-method and payment-attempt create/read, and delivery read. It is identical across environments. Trusted deployment context injects environment and scenario binding. A separately authenticated sandbox-only control plane creates/reads/seals instances, submits typed events, configures faults, advances a frozen logical clock, and resets. Production does not register these routes.

Every mutation requires an idempotency key and request fingerprint. The same key and input returns the original result; changed input returns `409`. Each command supplies the expected durable revision; one transaction validates bindings and guards, appends the audit event, updates state, and increments revision. A stale revision, out-of-order event, or invalid transition returns `409` without mutation; an expired or sealed instance returns `410`; a cross-environment or wrong-binding lookup behaves as not found.

Reset seals the old instance and creates a new unique instance with `resetFrom`; it never rewinds or reuses identity. Fault injection is instance-, operation-, and occurrence-scoped, deterministic, and one-shot by default. It records whether failure occurs before commit or after commit but before response, so timeout, connection failure, explicit rejection/error, and malformed or partial-response cases are reproducible without unseeded randomness.

Persist the instance definition/version, environment, release, catalog hash, pseudonymous customer/session bindings, logical clock, expiry, current revision, state, idempotency records, and append-only audit events. Correlate provider, agent, UI, monitor, and proof evidence with trace/run/request IDs while excluding secrets and raw customer data.

This follows [Stripe sandbox isolation](https://docs.stripe.com/sandboxes), [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests), [Stripe test clocks](https://docs.stripe.com/api/test_clocks), deterministic guarded transitions described by [XState](https://stately.ai/docs/transitions), and the separate state/control surfaces demonstrated by [WireMock scenarios](https://wiremock.org/docs/stateful-behaviour/). LangGraph's [persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) remains the agent-runtime checkpoint boundary, not the commerce system of record.
