Status: resolved
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 01-audit-current-demo-failures-and-commerce-fallbacks.md
Assignee: Codex

## Question

How will every customer-facing commerce fact fail closed across backend planning, tools, graph state, persistence, GenUI, Flutter repository selection, configured environment providers, Messenger presentation, monitoring, and proof? Define evidence sources and precedence for addresses, stores, items/modifiers, prices, cart, promotions, fulfillment, payment, orders, and delivery; missing/partial/conflicting evidence behavior; production/sandbox isolation; startup/configuration failure behavior; stale-state suppression; and tests that prohibit unbound default substitution such as the current Quận 7 address/store/payment examples. Distinguish allowed infrastructure defaults from forbidden commerce defaults.

## Decisions captured

- The frozen official snapshot may establish only versioned public facts: menu items, modifier compatibility, list prices, store directory, public payment support, and public promotion terms.
- Customer-specific or dynamic facts require a current successful response from the configured provider in the current Commerce Environment. These include accepted address, assigned store and availability, cart totals and discounts, fulfillment fee and ETA, payment link and status, order state, and delivery state.
- Customer input or an explicit UI action establishes a customer choice, not a provider outcome. Persisted state is cached evidence rather than independent authority.
- Missing, stale, malformed, partial, or conflicting evidence fails closed instead of selecting a fallback fact.
- `production` and `sandbox` are separate Commerce Environments with identical customer contracts and evidence rules. Each has isolated provider configuration, credentials, identities, state, persistence, and proof binding.
- A successful sandbox provider response is authoritative inside sandbox and is not a lower-authority `demo` fact. Customer-facing responses do not label individual facts as simulated; environment identity is recorded in deployment and proof metadata.
- Commerce facts never cross environments. Raw fixture or default values remain non-authoritative unless the configured provider for the current environment returns them with the required subject, journey, version, and freshness binding.
- Whether a provider is backed by mock data is an implementation and proof-provenance detail, not a separate commerce-fact class. The same provider response contract and fail-closed rules apply in both environments.
- Catalog evidence is bound to environment and snapshot hash; cart evidence to cart revision; fulfillment evidence to cart and accepted-address revisions; and payment, order, and delivery evidence to environment, customer, order identity, and latest provider status.
- Provider expiry is authoritative. Any binding change immediately invalidates dependent evidence rather than allowing it to remain current.
- If the current provider is unavailable, the last verified status may be shown only with its verification time. It is historical evidence, never presented as current, and cannot authorize a consequential next action until refreshed successfully.
- A customer-serving backend refuses to start when its selected Commerce Environment or required provider configuration is missing, invalid, or ambiguous. It never selects a fallback provider automatically; a later provider outage uses the stale-evidence rule above rather than changing environments or providers.
- A partial provider response preserves independently valid, properly bound fact groups. An incomplete or malformed group is absent, is not filled from defaults or cache, and blocks every action that depends on that group; unrelated verified groups may still be presented.
- Current provider evidence supersedes persisted evidence only when both share the required binding and the provider evidence has a strictly newer provider version or verification time. Otherwise the fact is conflicting and fails closed; storage order or UI recency never breaks the tie.
- Text, GenUI, Messenger, and monitoring consume Verified Commerce Projections from one shared verified-fact set. A surface may omit facts but cannot independently infer, upgrade, replace, or contradict them.

## Resolution

Use one fail-closed Verified Commerce Fact contract in both `production` and `sandbox`. Facts are authoritative when returned by the configured provider in the current isolated Commerce Environment with the required subject, journey, version/revision, and freshness bindings; whether that provider uses mock-backed data is only implementation and proof provenance, not a lower-authority data class or customer-facing label.

Public catalog facts bind to environment and frozen snapshot hash. Dynamic facts bind to the relevant cart, accepted-address, customer, order, provider-version, and expiry evidence. Binding changes invalidate dependents immediately. Current provider evidence may supersede persisted evidence only with matching bindings and a strictly newer provider version/time. Stale evidence may be shown only as last verified, never as current or as authority for a consequential action.

Missing configuration prevents startup without provider fallback. Missing, malformed, stale, or conflicting fact groups are absent and block dependent actions; independently valid groups remain usable. Unbound defaults, cross-environment evidence, UI placeholders, model claims, and storage recency never create commerce truth. Infrastructure defaults are allowed only when they cannot select, fill, or change a commerce fact.

All customer and operational surfaces consume surface-appropriate Verified Commerce Projections from the same verified set. Deterministic contract checks must reject provider fallback, environment crossover, stale-binding reuse, malformed-group promotion, unresolved conflicts, and text/GenUI/Messenger/monitor contradictions.
