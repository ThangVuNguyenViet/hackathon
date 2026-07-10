# KFC OMS And POS Integration Capability Map

## Destination

Produce a decision-complete integration and proof plan showing how KFC chat can connect to both an OMS and a POS when vendor API documentation is unavailable, without claiming unverified compatibility with any production vendor.

The destination includes canonical contracts, OMS/POS correlation and lifecycle semantics, failure and retry ownership, runtime configuration and observability, a mock-system proof strategy, and a vendor-onboarding handoff that can replace mocks without redesigning the agent.

## Notes

- This is a follow-on to the completed [KFC Source Feature Parity Map](../kfc-source-feature-parity/map.md); source identity, KFC ingress, disabled deeplink, and disabled KFC human controls remain settled.
- Wayfinder is planning by default. Resolve one ticket per session and do not continue implementation unless a ticket is explicitly typed as an execution task.
- Existing commit `d06b0933` is prototype evidence. Preserve it, audit it, and improve it through decisions; do not treat its current in-memory correlation or simulated proof as production architecture by default.
- Existing proof artifact: `artifacts/mock-pos-proof/2026-07-10T20-24-31-483Z/report.json`.
- The current prototype demonstrates a simulated OMS order correlated with a mock POS ticket, idempotent replay, POS status projection, rejection handling, and compensating OMS cancellation.
- Do not add Patrol tests.
- Mock OMS/POS coverage belongs in normal Vitest contract or component tests. Flutter `integration_test` must remain backend-backed and must not be used to imply real vendor compatibility.
- Every proof artifact must state whether each dependency is simulated, sandbox, or production.

## Decisions so far

- [KFC Source Feature Parity Map](../kfc-source-feature-parity/map.md) — KFC is already a first-class anonymous source with dashboard parity, disabled deeplink and human controls, backend-backed Flutter proof, and no `web_mock` source dependency.

## Not yet specified

- Whether the production topology places OMS/POS orchestration inside this backend, inside a dedicated commerce gateway, or in an existing enterprise integration layer.
- Whether POS status reaches the platform through polling, webhooks, an event bus, or a vendor-specific hybrid.
- Which datastore owns durable OMS-order-to-POS-ticket correlation and idempotency records across deploys and retries.
- How store routing, menu identifiers, modifiers, taxes, discounts, and tender types map when real vendor schemas arrive.
- Which failure classes permit automatic retry, require compensation, or require operator reconciliation.
- Which evidence will satisfy reviewers when only mocks are available and which claims must remain explicitly unproven.

## Out of scope

- Claiming compatibility with a specific OMS or POS before authoritative documentation or sandbox evidence exists.
- Acquiring production credentials or executing real customer orders.
- Replacing the customer chat, monitor dashboard, or GenUI catalog.
- Re-enabling KFC deeplinks or the KFC human join/resume loop.

## Frontier

Open, unassigned tickets with no unresolved entries in `Blocks` are the frontier.

- [Define The OMS And POS Capability Claim](./01-define-oms-pos-capability-claim.md) is the first frontier ticket.
