# KFC Model-Driven Small-Talk Router Design

Date: 2026-07-11

## Purpose

Reduce greeting, thanks, and goodbye latency without introducing hard-coded phrase matching or weakening the existing commerce planner. The router may complete only low-risk social turns. Every uncertain, mixed, or business-relevant turn continues through the current `gpt-4.1-mini` planner and existing safety gates.

The public `/chat/kfc/message` schema, idempotency behavior, persistence model, GenUI contracts, monitoring flow, and production LangSmith project remain unchanged.

## Current Runtime

The backend is currently a single-agent orchestration flow. `runAgentTurnCore` owns a typed `AgentGraphState`, invokes one tool planner, applies backend-owned policy and safety checks, executes typed tools, optionally composes a response, persists state, and emits dashboard events. The background monitor judge is observability support rather than a delegated agent.

Although `@langchain/langgraph` is installed and the original architecture document describes a future `StateGraph`, the active runtime does not instantiate LangGraph `StateGraph`, `Annotation`, or checkpoint primitives. This change will not migrate the orchestration loop. A full LangGraph migration has different goals, risks, and acceptance criteria and should be handled separately.

## Approaches Considered

### Recommended: concurrent social router inside the existing turn flow

Start a constrained `gpt-4.1-nano` routing call concurrently with D1 context loading. After context is available, accept the fast result only when its structured decision is `handle_social`. Otherwise continue through the existing planner.

This preserves the existing state and business path, overlaps most router latency with the unavoidable D1 read, and gives LangSmith a distinct routing span.

### Cascading planner wrapper

Wrap the existing planner with a nano preflight call and delegate to `gpt-4.1-mini` when needed. This is mechanically simple, but it serializes the router before every commerce planner call and can make menu and ordering turns slower.

### LangGraph `StateGraph` migration

Create explicit `load_context`, `route_social`, `plan`, `execute`, and `respond` nodes. This would make the flow visually explicit, but it is a broad architecture migration with no inherent latency benefit. It is out of scope for this optimization.

## Router Contract

Introduce a narrow interface independent of the tool planner:

```ts
interface SmallTalkRouterInput {
  latestUserMessage: string;
  channel: Channel;
  hasStructuredAction: boolean;
}

type SmallTalkRouterOutput =
  | { decision: 'handle_social'; responseText: string }
  | { decision: 'continue_to_planner' };

interface SmallTalkRouter {
  readonly model?: string;
  readonly promptVersion?: string;
  route(input: SmallTalkRouterInput): Promise<SmallTalkRouterOutput>;
}
```

The OpenAI implementation uses `gpt-4.1-nano` by default and validates the response with Zod. `responseText` is model-written; runtime source must not contain canned greeting, thanks, or goodbye responses.

The model receives a compact prompt with the latest message and channel only. A structured GenUI action bypasses the router. The model receives no transcript, tool catalog, menu data, order state, payment state, customer profile, or authorization material. Without conversation state, acknowledgements, confirmations, references, and ambiguous follow-ups must continue to the full planner; only self-contained social turns may be handled.

## Safety Boundary

`handle_social` is permitted only for a purely social turn such as a greeting, thanks, or goodbye. The router must return `continue_to_planner` for:

- any menu, pricing, promotion, product, availability, or recommendation request;
- any cart, ordering, fulfillment, address, voucher, loyalty, payment, invoice, or order-status request;
- any complaint, feedback, safety, allergen, escalation, or human-handoff request;
- any mixed turn that combines social language with another request;
- any acknowledgement, confirmation, or reference whose meaning may depend on commerce state or prior actions;
- any uncertain or ambiguous classification.

These are policy categories, not phrase dictionaries. There will be no runtime keyword list, regex classifier, stopword list, or hard-coded customer response.

Malformed output, an empty response, timeout, rate limit, unsupported model response, or router exception fails open to `continue_to_planner`. Router failure must never fail the HTTP request or suppress the full planner. Failures append a diagnostic `llm:small_talk_router_failed` conversation event without credentials or authorization data.

## Turn Flow

1. Preserve the existing idempotency lookup.
2. Start the `small_talk_router` request when `runAgentTurnCore` begins.
3. Load verified state, persist or reuse the inbound turn, and build bounded recent turns as today.
4. Await the router result after context loading completes.
5. If the result is `continue_to_planner`, run the existing `gpt-4.1-mini` planner with no behavioral changes.
6. If the result is `handle_social`, create the normal state and assistant turn using the model-written response, skip the planner, tools, GenUI, and composer, and continue through the existing synchronous intelligence and persistence path.
7. Run the deferred monitor judge and LangSmith flush through `waitUntil` as today.

The router promise should be observed even when the turn is cancelled or suppressed so it cannot become an unhandled rejection. Run-current checks remain authoritative.

## State Design

Continue using the existing typed `AgentGraphState`. The router decision is ephemeral orchestration data and does not become durable business state. The fast path must not mutate cart, fulfillment, order, payment, handoff, or retrieved evidence.

For observability, the final root trace output may include `route: 'social_fast_path' | 'full_planner'`. This is diagnostic metadata, not a state transition used by business logic.

## Configuration

Add:

- `OPENAI_SMALL_TALK_ROUTER_MODEL`, default `gpt-4.1-nano`;
- `OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS`, default `2500`.

The timeout aborts the router request and falls through to the planner rather than failing the turn.

`AppEnv` and `WorkerEnv` expose the model. Server and Worker option builders create the router only when `OPENAI_API_KEY` is configured. Tests and local deterministic scenarios may inject a static router.

The existing planner remains `gpt-4.1-mini`. The failed experiment that replaced the entire planner with nano is not repeated.

## LangSmith Observability

Create one child span named `small_talk_router` with:

- model and prompt version;
- latest message and channel;
- parsed decision and model-written response when present;
- error or timeout details;
- duration.

For social turns, there must be no `planner_iteration` or `response_compose` child span. For commerce and uncertain turns, `small_talk_router` is followed by the existing planner trace. Trace delivery remains deferred and diagnostic-only.

## Testing

Use TDD and cover:

- the OpenAI router parses `handle_social` and `continue_to_planner` outputs;
- malformed output, timeout, and fetch failure fall through safely;
- a social result produces a model-written reply with zero planner, composer, or tool calls;
- menu, ordering, payment, complaint, safety, and handoff results invoke the full planner unchanged;
- mixed social and commerce turns cannot use the fast path;
- an empty `handle_social` response falls through;
- the router begins before context loading finishes and its latency overlaps context loading;
- idempotent replay remains unchanged;
- exactly one deterministic intelligence event and one deferred AI refinement remain;
- LangSmith records `small_talk_router` and omits planner/composer spans only on accepted social turns;
- runtime source guards continue to reject phrase classifiers and canned demo language.

Run the full backend build and serial Vitest suite plus the existing Flutter customer-chat repository and controller tests.

## Live Correctness Gate

Before production deployment:

1. Run the existing nine-scenario live OpenAI replay with the unchanged `gpt-4.1-mini` planner.
2. Add a live router corpus containing pure social turns, mixed social-plus-commerce turns, and representative menu, ordering, payment, complaint, safety, and handoff requests.
3. Require every pure social turn to route safely and every non-social or mixed turn to continue to the planner.
4. Require no planner or composer failure events.

The router corpus is an evaluation asset, not a runtime phrase dictionary.

## Production Acceptance

Deploy from a clean committed branch with the existing LangSmith APAC configuration and rollback target recorded. Verify `/ready` reports the intended release SHA and observability settings.

Run 20 unique greeting turns and 20 unique menu-discovery turns through the Pages chatbot. Require:

- 100% HTTP success;
- greeting p95 below 6 seconds;
- menu p95 below 8 seconds;
- overall p95 below 8 seconds;
- one `agent_turn` and one linked `post_turn_monitor` root trace per request;
- a `small_talk_router` span for every request;
- zero `planner_iteration` spans for accepted greetings;
- normal planner/tool behavior for every menu turn;
- no planner, composer, router, or background-judge failure affecting HTTP success.

Retain the release only if correctness, trace completeness, and latency gates pass. Otherwise restore the recorded Worker version.

## Non-Goals

- Multi-agent delegation or specialist agents.
- Migrating the orchestration loop to LangGraph `StateGraph`.
- Hard-coded greeting detection or canned customer wording.
- Fast-path handling for menu, recommendations, ordering, payments, complaints, safety, or handoff.
- Changing public API, Flutter, D1, idempotency, or GenUI contracts.
