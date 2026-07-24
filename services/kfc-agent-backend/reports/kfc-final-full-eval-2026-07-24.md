# KFC final full live scenario evaluation — 2026-07-24

## Decision

**Do not merge PR #69 to `main` and do not deploy this branch.**

The deterministic gate passes, the 90-second regression did not recur, and the
`findStores` evidence boundary is clearer. The live release gate nevertheless
fails because the production OpenAI candidate has critical behavioral failures,
every alternative candidate also has release blockers, the authenticated
fixtures do not satisfy several scenario preconditions, and PR #69 currently
conflicts with `main`.

## Evaluated release

- Runtime commit: `8147b58e` (`Tighten store lookup evidence boundaries`)
- Current branch head: `33c85e06`
- The later commit is documentation-only; it does not change runtime, tests,
  scenario sources, or model configuration.
- LangSmith was disabled for every live run so tracing could not block or add
  latency to the agent loop.
- Scope: 11 scenarios against four candidates, for 44 selected behavioral
  sessions.
- Qwen additionally retained six failed attempt-1 preflights and six successful
  sequential attempt-2 retries.

## Change made before the gate

The `findStores` contract now says that each returned row evidences only its own
address. Empty or location-mismatched results do not prove a match or exhaustive
absence, and store candidates do not establish inventory, capacity, delivery
coverage, fee, ETA, or item serviceability. A focused donor-parity test locks
those boundaries.

This prompt/tool-description fix helped some sessions, but it was not portable
enough by itself. MiniMax S08 still inferred store absence, and DeepSeek S03
upgraded a store candidate into serviceability evidence. A typed distinction
between store candidates and verified fulfillment evidence is the next KISS
step; StateGraph is not justified by this result.

## Independent evaluation

Each reviewer read all selected `transcript.md` files and raw `trace.jsonl`
tool-call evidence. Scores use seven dimensions worth 0–4 points each.

| Candidate | Score | Average | Pass | Partial | Fail | Release decision |
|---|---:|---:|---:|---:|---:|---|
| OpenAI `gpt-4.1-mini` | 229/308 | 20.8/28 | 5 | 3 | 3 | No |
| DeepSeek v4 flash | 237/308 | 21.5/28 | 4 | 4 | 3 | No |
| MiniMax M3 | 220/308 | 20.0/28 | 4 | 3 | 4 | No |
| Qwen 3.7 max | 223/308 | 20.3/28 | 2 | 2 | 7 | No |

| Scenario | OpenAI | DeepSeek | MiniMax | Qwen |
|---|---|---|---|---|
| S01 Clear ordering | Fail 7/28 | Fail 13/28 | Fail 10/28 | Fail 16/28 |
| S02 Group recommendation | Fail 13/28 | Fail 12/28 | Fail 13/28 | Fail 12/28 |
| S03 Store/serviceability | Partial 22/28 | Fail 19/28 | Fail 12/28 | Fail 14/28 |
| S04 Post-order handling | Fail 16/28 | Partial 18/28 | Pass 28/28 | Fail 23/28 |
| S05 Complaint handoff | Pass 28/28 | Pass 26/28 | Fail 15/28 | Pass 28/28 |
| S06 Ambiguity and safety | Partial 21/28 | Partial 23/28 | Partial 21/28 | Partial 18/28 |
| S07 History and membership | Partial 19/28 | Partial 23/28 | Pass 26/28 | Fail 22/28 |
| S08 Failed payment / large order | Pass 26/28 | Partial 24/28 | Partial 21/28 | Pass 28/28 |
| S09 Payment methods | Pass 28/28 | Pass 27/28 | Pass 25/28 | Fail 17/28 |
| S10 Product comparison | Pass 25/28 | Pass 26/28 | Partial 22/28 | Fail 20/28 |
| S11 Allergy safety | Pass 24/28 | Pass 26/28 | Pass 27/28 | Partial 25/28 |

## Release blockers

1. OpenAI S01 and S02 issued unauthorized handoffs instead of completing the
   authorized cart flow. S01 then repeated the queued-handoff state after the
   customer objected.
2. OpenAI generated invalid `partySize: []` arguments. Qwen likewise serialized
   nullable fields as invalid empty strings or omitted required nullable fields
   and repeated unchanged failing calls.
3. OpenAI S04 claimed a cart draft had been prepared even though repeated
   `previewCart` results showed an empty cart.
4. The live caller identity contradicted signed-in preconditions in S04 and S07
   and degraded other authenticated flows across candidates.
5. Store lookup evidence is still over-interpreted by some models despite the
   improved description.
6. Several candidates invented or overstated price, spice, payment, delivery,
   cart, or complaint-recording facts.
7. Qwen failed 6 of 11 first concurrent preflights. Sequential retries passed,
   suggesting but not proving a concurrency/provider reliability problem.

## Latency

Latency is measured from each selected user message to the next assistant
message and includes tool-loop work.

| Candidate | Turns | Average | p50 | p95 | Maximum |
|---|---:|---:|---:|---:|---:|
| OpenAI | 47 | 8.703s | 5.994s | 21.534s | 41.640s |
| DeepSeek | 37 | 7.642s | 6.223s | 16.304s | 18.102s |
| MiniMax | 35 | 10.289s | 8.010s | 21.797s | 36.105s |
| Qwen | 28 | 12.744s | 8.192s | 29.117s | 29.941s |

No selected behavioral turn reached 90 seconds. Tool calls were generally
milliseconds; the longer turns were model/tool-loop orchestration. The evidence
does not support imposing a 20-second deadline because valid turns exceeded it.

## Complete transcripts and tool calls

Every selected session contains:

- `transcript.md`: complete customer/agent conversation
- `trace.jsonl`: raw model-visible tool calls, arguments, results, failures, and
  timings
- `manifest.json`, `preflight.json`, and `codex-review-packet.md`

Evidence and independent reviews:

- [OpenAI — all 11 sessions and review](kfc-final-full-eval-2026-07-24-evidence/openai)
- [DeepSeek — all 11 sessions and review](kfc-final-full-eval-2026-07-24-evidence/deepseek)
- [MiniMax — all 11 sessions and review](kfc-final-full-eval-2026-07-24-evidence/minimax)
- [Qwen — all sessions, failed preflights, retries, and review](kfc-final-full-eval-2026-07-24-evidence/qwen)

Artifact verification found all 44 selected completed manifests, all required
core files, and no API-key-shaped strings.

## Git and deployment gate

- PR: <https://github.com/ThangVuNguyenViet/hackathon/pull/69>
- State at evaluation: draft, `CONFLICTING`, `DIRTY`, no checks.
- `origin/main`: `71fbc6ee5b14281d5e5f8a54867eb061d9278362`
- Branch head: `33c85e061b78445afa6db2cbde714cf01b2970f2`
- The merge-tree inspection found 67 conflict markers/changed-in-both conflict
  sections across runtime, tests, scenarios, UI, and deployment files.
- The production deploy helper correctly refuses a release that is not clean
  current `origin/main`. No unsafe override was used.

## Recommended next work

1. Normalize provider-generated optional arguments before validation, including
   `partySize`, and stop repeating unchanged validation failures.
2. Reconcile the authority contract: explicit text may prepare a cart proposal,
   GenUI authorizes mutation, and handoff must require its own explicit consent.
   Confirm writes only from successful tool results and read-back state.
3. Align live authenticated fixtures with scenario preconditions.
4. Represent store candidates versus verified fulfillment facts in typed tool
   results instead of relying only on prose.
5. Re-run the affected scenarios, then the entire 44-session suite.
6. Reconcile the branch deliberately with current `main`, run deterministic and
   full live qualification again on the exact reconciled commit, then merge and
   deploy from a clean `main` only if that gate passes.

These fixes do not currently require StateGraph. Audit that need again only if a
concrete state-transition invariant cannot be expressed cleanly in the existing
agent loop and typed tool contracts.
