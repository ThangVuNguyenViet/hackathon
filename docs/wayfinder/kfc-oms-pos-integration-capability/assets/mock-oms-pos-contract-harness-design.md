# Mock OMS And POS Contract Harness Design

## Goal

Provide one repeatable command that proves this backend chain without vendor documentation:

```text
user message
-> planner decision
-> agent tool call
-> Demo Commerce Gateway HTTP API
-> Mock OMS HTTP API
-> Mock POS HTTP API
-> tool result
-> assistant response
-> GenUI payload
```

The harness demonstrates simulated integration capability. It does not run real vendor APIs or establish production guarantees.

## Process Model

One proof runner starts four separate HTTP servers on ephemeral ports:

1. Mock OMS
2. Mock POS
3. Demo Commerce Gateway
4. KFC agent backend

The runner:

1. Allocates ports and demo tokens.
2. Starts Mock OMS and Mock POS.
3. Starts the Demo Commerce Gateway with both downstream URLs.
4. Starts the KFC agent backend with the gateway URL.
5. Waits for all readiness checks.
6. Configures and executes each scenario sequentially.
7. Collects local and optional LangSmith evidence.
8. Writes the proof artifact.
9. Shuts every process down, including failure paths.

Services remain separate so the HTTP boundaries and distributed trace propagation are visible. A single runner is an operator convenience, not an in-process collapse of the architecture.

## Service Contracts

### Mock OMS

Required normal routes:

- `GET /health`
- `POST /v1/orders/preview`
- `POST /v1/orders`
- `GET /v1/orders/:omsOrderId`
- `POST /v1/orders/:omsOrderId/cancel`

Required response fields include `commerceOrderId`, `omsOrderId`, raw `omsStatus`, `traceId`, and `simulated: true`.

### Mock POS

Required normal routes:

- `GET /health`
- `POST /v1/tickets`
- `GET /v1/tickets/:posTicketId`
- `POST /v1/tickets/:posTicketId/cancel`

Required request fields include `commerceOrderId`, `omsOrderId`, store/item summary, and idempotency key. Required response fields include `posTicketId`, raw `posStatus`, `traceId`, and `simulated: true`.

### Demo Commerce Gateway

Required routes remain the stable agent-facing commerce API:

- `GET /health`
- `POST /v1/orders/preview`
- `POST /v1/orders`
- `GET /v1/orders/:commerceOrderId`
- `POST /v1/orders/:commerceOrderId/cancel`

The gateway generates `commerceOrderId`, orchestrates Mock OMS then Mock POS synchronously, derives `customerStatus`, and returns all source identifiers and raw statuses.

### KFC agent backend

Use the existing first-party KFC message and GenUI-action routes. The proof runner sends customer language rather than invoking the commerce client directly so LangSmith captures planner selection and tool execution.

## Mock-only Scenario Control

Mock behavior is configured through:

```text
PUT /__admin/scenarios/:scenarioId
```

Example control payload:

```json
{
  "operation": "submit_pos_ticket",
  "behavior": "delay",
  "delayMs": 5000,
  "response": null
}
```

Supported deterministic controls:

- Immediate success.
- Explicit rejection with error code.
- Delay in milliseconds.
- Cancellation failure.
- Fixed status response.
- Conflicting status response.
- Optional malformed response for transport validation tests.

Controls are keyed by `scenarioId` and operation so scenarios cannot leak behavior into one another. `scenarioId` travels as trace metadata, not as a vendor payload field. Admin routes bind to local interfaces and require a separate admin token.

## Fixed Scenario Suite

| Scenario | Required proof |
| --- | --- |
| Successful placement | OMS order and POS ticket created and correlated |
| Duplicate command | New trace, no additional OMS/POS request, original result returned |
| POS rejection, compensation succeeds | POS rejection followed by confirmed OMS cancellation |
| POS rejection, compensation fails | Failure and raw OMS conflict retained without false cancellation claim |
| POS timeout | Five-second delay crosses three-second budget and becomes `ambiguous_pos_submission` |
| Successful cancellation | POS cancellation precedes OMS cancellation and both confirm |
| Partial cancellation failure | Customer status is failed and raw source outcomes remain visible |
| Conflicting status | Both raw states preserved and conflict classification returned |

All scenarios run sequentially for deterministic presentation. Parallel load and restart recovery are outside scope.

## Trace Collection

Every service propagates:

- LangSmith distributed trace headers.
- Domain `X-Trace-Id`.
- `scenarioId` in trace metadata.

Each service also emits structured local trace events to the runner. The runner orders events by sequence number assigned within the trace rather than relying only on wall-clock timestamps.

Required event chain:

```text
user_message
planner_decision
tool_call
gateway_request
mock_oms_request
mock_oms_response
mock_pos_request
mock_pos_response
tool_result
assistant_response
genui_rendered
```

Failure scenarios may terminate before all downstream request events, but must include the expected failure and assistant/GenUI evidence.

## Evaluators

Run deterministic code evaluators for:

- Tool selection.
- Tool arguments against the scripted user answer.
- Required hop order.
- Trace continuity.
- Identifier correlation.
- Independent simulation labels.
- Timeout and conflict classification.
- Duplicate suppression.
- Compensation truthfulness.
- Assistant grounding.
- Expected GenUI payload.
- Disabled KFC human controls.

LLM-as-judge may score response clarity and naturalness, but cannot prove API execution.

## Artifact Layout

```text
artifacts/mock-commerce-proof/<run-id>/
  manifest.json
  service-readiness.json
  scenarios/
    <scenario-id>/
      local-trace.json
      evaluator-results.json
      api-summary.json
      assistant-genui.json
      langsmith.json
```

`manifest.json` contains:

- Git commit and run timestamp.
- Service URLs without tokens.
- Independent `gateway`, `oms`, and `pos` simulation labels.
- Scenario pass/fail summaries.
- LangSmith project, trace IDs, and URLs when available.
- Local artifact paths.
- Overall pass/fail status.

Artifacts must exclude credentials, raw customer addresses, phone numbers, invoice emails, and other PII.

## Execution Modes

### Default

Local structured traces and deterministic evaluators are authoritative for the run. LangSmith export is attempted when configured but is not required. This mode supports credential-free local development and CI.

### Presentation gate

Run with `--require-langsmith`. Fail unless every scenario has:

- A LangSmith trace/run URL.
- The expected distributed child runs.
- Deterministic evaluator results attached to the experiment or recorded in the manifest.

This mode is required for the reviewer-facing demonstration.

## Flutter Boundary

Do not add a mock-backed Flutter `integration_test`. The harness stores the assistant response and GenUI payload returned by the backend. Existing widget and golden tests verify mock-data rendering. Flutter integration tests remain reserved for the current backend-backed flow and must not be cited as real OMS/POS proof.

## Acceptance

The harness design is satisfied when one command can run the eight scenarios, produce a passing manifest and ordered evidence, clean up all processes, run without LangSmith credentials by default, and enforce LangSmith evidence in presentation mode.
