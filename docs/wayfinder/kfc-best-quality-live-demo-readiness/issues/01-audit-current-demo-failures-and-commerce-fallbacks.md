Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by:
Assignee: Codex

## Question

What does the current dirty checkout and latest deployed runtime actually support or fail across short-turn menu discovery, item/modifier-aware recommendation, cart mutation, fulfillment/address handling, payment, order status, delivery status, KFC GenUI, and Messenger delivery? Audit recent KFC and Messenger turns, live-AI/proof artifacts, the StateGraph nodes and routes, fixture clients, Flutter repository selection, customer-visible fallbacks, persistence, and current tests. Produce a source-linked failure and capability inventory that identifies every path capable of substituting fixture/default commerce facts, distinguishes current deployed SHA from local work, and names the gaps later contracts must resolve. Do not fix product code in this ticket.

## Answer

The deployed clean Worker is operationally ready but behaviorally unsafe; the substantial local repair tree is dirty, three commits behind the deployed release, and not deployed. Current deterministic regressions pass, while a fresh live-AI replay still fails scenario 01 at the ordinary cart-to-address/fee transition. Recent D1 evidence confirms stale journey leakage, address/store substitution, payment contradictions, accidental multi-item mutations, and one accepted KFC turn with tools but no assistant reply. The StateGraph is visible but remains mostly a wrapper over `runAgentTurnCore`, and several Flutter/backend paths can still substitute customer-facing fixture facts.

The source-linked findings, fallback classification, exact snapshot boundaries, commands/results, and downstream contract inputs are recorded in [Current Demo Failures And Commerce Fallbacks Audit](../assets/current-demo-failures-and-commerce-fallbacks-audit.md).
