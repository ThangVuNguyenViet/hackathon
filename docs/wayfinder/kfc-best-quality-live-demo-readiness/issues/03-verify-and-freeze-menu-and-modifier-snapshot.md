Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by:
Assignee: Codex

## Question

What menu-provider contract, observation metadata, combo composition, modifier groups/options, prices, and price deltas can safely back the demo while the upstream menu changes? Refresh and verify the API response, reconcile one captured observation with generated fixtures and the current ordering model, enumerate its item-to-modifier compatibility relationships, identify a golden-journey candidate, and define runtime revalidation plus deterministic baseline-fixture drift checks. Do not treat an old capture as current runtime truth or silently repair uncertain data.

## Resolution

At runtime, fetch the configured menu API and create a versioned Catalog Observation identified by Commerce Environment, provider version or validators, canonical hash, retrieval time, and expiry. Pin that observation within a recommendation, cart, or proof run. Before cart mutation and checkout, or whenever the provider signals a version change, revalidate product existence, modifier compatibility, price, and availability; present any change and require renewed selection or confirmation.

Retain every crawled observation as a separate Catalog Baseline Fixture. The July 7 raw crawl and its generated fixtures contain 120 items and 58 modifier trees, including `20751` and `20752`; `kfcvn-generic-menu@2026-07-10T14:45:08Z+3b163094` contains 118 items and 56 modifier trees without them. Both are valid historical observations for deterministic regression. Do not delete the older records, and do not union observations into a synthetic catalog.

In the July 10 capture, item `20702` supports the golden spicy-chicken and two-drink upsize path, with two independent +3,000 VND choices. It is eligible for a live proof only if the run's current preflight verifies the same required path and economics. The presence/absence of `20751`/`20752` and the `41160` 7,000-to-5,000 VND change are cross-observation drift cases, not current-menu claims.

Any Catalog Observation proves only the menu fields supplied under its own version and freshness binding. Store stock, address eligibility, promotion applicability, final cart acceptance, and OMS/POS availability remain unknown until independently verified and must fail closed.

Research, the complete compatibility index, source hashes, reconciliation delta, and drift contract: [Menu And Modifier Snapshot Research](../assets/menu-and-modifier-snapshot-research.md).
