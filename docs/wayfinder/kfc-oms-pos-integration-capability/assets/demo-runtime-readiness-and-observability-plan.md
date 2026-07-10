# Demo Runtime Readiness And Observability Plan

## Decision

Run four independently addressable HTTP services for the proof: KFC agent backend, Demo Commerce Gateway, Mock OMS, and Mock POS. The proof runner owns process startup, ephemeral configuration, readiness polling, temporary event collection, artifact assembly, and shutdown.

Readiness must prove that configured dependencies can be reached and authenticated. Configuration presence alone is not readiness, and a gateway URL must never imply a production dependency. Every health response, trace, dashboard projection, and artifact must label each dependency as `simulated`, `sandbox`, or `production`; this demo uses `simulated` for the gateway, OMS, and POS.

## Runtime Configuration

The runner allocates loopback ports and injects configuration rather than relying on fixed developer ports:

- Agent: gateway URL/token, OpenAI configuration, LangSmith configuration, and runner trace-collector URL/token.
- Gateway: Mock OMS URL/token, Mock POS URL/token, scenario context, and trace-collector URL/token.
- Mock OMS and Mock POS: local API token, mock-admin token, service/contract version, and trace-collector URL/token.
- Runner: `--require-langsmith` presentation gate, artifact root, scenario set, and optional retained-process diagnostics.

Tokens are random per proof run, remain in process environment only, and are redacted from logs and artifacts. The generated run manifest records URLs without credentials, dependency classification, process IDs, service versions, contract versions, git SHA, dirty-worktree flag, model names, prompt/tool versions, fixture hashes, scenario IDs, and timestamps.

## Health And Readiness Contracts

Every service exposes side-effect-free endpoints:

### `GET /health`

Confirms only that the process can answer HTTP. It returns `ok`, `service`, `version`, `contractVersion`, `dependencyClass`, and `timestamp`. Mock services and the demo gateway always report `dependencyClass: "simulated"`.

### `GET /ready`

Confirms configuration and required downstream connectivity without creating an order:

- Mock OMS and Mock POS validate their runtime token/configuration and report ready.
- Gateway calls the OMS and POS health endpoints with their configured credentials.
- Agent calls gateway health, verifies OpenAI configuration, and reports whether LangSmith is configured and export-verified.
- The runner polls all four services until ready or a bounded startup timeout expires.

Each check has `status` (`starting`, `ready`, `degraded`, or `unavailable`), `required`, `configured`, `reachable`, `authenticated`, `dependencyClass`, `latencyMs`, and a safe diagnostic message. Local proof may proceed with LangSmith `degraded` because local JSON is the fallback. `--require-langsmith` requires a successful test trace export before scenarios begin.

The existing backend `/ready` behavior must be tightened during implementation: URL/token presence is configuration, not connectivity; gateway mode is not synonymous with production; and POS simulation must be explicit rather than inferred.

## Temporary Trace Collection

The proof runner hosts an in-process, loopback-only collector. Each service posts safe structured events to it; the collector assigns a monotonic `sequence` and retains events only for the current run. This does not add a durable state layer.

Minimum event fields:

```json
{
  "sequence": 7,
  "timestamp": "2026-07-11T00:00:00.000Z",
  "runId": "commerce-proof-...",
  "scenarioId": "success",
  "traceId": "trace-...",
  "service": "mock-pos",
  "eventType": "mock_pos_response",
  "status": "ok",
  "durationMs": 18,
  "simulated": true,
  "identifiers": {},
  "statuses": {},
  "inputSummary": {},
  "outputSummary": {}
}
```

The collector rejects unknown run IDs, invalid tokens, missing trace IDs, and unsafe fields. Summaries may include item codes, quantities, store ID, totals, payment method, identifiers, and raw/derived statuses. They must not contain customer address, phone, email, free-form transcript bodies, API keys, bearer tokens, or authorization headers.

Events use the ordered hop vocabulary already defined by the domain contract: `user_message`, `planner_decision`, `tool_call`, gateway request, OMS request/response, POS request/response, `tool_result`, `assistant_response`, and `genui_rendered`. Failure and compensation events retain the same trace and sequence model. The collector exposes lookup by run/scenario/trace to the runner only.

## LangSmith Trace Shape

LangSmith is the canonical visual trace for presentation runs, not a state store. The agent creates the root run; HTTP clients propagate `langsmith-trace` and optional `baggage`, plus the domain `X-Trace-Id`. Gateway, OMS, and POS emit nested runs with the same domain trace metadata.

All runs carry safe searchable metadata: run/scenario IDs, the six domain identifiers when available, tool name and argument summary, OMS/POS/customer statuses, dependency classifications, model/prompt/tool versions, and expected/rendered GenUI kind. Deterministic evaluator results attach to the scenario root. Local events and LangSmith runs share `traceId` so a reviewer can cross-check them.

## Operator And Reviewer Surfaces

The proof runner prints a compact live table showing each scenario and completed hop, then writes the manifest, readiness snapshot, per-scenario ordered event JSON, evaluator results, response/GenUI summaries, and LangSmith URLs under the artifact layout defined by the harness plan.

The existing monitor dashboard remains the operational overview. Its scoped commerce enhancement is a compact trace summary for the selected KFC session: tool name, customer status, OMS/POS raw statuses, commerce/OMS/POS identifiers, explicit `SIMULATED` labels, and a LangSmith link when present. It must not become the canonical event viewer or expose tokens and raw payloads. Customer chat and GenUI show only grounded customer-safe outcomes.

## Acceptance Gates

A local proof passes when:

- All four services become ready before scenario execution.
- Every scenario has a complete, correctly ordered local trace with continuous identifiers and explicit simulation labels.
- Deterministic evaluators pass for tool choice, arguments, hop order, trace continuity, correlation, failure semantics, response grounding, GenUI, and disabled KFC human controls.
- Readiness, provenance, evaluator, and shutdown results are present in the run manifest.
- No secret or prohibited PII appears in artifacts or trace metadata.
- All child processes exit and no runner-owned listener remains.

A presentation proof additionally requires a LangSmith URL and recorded evaluator evidence for every scenario. A missing or failed LangSmith export fails the presentation gate rather than silently falling back.

## Explicit Non-goals

- Durable trace or commerce persistence.
- Production alerting, SLOs, queues, retries, reconciliation, or restart recovery.
- A new full trace explorer in Flutter.
- Claims of vendor compatibility, sandbox certification, or production readiness.
