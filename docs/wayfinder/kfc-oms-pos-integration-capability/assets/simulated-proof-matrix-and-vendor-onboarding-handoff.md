# Simulated Proof Matrix And Vendor Onboarding Handoff

## Claim Gate

The release may use this claim only after every required simulated gate below passes:

> Demonstrated simulated OMS/POS orchestration through replaceable adapter contracts.

`simulated` is mandatory. The proof does not establish compatibility with KFC, a named OMS/POS vendor, a vendor sandbox, or production operations.

## Evidence Matrix

| Layer | Required evidence | Required scenarios or assertions | Artifact | Claim contribution |
| --- | --- | --- | --- | --- |
| Unit | Pure tests for status derivation, identifier rules, idempotency keys, errors, redaction, evaluators, and trace ordering | Every branch in the domain and failure matrices; no network | Vitest reports and focused test names | Internal contract logic is deterministic |
| HTTP contract | Agent-to-gateway, gateway-to-OMS, and gateway-to-POS validation against versioned schemas | Authentication, trace headers, IDs, raw statuses, malformed response, timeout, and non-2xx mapping | Contract report and schema versions | Replaceable adapters honor the project contract |
| Multi-service component | Four real local HTTP services started by one runner, with OMS/POS outside the gateway process | All eight fixed scenarios, readiness, cleanup, and no direct in-process shortcut | Manifest, readiness, and per-scenario API summaries | Simulated HTTP orchestration executes end to end |
| Backend agent scenario | Customer language enters the normal KFC route and the planner executes the commerce tool | Correct tool/arguments, ordered hops, IDs, grounded response, GenUI, and disabled KFC human controls | Local trace, evaluator results, and assistant/GenUI JSON | User answer causes the AI/tool/API/result chain |
| Flutter widget/golden | Mock-data rendering through normal widget and golden tests | Safe success, failure, tracking, simulation label, layout, and disabled controls | Flutter output and approved goldens | UI renders the contract without a fake integration path |
| Backend-backed Flutter integration | Existing normal `integration_test` connects to a running backend | KFC source, chat action, returned GenUI, monitor visibility, and no mock repository or retired mock-only source | Result and screenshots/video from the same backend run | Real app-to-backend continuity only; not vendor proof |
| LangSmith presentation | Distributed nested trace and deterministic scores per scenario | Planner, tool, gateway, OMS, POS, result, response, GenUI, provenance, and no PII | Project/run URLs in scenario files and manifest | Reviewer-visible causal evidence for the simulated claim |

No Patrol suite is part of this matrix. Mock OMS/POS behavior belongs in Vitest and Flutter widget/golden tests. An `integration_test` is acceptable only when it uses the current backend-backed flow.

## Fixed Scenario Matrix

| Scenario | Required terminal evidence | Must not claim |
| --- | --- | --- |
| Successful placement | Commerce, OMS, and POS IDs correlated; customer status `accepted` | Vendor acceptance or durable delivery |
| Duplicate command | New trace, original result, `deduplicated: true`, no second OMS/POS request | Exactly-once behavior after restart |
| POS rejection, compensation succeeds | Rejection followed by confirmed OMS cancellation | Cancellation before OMS confirms it |
| POS rejection, compensation fails | Both raw outcomes retained; compensation failed/conflict | Order is cancelled |
| POS timeout | Three-second budget crossed by five-second delay; `ambiguous_pos_submission` | POS definitely did not receive the ticket |
| Successful cancellation | POS cancellation precedes OMS cancellation; both confirm | General vendor cancellation support |
| Partial cancellation failure | Customer status `failed`; raw outcomes and conflict retained | Fully cancelled order |
| Conflicting status | OMS/POS raw states preserved and conflict classified | Reconciled or automatically recovered state |

Restart durability, delayed retries, queues, and reconciliation are not simulated release gates. They become production requirements only if the destination expands beyond this demo.

## Pass And Fail Rules

The local gate passes only when:

- All four services report deep readiness with explicit `simulated` classification.
- All eight scenarios pass every deterministic evaluator and produce complete artifacts.
- The trace proves `user -> planner -> tool -> gateway -> OMS -> POS -> tool result -> assistant -> GenUI`, allowing only defined early-failure branches.
- Identifiers and raw/derived statuses remain correlated under one domain `traceId`.
- Tokens, authorization headers, addresses, phone numbers, emails, and unrestricted transcript text are absent from artifacts.
- The runner terminates every process and listener.
- Unit, contract, component, and Flutter widget/golden suites pass.

The presentation gate additionally requires:

- A reachable LangSmith run URL with expected nested runs for every scenario.
- Deterministic evaluator scores attached or linked from the manifest.
- Backend-backed Flutter and monitor evidence from the same identified proof run.
- Git SHA, dirty flag, model/prompt/tool versions, fixture hashes, contract versions, timestamps, and dependency classes in the manifest.

Missing artifacts, failed evaluators, unexpected downstream calls, absent simulation labels, leaked secrets/PII, or fallback from required LangSmith evidence fails the applicable gate.

## Release Artifact Index

```text
artifacts/mock-commerce-proof/<run-id>/
  manifest.json
  service-readiness.json
  test-results/
    unit.json
    contracts.json
    component.json
    flutter-widget-golden.json
    flutter-backend-integration.json
  scenarios/<scenario-id>/
    local-trace.json
    evaluator-results.json
    api-summary.json
    assistant-genui.json
    langsmith.json
  visual-proof/
    screenshots.json
    videos.json
```

The manifest is the index and overall verdict. It uses `not_run`, `passed`, `failed`, and `not_applicable` so missing evidence cannot look successful.

## Vendor Onboarding Input Checklist

Do not change the stable agent-facing commerce contract until authoritative vendor material exists. For each OMS and POS, request:

### Commercial and environment identity

- Legal vendor/product name, owner, technical contact, and support route.
- Sandbox/production URLs, region/tenant/store scope, API name/version, and lifecycle policy.
- Written permission for the intended order, status, cancellation, payment, and customer-data use cases.

### Authentication and security

- Auth scheme, credential provisioning/rotation, scopes, allowlisting, mTLS/signature, and clock-skew rules.
- Sandbox credentials and test stores/devices that cannot create real customer orders.
- PII/payment restrictions, retention, audit, encryption, and secret-management requirements.

### API contracts

- Authoritative OpenAPI/JSON Schema or equivalent request/response documentation.
- Product, modifier, store, fulfillment, tax, discount, tender, receipt, currency, locale, and timezone semantics.
- Vendor identifiers, idempotency and retention, correlation headers, pagination, and version headers.
- Status machines, terminal states, cancellation windows, partial success, and conflict precedence.
- Error codes, retryability, timeout guidance, rate limits, maintenance, and availability expectations.
- Webhook contracts, delivery guarantees, ordering, replay, signature verification, and acknowledgement rules where applicable.

### Verification support

- Vendor examples, Postman collection or conformance tests, known limitations, and sandbox reset/seeding procedure.
- Test data for success, duplicate, rejection, timeout, cancellation, status, and conflict.
- Expected vendor-issued OMS/POS identifiers and a vendor-side lookup or log surface.

## Adapter Mapping Handoff

For each real adapter, create a reviewed mapping record containing:

- Project command/result schema version and vendor API version.
- Field-level request/response mapping, including unsupported or lossy fields.
- Project-to-vendor status mapping with unknown-state handling.
- Project-to-vendor error and retry mapping.
- Authentication implementation and redaction policy.
- Idempotency/correlation strategy and vendor limitations.
- Timeout, cancellation, webhook, and reconciliation behavior.
- Contract tests derived from authoritative examples.
- Owner, review date, and unresolved gaps.

The Demo Commerce Gateway remains stable. Vendor adapters replace mocks behind it only after review. Vendor schemas must not leak into agent tools or Flutter models without an approved project-contract change.

## Evidence-Level Promotion

1. **Simulated:** this matrix passes with independently labelled mock services.
2. **Sandbox:** authoritative docs, real sandbox auth, vendor IDs, and the required scenario subset pass against a named version.
3. **Production:** approved credentials, durable idempotency/state, retry/reconciliation, alerts/audit, ownership, and a controlled real-order proof pass.

Each level gets a new dated manifest. Simulated evidence cannot be relabelled as sandbox or production evidence.

## Implementation Handoff Order

1. Implement versioned gateway, Mock OMS, Mock POS, and trace-event schemas.
2. Implement deep readiness and the runner-owned collector.
3. Implement the eight-scenario four-service runner and deterministic evaluators.
4. Add or extend unit, HTTP contract, component, and Flutter widget/golden tests.
5. Project safe commerce trace fields into the existing monitor.
6. Run the existing backend-backed Flutter integration against the proof backend.
7. Run `--require-langsmith`, assemble the manifest, and review the claim gate.

This order proves the backend causal chain before spending effort on visual evidence.
