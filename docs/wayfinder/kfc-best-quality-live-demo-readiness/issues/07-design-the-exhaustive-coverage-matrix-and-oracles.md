Status: resolved
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 02-define-the-three-minute-short-turn-golden-journey.md, 04-design-menu-and-modifier-aware-recommendation-contract.md, 05-design-fail-closed-verified-commerce-facts.md, 06-design-the-environment-scoped-commerce-lifecycle-provider.md
Assignee: Codex

## Question

What exact deterministic, live-AI, GenUI, Messenger, state, event, negative, timeout, and deployment test matrix constitutes 100% coverage of the named demo behavior contract? Map every behavior class and failure invariant to inputs, preconditions, required and forbidden tools, state transitions, text claims, GenUI data/actions, Messenger output, lifecycle-provider state, persistence evidence, latency, and artifact oracles. Require exhaustive deterministic catalog/modifier validation, representative live catalog cases, short natural paraphrase families, cart-before/cart-after assertions, and explicit no-default/no-contradiction checks without equating scenario coverage with arbitrary-language or line coverage.

## Resolution

Use a versioned Scenario Coverage Ledger as the closed-world acceptance inventory. Every active behavior and failure invariant requires a deterministic hard oracle; stochastic or deployed behaviors additionally require their declared representative live proof. Hard machine oracles always outrank AI judging and screenshots.

Exhaust every product and modifier tree in every versioned baseline fixture, plus all products and trees in the current live/deployed observation, as well as lifecycle transition/event pairs, fact bindings, environment isolation, consent, idempotency, concurrency, fault, StateGraph, checkpoint, persistence, and surface-projection contracts deterministically. Run only six currently verified representative catalog cases through live AI. Keep scenarios 01-08 as one consolidated 44-turn planner/GenUI replay, scenario 09 as planner-only/no-payment-widget coverage, and small-talk, direct-catalog streaming, and Worker interruption as separate boundaries. Embed three short forms for each of eight paraphrase families inside the 44 turns rather than replaying them separately.

Counted deterministic, live, and deployed passes have zero retries, skips, quarantine, manual repairs, fallbacks, or contradictions. Live scenario cases use `it.concurrent.each` with `maxConcurrency=2`, while deterministic tests retain normal parallelism. The complete matrix, per-case oracle record, manifest contract, confirmed checkout gaps, implementation order, and sources are in [Exhaustive Coverage Matrix And Oracles](../assets/exhaustive-coverage-matrix-and-oracles.md).
