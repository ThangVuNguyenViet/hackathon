# KFC Agent Backend

Fastify and Cloudflare Worker backend for the KFC Vietnam conversational
assistant.

The agent is intentionally small:

1. Load the recent user and assistant messages owned by the application.
2. Add the current verified cart, fulfillment, order, and payment state.
3. Let the configured chat model choose from the KFC tools.
4. Execute fixture or configured commerce-provider tools and return each result
   to the same model.
5. Persist the natural response and derive GenUI from successful tool results.

There is no graph runtime, classifier, router, planner, response composer,
checkpoint, approval node, or mandatory response-envelope tool. Every
configured candidate uses the same provider-neutral chat-model and tool
interfaces.

## Local setup

```bash
npm install
npm run fixtures:build
npm run build
KFC_COMMERCE_MODE=fixture npm run dev
```

The backend fixture provider supplies menu, cart, store, fulfillment, order,
payment, membership, content, and handoff results. In fixture mode, the only
external AI request is the configured model provider.

Select one immutable candidate profile with:

```bash
KFC_AGENT_CANDIDATE=openai-gpt-4.1-mini
# deepseek-v4-flash
# qwen3.7-max
# minimax-m3
# google-gemini-3.1-flash-lite
```

Credentials come from `OPENAI_API_KEY`, `OPENCODE_API_KEY`, or
`GOOGLE_API_KEY`, according to the selected profile. OpenCode candidates use
the fixed `https://opencode.ai/zen/go/v1` API endpoint; no OpenCode base URL is
accepted from runtime configuration. The Anthropic SDK is configured with
`https://opencode.ai/zen/go` because it appends `/v1/messages` itself. The
OpenAI-compatible adapter receives the full `/v1` base. `OPENAI_BASE_URL`
remains optional for the named OpenAI control only.

The OpenAI control uses Responses. DeepSeek uses the OpenAI-compatible chat
completions transport with thinking disabled. Qwen and MiniMax use the
Anthropic Messages adapter. Their published output capabilities remain pinned
at 65,536 and 131,072 tokens respectively, while ordinary agent requests use a
provider-neutral 4,096-token response budget. The smaller request budget is
ample for bounded customer-support replies and tool arguments and avoids
turning a capability ceiling into an instruction to generate an unusually
long response. The MiniMax capability value comes from the OpenCode model
metadata for `opencode-go/minimax-m3` (`@ai-sdk/anthropic`, metadata
`last_updated` 2026-05-31), locally verified on 2026-07-24. That metadata is
evidence for the compiled profile only; runtime code does not read the local
OpenCode cache. Google support remains available but is not in the default
live candidate matrix.

`checkModelCapabilities` checks ordinary invocation and typed tool-call
behavior on a `BaseChatModel` for isolated tests. Evidence-producing
`runModelCapabilityPreflight` accepts only the opaque configured-model binding
returned by the canonical factory, so identity and model cannot be paired
independently. It returns only candidate identity, pass/fail flags, and bounded
failure codes; it never returns prompts, model response content, credentials,
or raw provider errors.

## Export the narrative scenario inventory

This command validates and exports the retained narrative prompts. It never
sends scripted turns to a model. A Codex role-player uses the goals,
preconditions, and turns as improvisational context in fresh live sessions;
an independent reviewer judges the resulting evidence.

```bash
npm run scenario:inventory
```

Pass one reviewed conversation file to export only that narrative:

```bash
npm run scenario:inventory -- \
  ../../ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.json
```

The reviewed conversation sources live in
`../../ai-talent-tracks/fnb/conversations/*.json`.

## Runtime state

Conversation history and verified commerce snapshots are application-owned in
Cloudflare D1. A small in-memory adapter exists only for deterministic tests.
The model provider does not own session memory.

## GenUI

First-party KFC chat uses the same agent loop. Successful tool results update
the verified state, and `selectKfcGenUiAttachment` chooses the matching
structured surface. Messenger and Zalo receive standalone text/media
presentation from the same response.

## Checks

```bash
npm run check
npm run build
npm run worker:deploy:dry-run
```

`npm run check` covers formatting, linting, and TypeScript. Live behavior is
inspected from the scenario transcript instead of an assertion-based agent
qualification suite.
