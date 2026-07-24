# KFC recommendation behavioral-world prototype

> THROWAWAY PROTOTYPE — this package tests whether the synthetic journey,
> logging-policy, outcome, and counterfactual data shape feels coherent. It is
> not the production recommendation service or the Flutter stakeholder demo.

The prototype uses the checked-in KFC catalog and store fixtures to generate a
small deterministic behavioral world. It writes model-visible Parquet tables
and a physically separate oracle table, then exposes the same bundle through a
local Streamlit browser UI.

## Run it

```bash
cd services/kfc-recommendation-simulator
uv sync
uv run kfc-rec-sim generate --preset smoke
uv run kfc-rec-sim audit ../../.artifacts/kfc-recommendation-simulator/smoke
uv run streamlit run app.py -- --bundle ../../.artifacts/kfc-recommendation-simulator/smoke
```

The Streamlit UI is a disposable inspection shell. The pure generation and
audit functions are deliberately kept outside it so validated contracts can be
carried into the later implementation plan.

## Demo variants

The browser shell has three deliberately different presentation prototypes.
Use the fixed arrow switcher, the keyboard left/right arrows, or open a variant
directly:

- `/?variant=A` — a guided three-step story: simulate context, generate
  recommendations, then simulate the customer response;
- `/?variant=B` — a kiosk-theatre layout with the order ticket beside the
  recommendation stage;
- `/?variant=C` — a one-screen evidence board with model-visible and oracle
  details kept in optional drawers.

Start a stakeholder walkthrough with variant A and the
`Quick lunch · cross-sell accepted` scenario. The scenario is a replay from the
generated synthetic bundle, not a live production recommendation request.

## Question this prototype answers

Can a reviewer inspect one reproducible KFC ordering journey and understand:

1. which complete candidate set was eligible;
2. how a biased logging policy produced the displayed slate;
3. what the simulated customer selected or rejected;
4. how basket and checkout outcomes followed; and
5. how the hidden counterfactual oracle differs without leaking into
   model-visible features?
