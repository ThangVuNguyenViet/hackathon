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

## Question this prototype answers

Can a reviewer inspect one reproducible KFC ordering journey and understand:

1. which complete candidate set was eligible;
2. how a biased logging policy produced the displayed slate;
3. what the simulated customer selected or rejected;
4. how basket and checkout outcomes followed; and
5. how the hidden counterfactual oracle differs without leaking into
   model-visible features?
