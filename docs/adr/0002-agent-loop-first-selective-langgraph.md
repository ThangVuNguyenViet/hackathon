# ADR-0002: Agent loop first, selective durable graphs

## Status

Accepted

## Date

2026-07-27

## Context

The earlier KFC implementation introduced a custom `StateGraph` before the
customer runtime had a demonstrated graph-shaped requirement. It duplicated
framework behavior with custom router, planner, state, and response-composition
layers. Deterministic topology tests passed while live conversational behavior
remained difficult to improve.

The product also needs:

- model switching during a conversation;
- durable app-owned customer and business state;
- bounded context without blocking customer responses;
- live trace-derived evaluation and repair;
- possible future pause/resume workflows for payment, POS, approval, or other
  cross-request work.

## Decision drivers

- Preserve one reasoning owner for an ordinary customer conversation.
- Prefer maintained high-level framework features over custom orchestration.
- Keep model providers interchangeable during a durable conversation.
- Keep D1 authoritative only for product-required conversation and business
  state; use LangSmith and local evidence for tracing, debugging, and evals.
- Never make tracing, evaluation, or compaction part of response latency.
- Add graph complexity only after an observed failure demonstrates a
  graph-shaped need.

## Considered options

### Custom `StateGraph` for the whole conversation

Rejected. It makes normal tool use and conversation flow explicit at the wrong
abstraction level, creates duplicate state authority, and repeats the failure
mode of the prior implementation.

### LangChain `createAgent` with selective middleware

Accepted for the customer runtime. `createAgent` already uses LangGraph
internally while keeping the supported high-level tool loop. Retry, call limits,
tool recovery, and bounded grounded review belong in middleware.

### LangGraph Functional or Graph API for specific workflows

Deferred until a measured requirement needs durable pause/resume, branching,
fan-out/join, recovery across requests, or independently reusable workflow
state. Prefer the Functional API when ordinary TypeScript control flow remains
clear. Use the Graph API only when explicit topology materially helps.

### ActiveGraph as the runtime

Rejected for the current product path. Its event-sourced world-state, fork,
diff, lineage, and authority-separation ideas are useful, but the current
runtime is Python-first and would duplicate D1 and LangSmith infrastructure.
Its own positioning recommends a chat framework when the problem fits one
conversation.

## Decision

1. Keep one LangChain `createAgent` loop for each customer turn.
2. Keep D1 as the authoritative app-owned transcript and verified business
   state. Assemble explicit portable message history for every provider.
3. Compact older complete user/assistant exchanges after the assistant turn is
   durably committed. Compaction is best-effort deferred work and never blocks
   the customer response.
4. Do not use provider-hosted conversation state or response chaining as the
   durable source of truth. Provider-native IDs may be used only as optional
   transport optimizations if they cannot break model switching, replay, or D1
   authority.
5. Use middleware and typed tools before introducing explicit graph nodes.
6. Keep tracing and evaluation asynchronous. LangSmith or bounded local
   artifacts own traces and eval evidence; D1 does not store full debug traces.
7. Run self-improvement as a development control plane:

   `trace -> finding -> eval -> proposed patch -> targeted and held-out runs -> reviewable PR -> human promotion`

   Generated changes never receive production authority merely because they
   passed a self-authored test.

## Graph admission gate

An explicit graph is admitted only when all of these are true:

1. A real transcript or operational incident demonstrates the failure.
2. The need includes a cycle, multiple decision points, parallel fan-out and
   join, indefinite pause/resume, cross-request recovery, or a reusable
   multi-stage workflow.
3. A maintained out-of-the-box primitive is available before custom
   orchestration is considered.
4. D1 remains the sole authority for conversations, carts, orders, and business
   effects; checkpoints contain only resumable execution state.
5. Paired live evaluation shows a material quality, recovery, or latency gain.

Likely first candidates are a real payment/POS callback saga or long-running
approval workflow. Menu discovery, cart composition, address collection, and
ordinary customer support are not sufficient reasons by themselves.

## Consequences

### Positive

- Less custom orchestration and fewer state authorities.
- Provider-portable sessions and mid-conversation model switching.
- Framework-owned tool-loop behavior remains available.
- Compaction, tracing, and evaluation cannot add customer-path latency.
- A clear evidence gate prevents another premature graph rewrite.

### Negative

- Provider-hosted conversation and compaction conveniences are not used as the
  source of truth.
- Explicit graph visualization and checkpoint replay are unavailable until a
  workflow passes the admission gate.
- Deferred compaction is eventually consistent and may be absent after a
  background failure; recent bounded history and verified D1 business state
  must remain sufficient for the next turn.

## References

- [LangChain agents](https://docs.langchain.com/oss/javascript/langchain/agents)
- [LangChain middleware](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in)
- [LangGraph API selection](https://docs.langchain.com/oss/javascript/langgraph/choosing-apis)
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [ActiveGraph system paper](https://arxiv.org/abs/2605.21997)
- [ActiveGraph event model](https://docs.activegraph.ai/concepts/events/)
- [LangSmith evaluation](https://docs.langchain.com/langsmith/evaluation)
- [Cloudflare durable agents and Workflows](https://developers.cloudflare.com/workflows/get-started/durable-agents/)
