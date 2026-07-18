# KFC Cost-Aware Live Quality Gates Map

Labels: wayfinder:map

## Destination

Produce a decision-ready implementation and rollout specification that materially reduces routine live-AI verification cost without reducing the KFC bot behavior contract or allowing an unqualified behavior-affecting release into production.

The map is complete when the team can implement one exact-SHA, cost-observable verification policy with conservative change classification, a compact deployed canary, full dual-model qualification where required, fresh nightly drift coverage, reusable evidence, and explicit failure and emergency rules without further product or architecture decisions.

## Notes

Domain: KFC conversational ordering verification, live-AI scenario coverage, release qualification, OpenAI and Gemini model-provider operation, LangSmith evidence, GitHub Actions, and deployed Worker/Pages acceptance.

Skills every session should consult: `wayfinder`, `grilling`, and `domain-modeling`.

Planning only during this map. Do not edit CI, runtime model selection, prompts, tools, or the concurrent Gemini migration while charting or resolving decisions.

Settled direction:

- A behavior-affecting release must pass the full live suite before production. Low-risk releases run deterministic gates plus one compact deployed real-AI canary.
- The full live suite runs once against the exact post-merge release identity; deployment reuses that result instead of repeating it.
- The compact canary covers small-talk routing, a verified catalog recommendation, one reversible cart mutation, and persisted trace/state evidence with no forbidden tools.
- Change classification uses a narrow low-risk allowlist. An unclassified or uncertain change is behavior-affecting.
- Full live coverage retains the consolidated scenario matrix plus the distinct small-talk, direct-catalog, and interruption boundaries. Only proven duplicate model calls may be removed.
- Qualification identity includes the release SHA, model IDs, prompts, tools, Scenario Coverage Ledger, fixtures, and runtime configuration.
- A qualifying deployment result may be reused for at most 24 hours. A fresh full suite still runs nightly against the deployed candidate.
- Release qualification has no automatic retries or quarantined behavior tests. Diagnostic reruns are separate and cannot replace a failed qualification.
- Cost decisions begin with measured calls, tokens, provider cost, duration, and suite/case identity. Budget alerts precede any cost-based blocking threshold.
- Superseded branch work may be cancelled and identical release fingerprints deduplicated, but active deployment qualification is never cancelled.
- Behavior-affecting emergency releases have no bypass. Infrastructure-only emergencies may use deterministic gates plus the compact canary and must run the full suite immediately afterward.
- OpenAI and Gemini must both remain active model providers after the concurrent Gemini migration. The deployed release currently reports `gpt-4.1` for commerce planning and `gpt-4.1-nano` for response composition; `gpt-4.1-mini` is the constrained small-talk router, not a planner downgrade.
- Preserve concurrent work. This map must consume the Gemini migration's resulting contract rather than editing or duplicating that implementation.

## Decisions so far

None.

## Not yet specified

- Which additional cost reductions, such as prompt caching, request batching, or narrower provider-specific matrices, are justified by the measured cost and failure baseline.
- Whether the completed Gemini migration exposes routing, fallback, shadow, or traffic-allocation seams that change the cheapest safe qualification sequence.

## Out of scope

- Reducing or weakening the approved KFC Scenario Coverage Ledger.
- Downgrading the commerce planner or accepting lower behavior quality solely to reduce test cost.
- Implementing or replacing the concurrent Gemini migration.
- Redesigning unrelated product behavior, commerce providers, customer surfaces, or demo content.
- Implementing CI/runtime changes during this Wayfinder charting session.

## Frontier

- [Measure Current Live Verification Cost And Duplication](./issues/01-measure-current-live-verification-cost-and-duplication.md)
- [Inventory Current And Migrating Model Roles](./issues/02-inventory-current-and-migrating-model-roles.md)
