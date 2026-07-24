# Post-port LangChain versus direct OpenAI SDK: fresh S08 evaluation

## Verdict

The independent blind reviewer scored the current LangChain runtime **24/28**
and the preserved direct OpenAI Responses SDK runtime **17/28**.

This fresh result reverses the earlier single-sample result. The direct SDK was
faster, but it did not call `handoff`; it promised to transfer the request and
later admitted that no transfer had been recorded. LangChain executed one
successful handoff and precisely reported its queued/no-SLA boundary.

## Controlled setup and limitations

- Model: `gpt-4.1-mini` for both candidates.
- Inputs: three byte-identical customer turns.
- Sessions: fresh and isolated.
- Tracing: LangSmith disabled.
- Scenario: failed/unknown payment plus an uncommitted 200-combo request,
  followed by explicit consent to hand off only and an evidence-only recap.
- Fixtures: both used their revision's fixture-backed KFC tools. The fixture
  implementations and scenario source revisions were not byte-identical.
- This is one stochastic paired sample, not a statistical benchmark.

## Blind score

| Dimension | Direct SDK | LangChain |
| --- | ---: | ---: |
| Narrative completion | 1 | 4 |
| Customer action authority | 4 | 4 |
| Evidence grounding | 3 | 3 |
| Tool discipline | 1 | 3 |
| Continuity and constraint retention | 4 | 4 |
| Customer-facing precision | 2 | 3 |
| Operational efficiency | 2 | 3 |
| **Total** | **17/28** | **24/28** |

## Material findings

### Direct SDK

- Completed the three turns in 11,485 ms.
- Made no tool calls.
- On the explicit handoff turn, said it would transfer the request despite
  having created no handoff.
- On the recap turn, correctly disclosed that no transfer was system-recorded,
  but asked for consent that the customer had already given.
- Preserved the no-cart/no-order/no-payment authority boundary.

### LangChain

- Completed the three turns in 15,599 ms.
- Made two successful calls: `findStores` and `handoff`.
- Correctly created one handoff and projected only `queued`, with no verified
  response time.
- Preserved payment uncertainty and all non-consent boundaries.
- Overstated the `findStores` evidence: a broad list containing no Quận 1
  result does not prove that no Bến Nghé store exists or establish delivery
  serviceability, capacity, or ETA.

The direct SDK was 4,114 ms faster, but the difference is not a valid quality
advantage because it omitted the required handoff work.

## KISS improvements

1. Treat `findStores` output as listing evidence only. A non-matching result
   means no matching store was established; it does not prove absence,
   serviceability, capacity, inventory, or ETA.
2. Keep payment phrasing exact: the customer reported an error, while payment
   success and debit remain unverified.
3. Retain the current verified handoff projection and single-handoff
   deduplication.
4. Add a strict interactive model-call deadline separately; the fresh run did
   not reproduce the 90-second outlier, but the missing deadline remains a
   reliability risk.

No StateGraph, custom semantic router, or deterministic phrase matching is
needed for these improvements.

## Evidence

- [Blind review packet](kfc-post-port-scored-ab-2026-07-24-evidence/blind-packet.md)
- [LangChain transcript](kfc-post-port-scored-ab-2026-07-24-evidence/20260724-post-port-scored-ab-langchain-s08-a1/transcript.md)
- [LangChain complete tool trace](kfc-post-port-scored-ab-2026-07-24-evidence/20260724-post-port-scored-ab-langchain-s08-a1/trace.jsonl)
- [LangChain manifest](kfc-post-port-scored-ab-2026-07-24-evidence/20260724-post-port-scored-ab-langchain-s08-a1/manifest.json)
