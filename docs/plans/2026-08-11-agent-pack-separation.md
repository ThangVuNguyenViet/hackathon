# Agent Pack Separation Implementation Plan

## Objective

Extract a business-agnostic agent execution host while keeping KFC and PVCFC as separate agent packs. Make PVCFC public-data tools depend on a temporary provider port whose bundled-fixture adapter can later be deleted and replaced by an official API adapter without changing the tools or shared runner.

## Global constraints

- There is no universal business domain model. Shared code owns only model execution, conversation persistence, tracing, cancellation, commit fencing, and trusted pack dispatch.
- KFC owns its commerce clients, session/cart hydration, typed tools, commerce-state publication, confirmations, and GenUI.
- PVCFC owns its instructions, evidence policy, public-data provider, read tools, and any future PVCFC state or actions.
- PVCFC must never create KFC clients/carts, hydrate or publish KFC state, expose KFC tools, or use KFC GenUI.
- Pack selection is required, route-authored, and never inferred from customer prose, metadata, organization text, or session prefixes.
- The shared runner accepts official Agents SDK tools opaquely. Do not introduce a universal tool/domain framework.
- Public HTTP routes remain compatible. Transport identity is separate from business identity.
- Fixture mode is temporary. PVCFC tools depend on a provider interface without fixture terminology; provider selection is trusted startup configuration and never silently falls back.
- PVCFC collection names, counts, capture date, organization metadata, and record totals are fixture data, not hard-coded TypeScript enums/counts.
- Every approved PVCFC record, including discovery-only source inventory, is listable and exactly retrievable. Search returns bounded compact hits; detail returns one full record; listing uses deterministic revision-bound cursors.
- Preserve all unrelated workspace changes.
- Use TDD: observe each new behavioral test fail before production implementation.

## Task 1: Neutral agent-pack contracts and trusted registry

Add failing tests and implement minimal business-neutral contracts for `AgentPack`, explicit agent profile, prepared turn resources, optional pack-owned lifecycle/presentation hooks, and an immutable trusted `AgentPackRegistry`. Unknown/duplicate/missing IDs fail before inference. Use official SDK tool types opaquely. No KFC or PVCFC domain fields in shared contracts.

## Task 2: Separate shared turn execution from the KFC adapter

Add failing integration tests proving PVCFC execution creates no KFC clients/cart/session, commits no KFC verified graph state, and uses no KFC GenUI, while KFC behavior remains unchanged. Extract a neutral `AgentTurnRunner`/direct-turn shell. Wrap the existing KFC lifecycle behind `KfcAgentPack` without rewriting commerce internals. Make trusted pack selection mandatory and remove the default-to-KFC path.

## Task 3: PVCFC provider contract and data-driven bundled adapter

Add failing provider/tool contract tests, then implement a PVCFC-owned `PvcfcPublicDataProvider` with collection listing, bounded search, exact record retrieval, deterministic revision-bound cursors, and typed unavailable/invalid/stale-cursor outcomes. Move the bundled fixture implementation behind this port. Replace fixed product counts and hard-coded collection-kind enums with manifest/fixture-declared collections. Include source inventory as `discovery_only`. Prove a synthetic added product, added collection, and unknown payload field require no production TypeScript changes.

## Task 4: PVCFC pack integration and business isolation cleanup

Add failing route-to-model tests, then implement `PvcfcAgentPack` using explicit instructions, evidence policy, provider-backed tools, and conversation-only persistence. Remove PVCFC persona inference from session/prose in the OpenAI runner. Remove unreachable hard-coded PVCFC content from KFC GenUI. Separate web-chat transport identity from KFC business identity. Keep public routes stable.

## Task 5: Compatibility cleanup and acceptance verification

Remove obsolete PVCFC fixture/repository/tool paths and temporary KFC-prefixed shared aliases once all call sites use the new contracts. Keep the temporary bundled fixture artifacts and builder only behind the PVCFC provider adapter for later official-API replacement. Verify pack/provider failure semantics, exact record reachability, KFC regression behavior, build copying, typecheck, format/lint budgets, architecture checks, and focused/full relevant tests.
