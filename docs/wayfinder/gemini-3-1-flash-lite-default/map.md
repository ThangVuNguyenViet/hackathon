# Gemini 3.1 Flash-Lite Planner Default Map

Labels: wayfinder:map

## Destination

Make Gemini 3.1 Flash-Lite on Vertex AI `global` the production-default KFC tool planner after it passes the complete promotion path, while retaining GPT-4.1 as an explicit deployment rollback.

The map is complete when the shared planner contract works without a Gemini-only semantic prompt fork, Gemini passes 54/54 qualification cases with zero critical violations, blinded Vietnamese review, 100 shadow turns, and 100 turns at a 10% canary, and the deployed default is switched with retained evidence and rollback instructions.

## Notes

Domain: KFC tool planning, provider-neutral planner behavior, Vertex AI transport, structured output, semantic validation, model qualification, production shadowing, canary rollout, cost, and rollback.

Skills every session should consult: `wayfinder` and `domain-modeling`; use `grilling` only for unresolved product decisions.

This map carries execution through the final default switch. Each implementation ticket must leave the smallest runnable check and retained evidence. Preserve unrelated work and use this dedicated worktree:

- Worktree: `/Users/vietthangvunguyen/Workspace/hackathon-gemini-migration`
- Branch: `codex/gemini-default-migration`
- Baseline: `7594efc54dacf4582cd3b4898f6c1ff04b5cbdae`

Settled direction:

- Target only the tool planner in this effort. Response composition, small-talk routing, monitoring judges, and outcome judges remain unchanged.
- Target `gemini-3.1-flash-lite` through Vertex AI `global` with minimal thinking.
- Improve prompts, validation, normalization, behavior guards, and bounded semantic recovery for every planner provider. Gemini-specific code is limited to Vertex authentication, endpoint/request mapping, structured-output mapping, thinking configuration, response extraction, and usage telemetry.
- Permit at most one shared semantic replan within the existing request deadline. Retain and bill every attempt.
- Do not silently fall back to GPT-4.1 per request. GPT-4.1 remains a deployment-level rollback.
- Require 54/54 qualification cases, zero critical safety/evidence violations, every existing deadline, blinded review by two Vietnamese reviewers, 100 redacted shadow turns, and 100 turns at a 10% canary.
- Keep GPT-4.1 as the deployed default until the canary passes. Switch the default only after measured total-model savings are at least 25%.
- Do not impose the current 640-token planner output cap during adaptation or qualification. Retain the existing deadlines and measure output usage.
- Production Vertex access uses one dedicated credential with `roles/aiplatform.user`, stored only as a Worker secret. Human ADC is local-development only.

Verified charting baseline:

- The reconciled arena currently contains Gemini 2.5 Flash-Lite through the Gemini Developer API, not Gemini 3.1 Flash-Lite through the production Vertex path.
- Production planner construction is OpenAI-specific even though the arena already contains a compatibility transport.
- The corrected Gemini 2.5 Flash-Lite smoke passed 4/10; corrected Gemini 2.5 Flash passed 6/10. The remaining failures were semantic, while the final Flash run had 33/33 successful provider requests.
- GPT-4.1 passed one complete nine-scenario Text/GenUI proof and later passed 53/54 repeated qualification cases. This migration deliberately raises the challenger gate to 54/54.

## Decisions so far

- 2026-07-18: Retained Gemini failures map to shared raw-contract, per-tool argument, semantic-validation, and bounded-replan seams; enforce typed violations and one shared replan rather than a Gemini-only prompt fork or phrase-based plan rewriting. See [ticket 01 audit](./assets/gemini-failures-and-shared-planner-seams-audit.md).
- 2026-07-18: [Prove The Vertex Gemini 3.1 Runtime Contract](./issues/02-prove-vertex-gemini-3-1-runtime-contract.md) verified strict output and minimal thinking from Node and a remote Cloudflare Worker using one `roles/aiplatform.user` service account and native Web Crypto OAuth.
- 2026-07-18: [Implement Provider-Neutral Production Planner Transport](./issues/03-implement-provider-neutral-production-planner-transport.md) added one Vertex adapter around the shared Responses-style planner, with native OAuth refresh, strict schema mapping, minimal thinking, uncapped Gemini output, normalized telemetry/readiness, and OpenAI retained as the default. PR #20 was excluded because quota limits invalidated its live proof.

## Not yet specified

- Whether production needs an explicit output-token ceiling. Decide from successful qualification and shadow telemetry before canary; do not guess a limit now.
- Any planner-contract changes exposed only after the first Gemini 3.1 smoke. Graduate each distinct root cause into a ticket only when it is precise.

## Out of scope

- Migrating response composition, small-talk routing, monitoring judges, or outcome judges to Gemini.
- A Gemini-only semantic prompt, hidden retry policy, or per-request GPT fallback.
- Loosening scenario expectations, safety rules, evidence requirements, deadlines, or the 54/54 gate to make Gemini pass.
- Changing unrelated commerce behavior, Flutter UI, Messenger delivery, or deployment architecture.
- Removing GPT-4.1 credentials or rollback support after the default switch.

## Frontier

Open, unblocked, unassigned child tickets are the frontier. In this local Markdown tracker, `Blocked by` names the tickets that must close first.

- [Strengthen The Shared Planner Contract And Semantic Replan](./issues/04-strengthen-shared-planner-contract-and-semantic-replan.md)
- [Add Gemini 3.1 To The Arena](./issues/05-add-gemini-3-1-to-the-arena.md)
