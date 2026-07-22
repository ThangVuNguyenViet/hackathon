# Live KFC Scenarios

The reviewed customer conversations live in
`ai-talent-tracks/fnb/conversations/*.json`. The backend loads those files and
sends each user turn through the same model-and-tools loop used by the product.

Run all nine conversations with OpenAI:

```bash
cd services/kfc-agent-backend
KFC_AGENT_PROVIDER=openai OPENAI_API_KEY=... npm run live:scenario
```

Run them with Google:

```bash
cd services/kfc-agent-backend
KFC_AGENT_PROVIDER=google GOOGLE_API_KEY=... npm run live:scenario
```

To inspect one conversation, pass its JSON path after `--`:

```bash
npm run live:scenario -- \
  ../../ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.json
```

The runner prints the model response, selected tools, GenUI kind, and elapsed
time for each turn. It intentionally has no wording assertions, tool-selection
assertions, judge, qualification profile, or scripted pass/fail outcome.

Menu, cart, store, fulfillment, order, payment, membership, content, and
handoff data come from the bundled fixture provider. Only the selected model
provider is an external AI API during fixture-mode scenario runs.
