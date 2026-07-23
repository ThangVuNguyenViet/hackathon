# KFC Big-Bang LangChain Migration Plan

## Outcome

Rebuild the current `codex/kfc-kiss-model-agnostic` branch around one
provider-neutral LangChain `createAgent` loop, preserve the valuable behavior
from the direct OpenAI SDK work, introduce trusted in-process business packs,
simplify durable storage, and qualify every configured live model through
improvised Codex-reviewed scenarios.

## Global constraints

- The current branch is the baseline and target. Do not rebuild from `main` or
  cherry-pick donor commits wholesale.
- There is one production semantic loop based on LangChain `createAgent`.
- Do not import or construct `StateGraph`. Add LangGraph only after a separate
  evidence-backed architecture audit proves a required resumable workflow.
- Do not use direct OpenAI SDK orchestration. Models enter through
  `BaseChatModel`.
- Never route intent, tool choice, or semantic behavior through a deterministic
  set of words, phrases, or regular expressions. Exact normalized retrieval
  matching and schema validation remain allowed.
- D1 owns product state required after a crash or week-long pause. LangSmith
  owns tracing, evaluation, and debugging evidence.
- Conversation context is a persisted older-history summary plus recent
  complete exchanges plus typed authoritative business state. An LLM summary
  never authorizes a business operation.
- Preserve unrelated work. No production deployment, merge, real customer
  message, or financial action.
- Run Vitest directly through its normal package script. Do not launch test
  commands from TypeScript or Dart.
- Scenario scripts contain narrative goals and preconditions, not exact
  wording, exact tool sequences, or deterministic tool assertions.
- Every retained live fix must pass deterministic checks and fresh independent
  held-out Codex review without weakening the rubric.

## Task 1: Policy, scenarios, and deterministic test foundation

- Add repository `AGENTS.md` rules for semantic routing, selective StateGraph,
  scenario integrity, and held-out live verification.
- Port scenario scripts 10 and 11 and the approved narrative improvements to
  scenarios 02, 03, 04, 06, 07, and 09.
- Remove scripted acceptance fields and generated test-suite inventory
  artifacts while retaining scenario goals, turns, risks, and outcomes.
- Restore only a small direct Vitest foundation for provider profiles, agent
  kernel contracts, menu search behavior, storage contracts, pack isolation,
  and queue-envelope limits.

## Task 2: Provider-neutral semantic kernel and KFC pack

- Extract the sole `createAgent` invocation into a business-neutral kernel.
- Introduce a trusted static business-pack registry and versioned typed pack
  state envelope.
- Move KFC prompt, tools, state projection, and presentation behind the KFC
  pack while retaining `runAgentTurn` as a compatibility facade.
- Port richer menu search and complete delegated cart-plan semantics from the
  selected donor work.
- Add OpenAI, Google, and confirmed OpenCode-compatible model profiles through
  maintained LangChain chat-model adapters.
- Pin model/profile per session and fail capability preflight closed.

## Task 3: Context, storage, tracing, and Messenger ingress

- Keep `conversation_turns` as the canonical transcript.
- Add monotonic per-session turn ordinals, a versioned rolling summary with a
  covered-through watermark, and one typed current pack-state projection.
- Assemble model context from summary, newest complete exchanges under a
  provider-neutral token budget, and typed current state.
- Replace generic event-log state reads with explicit compact product records.
- Remove duplicated transcript/debug/trace payloads from D1 while retaining
  operational idempotency, run ownership, delivery recovery, irreversible
  receipts, session authority, and the dashboard product read model.
- Attach LangChain callbacks and safe correlation metadata to LangSmith.
- Queue only a bounded normalized Messenger envelope after signature
  verification; never queue expanded raw bytes.
- Keep D1 as the production store and a small in-memory test adapter. Remove
  unused Postgres parity code.

## Task 4: Business packs and PVCFC production corpus

- Add a KFC pack and a PVCFC public-customer-service pack behind the same kernel
  contract.
- Copy the verified `pvcfc-public-web-2026-07-21` corpus into an immutable
  tracked pack fixture with manifest, hashes, provenance, and custody sidecar.
- Add a deterministic corpus checker and derived public-knowledge index.
- Keep PVCFC claims dated and grounded in captured public sources. Do not
  fabricate private customer, dealer, order, complaint, or visit authority.
- Namespace sessions and state by trusted business binding and pack version.

## Task 5: Live scenario evidence harness

- Run all retained scripts in fresh sessions for every candidate model that
  passes ordinary invocation and typed-tool capability preflight.
- Capture append-only schema-versioned JSONL containing all user messages,
  assistant messages, tool calls, complete tool results, errors, timing, and
  correlation identifiers.
- Render a complete Markdown transcript and manifest for every model run.
- Keep LangSmith sanitized; keep detailed synthetic evidence in ignored local
  artifacts.
- Do not turn the harness into a semantic assertion suite.

## Task 6: Independent evaluation and bounded repair

- Give blinded transcript packets to fresh Codex evaluators.
- Score task completion, grounding, appropriate tool use, state continuity,
  safety, conversational quality, and business-pack isolation.
- Choose the highest-impact verified failure, make one bounded reversible fix,
  rerun deterministic checks, then rerun fresh held-out live scenarios.
- Keep only regression-free improvements.
- Stop on clean qualification, an external blocker, an approval-required
  action, or stagnation where another change would only tune to existing
  evidence.

## Task 7: Final verification and handoff

- Run formatting, lint, typecheck, build, direct Vitest, local D1 migration,
  Worker dry-run, capability preflights, and the complete live matrix.
- Run an independent whole-branch review and resolve important findings.
- Commit coherent checkpoints to the existing target branch and update its
  draft PR, retargeting to `main` when ready. Do not merge or deploy.
- Deliver an indexed report containing all transcript artifacts, tool-call
  evidence, model evaluations, fixes, decisions, verification commands,
  remaining blockers, and PR state.
