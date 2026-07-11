Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by:
Assignee: Codex

## Question

What claims, screenshots, traces, scenario results, live endpoints, videos, manifests, and runtime behaviors are verifiably available for the KFC Commerce Agent pitch now? Produce a source-linked evidence inventory that distinguishes implemented behavior, live proof, deterministic proof, planned work, and unsupported claims. Measure the current three-turn demo and its recorded fallback, identify the exact checkout/runtime snapshot each artifact proves, and recommend the strongest evidence for the six-slide main story and five-slide technical appendix.

## Resolution

Resolved in [Pitch Evidence And Demo Readiness Audit](../assets/pitch-evidence-and-demo-readiness-audit.md).

The implemented and deterministic case is strong, but the current live-demo case is not ready: 87/87 selected deterministic checks passed on clean checkout `a91edd58`, while a fresh deployed three-turn probe produced no tools, GenUI, or order, and two full live-AI replays passed only 3/9 behavioral scenarios. No current recording matches a verified three-turn order flow. Customer semantic progress, text streaming, GenUI structural streaming/A2UI, production OMS/POS compatibility, and measured business impact remain unavailable or unsupported and must not be claimed.
