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
checkpoint, approval node, or mandatory response-envelope tool. OpenAI and
Google use the same provider-neutral chat-model and tool interfaces.

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

Select the model provider with:

```bash
KFC_AGENT_PROVIDER=openai
# or
KFC_AGENT_PROVIDER=google
```

Credentials come from `OPENAI_API_KEY` or `GOOGLE_API_KEY`.
`OPENAI_BASE_URL` remains optional.

## Run a real conversational scenario

This command sends the scenario's user turns through the live model and prints
the assistant replies, selected tools, GenUI kind, and elapsed time. It has no
assertions or outcome judge.

```bash
npm run live:scenario
```

Pass another reviewed conversation file to run it:

```bash
npm run live:scenario -- \
  ../../ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.json
```

The reviewed conversation sources live in
`../../ai-talent-tracks/fnb/conversations/*.json`.

## Runtime state

Conversation history and verified commerce snapshots are application-owned in
memory, D1, or PostgreSQL. They are supplied as context on each turn. The model
provider does not own session memory.

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
