# LangChain parity, conversation state, live eval, and graph decision

Date: 2026-07-27  
Target branch: `codex/kfc-kiss-model-agnostic`

## Executive decision

- Keep the customer runtime on LangChain `createAgent`. It is already backed by LangGraph and provides the high-level agent/tool loop and middleware lifecycle we need.
- Keep D1 as the durable, provider-neutral authority for conversation turns and business state. Do not also make an OpenAI-hosted conversation, a `previous_response_id` chain, or a LangGraph checkpointer authoritative for the same conversation.
- Keep compaction asynchronous and durable: a bounded recent window plus an older summary is assembled from D1, while summary refresh runs after the assistant response.
- Do not introduce a custom `StateGraph` now. Admit LangGraph Functional or Graph APIs only when an observed requirement needs durable cross-request pause/resume, explicit branching, fan-out/join, or recovery.
- Do not migrate the runtime to ActiveGraph. Borrow its causal-lineage and fork-test-diff-promote ideas for the development control plane.
- KFC's final sealed DeepSeek advisory canary passed on its first response.
- PVCFC's final sealed canary passed citation, language, partial-coverage, and private-authority safety, but remains unqualified for useful product guidance because the retained public corpus/retrieval results are poorly relevant.

## OpenAI's four conversation strategies and our equivalents

| OpenAI strategy | Closest equivalent here | Decision |
|---|---|---|
| Agents SDK Session | D1 `ConversationStore` plus the portable context assembler and deferred summarizer | Chosen. Storage remains app-owned and works across providers and mid-conversation model switches. |
| `conversationId` | No provider-neutral exact equivalent. A LangGraph checkpointer can host framework-owned execution state, but is not an OpenAI-hosted conversation clone. | Not used. Making OpenAI-hosted history authoritative would couple the session to one provider and conflict with D1 authority. |
| `previousResponseId` | `@langchain/openai` exposes `previous_response_id` for the Responses API | Supported by the adapter, intentionally not used as the durable conversation chain for a model-agnostic session. |
| Explicit message history | D1 turns assembled into LangChain messages | Chosen. This is the portable path and supports switching models during a conversation. |

OpenAI's documentation treats these as alternative history-management strategies and warns against duplicating client-managed history with server-managed state. Relevant references: [Running agents](https://openai.github.io/openai-agents-js/guides/running-agents/), [Sessions](https://openai.github.io/openai-agents-js/guides/sessions/), [LangChain agents](https://docs.langchain.com/oss/javascript/langchain/agents).

## Changes implemented

### Donor parity and reliability

- Added bounded provider-neutral model retry middleware and read-tool retry middleware.
- Disabled nested provider SDK retries so one transient failure cannot multiply into long hidden waits.
- Added one OOTB `createAgent` middleware review pass after grounded KFC tool use; no custom agent loop or `StateGraph`.
- Strengthened current-turn evidence rules, exact name preservation, output-scope behavior, modifier evidence, taste/spice uncertainty, and whole-combo suitability.
- Normalized the exact typed `"null"` sentinel at the nullable menu-tool boundary after DeepSeek emitted it; customer prose is not routed by fixed words, phrases, or regular expressions.
- Preserved the enhanced `searchMenu` behavior and clarified that a combined-category result is a candidate collection, not permission to return unrelated subtypes.

### Context and conversation state

- The latest user message is always last in assembled model context.
- Older complete exchanges may be represented by a durable summary; recent complete exchanges remain verbatim.
- Compaction is scheduled only after the assistant turn is durably committed.
- Compaction, LangSmith tracing, and other deferred work cannot block or fail a customer response.

### PVCFC business pack

- Added a narrative live scenario and enabled the live runner to select either KFC or PVCFC through the business-pack registry.
- Added complete local tool-call evidence for public-corpus searches.
- Enforced dated public citations and an explicit private-system authority boundary.
- Added concise publication formatting, partial-English-coverage disclosure, response-language continuity, and current-turn re-search instructions.
- Preserved the crawled PVCFC corpus as current production-like fixture data.

### Live evidence and provenance

- Every run records the improvised transcript, complete raw/model-facing tool calls and results, model preflight, manifest, reviewer packet, and terminal artifact hashes.
- Final runs additionally seal the exact executable source/fixture state with a runtime source SHA-256. This covers 255 files under `src`, the live runner, package manifests, generated KFC fixtures, and PVCFC business-pack fixtures.

## Live scenario ledger

Every transcript and every tool call/result is linked below. Earlier failed attempts are intentionally retained.

| Run | Outcome | Transcript | Complete tool trace | Independent review |
|---|---|---|---|---|
| KFC budget/cart `s02-a1` | Failed qualification. Retrieval recovered, but the text harness could not submit a trusted GenUI action, so the secure runtime correctly refused cart mutation. | [transcript](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-kfc-s02-a1/transcript.md) | [trace](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-kfc-s02-a1/trace.jsonl) | [FAIL](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-kfc-s02-a1/independent-evaluation.md) |
| KFC advisory `s10-a1` | Corrected unsupported spice claims only after customer challenge. | [transcript](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-kfc-s10-a1/transcript.md) | [trace](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-kfc-s10-a1/trace.jsonl) | [PASS after correction](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-kfc-s10-a1/independent-evaluation.md) |
| KFC advisory `s10-a2` | First answer marked unknown attributes but overstated whole-combo suitability; corrected after challenge. | [transcript](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-kfc-s10-a2/transcript.md) | [trace](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-kfc-s10-a2/trace.jsonl) | Pending final-ledger consolidation |
| KFC advisory `s10-a3` | Sealed final canary: first answer grounded both items and correctly concluded neither entire combo is verified non-spicy; no cart mutation. | [transcript](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-kfc-s10-a3/transcript.md) | [trace](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-kfc-s10-a3/trace.jsonl) | [independent review](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-kfc-s10-a3/independent-evaluation.md) |
| PVCFC `s01-a1` | Abandoned before a customer turn because the first role-player process received stdin EOF. | [transcript](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-pvcfc-s01-a1/transcript.md) | [trace](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-pvcfc-s01-a1/trace.jsonl) | Not applicable |
| PVCFC `s01-a2` | Safe private boundary, but verbose raw excerpts and broken English UX. | [transcript](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-pvcfc-s01-a2/transcript.md) | [trace](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-pvcfc-s01-a2/trace.jsonl) | [FAIL](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-pvcfc-s01-a2/independent-evaluation.md) |
| PVCFC `s01-a3` | Brevity improved; language and product relevance still failed. | [transcript](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-pvcfc-s01-a3/transcript.md) | [trace](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-pvcfc-s01-a3/trace.jsonl) | [FAIL](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-pvcfc-s01-a3/independent-evaluation.md) |
| PVCFC `s01-a4` | Pre-final canary; private boundary passed, English factual turns still fell back to Vietnamese. | [transcript](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-pvcfc-s01-a4/transcript.md) | [trace](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-pvcfc-s01-a4/trace.jsonl) | Pending final-ledger consolidation |
| PVCFC `s01-a5` | Sealed final canary: English/partial-coverage/private-boundary behavior passed; public product relevance remained poor. | [transcript](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-pvcfc-s01-a5/transcript.md) | [trace](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-pvcfc-s01-a5/trace.jsonl) | [independent review](kfc-langchain-parity-2026-07-27-evidence/20260727-parity-deepseek-pvcfc-s01-a5/independent-evaluation.md) |

Final sealed runtime snapshot: `e8946270d43cb14384ed9d1cb08c858debcbf32cb38a3260817cabf369cd7781`.

LangSmith returned quota-limit `429` responses during the canaries. Customer turns continued normally, demonstrating that observability is no longer in the response critical path.

## ActiveGraph and graph-shaped architecture decision

ActiveGraph is an event-sourced world-state runtime: an immutable event log projects a typed graph and makes causal lineage, replay, fork, diff, and governed promotion first-class. It is not a drop-in chat runtime. Its current implementation is Python-first, young, single-threaded, and lacks the TypeScript/Cloudflare/streaming surface this codebase already has. Making it authoritative would also duplicate or displace D1 and LangSmith.

Decision:

- Do not add ActiveGraph to the customer runtime.
- Borrow append-only eval manifests, causal links from transcript to finding to patch to before/after run, structural effect diffs, and explicit authority states: `proposed → tested → reviewable → merged → deployed`.
- Keep automated improvement in the development control plane: live traces → independent review → bounded patch → targeted run → held-out run → human-reviewed merge.
- Consider a sanitized offline ActiveGraph experiment only if existing artifacts and LangSmith cannot answer repeated causal/fork/diff questions.

Primary sources: [ActiveGraph system paper](https://arxiv.org/abs/2605.21997), [events](https://docs.activegraph.ai/concepts/events/), [forking](https://docs.activegraph.ai/concepts/forking/), [LangGraph API selection](https://docs.langchain.com/oss/javascript/langgraph/choosing-apis), [LangGraph Functional API](https://docs.langchain.com/oss/javascript/langgraph/functional-api), [LangSmith Engine](https://docs.langchain.com/langsmith/engine), [Cloudflare durable agents/workflows](https://developers.cloudflare.com/workflows/get-started/durable-agents/).

## LangGraph admission gate

The accepted architecture is recorded in [ADR 0002](../../../docs/adr/0002-agent-loop-first-selective-langgraph.md).

A graph change must have:

1. An observed live failure.
2. A graph-shaped requirement: durable pause/resume, multiple decision points, cycle, fan-out/join, or cross-request recovery.
3. An OOTB framework primitive before custom orchestration.
4. D1 retained as the single business/conversation authority.
5. A paired eval showing enough quality, recovery, or latency gain to pay for the complexity.

Likely first candidates are a real payment/POS callback saga or a long-running PVCFC operation—not ordinary menu, cart, address, or advisory conversation turns.

## Verification

- `npm run check`: passed.
- `npm test`: 60 files, 245 tests passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Release recommendation

- KFC: the final sealed DeepSeek advisory canary is qualified for this scenario. This does not replace browser/GenUI acceptance for trusted cart actions because a text role-player cannot manufacture the signed UI action.
- PVCFC: private-authority safety is qualified; product-guidance quality is not. Do not claim PVCFC feature qualification until the public corpus is distilled into product-granular records and retrieval relevance is re-evaluated.
- Architecture: proceed with the current `createAgent` path. Do not add custom LangGraph or ActiveGraph runtime code now.
