# KFC GenUI LangSmith Evaluation Design

## Goal

Make live GenUI behavior inspectable and comparable in LangSmith while keeping Flutter visual proof and deterministic backend state as separate sources of evidence. Repair the live-monitor takeover controls so their hover and focus behavior remains usable and testable.

## Takeover Card

`SessionCard` keeps takeover actions hidden until hover or keyboard focus. The action overlay must occupy the card's foreground layer, expose no semantics or pointer target while hidden, and become hit-testable after hover or focus. The overlay must not overlap the status text at compact grid sizes.

Focused widget tests cover hidden, hovered, focused, and compact-card states. This work remains separate from GenUI evaluator logic.

## LangSmith GenUI Evaluation

The existing Flutter integration runner remains the only live screenshot replay engine. After it writes `manifest.json`, a new evaluator converts the manifest and capture plan into scenario results.

Each scenario result contains:

- scenario ID and use-case IDs;
- expected and observed widget kinds by customer turn;
- required lifecycle widgets and observed lifecycle widgets;
- missing screenshots and artifact paths;
- deterministic scores for widget correctness, lifecycle coverage, screenshot completeness, forbidden handoff, and concise GenUI responses;
- the source commit and live model configuration.

When `LANGSMITH_API_KEY` is configured, the exporter creates one root `RunTree` per proof run and one child run per scenario. Tags identify the scenario, use cases, commit, and evaluation schema. Local JSON remains available when LangSmith is not configured.

LangSmith is observability and evaluation evidence. It does not replace the backend store, the integration manifest, or Flutter screenshots.

## Dataset

The nine conversation scripts and `genui-scenario-capture-plan.json` define the versioned dataset. Dataset examples are keyed by scenario ID and schema version. Seeding is idempotent and does not duplicate existing examples.

## Commands

- `npm run eval:genui -- --manifest <path>` evaluates an existing proof manifest.
- `npm run eval:genui:seed` seeds or updates the LangSmith dataset.
- `npm run test:live:genui:integration` continues to produce the live Flutter proof.
- `npm run eval:context:experiment` runs the seeded context dataset through LangSmith's native `evaluate()` API. It defaults to deterministic mode; pass `--mode live` to use the OpenAI-backed evaluator.

## Acceptance

- takeover-card widget tests pass at desktop and compact sizes;
- evaluator unit tests cover pass, wrong widget, missing lifecycle widget, missing screenshot, and forbidden handoff cases;
- the latest nine-scenario manifest evaluates successfully;
- the context evaluation emits a native LangSmith experiment when credentials and the seeded dataset are available;
- GenUI evaluation continues to emit RunTree root and scenario runs until a dataset-to-live-replay adapter exists;
- all ordinary backend and customer-chat Flutter tests remain green.
