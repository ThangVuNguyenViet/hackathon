# PVCFC Multi-Business Customer Chatbot Map

Labels: wayfinder:map

## Destination

Produce an implementation-ready architecture, data, migration, and verification specification for one customer-chatbot codebase that serves KFC Vietnam and PVCFC through trusted Business routing, a Shared Assistant Runtime, replaceable Providers behind Adapters, and distinct Business Packs.

The map is complete when implementers can preserve KFC's established customer-visible outcomes through a behavior-compatible migration and add a full-service PVCFC Business Pack using provenance-bound public-site fixtures plus clearly synthetic private-capability Providers, without making further product or architecture decisions.

## Notes

Domain: multi-Business conversational assistants, trusted Business identity, isolation, shared conversation runtime, Business Packs, knowledge and capability Providers, Adapters, fixture provenance, KFC compatibility, PVCFC customer service, GenUI, evaluation, and migration.

Skills every session should consult: `wayfinder`, `grilling`, and `domain-modeling`. Research tickets should use `research`; the PVCFC site inventory must use `use-tinyfish`.

Planning only during this map. Do not implement product/runtime changes while charting or resolving decisions. Research assets and executable specifications are allowed; runtime implementation belongs to a later effort.

Dedicated charting worktree:

- Worktree: `/Users/vietthangvunguyen/Workspace/hackathon/.claude/worktrees/wayfinder-pvcfc-multivendor`
- Branch: `worktree-wayfinder-pvcfc-multivendor`
- Baseline: `8a8d6968529b972b7324a232c0a41b1b27372431`

Settled direction:

- KFC Vietnam and PVCFC are Businesses. Knowledge bases and external APIs are Providers, and provider-specific translation lives in Adapters.
- Share conversation execution, trusted identity isolation, evidence handling, Provider boundaries, safety, persistence, and orchestration. Keep knowledge, capabilities, policies, state, presentation, and executable quality contracts in Business Packs.
- Preserve KFC customer-visible outcomes and safety guarantees, but allow scenario contracts, tool names, dataset identities, and internal evidence shapes to migrate under updated executable tests.
- The first PVCFC Business Pack targets a full customer-service platform, not only public question answering.
- Use TinyFish-crawled public PVCFC content as provenance-bound knowledge fixtures. Represent customer, sales, order, complaint, and other private workflows with clearly synthetic mock capability Providers until authoritative PVCFC APIs are available.
- A trusted channel or tenant binding selects the Business before model execution. Business configuration, credentials, state, and evidence must be isolated; the model never chooses the Business.

## Decisions so far

- [Audit The KFC Compatibility Baseline And Reusable Seams](./issues/01-audit-kfc-compatibility-baseline-and-reusable-seams.md) — Preserve KFC's evidence-backed outcomes, authorization, state transitions, confirmations, GenUI/text projections, persistence, and conjunctive acceptance gate while moving identity, domain vocabulary, presentation, fixtures, provider bindings, and acceptance inventory behind a KFC Business Pack.
- [Inventory PVCFC Public Knowledge And Crawl Fixture Sources](./issues/02-inventory-pvcfc-public-knowledge-and-crawl-fixture-sources.md) — Use a versioned, immutable, SHA-256-manifested TinyFish corpus for PVCFC's public corporate, product, agronomy, pricing, contact, form, service, investor, sustainability, news, legal, and language content. Preserve source/date/version relationships and treat public forms and UI only as interface evidence, never as private API authority or real customer state.
- [Define Shared Runtime And Business Pack Contract](./issues/03-define-shared-runtime-and-business-pack-contract.md) — Use a kernel-and-pack boundary: the Shared Assistant Runtime enforces trusted execution, capability dispatch, evidence integrity, generic safety, persistence, run coordination, channel constraints, observability, and evaluation mechanics; each Business Pack owns its domain language, capabilities, opaque state/reducer, policy, knowledge rules, prompts, presentation projection, Provider requirements, and quality inventory. Deployment configuration binds Pack-declared ports to Business-scoped Adapters and credentials.
- [Design Trusted Business Routing And Isolation](./issues/04-design-trusted-business-routing-and-isolation.md) — Resolve Business identity from an authenticated ingress/deployment/channel binding before model or state access, then carry an immutable Business/environment/Pack/binding context through authorization, Provider selection, storage, checkpoints, caches, confirmations, delivery, observability, and operator access. Every logical key is Business-scoped; missing or mismatched bindings fail closed, and local shortcuts cannot exist in production.
- [Design Provider Adapter And Fixture Provenance Contracts](./issues/05-design-provider-adapter-and-fixture-provenance-contracts.md) — Business Packs define typed capability ports; environment-specific bindings select Adapters and Providers. Every result carries normalized status, dispatch/commit uncertainty, multidimensional authority, scope, freshness, binding/version identity, and immutable evidence. Public crawl, synthetic scenario, sandbox runtime, baseline test, and discovery sources remain distinct, and failed real Providers never fall back to fabricated success.
- [Define PVCFC Business Pack Capabilities And Workflows](./issues/06-define-pvcfc-business-pack-capabilities-and-workflows.md) — Provide source-backed public knowledge for corporate, product, agronomy, price, distribution, forms, documents, sustainability, news, and legal needs; public handoffs prepare but do not submit. Demonstrate customer, sales inquiry, order service, complaint, and factory-visit workflows only through visibly synthetic, scenario-scoped Providers with consent, exact confirmation, revisions, uncertainty handling, and fail-closed routing to official channels for real action.
- [Design Business Specific Presentation And Localization](./issues/07-design-business-specific-presentation-and-localization.md) — The [presentation contract](./assets/business-specific-presentation-and-localization-contract.md) assigns canonical text, branding, localization, component semantics, actions, citations, and media policy to Pack-scoped projection and rendering while keeping the accessible shell, channel-safe degradation, validation, and authority enforcement Business-neutral. A fixture-only [Flutter prototype](../../../apps/kfc_live_monitor_flutter/lib/features/customer_chat/presentation/business/) and [golden evidence](../../../apps/kfc_live_monitor_flutter/test/goldens/multibusiness_presentation/) prove one shared shell with a 12-kind KFC compatibility adapter and three distinct PVCFC presentation families without claiming production wiring.

## Not yet specified

- Issue 08 must define the complete executable multi-Business quality contract and oracle, including KFC baseline reconciliation and PVCFC/isolation/presentation gates.
- [Issue 09](./issues/09-assemble-implementation-ready-multibusiness-specification.md) must assemble the final implementation-ready specification for production module extraction, runtime/backend migration, deployment rollout, rollback, and removal of temporary compatibility bridges. It remains blocked by issue 08.

## Out of scope

- Implementing or deploying the runtime changes during this planning map.
- Claiming integration with authoritative PVCFC customer, sales, order, complaint, identity, or other private systems before their real contracts and access are supplied.
- Treating synthetic private-capability fixtures as real PVCFC records or crawled public content as evidence of private workflows.
- Requiring exact preservation of KFC's internal tool names, scenario schemas, dataset identities, or evidence representation when customer-visible outcomes and safety guarantees remain behavior-compatible.
- Designing a universal commerce model that forces PVCFC into KFC catalog/cart/order semantics.
- Letting model output, user input, or public-site content select or override the trusted Business identity.

## Frontier

Open, unblocked, unassigned child tickets are the frontier. In this local Markdown tracker, `Blocked by` names the tickets that must close first.

- [Design Multi-Business Quality Contract And KFC Migration](./issues/08-design-multibusiness-quality-contract-and-kfc-migration.md)

Issues 01–07 are resolved. Issue 08 is therefore the sole open unblocked ticket; [issue 09](./issues/09-assemble-implementation-ready-multibusiness-specification.md) remains blocked by issue 08.
