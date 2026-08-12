# ADR-0002: Prefer an agent loop and admit LangGraph selectively

## Status

Accepted on 2026-08-12.

## Context

KFC previously wrapped a LangChain agent loop in application-authored
LangGraph state, while a separate OpenAI Agents SDK path provided another
runtime. PVCFC used the SDK path even though its prompt, tools, evidence rules,
and provider lifecycle were unrelated to KFC. The duplicate runtimes made
execution identity, persistence, qualification, and deployment drift.

[PR #69](https://github.com/ThangVuNguyenViet/hackathon/pull/69) demonstrated
that an ordinary KFC turn could run through LangChain's agent loop without an
outer workflow graph. Its branch diverged from current `main`, so it remains
historical evidence rather than code to merge.

The application already owns durable transcript, authorization, confirmations,
irreversible-effect reservations, idempotency, verified state, delivery, and
run fences. Those are business/application transaction boundaries, not model
workflow state.

## Decision drivers

- Keep one maintained model/tool loop for both business agents.
- Preserve separate KFC and PVCFC business packs rather than inventing a
  universal business domain.
- Keep application persistence authoritative for security and effects.
- Avoid a graph unless its workflow semantics provide concrete value that an
  agent loop plus application transaction cannot provide.
- Keep a future graph adoption explicit, reviewable, and removable.

## Considered options

1. Keep a LangGraph outer workflow around every agent turn. This makes
   branching visible but duplicates state ownership and adds graph persistence
   without a current workflow requirement.
2. Keep both the OpenAI Agents SDK and LangChain paths. This preserves legacy
   probes but retains runtime ambiguity and parallel qualification surfaces.
3. Use LangChain `createAgent` as the only agent loop now, with an explicit
   admission gate for future LangGraph use.

## Decision

KFC and PVCFC each own a separate LangChain `createAgent` business pack.
Trusted route configuration selects the pack. The shared registry contains
only pack identity and `runTurn`; prompts, tools, web allowlists, evidence
precedence, policy, and presentation remain pack-owned.

The application continues to own canonical conversation and business state,
authorization, confirmation, idempotency, effects, atomic persistence, and
delivery. LangChain owns model/tool iteration and maintained call limits and
tracing. TinyFish is an optional injected evidence client behind separate KFC
and PVCFC policies.

Do not introduce LangGraph merely to sequence an ordinary turn or to duplicate
application state. A proposal to add it must identify and prove at least one
required graph capability, such as durable resumable multi-stage workflow
branches, fan-out/fan-in across independently recoverable steps, or workflow
replay that cannot be expressed safely by the existing transaction boundary.
The proposal must also define state ownership, persistence migration,
failure/recovery semantics, qualification evidence, and the removal path.

## Consequences

### Positive

- One executable agent-loop stack and one runtime identity
  (`langchain-create-agent`).
- KFC and PVCFC can evolve independently without shared business policy.
- Security-critical state remains in application-owned D1/PostgreSQL
  transactions instead of framework checkpoints.
- TinyFish and model providers remain injected capabilities rather than pack
  selectors or canonical data stores.
- A future graph can still be adopted when a measured workflow need justifies
  its operational cost.

### Negative

- Multi-step transaction flow is explicit application code and must retain
  focused invariant tests.
- LangChain may include LangGraph transitively; dependency lockfiles can contain
  it even though application code does not import or author a graph.
- Future graph adoption requires a new ADR and migration/qualification work.

## Follow-up

- Remove unused framework-specific checkpoint/session tables only through a
  separately reviewed database migration after rollout observation.
- Build a new credentialed model scenario matrix against the current business
  packs before making live model evaluation release-blocking again.
