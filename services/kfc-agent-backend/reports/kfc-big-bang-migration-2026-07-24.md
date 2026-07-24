# KFC big-bang LangChain migration report

Date: 2026-07-24  
Target branch: `codex/kfc-kiss-model-agnostic`  
Draft PR: [#69](https://github.com/ThangVuNguyenViet/hackathon/pull/69)

## Executive summary

The branch now has one provider-neutral LangChain `createAgent` semantic loop,
with KFC and PVCFC supplied as trusted business packs. The direct OpenAI SDK
work remains the behavioral donor, not a second production runtime. The useful
parts of that work—complete menu retrieval, exact item aliases, typed tool
errors, reversible cart batching, verified business state, and natural
model-selected tool use—were retained behind provider-neutral contracts.

An explicit `StateGraph` was not reintroduced. The current ordinary chatbot
turn does not need durable graph-step recovery, human-in-the-loop resumption,
or a deterministic multi-stage workflow. ADR-0002 therefore keeps
checkpointing, interrupts, and an outer graph off until a separately reviewed
failure demonstrates that the simpler agent loop plus application-owned state
cannot solve the problem.

The live qualification preserved 54 run directories: 43 initial completed
scenario runs, one failed scenario run, six failed preflights, one abandoned
ready run, and three focused OpenAI repair-loop runs. Four independent model-blind
evaluations scored the initial packets from 67.5% to 77.0%. The highest-severity
cross-model finding was customer-authority leakage around cart mutation. A
first text-echo guard was rejected; the retained design requires a
server-verified typed cart action, hides `updateCart` from ordinary text turns,
and keeps a fail-closed executor guard. The fresh v4 held-out scenario was
independently approved at **28/28**.

This is not yet a claim that every initial model/scenario behavior is
production-qualified. The initial evaluations still identify model-specific
grounding, retry, authentication-fixture, payment-fixture, and allergen-safety
problems. The report separates those findings from infrastructure failures and
retains every transcript/tool trace for later live-suite design.

## Decisions

### One semantic loop

- `createAgent` owns model/tool iteration through a configured LangChain
  `BaseChatModel`.
- Typed tools, business truth, authorization, confirmation, idempotency,
  persistence, verified collections, and presentation remain application-owned.
- There is no direct OpenAI SDK orchestration and no parallel StateGraph
  semantic runtime.
- Provider integrations use maintained LangChain adapters rather than a custom
  transport layer.

### StateGraph is deferred, not forbidden forever

ADR-0002 at
`/Users/vietthangvunguyen/Workspace/hackathon/docs/adr/0002-agent-loop-first-selective-langgraph.md`
requires a named production or live-corpus failure, a focused integration test,
cost/failure-surface accounting, and no duplicate source of truth before adding
LangGraph features. An outer `StateGraph` additionally needs at least three
deterministic stages or branches and a real pause/recovery boundary that cannot
be expressed with agent middleware plus application code. Every future proposal
must re-audit whether a graph is actually needed; “LangChain uses LangGraph
internally” is not itself a reason to add an application graph.

### No deterministic word or phrase routing

The root `AGENTS.md` now prohibits keyword, phrase, and regular-expression
routing for semantic behavior. Intent interpretation and tool choice stay with
the configured model. Exact normalized retrieval matching, identifiers,
aliases, schema validation, and typed control-state checks remain valid because
they verify data rather than classify customer meaning from a fixed word list.

### Provider and model profiles

| Candidate | Provider | Maintained adapter / transport | Qualification role |
|---|---|---|---|
| `openai-gpt-4.1-mini` | OpenAI | `ChatOpenAI`, Responses API | Control |
| `deepseek-v4-flash` | OpenCode | `ChatOpenAI`, OpenAI-compatible chat | Candidate |
| `qwen3.7-max` | OpenCode | `ChatAnthropic`, Anthropic Messages | Candidate |
| `minimax-m3` | OpenCode | `ChatAnthropic`, Anthropic Messages | Candidate |
| `google-gemini-3.1-flash-lite` | Google | `ChatGoogle`, Google GenAI | Configured, not run |

Google was excluded from this live matrix because the available Gemini key did
not have sufficient quota. That is an external qualification gap, not a model
failure.

Two portability defects were found by live preflight:

1. Qwen and MiniMax capability limits (65,536 and 131,072 tokens) were
   incorrectly used as per-request output limits. Commit `b57d4b71` retains the
   capability metadata but caps ordinary agent responses at 4,096 tokens.
2. The Anthropic SDK appends `/v1/messages`. Supplying an OpenCode base ending
   in `/v1` therefore produced `/v1/v1/messages`. Commit `60449452` uses
   `https://opencode.ai/zen/go` for Anthropic Messages, while DeepSeek's
   OpenAI-compatible adapter keeps `https://opencode.ai/zen/go/v1`.

Candidate identity is pinned per session and ordinary invocation plus typed
tool calling must preflight successfully before a live scenario can proceed.

### Business-agnostic trusted packs

The generic kernel binds a trusted, versioned pack rather than importing KFC
semantics. The KFC pack owns ordering instructions, tools, verified state, and
presentation. The PVCFC customer-service pack uses the same kernel contract but
has public-knowledge tools and no private dealer, customer, order, complaint,
or visit authority.

PVCFC's `pvcfc-public-web-2026-07-21` corpus is retained as production-like
public data:

- 24 raw artifacts;
- 1,243,751 bytes;
- manifest SHA-256
  `0311e71df1ce34e963723849a76026621f15013d313c05286b5c7ee8c657a28e`;
- custody kind `untracked_donor_worktree`, with no donor commit recorded;
- deterministic manifest/hash checker, derived public index, and `.ready.json`
  publication marker.

The verifier rejects installing, unpublished, or hash-mismatched data. PVCFC
answers default to Vietnamese, may use partial English coverage when available,
and keep claims dated and cited to captured public sources. Session and state
keys include trusted pack identity/version; pluggable pack keys use injective
canonical JSON framing, and legacy KFC IDs cannot enter the reserved `pack:`
namespace.

### Context and durable state

The context shape is:

1. a versioned rolling summary of older complete exchanges;
2. the newest complete user/assistant exchanges that fit a
   provider-neutral token budget;
3. a separately typed current business-state projection.

Each transcript turn has a monotonic per-session ordinal. The summary has a
`through_ordinal` watermark and compare-and-swap revision, so concurrent
publication cannot silently skip or reorder history. Incomplete exchanges are
not summarized. If the newest complete exchange is too large, the assembler
reports that condition instead of splitting it mid-exchange.

The durable business state is **not compacted into prose**. A summary can help
the model remember conversation, but it never authorizes a cart, order,
payment, inventory, or customer-state claim. The complete transcript remains
the canonical record, while the typed projection remains the current business
authority.

This matches LangChain's guidance to trim or summarize older message history
while retaining recent context ([short-term memory](https://docs.langchain.com/oss/python/concepts/memory),
[adding memory](https://docs.langchain.com/oss/python/langgraph/add-memory),
[long-term memory](https://docs.langchain.com/oss/python/langchain/long-term-memory)).
LangGraph persistence is useful for checkpointed execution, fault recovery,
time travel, and pause/resume workflows
([persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)),
but it is not required as the primary conversation store for this ordinary
agent loop.

OpenAI conversation state and compaction remain provider-specific transport
options, not durable product authority
([conversation state](https://developers.openai.com/api/docs/guides/conversation-state),
[compaction](https://developers.openai.com/api/docs/guides/compaction)).
Opaque provider compaction cannot replace the app-owned transcript, summary
watermark, or typed business state in a model-agnostic system.

### D1, transient storage, and LangSmith

| Boundary | Retained responsibility | Explicitly excluded |
|---|---|---|
| D1 | canonical conversation turns; rolling summaries; trusted pack-state projections; session/customer/channel binding; model/profile pin; catalog pins; dashboard product read models; idempotency and run ownership; delivery recovery; irreversible-operation receipts and leases | duplicate raw model payloads, tool debug streams, evaluator payloads, and generic trace/event logs |
| Queue / request memory / local qualification artifacts | bounded normalized Messenger ingress envelope; request-scoped expanded objects and tool traces; synthetic JSONL/transcripts used for this qualification | long-term customer/business authority; raw unverified webhook bytes; secrets |
| LangSmith | sanitized model/tool tracing, evaluation, debugging, safe correlation metadata | business recovery authority or a D1 fallback |

The Messenger queue stores only the bounded normalized envelope after signature
verification; expanded raw bytes are not queued. LangSmith fails open and D1
does not absorb trace payloads when tracing is unavailable.

There is no blanket 24-hour conversation retention. A customer may be active
for a burst and return a week later, so the transcript, summary, typed state,
and resume bindings live according to product retention policy rather than a
short inactivity TTL. Short expiries are limited to facts that are inherently
temporary—leases, verified action claims, inventory observations, proof
conversation.

## Donor and workstream audit

| Source | Adopted | Rejected / not carried forward |
|---|---|---|
| `main` / direct OpenAI Responses work (upstream reference around PR #68) | canonical tool behavior; typed error recovery; richer menu search; exact IDs and aliases; complete/capped collection semantics; delegated reversible cart batch behavior; natural model tool selection | direct SDK orchestration; provider-owned conversation as authority; permanent dual runtimes |
| `/.claude/worktrees/test-suite-inventory` | normal package scripts for direct Vitest, build/lint/typecheck cleanup, useful scenario inventory and missing scenario coverage | TypeScript/Dart wrappers that launch tests with `Process.run`; generated inventory artifacts; deterministic scenario replay and exact tool/word assertions |
| `/.worktrees/model-agnostic-kfc-agent-main` | narrative scenario problems, risks, preconditions, and useful typed business/test contracts | custom planner/router/composer topology, graph-first runtime, StateGraph/checkpointer adoption without a demonstrated resume workflow, wholesale cherry-pick |
| PVCFC crawl donor worktree / related PR work | the verified public crawl itself, provenance, hashes, derived index, publication readiness checks, public-only authority | vendor-specific kernel coupling; private-business claims; fabricated donor commit provenance |

The branch was intentionally rebuilt on the current target rather than
cherry-picking donors wholesale. This preserved useful behavior while avoiding
old topology and test assumptions.

## Implementation checkpoints

| Area | Key commits | Result |
|---|---|---|
| Scenario/test reset | `f53e8875`, `5081fc54`, `a5f7f9cf`, `0d529f49` | Retained narrative scenarios and small direct Vitest contracts; removed the replay engine and deterministic acceptance data. |
| Policy and plan | `7528731e` | Recorded the big-bang plan and repository rules. |
| Neutral kernel and KFC pack | `4d7ca291`, `c0b8f74d`, `e3408c5b`, `57b76358` | Extracted trusted pack registry/state validation around one provider-neutral kernel. |
| Model candidates | `684ffdf2`, `419acb5b`, `5d1e2001`, `be366250`, `b57d4b71`, `60449452` | Added pinned OpenAI, OpenCode, and Google profiles; hardened capability metadata, request budgets, and endpoints. |
| Menu/cart donor parity | `4a6416c9`, `27c466e5` | Retained complete ordering behavior, exact identifiers/aliases, richer search, truthful complete/capped collections, and delegated reversible cart plans. |
| Context and state | `7930111d`, `00b6e597` | Added monotonic transcript ordinals, rolling summary CAS/watermark, complete token-bounded exchanges, and atomic typed-state publication. |
| Storage boundary | `72afcfee`, `67f78700` | Removed the generic conversation event log and stale Postgres/Cloud Run parity; retained Worker+D1 product state and recovery records. |
| Observability and ingress | `8844b9b4`, `6a5cd53a`, `50feed35` | Added fail-open LangSmith callbacks/safe roots and compact signed Messenger queue claims. |
| PVCFC pack/corpus | `9797e5ee`, `8e59791d`, `8aac672b` | Added public-only PVCFC pack, immutable corpus custody/readiness checks, and collision-safe pack/session keys. |
| Live evidence harness | `20afeebf`, `aff3ee68`, `8a000b55` | Added interactive subagent evidence capture, terminal lifecycle handling, and envelope-wide redaction. |
| Authority repair | `8ad23223`, `df4ffdd3`, `fe906eea`, `3ebb14ec` | Replaced the rejected text-echo guard with trusted typed action binding, tool visibility filtering, and executor defense in depth. |
| Live environment precedence | `c0aae1ca`, `99b5a339` | Replaced shell sourcing with Node's non-overriding `.env` loader and anchored all live-run paths to the worktree module rather than caller CWD. |

## Scenario and evidence method

The 11 scenario files are narrative scripts: goals, preconditions, risks,
suggested customer turns, and intended outcomes. They no longer contain exact
assistant wording, exact tool sequences, fixed word matches, or scripted
acceptance assertions. Codex role-player subagents improvised the live
conversation, and separate model-blind Codex evaluators reviewed transcripts
plus complete tool evidence.

Each retained run directory contains an append-only JSONL trace, rendered
transcript, preflight result, manifest with hashes/correlation, and a review
packet. Failures and operator mistakes were retained rather than rewritten as
passes.

## Initial model-blind evaluation

Model identities were disclosed only after the blind packets were scored.

| Blind packet | Model mapping | Score | Percentage | Evaluation |
|---|---|---:|---:|---|
| A | Qwen3.7 Max | 209 / 308 | 67.9% | [packet A](kfc-big-bang-migration-2026-07-24-evidence/blind-evaluations/packet-a-evaluation.md) |
| B | OpenAI GPT-4.1 mini | 237 / 308 | 77.0% | [packet B](kfc-big-bang-migration-2026-07-24-evidence/blind-evaluations/packet-b-evaluation.md) |
| C | MiniMax M3 | 208 / 308 | 67.5% | [packet C](kfc-big-bang-migration-2026-07-24-evidence/blind-evaluations/packet-c-evaluation.md) |
| D | DeepSeek V4 Flash | 233 / 308 | 75.6% | [packet D](kfc-big-bang-migration-2026-07-24-evidence/blind-evaluations/packet-d-evaluation.md) |

Cross-packet strengths were consistent customer restraint around irreversible
order/payment actions, useful handoff recovery, and good performance when a
narrow authoritative policy/product result was available.

Cross-packet problems were also material:

- Qwen repeatedly emitted invalid `searchMenu` arguments and reached the
  recursion limit in s06.
- OpenAI converted an s08 feasibility question into an unauthorized 200-item
  cart mutation.
- MiniMax claimed cart success without a mutation result in s07 and invented
  payment methods in s09.
- DeepSeek gave an unsupported peanut-allergy assurance in s06 and claimed a
  fresh availability/capacity check without a new tool result in s03.
- Multiple models turned caller-bound authentication fixture failures into
  claims that the customer was logged out, or overclaimed serviceability,
  payment, response time, spice, or contact facts.

The evaluations explicitly separate model behavior from fixture/runtime
blockers. Logged-in scenario preconditions were not available to protected
tools in several runs; payment fixtures were empty or inaccessible; address
resolution and peak-load state were not always represented. Those are gaps in
the scenario/runtime contract, not proof that a customer lacks an order,
address, points, payment, or delivery option.

## Bounded repair loop

The Loop Library feedback cycle was kept finite: observe the blind evidence,
choose the highest-value failure, make one bounded change, verify deterministic
contracts, run a fresh held-out scenario, and stop on independent approval or
stagnation.

| Step | Commit / run | Decision |
|---|---|---|
| Text-echo authorization | `8ad23223` | **Rejected as insufficient.** Matching a model-supplied `customerRequest` string to the current text does not create trustworthy structural authority and still exposes mutation on ordinary text turns. |
| Structural authorization gate | `df4ffdd3` | Retained. Only a server-verified typed GenUI cart action can supply cart changes; the model cannot expand or reinterpret the action payload. |
| Tool visibility | `fe906eea` | Retained. `updateCart` is not exposed to the model when the current turn lacks a trusted cart action, preventing repeated forbidden calls rather than relying only on post-call rejection. |
| Executor regression guard | `3ebb14ec` | Retained. Even if tool visibility regresses or a call reaches the executor directly, an unbound/invalid trusted action still fails closed. |
| Focused v2 | `20260724-v2-openai-gpt-4.1-mini-s08-a1` | Behavior looked safe, but the role-player followed a scripted turn sequence too closely. It is preserved as evidence but rejected as an independent acceptance gate. |
| Focused v3 | `20260724-v3-openai-gpt-4.1-mini-s08-a1` | **NOT APPROVED, 16/28.** Nine rejected/invalid cart attempts, unsupported “no charge” claims, and duplicate handoff. The executor prevented mutation, but model/tool behavior was not acceptable. |
| Focused v4 | `20260724-v4-openai-gpt-4.1-mini-s08-a1` | **APPROVED, 28/28.** Read-only status/cart checks, no payment/order/inventory claim, one explicitly requested handoff, and no cart mutation tool exposed. |

The v4 result validates the bounded authority repair for the held-out s08
failure. It does not erase unrelated initial matrix findings or promote every
candidate to production.

## LangSmith and local evidence limitations

LangSmith uploads returned nonblocking HTTP 429 responses because the monthly
trace limit was exhausted (`monthly_traces of 6863 exceeded`). Local JSONL,
transcript, manifest, preflight, and review artifacts therefore remain the
complete evidence source for this qualification.

Some npm-launched runs reloaded repository environment configuration, so a
shell prefix such as `LANGSMITH_API_KEY= LANGSMITH_TRACING=false
LANGCHAIN_TRACING_V2=false` did not consistently suppress an explicitly
constructed tracer. This was recorded in the run notes and did not convert the
429 into a scenario failure. The application tracer remained fail-open and no
trace/debug payload was copied into D1.

Commits `c0aae1ca` and `99b5a339` fixed that harness defect after the matrix:
the package script no longer sources `.env` in a subshell, explicit environment
values (including an intentionally empty LangSmith key) win, and the root
configuration/evidence paths are derived from `import.meta.url` so direct
invocation cannot accidentally read a neighboring checkout.

## Operator and lifecycle anomalies

- MiniMax s01 attempt 1 used a malformed scenario path and failed before an
  artifact directory existed. It is not one of the 54 indexed directories.
- The first MiniMax s05 invocation used the same path typo and failed before
  artifact creation; the corrected invocation produced the indexed
  `20260724-v1-minimax-m3-s05-a1` directory.
- `20260724-v1-openai-gpt-4.1-mini-s01-a1` was abandoned after preflight by a
  transient PTY launch/hard kill. Its manifest remained `ready`, with zero
  turns; it is retained and not counted as a completed scenario.
- Qwen s01 attempts 1–3 and MiniMax s01 attempts 2–4 preserve the provider
  preflight failures that led to the request-token and endpoint fixes.
- Qwen s06 is retained with status `failed`; its recursion-limit failure is a
  model/tool-policy result, not hidden as an infrastructure pass.

## Complete evidence index

The following table indexes all **54** retained run directories. `T` is the
rendered transcript, `J` the full JSONL trace/tool evidence, `M` the manifest,
`P` the preflight, `R` the Codex review packet, and `E` a focused independent
evaluation when present.

| Run | Model | Scenario | Attempt | Status | Files |
|---|---|---:|---:|---|---|
| `20260724-v1-deepseek-v4-flash-s01-a1` | DeepSeek | 01 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s01-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s01-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s01-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s01-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s01-a1/codex-review-packet.md) |
| `20260724-v1-deepseek-v4-flash-s02-a1` | DeepSeek | 02 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s02-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s02-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s02-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s02-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s02-a1/codex-review-packet.md) |
| `20260724-v1-deepseek-v4-flash-s03-a1` | DeepSeek | 03 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s03-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s03-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s03-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s03-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s03-a1/codex-review-packet.md) |
| `20260724-v1-deepseek-v4-flash-s04-a1` | DeepSeek | 04 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s04-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s04-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s04-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s04-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s04-a1/codex-review-packet.md) |
| `20260724-v1-deepseek-v4-flash-s05-a1` | DeepSeek | 05 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s05-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s05-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s05-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s05-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s05-a1/codex-review-packet.md) |
| `20260724-v1-deepseek-v4-flash-s06-a1` | DeepSeek | 06 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s06-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s06-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s06-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s06-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s06-a1/codex-review-packet.md) |
| `20260724-v1-deepseek-v4-flash-s07-a1` | DeepSeek | 07 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s07-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s07-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s07-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s07-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s07-a1/codex-review-packet.md) |
| `20260724-v1-deepseek-v4-flash-s08-a1` | DeepSeek | 08 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s08-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s08-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s08-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s08-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s08-a1/codex-review-packet.md) |
| `20260724-v1-deepseek-v4-flash-s09-a1` | DeepSeek | 09 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s09-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s09-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s09-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s09-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s09-a1/codex-review-packet.md) |
| `20260724-v1-deepseek-v4-flash-s10-a1` | DeepSeek | 10 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s10-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s10-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s10-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s10-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s10-a1/codex-review-packet.md) |
| `20260724-v1-deepseek-v4-flash-s11-a1` | DeepSeek | 11 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s11-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s11-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s11-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s11-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-deepseek-v4-flash-s11-a1/codex-review-packet.md) |
| `20260724-v1-minimax-m3-s01-a2` | MiniMax | 01 | 2 | `preflight_failed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a2/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a2/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a2/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a2/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a2/codex-review-packet.md) |
| `20260724-v1-minimax-m3-s01-a3` | MiniMax | 01 | 3 | `preflight_failed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a3/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a3/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a3/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a3/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a3/codex-review-packet.md) |
| `20260724-v1-minimax-m3-s01-a4` | MiniMax | 01 | 4 | `preflight_failed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a4/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a4/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a4/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a4/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a4/codex-review-packet.md) |
| `20260724-v1-minimax-m3-s01-a5` | MiniMax | 01 | 5 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a5/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a5/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a5/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a5/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s01-a5/codex-review-packet.md) |
| `20260724-v1-minimax-m3-s02-a1` | MiniMax | 02 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s02-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s02-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s02-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s02-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s02-a1/codex-review-packet.md) |
| `20260724-v1-minimax-m3-s03-a1` | MiniMax | 03 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s03-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s03-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s03-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s03-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s03-a1/codex-review-packet.md) |
| `20260724-v1-minimax-m3-s04-a1` | MiniMax | 04 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s04-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s04-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s04-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s04-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s04-a1/codex-review-packet.md) |
| `20260724-v1-minimax-m3-s05-a1` | MiniMax | 05 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s05-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s05-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s05-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s05-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s05-a1/codex-review-packet.md) |
| `20260724-v1-minimax-m3-s06-a1` | MiniMax | 06 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s06-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s06-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s06-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s06-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s06-a1/codex-review-packet.md) |
| `20260724-v1-minimax-m3-s07-a1` | MiniMax | 07 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s07-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s07-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s07-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s07-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s07-a1/codex-review-packet.md) |
| `20260724-v1-minimax-m3-s08-a1` | MiniMax | 08 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s08-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s08-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s08-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s08-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s08-a1/codex-review-packet.md) |
| `20260724-v1-minimax-m3-s09-a1` | MiniMax | 09 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s09-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s09-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s09-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s09-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s09-a1/codex-review-packet.md) |
| `20260724-v1-minimax-m3-s10-a1` | MiniMax | 10 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s10-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s10-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s10-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s10-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s10-a1/codex-review-packet.md) |
| `20260724-v1-minimax-m3-s11-a1` | MiniMax | 11 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s11-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s11-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s11-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s11-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-minimax-m3-s11-a1/codex-review-packet.md) |
| `20260724-v1-openai-gpt-4.1-mini-s01-a1` | OpenAI | 01 | 1 | `ready` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s01-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s01-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s01-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s01-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s01-a1/codex-review-packet.md) |
| `20260724-v1-openai-gpt-4.1-mini-s01-a2` | OpenAI | 01 | 2 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s01-a2/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s01-a2/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s01-a2/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s01-a2/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s01-a2/codex-review-packet.md) |
| `20260724-v1-openai-gpt-4.1-mini-s02-a1` | OpenAI | 02 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s02-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s02-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s02-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s02-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s02-a1/codex-review-packet.md) |
| `20260724-v1-openai-gpt-4.1-mini-s03-a1` | OpenAI | 03 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s03-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s03-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s03-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s03-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s03-a1/codex-review-packet.md) |
| `20260724-v1-openai-gpt-4.1-mini-s04-a1` | OpenAI | 04 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s04-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s04-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s04-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s04-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s04-a1/codex-review-packet.md) |
| `20260724-v1-openai-gpt-4.1-mini-s05-a1` | OpenAI | 05 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s05-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s05-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s05-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s05-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s05-a1/codex-review-packet.md) |
| `20260724-v1-openai-gpt-4.1-mini-s06-a1` | OpenAI | 06 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s06-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s06-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s06-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s06-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s06-a1/codex-review-packet.md) |
| `20260724-v1-openai-gpt-4.1-mini-s07-a1` | OpenAI | 07 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s07-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s07-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s07-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s07-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s07-a1/codex-review-packet.md) |
| `20260724-v1-openai-gpt-4.1-mini-s08-a1` | OpenAI | 08 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s08-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s08-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s08-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s08-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s08-a1/codex-review-packet.md) |
| `20260724-v1-openai-gpt-4.1-mini-s09-a1` | OpenAI | 09 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s09-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s09-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s09-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s09-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s09-a1/codex-review-packet.md) |
| `20260724-v1-openai-gpt-4.1-mini-s10-a1` | OpenAI | 10 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s10-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s10-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s10-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s10-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s10-a1/codex-review-packet.md) |
| `20260724-v1-openai-gpt-4.1-mini-s11-a1` | OpenAI | 11 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s11-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s11-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s11-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s11-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-openai-gpt-4.1-mini-s11-a1/codex-review-packet.md) |
| `20260724-v1-qwen3.7-max-s01-a1` | Qwen | 01 | 1 | `preflight_failed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a1/codex-review-packet.md) |
| `20260724-v1-qwen3.7-max-s01-a2` | Qwen | 01 | 2 | `preflight_failed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a2/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a2/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a2/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a2/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a2/codex-review-packet.md) |
| `20260724-v1-qwen3.7-max-s01-a3` | Qwen | 01 | 3 | `preflight_failed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a3/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a3/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a3/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a3/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a3/codex-review-packet.md) |
| `20260724-v1-qwen3.7-max-s01-a4` | Qwen | 01 | 4 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a4/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a4/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a4/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a4/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s01-a4/codex-review-packet.md) |
| `20260724-v1-qwen3.7-max-s02-a1` | Qwen | 02 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s02-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s02-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s02-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s02-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s02-a1/codex-review-packet.md) |
| `20260724-v1-qwen3.7-max-s03-a1` | Qwen | 03 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s03-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s03-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s03-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s03-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s03-a1/codex-review-packet.md) |
| `20260724-v1-qwen3.7-max-s04-a1` | Qwen | 04 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s04-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s04-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s04-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s04-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s04-a1/codex-review-packet.md) |
| `20260724-v1-qwen3.7-max-s05-a1` | Qwen | 05 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s05-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s05-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s05-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s05-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s05-a1/codex-review-packet.md) |
| `20260724-v1-qwen3.7-max-s06-a1` | Qwen | 06 | 1 | `failed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s06-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s06-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s06-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s06-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s06-a1/codex-review-packet.md) |
| `20260724-v1-qwen3.7-max-s07-a1` | Qwen | 07 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s07-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s07-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s07-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s07-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s07-a1/codex-review-packet.md) |
| `20260724-v1-qwen3.7-max-s08-a1` | Qwen | 08 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s08-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s08-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s08-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s08-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s08-a1/codex-review-packet.md) |
| `20260724-v1-qwen3.7-max-s09-a1` | Qwen | 09 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s09-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s09-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s09-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s09-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s09-a1/codex-review-packet.md) |
| `20260724-v1-qwen3.7-max-s10-a1` | Qwen | 10 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s10-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s10-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s10-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s10-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s10-a1/codex-review-packet.md) |
| `20260724-v1-qwen3.7-max-s11-a1` | Qwen | 11 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s11-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s11-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s11-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s11-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v1-qwen3.7-max-s11-a1/codex-review-packet.md) |
| `20260724-v2-openai-gpt-4.1-mini-s08-a1` | OpenAI | 08 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v2-openai-gpt-4.1-mini-s08-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v2-openai-gpt-4.1-mini-s08-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v2-openai-gpt-4.1-mini-s08-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v2-openai-gpt-4.1-mini-s08-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v2-openai-gpt-4.1-mini-s08-a1/codex-review-packet.md) |
| `20260724-v3-openai-gpt-4.1-mini-s08-a1` | OpenAI | 08 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v3-openai-gpt-4.1-mini-s08-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v3-openai-gpt-4.1-mini-s08-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v3-openai-gpt-4.1-mini-s08-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v3-openai-gpt-4.1-mini-s08-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v3-openai-gpt-4.1-mini-s08-a1/codex-review-packet.md) [E](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v3-openai-gpt-4.1-mini-s08-a1/codex-evaluation.md) |
| `20260724-v4-openai-gpt-4.1-mini-s08-a1` | OpenAI | 08 | 1 | `completed` | [T](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v4-openai-gpt-4.1-mini-s08-a1/transcript.md) [J](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v4-openai-gpt-4.1-mini-s08-a1/trace.jsonl) [M](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v4-openai-gpt-4.1-mini-s08-a1/manifest.json) [P](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v4-openai-gpt-4.1-mini-s08-a1/preflight.json) [R](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v4-openai-gpt-4.1-mini-s08-a1/codex-review-packet.md) [E](kfc-big-bang-migration-2026-07-24-evidence/live-runs/20260724-v4-openai-gpt-4.1-mini-s08-a1/codex-evaluation.md) |

## Final verification gates

| Gate | Result |
|---|---|
| Repository formatting | **PASS** — `npm run format:check` |
| ESLint | **PASS** — `npm run lint`, zero warnings |
| TypeScript typecheck | **PASS** — `npm run typecheck` |
| Production build | **PASS** — `npm run build` |
| Direct Vitest suite | **PASS** — 39 files, 159 tests |
| Fresh local D1 migrations | **PASS** — all 20 migrations through `0022_storage_boundary_cleanup.sql` on a new temporary local store |
| Cloudflare Worker dry-run | **PASS** — `wrangler deploy --dry-run`, 11,398.20 KiB upload / 1,243.25 KiB gzip |
| Final capability preflights | **PASS for the four qualified candidates** — ordinary invocation and typed-tool preflight succeeded before accepted live runs; Google remained excluded for quota |
| Independent whole-branch review | **PENDING** |

## Pull request and handoff state

At report time, [PR #69](https://github.com/ThangVuNguyenViet/hackathon/pull/69)
is open and draft, with head `codex/kfc-kiss-model-agnostic` and base
`codex/test-suite-inventory`. Retargeting to `main` is therefore **pending**.
No merge or deployment is authorized by this workstream.

The next handoff is mechanical:

1. record exact final-gate outputs above;
2. resolve any Important/Critical whole-branch review finding;
3. commit the report/evidence with the coherent final code state;
4. push the target branch and retarget/update draft PR #69 to `main`;
5. keep the PR draft until the remaining initial matrix defects and fixture
   gaps are consciously accepted or assigned.
