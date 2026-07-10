# Current Commerce Prototype Audit

## Scope

Audited commit `d06b0933` against the accepted claim in [OMS And POS Capability Claim Boundary](./oms-pos-capability-claim-boundary.md). This is an architecture audit, not an implementation change request.

## Reusable Foundations

- `OmsClient`, `PaymentClient`, and `PosClient` provide replaceable typed boundaries independent of a named vendor.
- POS submission crosses an authenticated HTTP boundary and carries an explicit idempotency key.
- The mock POS is runnable as a separate process and reports `simulated: true` from health output.
- Configuration separates fixture commerce, gateway commerce, disabled POS, and HTTP POS modes.
- Component tests and the machine-readable report demonstrate the accepted narrow claim: simulated orchestration, correlation, duplicate suppression within one coordinator, status projection, rejection, and attempted compensation.
- KFC chat and graph code continue to depend on the OMS abstraction rather than importing mock POS behavior directly.

These pieces should be preserved unless later vendor evidence proves a contract mismatch.

## Production-Shaped Gaps

### Critical: correlation and idempotency are process-local

`createOmsWithPos` stores preview results and OMS-to-POS correlation in two in-memory maps. A restart loses both. The Cloudflare Worker constructs environment-derived server options inside request handling, so a coordinator can be recreated between requests. Consequently:

- A repeated confirmation can place another OMS order after restart.
- `getOrderStatus` cannot find the POS ticket after request/process loss and silently returns OMS-only state.
- Cancellation cannot propagate to POS when the in-memory ticket lookup is absent.

The final design needs a durable commerce operation ledger with unique idempotency constraints and correlation lookup by OMS order, POS ticket, customer order, and submission operation.

### Critical: ambiguous POS submission is treated as definite failure

Any POS failure, including network timeout after the POS may have accepted the ticket, immediately triggers OMS cancellation. The coordinator then states that the OMS order “was cancelled” without checking the cancellation result. This can create an active POS ticket paired with a live or ambiguously cancelled OMS order.

Timeout/unavailable, explicit rejection, validation failure, and authentication failure require different policies. Ambiguous outcomes need reconciliation before retry or compensation.

### High: cancellation and status divergence are hidden

- Cancellation calls OMS first, then POS. If POS cancellation fails, the method returns OMS success and hides the divergence.
- POS status lookup failure is ignored and returned as OMS-only success.
- POS `ready` is flattened to OMS `preparing`; POS `rejected` is flattened to OMS `cancelled`. This discards information needed for reconciliation and monitoring.
- No operation state records which system accepted, rejected, timed out, or compensated.

### High: HTTP contracts trust unvalidated responses

The OMS gateway and POS clients cast arbitrary JSON to `ToolResult<T>` without runtime schema validation. They have no request timeout, retry budget, request/correlation ID, API version negotiation, or structured handling for non-JSON and malformed error responses.

Bearer authentication is a reasonable placeholder, but it does not establish the future vendor authentication contract.

### High: readiness proves configuration, not connectivity

`/ready` reports gateway/POS readiness from the presence of URLs and tokens. It does not call dependency health endpoints, validate credentials, identify API versions, or distinguish mock, sandbox, and production OMS independently. Gateway mode is marked `production: true` based on configuration alone, which exceeds the accepted evidence claim.

### Medium: canonical order and POS state are conflated

`Order` directly embeds optional `posTicketId` and `posStatus`, and the wrapper rewrites OMS status from POS state. This is convenient for the prototype but prematurely chooses ownership and status precedence before the commerce domain contract is decided.

A canonical projection may still expose both, but raw OMS state, raw POS state, derived customer state, and reconciliation state should remain distinguishable.

### Medium: mock and proof coverage is narrow

The mock POS persists only in memory and supports immediate acceptance/rejection plus manual status change. Missing cases include timeout, delayed acceptance, malformed payload, expired authentication, retry after restart, duplicate idempotency key with a different payload, conflicting status, partial cancellation, and reconciliation.

The proof OMS is an in-process object rather than an external HTTP mock. The proof report's `passed` reducer treats every object-valued check as passing, so the correlation object itself is not validated as a boolean assertion. There is no proof through chat, dashboard telemetry, or a restarted coordinator.

## Prototype Classification

| Area | Classification | Direction |
| --- | --- | --- |
| Typed client boundaries | Preserve | Add runtime schemas and versioning |
| HTTP POS adapter | Preserve concept | Add timeout, validation, IDs, and error taxonomy |
| In-memory correlation maps | Replace | Durable operation ledger |
| Immediate OMS cancellation on any POS failure | Replace | Failure-specific state machine and reconciliation |
| POS mock server | Extend | Deterministic latency, failures, restart, and persistence controls |
| Readiness configuration | Extend | Active dependency checks and evidence-level labels |
| `Order.posStatus` projection | Re-decide | Separate raw and derived state ownership |
| Component proof/report | Extend | Boolean gates, external mock OMS, restart and divergence scenarios |

## Planning Consequences

1. Choose where commerce orchestration runs before assigning persistence and retry ownership.
2. Define durable identifiers and the commerce operation ledger in **Define The Commerce Domain And Correlation Contract**.
3. Define explicit outcome classes and reconciliation in **Decide POS Delivery And Failure Semantics**.
4. Extend mocks and evidence only after those contracts are settled.
5. Do not harden the current in-memory wrapper incrementally as if its topology were already approved.

The audit makes the topology question precise enough to graduate from fog into **Choose The Commerce Orchestration Topology**.
