---
title: KFC Vietnam Recommendation Shadow
emoji: 🍗
colorFrom: red
colorTo: yellow
sdk: docker
app_port: 7860
---

# KFC Vietnam recommendation shadow

This Docker Space serves the pinned public MLflow PyFunc at `/invocations`.
It is a protected technical shadow scorer only; customer-visible ordering
remains deterministic.

`model-binding.json` is generated for each publication and pins an immutable
Hugging Face model commit. The image exposes MLflow's `/health` and
`/invocations` routes on port 7860.
