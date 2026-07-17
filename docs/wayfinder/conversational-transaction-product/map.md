# Conversational Transaction Product Map

Labels: wayfinder:map

## Destination

Produce a decision-complete product, validation, architecture, commercial, and delivery specification for turning the current KFC customer-service system into a multi-tenant Conversational Transaction Engine for restaurant and retail enterprises.

The destination is reached when another team can validate the specialty, build the reusable platform, and run the 12-week KFC design-partner pilot without unresolved product, domain, integration, tenancy, reliability, proof, pricing, or sequencing decisions.

## Notes

Domain: conversational commerce transactions across AI frontends, customer identity, OMS, POS, payment, loyalty, CRM, human takeover, tenant isolation, reconciliation, evidence, and enterprise operations.

Skills every session should consult: `wayfinder`, `grilling`, and `domain-modeling`.

Planning only. This map resolves decisions and produces an implementation-ready specification; it does not implement the platform or execute the KFC pilot.

Settled direction:

- Do not claim to be a better general chatbot. The proposed specialty is the lifecycle between changing customer intent and authoritative business state.
- OpenClaw, Filum, TwoHearts, and custom agents may sit above the product. The current KFC agent remains a reference frontend, not the platform boundary.
- The initial customer is a 50-plus-location restaurant or retail enterprise with chat support and difficult OMS/POS/payment integration risk. Direct enterprise sales precede provider partnerships.
- KFC is the first design partner, not a product fork. KFC-specific behavior belongs in tenant configuration and certified connectors.
- A Tenant is the contracted enterprise isolation boundary. The initial deployment is shared multi-tenant SaaS; dedicated data planes require later contractual or compliance evidence.
- The core guarantee is one reconciled business effect per authorized Operation Key, or a clearly reported non-success disposition. Never promise distributed exactly-once execution.
- A billable Verified Action requires authoritative reconciliation and an Action Receipt. Rejected, failed, duplicated, or unresolved requests are not usage-billable.
- The first action pack covers order creation, amendment or cancellation, and payment reconciliation. Refund, loyalty, complaint, and delivery-recovery packs follow only after evidence of demand.
- Write actions require verified customer identity and server-enforced policy. Confirmation binds the exact action, customer, business-state version, amount, and expiry.
- Upstream uncertainty becomes Pending Reconciliation; it never triggers a blind mutation retry or an unsupported success response.
- Runtime correctness is instance-independent. Durable shared state owns conversations, run claims, operations, and reconciliation; prompt caching and affinity are optional cost optimizations.
- Cache read-heavy discovery data only. Consequential price, availability, eligibility, order, and payment state is revalidated against authoritative systems.
- Version one exposes HTTPS/OpenAPI action and status contracts plus signed result webhooks. A customer-hosted connector runner, SDK, workflow language, and marketplace are deferred until required.
- The operator console is limited to actions, receipts, exceptions, connector health, policies, and usage. Inbox, ticketing, CRM, and knowledge management remain integrations.
- The full platform investment is gated by target-buyer interviews, an incumbent benchmark, and one paid enterprise pilot bought for transaction assurance.
- The KFC pilot lasts 12 weeks, assumes a technical lead, two implementation engineers, part-time security/QA, and named KFC integration owners, subject to a week-one dependency-readiness gate.
- Pilot price is a fixed 420 million VND paid by milestones. The provisional production anchor is 60 million VND per month plus 4,000 VND per successfully reconciled Verified Action, finalized from pilot evidence.

## Decisions so far

- [Validate The Specialty And Competitive Claim](./issues/01-validate-specialty-and-competitive-claim.md) — Safe transactional actions are not unique; validate an agent-neutral reconciliation and portable-evidence specialty through one common benchmark and a separately purchased enterprise pilot before making superiority claims.

## Not yet specified

- Which additional restaurant or retail action pack should follow the first paid deployment.
- Whether demonstrated demand justifies a customer-hosted connector runner, dedicated tenant data plane, connector marketplace, or formal partner certification program.
- Which formal security certifications and regional deployment options become necessary after the initial enterprise production conversion.
- Whether evidence from repeated deployments supports expansion beyond restaurant and retail enterprises.

## Out of scope

- Building another omnichannel inbox, CRM, ticketing system, knowledge-base editor, or general personal-agent runtime.
- Claiming that competitors cannot provide idempotency, safe actions, reconciliation, or audit evidence without comparative proof.
- Claiming overall superiority over OpenClaw, Filum, TwoHearts, Intercom, Zendesk, or another provider.
- Implementing the platform, production connectors, or KFC pilot during this Wayfinder effort.
- Handling payment-card data directly or promising PCI certification during the pilot.
- Promising SOC 2, ISO 27001, a dedicated data plane, or a 99.9% production SLA before their dependencies and operating responsibilities are accepted.

## Frontier

Open, unassigned child tickets with no unresolved entries in `Blocked by` are the frontier.

- [Audit The Current System Against The Product Boundary](./issues/02-audit-current-system-against-product-boundary.md)
