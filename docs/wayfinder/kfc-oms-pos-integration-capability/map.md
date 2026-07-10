# KFC OMS And POS Integration Capability Map

## Destination

Produce a decision-complete demo and proof plan showing the observable chain from a KFC chat user answer, through AI tool selection and execution, through a separate local commerce gateway, to mock OMS and mock POS APIs, without claiming vendor compatibility.

The destination includes a temporary trace contract, synchronous mock API orchestration, deterministic demo outcomes, process readiness, and evidence showing every planner/tool/API/response/GenUI hop. A real stateful commerce layer is not required.

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
- [Define The OMS And POS Capability Claim](./01-define-oms-pos-capability-claim.md) — The accepted claim is demonstrated simulated OMS/POS orchestration through replaceable adapters; the prototype unlocks architecture planning but does not prove vendor compatibility, durability, or production readiness.
- [Audit The Current Commerce Prototype](./02-audit-current-commerce-prototype.md) — Preserve the typed seams and simulated HTTP proof; process-local correlation is acceptable only because the later topology decision explicitly limits the work to a single-run demo.
- [Choose The Commerce Orchestration Topology](./08-choose-commerce-orchestration-topology.md) — Run a separate local HTTP gateway plus separate mock OMS/POS services synchronously, and prove the full call chain with one temporary trace; durable state and production recovery are non-goals.
- [Define The Commerce Domain And Correlation Contract](./03-define-commerce-domain-and-correlation.md) — Keep six identifiers and raw OMS/POS states distinct, derive a seven-state customer status, and use LangSmith distributed traces plus deterministic evaluators as canonical visual evidence.

## Not yet specified

- Which deterministic failure variants are necessary to make the demo convincing without simulating a full production recovery system.

## Out of scope

- Claiming compatibility with a specific OMS or POS before authoritative documentation or sandbox evidence exists.
- Acquiring production credentials or executing real customer orders.
- Replacing the customer chat, monitor dashboard, or GenUI catalog.
- Re-enabling KFC deeplinks or the KFC human join/resume loop.
- Durable commerce persistence, queues, background retries, restart recovery, and production reconciliation.
- Mapping real vendor schemas for stores, products, modifiers, taxes, discounts, tenders, and receipts.

## Frontier

Open, unassigned tickets with no unresolved entries in `Blocks` are the frontier.

- [Decide POS Delivery And Failure Semantics](./04-decide-pos-delivery-and-failure-semantics.md) is now the first frontier ticket.
