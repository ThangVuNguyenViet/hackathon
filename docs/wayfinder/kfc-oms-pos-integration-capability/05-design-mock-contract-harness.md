# Design The Mock OMS And POS Contract Harness

## Status

Closed

## Type

Prototype, HITL

## Assignee

Codex

## Blocks

- Define The Commerce Domain And Correlation Contract
- Decide POS Delivery And Failure Semantics

## Question

What mock OMS and mock POS behaviors, configurable failures, contract fixtures, and deterministic scenarios are required to demonstrate the chosen integration semantics without letting the mocks define the future vendor contract accidentally?

The design must cover happy path, duplicate delivery in one demo run, delayed response, unavailable item, store rejection, timeout, conflicting status, and cancellation. Recovery after process restart is outside the demo scope.

## Interview notes

- One proof runner starts Mock OMS, Mock POS, Demo Commerce Gateway, and KFC agent backend as separate HTTP servers on ephemeral ports.
- The runner injects service URLs and demo tokens, executes scenarios, collects LangSmith/local evidence, writes one manifest, and shuts down all processes.
- Deterministic mock behavior is configured through mock-only `PUT /__admin/scenarios/:scenarioId` endpoints. Normal OMS/POS payloads remain production-shaped; `scenarioId` is trace metadata, not a vendor field.
- The fixed suite contains eight scenarios: success, duplicate suppression, rejection with compensation success, rejection with compensation failure, POS timeout, successful POS-first cancellation, partial cancellation failure, and conflicting OMS/POS status.
- Each run writes a manifest, ordered local trace per scenario, deterministic evaluator scores, safe API summaries, assistant response, GenUI payload, and independent simulation labels. Include LangSmith run URLs when available. Exclude PII, credentials, and raw addresses.
- Mock-backed Flutter `integration_test` is forbidden; mock GenUI rendering remains in normal widget/golden tests.

## Resolution

Use one proof runner to start four separate HTTP services on ephemeral ports, configure deterministic mock behavior through local admin endpoints, execute eight fixed scenarios, collect ordered local and optional LangSmith traces, run deterministic evaluators, write one structured artifact tree, and clean up all processes.

Default mode passes without LangSmith credentials using local JSON evidence. Presentation mode uses `--require-langsmith` and fails unless every scenario has LangSmith trace URLs and evaluator evidence. Mock-backed Flutter integration tests remain prohibited.

Full design: [Mock OMS And POS Contract Harness Design](./assets/mock-oms-pos-contract-harness-design.md).

## Current implementation amendment (2026-07-20)

The runner, trace collector/event vocabulary, deterministic proof evaluators,
generated artifacts, and mock LangSmith gate described above are retired. The
retained harness boundary is the gateway plus Mock OMS/POS HTTP component suite.
It verifies project contracts and failure semantics, but it is not evidence of
live model selection, a grounded agent response, deployment, or vendor
compatibility.
