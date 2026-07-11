Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by: 01-audit-pitch-evidence-and-demo-readiness.md
Assignee: Codex (current thread)

## Question

Which architecture and agent-behavior questions are technically informed judges most likely to ask, and what verified 20-second answer should Thang give for each? Design five numbered appendix slides covering runtime request flow, planning/tools/policy/state ownership, idempotency/queues/interruption/recovery/human control, evaluation/proof methodology, and OMS/POS adapter contracts. Link every answer to current code or proof and record concise boundaries for claims that are not yet demonstrated.

## Resolution

[Technical Appendix And Q&A Answer Bank](../assets/technical-appendix-and-qa-answer-bank.md) defines five numbered appendix slides and twelve exact 20-second answers. The appendix establishes a single-agent governed commerce loop; separates planner proposals from typed tools, safety gates, and persisted state authority; explains generation-owned run coordination, safe supersession, human takeover, and recovery; separates four evaluation/proof layers; and limits OMS/POS language to simulated orchestration through replaceable adapter contracts.

The current checkout was re-verified with 10 focused test files and 66/66 deterministic tests passing. The answer bank records the shared dirty-worktree boundary and does not turn this into live-model, deployed-runtime, vendor-sandbox, production-order, or business-impact proof.
