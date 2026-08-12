# LangChain-Only Business Agents Design

## Status

Approved direction, written for implementation review on 2026-08-12.

## Context

The repository currently contains three competing execution shapes:

- KFC can run through a custom LangGraph `StateGraph` containing a nested
  LangChain `createAgent` loop.
- KFC can also run through a direct OpenAI Agents SDK path.
- PVCFC runs through the direct OpenAI Agents SDK path even though its data,
  tools, prompt, and lifecycle are business-specific.

PR #69 proved a useful architectural point: an ordinary KFC conversation can
run through LangChain `createAgent` without a separately authored workflow
graph. Its implementation has diverged too far from current `main` to merge,
and its PVCFC corpus is obsolete. We retain its graph-admission rule and
historical qualification evidence, not its branch or code wholesale.

PVCFC now has a provenance-bearing public-data provider containing 497
reachable records, including 67 products and 79 discovery-only source-inventory
records. That fixture provider is temporary. A future official API provider
must be able to replace it without changing the PVCFC agent's tool contract.

## Goals

1. Make LangChain `createAgent` the only agent execution stack for both KFC and
   PVCFC.
2. Remove direct OpenAI Agents SDK usage and authored LangGraph workflow code
   from production.
3. Keep KFC and PVCFC as separate business packs with separate prompts, tools,
   policies, lifecycle, presentation, and data providers.
4. Give both packs live web search and exact-page fetch through TinyFish, with
   policy owned by each pack.
5. Preserve KFC commerce safety and PVCFC fixture reachability while replacing
   commodity custom infrastructure with maintained LangChain features.
6. Refresh PVCFC demo scenarios and suggestion pills so they demonstrate the
   expanded public-data provider and live official-site fallback honestly.

## Non-goals

- Designing a universal business domain model or a default tool set for every
  business.
- Treating web results as canonical business data.
- Crawling all 4,503 inventoried news URLs during a customer turn.
- Replacing application-owned conversation, approval, idempotency, business,
  or delivery state with model/framework memory.
- Introducing an explicit LangGraph workflow pre-emptively.
- Porting PR #69's old PVCFC corpus, monolithic KFC pack, or branch history.

## Decision 1: One LangChain execution stack

Each business pack constructs a LangChain `createAgent` using its own model,
system prompt, LangChain tools, middleware, and response adaptation. Shared
code may provide small execution utilities and neutral contracts, but it must
not decide business policy or expose SDK-specific types.

`@langchain/openai` remains allowed as a LangChain model-provider integration.
Direct imports of `openai`, `@openai/agents`, or
`@kfc/openai-agents-runtime` are not allowed in the agent runtime.

The KFC outer `StateGraph`, graph runner, graph checkpoints, and dual-runtime
switch are removed after equivalent LangChain behavior passes the KFC safety
and lifecycle suite. PVCFC is migrated directly to `createAgent`; it never
uses KFC runtime, state, presentation, or tools.

The HTTP response runtime identifier becomes a neutral LangChain identifier,
not `openai-responses` or `langgraph-create-agent-workflow-v1`.

## Decision 2: Explicit LangGraph admission gate

No authored LangGraph workflow is part of this migration. LangChain may use
LangGraph internally as an implementation detail of `createAgent`; application
code does not import or construct graph primitives.

A future proposal may introduce explicit LangGraph only when it documents all
of the following:

1. A real production incident, trace, or accepted product requirement that is
   graph-shaped across calls, such as durable pause/resume or independently
   resumable branches.
2. Why LangChain middleware and application-owned state cannot solve it more
   simply.
3. The exact maintained LangGraph primitive being adopted.
4. Persistence, latency, observability, and operational ownership.
5. Focused acceptance evidence and a removal condition.
6. Explicit user approval of the additional graph complexity.

## Decision 3: Separate business packs

The shared boundary resolves a trusted server-selected business ID to a
business-owned runnable. Customer prose, session prefixes, and metadata text
cannot select or mutate a business pack.

The shared layer is limited to:

- trusted pack registration and resolution;
- neutral turn input and output contracts;
- application conversation-history assembly;
- request fencing, cancellation, and atomic response persistence;
- neutral, redacted tool/evidence tracing.

The KFC pack owns commerce clients, typed commerce tools, authorization,
confirmation, idempotency, verified state, GenUI, and KFC prompt policy.

The PVCFC pack owns its public-data provider, four provider tools, evidence
policy, TinyFish allowlist, citations, prompt, and text presentation. It creates
no KFC cart, publishes no KFC verified state, and produces no KFC GenUI.

## Decision 4: PVCFC provider contract remains data-source neutral

The four existing PVCFC operations remain stable:

- list collections;
- list records with pagination;
- search records;
- get an exact record.

They are re-exposed as LangChain `tool(...)` definitions with Zod schemas. The
agent can enumerate and retrieve all 497 fixture records, including the 79
discovery-only source-inventory records. Discovery-only records are list/get
evidence and are not promoted into searchable canonical content.

The fixture implementation is one provider mode. An official API provider can
implement the same interface later. Adding records, unknown nested fields, or
new collections to an existing provider requires a data rebuild, not tool or
agent changes.

## Decision 5: TinyFish live web capability

Both KFC and PVCFC opt in to two business-owned LangChain tools backed by the
official, pinned `@tiny-fish/sdk@0.3.0`:

- a search tool for discovering current official pages;
- a fetch tool for extracting one exact official page.

The packs do not share allowlists or evidence precedence. A small shared client
adapter is permitted for SDK construction, sanitised telemetry, deterministic
test injection, and timeout configuration.

### PVCFC policy

- Query the fixture or future official API first.
- Use TinyFish only when the request is current, missing, stale, or asks for a
  known source page that is not materialised in the provider.
- Search is restricted to approved PVCFC-owned domains.
- Fetch accepts an HTTPS URL only when it is already in the fixture inventory
  or was returned by the current turn's allowlisted search.
- Validate both the input URL and TinyFish `final_url`; discard redirected
  external content.
- Keep source URL, title, publication date when available, and retrieval time.
- Cite live-web claims with clickable URLs and label them as current web
  evidence rather than fixture-authoritative data.

### KFC policy

- Commerce APIs and verified KFC catalog/state remain authoritative for orders,
  prices, availability, promotions, and cart mutations.
- Web search is supplementary public information only and cannot author a cart,
  price, availability claim, promotion eligibility, or trusted action.
- Search and fetch use an explicit KFC-owned allowlist and the same redirect and
  citation safeguards.

### Cost and latency bounds

- Missing `TINYFISH_API_KEY` leaves fixture/API capability available and reports
  web capability as unavailable; it does not break fixture-only PVCFC startup.
- One turn may perform at most one TinyFish search and two single-URL fetches.
- TinyFish SDK retries are disabled; LangChain middleware owns bounded retries.
- Calls use short explicit SDK and per-URL timeouts within the existing 30-second
  turn deadline.
- A TinyFish failure degrades to available canonical evidence with a concise
  freshness limitation; it never triggers an unrestricted crawler fallback.
- Normal turns never bulk-fetch the 4,503 inventoried news URLs.

## Decision 6: Conversation and durable state

The application conversation store remains the canonical transcript. Each
turn reconstructs bounded LangChain message history from that store. KFC
business state, approval state, irreversible-operation reservations,
idempotency records, and delivery outbox remain in application persistence.

OpenAI SDK session-item persistence and LangGraph checkpoint tables/APIs become
unused and are removed in a separately reversible schema-cleanup step after all
runtime references are gone. The D1 and PostgreSQL databases remain because
they store application state; only framework-specific checkpoint/session
storage is retired.

## Decision 7: Maintained framework features over custom utilities

Where behavioral parity is demonstrated, use maintained LangChain facilities:

- `summarizationMiddleware` for bounded conversational context;
- `modelRetryMiddleware` and `toolRetryMiddleware` for commodity retries;
- `modelCallLimitMiddleware` and `toolCallLimitMiddleware` for loop bounds;
- automatic LangSmith tracing with tags and metadata.

Retain custom code only for business and application invariants: commerce
authorization, confirmations, evidence precedence, trusted action execution,
idempotency, atomic persistence, delivery, cancellation, and provider-specific
normalization. Remove wrappers around private LangSmith methods and duplicated
generic retry/compaction/tool-loop machinery.

## Decision 8: PVCFC demos and suggestion pills

The demo should lead with scenarios that are supported by the current fixture
and expose live-web fallback only where it adds honest freshness:

1. **Choose a fertilizer** — compare URL-distinct products by crop or need,
   preserving products with duplicate display names.
2. **Inspect product evidence** — retrieve exact composition, packaging, usage,
   certificates, and official source links where present.
3. **Find a dealer or contact channel** — search dealer, support, and regional
   public information with provenance.
4. **Explore 2Nông and urban agriculture** — enumerate services, offerings,
   education pages, and store information without inventing inventory, prices,
   or opening hours.
5. **Review company and facility facts** — answer organization, plant,
   technology, sustainability, governance, and public-report questions.
6. **Browse reports and disclosures** — list and retrieve annual or
   sustainability report records and cite their official landing pages.
7. **Check current official news** — use TinyFish search for recent PVCFC news,
   then fetch and cite selected official pages.
8. **Open an inventoried page on demand** — locate a source-inventory URL and
   fetch that page without pre-crawling the full sitemap.

Suggestion pills must be derived from these supported scenarios. Remove pills
or UI copy that implies live prices, current store inventory, confirmed store
hours, exhaustive news ingestion, or autonomous agronomic prescriptions when
the underlying evidence does not support them.

## Error handling and security

- Unknown or duplicate business IDs fail closed at startup.
- Missing required model/provider configuration fails only the affected pack.
- Tool schemas reject unbounded pagination, arbitrary domains, credentials in
  URLs, non-HTTPS URLs, and oversized input.
- Tool output is compact for search/list and bounded for detail/fetch.
- Secrets and full fetched articles are never written to traces.
- Web content is untrusted evidence and cannot issue instructions to tools or
  override business policy.
- Customer-controlled metadata cannot become developer instructions, verified
  actions, or pack selectors.

## Delivery stages

### Stage 1: LangChain-only execution and parity

Retype the shared pack boundary, migrate PVCFC tools and execution to LangChain,
make the existing KFC `createAgent` path the only KFC semantic loop, and remove
route selection of the OpenAI SDK and explicit StateGraph runtimes. Preserve
HTTP compatibility except for the corrected runtime identifier.

### Stage 2: TinyFish tools

Add the pinned SDK, configuration/readiness projection, injected client seam,
per-pack search/fetch tools, allowlists, evidence receipts, citations, and
deterministic tests. Qualify Node and Cloudflare Worker builds separately.

### Stage 3: PVCFC demo refresh

Update suggestion pills, supported scenario copy, and deterministic demo tests
against the 497-record provider plus fake TinyFish responses. Do not depend on
live TinyFish for CI.

### Stage 4: Legacy and custom-infrastructure cleanup

Delete the direct OpenAI Agents SDK package/path, explicit graph/checkpointer
code, SDK session state, obsolete runtime flags/scripts/tests, and commodity
custom utilities after parity gates prove their replacements. Leave database
table deletion to an explicit migration after runtime rollout.

## Acceptance criteria

### Architecture

- No production import of `@kfc/openai-agents-runtime`, `@openai/agents`, direct
  `openai`, `@langchain/langgraph`, or `@langchain/langgraph-checkpoint`.
- No `StateGraph`, `Command`, graph checkpointer, OpenAI SDK executor, or dual
  agent-runtime flag remains in production routing.
- Both packs execute via LangChain `createAgent` and are selected only by a
  trusted route-owned pack ID.

### PVCFC

- All 497 provider records round-trip through list/get; all searchable records
  remain discoverable; all 79 discovery-only inventory records remain list/get
  only.
- The agent exposes the four provider tools plus PVCFC-owned TinyFish search and
  fetch when configured.
- Fixture/API evidence is attempted before live web when it can answer.
- Every live-web claim is backed by an allowlisted returned URL.
- PVCFC never invokes KFC clients, tools, state publication, commands, or GenUI.

### KFC

- Existing commerce authorization, confirmation, idempotency, human handoff,
  interruption, delivery, and GenUI acceptance suites pass.
- Web evidence cannot mutate commerce state or override verified commerce data.
- KFC no longer selects a direct OpenAI SDK runtime when model configuration is
  present.

### TinyFish

- No-key, timeout, retry, quota, malformed response, disallowed-domain,
  credential URL, and external-redirect cases fail safely.
- Worker dry-run and Node build pass with the pinned SDK.
- Deterministic tests use an injected fake client; a separately gated live
  canary verifies real Search and Fetch compatibility.

### Operations

- Application conversation and business state remain durable through existing
  stores.
- Duplicate message IDs remain idempotent, stale runs cannot commit, and reset
  behavior remains correct.
- LangSmith traces show neutral agent/tool names and sanitised URL/status/latency
  evidence without secrets or full page contents.

## PR #69 disposition

PR #69 is not merged or cherry-picked. Its accepted agent-loop-first ADR and
historical parity report are retained as referenced design evidence. The new
migration PR links to #69 and supersedes it. After the replacement PR exists,
#69 may be closed as superseded without deleting its history.
