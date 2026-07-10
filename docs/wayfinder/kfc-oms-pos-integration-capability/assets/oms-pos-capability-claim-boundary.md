# OMS And POS Capability Claim Boundary

## Evidence Reviewed

- Project requirement: use mock external integrations during the hackathon while preserving replaceable production-shaped client boundaries.
- Commit `d06b0933`, including the OMS/POS coordinator, authenticated HTTP POS adapter, mock POS server, readiness configuration, and component tests.
- Proof report `artifacts/mock-pos-proof/2026-07-10T20-24-31-483Z/report.json`.
- Existing fixture and deployment documentation that explicitly classifies generated data and external clients as mocks rather than production systems of record.

## Accepted Claim

Use this language for the current project:

> The prototype demonstrates a vendor-neutral, simulated OMS/POS integration path. A confirmed order can pass through replaceable OMS and POS adapter boundaries, retain an OMS-order-to-POS-ticket correlation, suppress duplicate submission within the running coordinator, project POS preparation state, surface POS rejection, and invoke compensating OMS cancellation.

Short form:

> Demonstrated simulated OMS/POS orchestration through replaceable adapter contracts.

The words `simulated` and `prototype` are mandatory whenever this claim appears without the full evidence context.

## Claims Not Supported

Do not say any of the following until stronger evidence exists:

- Connected to KFC's OMS or POS.
- Compatible with a named OMS or POS vendor.
- Validated against a vendor sandbox.
- Production-ready OMS/POS integration.
- Durable or exactly-once order delivery.
- Automatic recovery across process restart, network partition, or conflicting vendor state.
- Complete mapping of products, modifiers, taxes, discounts, tenders, stores, or receipts.
- Proven operational security, throughput, latency, or availability.

## Evidence Levels

### Simulated

Required label: `simulated: true` for OMS and POS independently.

Minimum evidence:

- Versioned internal contract or typed adapter boundary.
- Deterministic mock systems that run outside the coordinator process or through an equivalent HTTP boundary.
- Contract/component tests covering correlation, duplicate submission, status projection, rejection, and compensation.
- A machine-readable proof report naming every simulated dependency and linking test output or artifacts.
- Readiness output that cannot be mistaken for production configuration.

Allowed claim: architectural feasibility and demonstrated simulated orchestration.

### Sandbox

Required label: vendor name, sandbox environment, API/version identifier, and test timestamp.

Minimum evidence:

- Authoritative vendor documentation or an approved sandbox contract.
- Real sandbox authentication through the production adapter implementation.
- Vendor-issued OMS order and POS ticket identifiers.
- Happy path plus duplicate, rejection, cancellation, status, and timeout scenarios.
- Captured request/response provenance with secrets and customer data redacted.

Allowed claim: validated against the named vendor sandbox and documented scenarios.

### Production

Required label: deployed environment, version, time window, and operator approval.

Minimum evidence:

- Approved production credentials and data handling controls.
- Durable correlation and idempotency state.
- Reconciliation, retry, alerting, and audit visibility.
- Controlled real-order proof with rollback or cancellation procedure.
- Observed production identifiers and terminal states from both systems.

Allowed claim: operational production connection only for the systems, version, and scenarios actually observed.

## Existing Prototype Assessment

Commit `d06b0933` is sufficient prototype evidence to proceed with the next Wayfinder architecture tickets because it proves that the current agent boundary can host OMS/POS orchestration without changing the chat contract.

It is not sufficient for the final simulated proof gate. The final harness must additionally cover:

- POS timeout and unavailable service.
- Delayed acceptance and retry.
- Duplicate delivery after coordinator restart.
- Durable correlation lookup after restart.
- Conflicting OMS/POS status.
- Cancellation when only one system succeeds.
- Reconciliation after an ambiguous partial failure.
- Explicit dependency classification for OMS and POS separately rather than one aggregate `simulated` flag.

These gaps are already routed to **Audit The Current Commerce Prototype**, **Define The Commerce Domain And Correlation Contract**, **Decide POS Delivery And Failure Semantics**, and **Design The Mock OMS And POS Contract Harness**; no new ticket is required yet.
