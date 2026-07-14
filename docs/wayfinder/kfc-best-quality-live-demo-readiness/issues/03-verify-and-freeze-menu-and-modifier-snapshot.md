Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by:
Assignee: Codex

## Question

What current official KFC Vietnam menu, combo composition, modifier groups/options, availability, prices, and price deltas can safely back the demo? Refresh and verify the public-source evidence, reconcile it with generated fixtures and the current ordering model, enumerate every item-to-modifier compatibility relationship, identify spicy-chicken and drink-size candidates suitable for the golden journey, and define a versioned frozen snapshot with provenance and drift checks. Do not treat public-page observation as a production ordering API or silently repair uncertain data.

## Resolution

Freeze `kfcvn-generic-menu@2026-07-10T14:45:08Z+3b163094`, the official 118-item payload with 56 verified modifier trees. Use item `20702` for the golden spicy-chicken and two-drink upsize path. Its two independent medium-to-large Pepsi choices are +3,000 VND each. Remove stale fixture-only `20751`/`20752` and refresh `41160` from 7,000 to 5,000 VND during implementation; do not silently patch them.

The snapshot proves generic menu compatibility and listed prices only. Store stock, address eligibility, promotion applicability, final cart acceptance, and OMS/POS availability remain unknown until independently verified and must fail closed.

Research, the complete compatibility index, source hashes, reconciliation delta, and drift contract: [Menu And Modifier Snapshot Research](../assets/menu-and-modifier-snapshot-research.md).
