# Free-software delegation options for the recommendation simulator POC

**Research date:** 2026-07-24

**Decision supported:** Identify commodity parts of the accepted KFC synthetic-behavioral-world prototype that should be delegated to maintained, genuinely free local software.

**Source policy:** Only official documentation, official repositories, release pages, and first-party papers were used. “Open source” below means the local software has a recognized permissive open-source license; a vendor's hosted service is treated separately. License notes are factual observations, not legal advice.

## Recommendation

Change the accepted UI decision from a hand-built ANSI/TUI inspector to a **local Streamlit app**. Keep the deterministic `generate` and `audit` CLIs as the source of truth and make Streamlit a thin reader/controller over the same Python functions.

Adopt no general recommender simulator or synthetic-tabular generator as the behavioral-world core. The difficult behavior is KFC-specific: four placements with different policies, eligibility evidence, journey-local latent preferences, basket mutations, an outside option, slate interference, exact logging propensities, common random draws, potential outcomes, drift, typed event chains, and physically separate oracle data. Existing libraries either do not own those requirements or impose a much larger research stack.

Use the following staged stack:

1. **Now:** Streamlit + the already accepted NumPy, Pydantic, `jsonschema`, and PyArrow stack.
2. **Optional smoke-bundle audit:** add `choice-learn` only if coefficient/effect recovery needs an independent richer choice-model check; use `statsmodels` instead for a narrower conditional-logit check with less modeling machinery.
3. **Benchmark phase:** add local MLflow when multiple simulator/model runs need comparison; consider Evidently OSS for generic drift and standard recommendation metrics.
4. **Bandit qualification:** keep the already selected Vowpal Wabbit path. Evaluate `sb-obp` in an isolated compatibility spike if slate OPE beyond the accepted IPS/DR check is needed.
5. **Only when large bundles must be shared:** add DVC. Do not introduce a data-lake service for a local POC.

This delegates UI widgets, run comparison, physical table serialization, and standard statistical reports without delegating the product's causal and eligibility contract.

## Build-versus-adopt matrix

| Capability | Candidate software | Verified status | Fit to the accepted POC | Decision |
|---|---|---|---|---|
| Interactive simulator explorer | **Streamlit** | Apache-2.0; active, with v1.60.0 released 2026-07-21. Streamlit is free local software; Community Cloud is a separate hosted service. [Repository](https://github.com/streamlit/streamlit), [release](https://github.com/streamlit/streamlit/releases/tag/1.60.0), [dataframe selections](https://docs.streamlit.io/develop/api-reference/data/st.dataframe), [Community Cloud](https://docs.streamlit.io/deploy/streamlit-community-cloud) | Directly supplies controls, row-selectable tables, charts, session state, and a browser UI for journey → placement → slate → outcome navigation, oracle toggling, replay, and regeneration. | **Adopt now.** Replace the custom ANSI/TUI view, not the CLI or simulator engine. |
| ML/model demo UI | Gradio | Apache-2.0; active, with 6.20.0 released 2026-07-07. Local execution is independent of hosted Hugging Face Spaces and share links. [Repository](https://github.com/gradio-app/gradio), [release](https://github.com/gradio-app/gradio/releases/tag/gradio%406.20.0), [sharing boundaries](https://www.gradio.app/guides/sharing-your-app/) | Excellent for request/response and chatbot demos, but less natural than Streamlit for dense multi-table run inspection and causal diagnostics. | **Do not combine UI frameworks.** Reconsider Gradio only for a standalone model endpoint demo. |
| Terminal UI | Textual | MIT; active, with v8.2.8 released 2026-06-30. [Repository](https://github.com/Textualize/textual), [release](https://github.com/Textualize/textual/releases/tag/v8.2.8), [documentation](https://textual.textualize.io/) | Avoids raw ANSI and supports sophisticated terminal applications, but still requires event, layout, and navigation code and is less reviewable than a browser data app. | **Do not adopt** unless terminal-only operation becomes a firm requirement. |
| Reactive research notebook/app | marimo | Apache-2.0; active, with 0.23.15 released 2026-07-23. [Repository](https://github.com/marimo-team/marimo), [release](https://github.com/marimo-team/marimo/releases/tag/0.23.15), [documentation](https://docs.marimo.io/) | Strong for Git-friendly reactive analysis of assumptions and plots; weaker than Streamlit as the canonical multi-view demo/inspection surface. | **Optional analysis notebook, not a second UI.** |
| Rich linked dashboard | Panel | BSD-3-Clause; active, with v1.9.3 released 2026-06-01. [Repository](https://github.com/holoviz/panel), [release](https://github.com/holoviz/panel/releases/tag/v1.9.3), [Tabulator widget](https://panel.holoviz.org/reference/widgets/Tabulator.html) | Powerful linked PyData dashboards, but more concepts and dependencies than this local POC needs. | **Do not adopt initially.** |
| KFC structural causal world | NumPy + domain code | NumPy is BSD-3-Clause and actively maintained. [Repository](https://github.com/numpy/numpy) | The accepted world is authored ground truth, not a distribution learned from customer data. Small explicit functions make every planted effect, random draw, and transition inspectable. | **Build and own.** This is domain logic, not commodity plumbing. |
| General recommender simulation | RecSim NG | Apache-2.0, but the official repository was archived read-only on 2026-04-19. It is an unsupported TensorFlow/Edward2 probabilistic simulator. [Repository and archive notice](https://github.com/google-research/recsim_ng) | Conceptually relevant for probabilistic entities, behaviors, stories, sequential state, and uncertainty. It still requires custom four-placement semantics, eligibility, propensities, oracle artifacts, and event contracts, while adding an archived TensorFlow stack. | **Reference concepts only; do not depend on it.** |
| General recommender simulation | SARDINE | MIT research code; the official repository has only three commits and no published releases. It exposes Gymnasium environments for single-item and slate recommendation. [Official repository](https://github.com/naver/sardine), [paper](https://arxiv.org/abs/2311.16586) | Covers sessions, slates, click uncertainty, influence/boredom, and some examination bias. It does not provide the accepted exact slate/logging propensities, KFC placements, common-draw potential outcomes, or eligibility/evidence contracts. | **Reference environments only; do not make it the core.** |
| Standard environment API | Gymnasium | MIT; actively maintained successor to OpenAI Gym. [Repository](https://github.com/Farama-Foundation/Gymnasium), [API](https://gymnasium.farama.org/api/env/) | A standard `reset`/`step` boundary could make later RL experiments easier, but the first generator/auditor does not require an environment abstraction. | **Optional thin adapter later.** Do not make the artifact generator depend on it. |
| Plackett–Luce sampling | `choix` | MIT; v0.4.1 released in 2025, with low current development cadence. It supports Luce/Plackett–Luce probabilities, ranking generation, and fitting. [Official API](https://choix.lum.li/en/latest/api.html), [data forms](https://choix.lum.li/en/latest/data.html), [release](https://github.com/lucasmaystre/choix/releases/tag/v0.4.1) | Its generator uses static item parameters and uniformly sampled subsets. It does not own contextual utilities, outside-option journeys, slate interference, basket state, or common random draws. The accepted Gumbel/Plackett–Luce draw is small and must expose its components. | **Do not add to the core.** It can be a tiny independent reference check. |
| Discrete-choice recovery audit | `choice-learn` | MIT; active, with v1.3.3 released 2026-05-28. [Documentation and license](https://artefactory.github.io/choice-learn/), [ChoiceDataset](https://artefactory.github.io/choice-learn/references/data/references_choice_dataset/), [release](https://github.com/artefactory/choice-learn/releases/tag/v1.3.3) | Supports request-shared and item-varying features, item availability, exit choice, multinomial/conditional/nested/latent-class models. It can independently test whether planted coefficients are recoverable, but TensorFlow is required and it does not generate the behavioral world. | **Optional development/audit extra after the smoke bundle.** |
| Narrow choice recovery audit | `statsmodels` `ConditionalLogit` | BSD-3-Clause; actively maintained. [Repository](https://github.com/statsmodels/statsmodels), [official `ConditionalLogit` API](https://www.statsmodels.org/stable/generated/statsmodels.discrete.conditional_models.ConditionalLogit.html) | Can fit a grouped binary conditional likelihood over long candidate rows. It cannot model the full repeated slate journey, and group-constant context needs candidate interactions. | **Optional lighter audit alternative** to `choice-learn`, not a simulator dependency. |
| Synthetic tabular generation | Synthcity | Apache-2.0; latest release v0.2.12 was 2025-05-08, with later repository activity. It learns privacy/fairness/augmentation generators from observed data. [Repository](https://github.com/vanderschaarlab/synthcity), [documentation](https://synthcity.readthedocs.io/) | Wrong problem: there is no real customer-behavior table to imitate, and learned synthetic rows would obscure rather than expose planted causal truth and propensities. | **Do not adopt.** |
| Synthetic tabular generation | SDV Community | Active, but distributed under Business Source License 1.1 rather than an open-source license. [Official license statement](https://docs.sdv.dev/SDV/explore), [repository](https://github.com/sdv-dev/SDV) | Also learns tabular/multi-table/sequential distributions from real data and cannot guarantee the accepted causal mechanisms. | **Reject:** not genuinely OSS and not the right abstraction. |
| Causal graphical modeling | DoWhy GCM | MIT; actively maintained. Its GCM surface can define structural causal models, draw samples, and perform interventions/counterfactuals, but the documentation describes this API as experimental. [Repository](https://github.com/py-why/dowhy), [GCM introduction](https://www.pywhy.org/dowhy/main/user_guide/gcm_based_inference/introduction.html), [sampling](https://www.pywhy.org/dowhy/v0.13/user_guide/modeling_gcm/draw_samples.html) | Closest conceptual library, but set-valued slates, position examination, exact logging probabilities, common-draw artifacts, and basket transitions remain custom. | **Defer to an optional causal-refutation notebook.** Do not put the experimental API in the generator core. |
| Config/manifest validation | Pydantic + `jsonschema` | Both MIT and actively maintained. Pydantic generates Draft 2020-12 JSON Schema; `jsonschema` independently validates instances. [Pydantic JSON Schema](https://docs.pydantic.dev/latest/concepts/json_schema/), [`jsonschema` repository](https://github.com/python-jsonschema/jsonschema) | Exactly matches the accepted immutable world/config manifests and committed versioned schemas. | **Adopt now** as already decided. Keep committed schemas as cross-language authority. |
| Parquet schema and physical validation | PyArrow | Apache-2.0 and actively maintained. It owns Arrow schemas, Parquet I/O, and full table validation. [Schema](https://arrow.apache.org/docs/python/generated/pyarrow.Schema.html), [Table validation](https://arrow.apache.org/docs/python/generated/pyarrow.Table.html), [Parquet](https://arrow.apache.org/docs/python/parquet.html) | Fits the accepted no-pandas artifact contract. It validates physical types/nullability; the audit command still owns cross-table/event/propensity/leakage invariants. | **Adopt now** as already decided. |
| Dataframe validation | Pandera | MIT; active, with v0.32.1 released 2026-06-29. [Documentation](https://pandera.readthedocs.io/en/stable/), [releases](https://github.com/unionai-oss/pandera/releases) | Strong when pandas, Polars, or another supported dataframe backend is already authoritative. Raw `pyarrow.Table` is not the natural target, so it would add a second dataframe representation. | **Defer.** Reconsider only if the benchmark standardizes on pandas/Polars. |
| Data quality suite/report | GX Core | Apache-2.0; active under Fivetran stewardship, with v1.19.0 released 2026-07-13. [Core overview](https://docs.greatexpectations.io/docs/core/introduction/gx_overview/), [release](https://github.com/fivetran/great_expectations/releases/tag/1.19.0), [stewardship update](https://greatexpectations.io/blog/an-update-from-great-expectations/) | Expectations and Data Docs could replace generic report plumbing, but Data Context/Suite/Checkpoint machinery is excessive for one local bundle and still cannot validate domain event chains or oracle leakage by itself. | **Do not add now.** |
| Generic drift/RecSys reports | Evidently OSS | Apache-2.0; active, with v0.7.21 released 2026-03-10. The hosted Evidently service is separate from the local library. [Repository](https://github.com/evidentlyai/evidently), [release](https://github.com/evidentlyai/evidently/releases/tag/v0.7.21), [recommendation metrics](https://docs.evidentlyai.com/metrics/explainer_recsys), [local reports](https://docs.evidentlyai.com/quickstart_ml) | Can delegate generic distribution/drift reports and standard NDCG/MAP/MRR/Hit Rate/diversity/novelty/popularity-bias metrics. It cannot prove planted effects, propensity correctness, replay identity, or oracle isolation. | **Optional in benchmark phase.** Use only for the generic portion of reports. |
| Experiment tracking | MLflow | Apache-2.0 and actively released. It supports fully local tracking with SQLite and local artifacts; hosted Databricks/cloud products are separate. [Self-hosting](https://mlflow.org/docs/latest/self-hosting/index.html), [architecture](https://mlflow.org/docs/latest/self-hosting/architecture/overview/), [releases](https://github.com/mlflow/mlflow/releases) | Natural home for seed/config/input hashes, metrics, reports, and artifacts once many generator/model runs exist. It is unnecessary for inspecting one smoke bundle. | **Adopt in benchmark phase**, not in the first simulator slice. |
| Artifact/data versioning | DVC | Apache-2.0; active, with v3.67.1 released 2026-03-31. DVC stores hashes/metadata with Git while data lives in a local cache or configured remote. [Repository](https://github.com/iterative/dvc), [version retrieval](https://dvc.org/doc/command-reference/get) | Useful once benchmark Parquet bundles must be shared or retrieved by revision. The accepted ignored artifact directory, manifest hashes, and one committed smoke bundle are simpler today. | **Defer until sharing is real.** |
| Data-lake versioning | lakeFS | Apache-2.0; active. Local OSS and paid/enterprise offerings are distinct. [Repository](https://github.com/treeverse/lakeFS), [quickstart](https://docs.lakefs.io/v1.79/quickstart/launch/), [product boundaries](https://lakefs.io/pricing/) | Adds a server and storage control plane intended for data-lake branching. That is unrelated to a local 1K/25K/250K-journey POC. | **Do not adopt.** |
| Contextual/slate off-policy evaluation | `sb-obp` | Apache-2.0; a community modernization of OBP with source activity in 2025 but no tagged releases. It includes slate IIPS/RIPS/Cascade-DR and distinguishes joint, per-position marginal, and cascade propensities. [Official repository](https://github.com/sb-ai-lab/sb-obp) | Best current candidate for an independent slate-OPE check. Modest maintenance, a heavy dependency surface, and dynamic KFC eligibility still require a pinned compatibility proof. | **Dev-only adapter spike later.** Do not make the first bundle depend on it. |
| Original contextual/slate OPE | Open Bandit Pipeline (OBP) | Apache-2.0. It implements IPW/SNIPW/DR and slate IIPS/RIPS/Cascade-DR, but its latest official release remains 0.5.5 from 2022 and the published package targets older Python versions. [Official repository and estimator list](https://github.com/st-tech/zr-obp) | Excellent estimator/formulation reference, but not a suitable new core dependency for the pinned modern simulator environment. | **Reference only; prefer the isolated `sb-obp` spike.** |
| Sequential RL off-policy evaluation | SCOPE-RL | Apache-2.0; latest official release v0.2.1 was 2023. It provides trajectory-wise and marginal OPE plus confidence intervals. [Repository](https://github.com/hakuhodo-technologies/scope-rl), [OPE API](https://scope-rl.readthedocs.io/en/stable/documentation/_autosummary/scope_rl.ope.ope.html) | Appropriate if the project later evaluates genuinely sequential RL policies over full journeys. It brings a much larger offline-RL dependency surface than the accepted simulated contextual-bandit experiment. | **Do not adopt now.** |
| Contextual-bandit learning/OPE | Vowpal Wabbit | BSD-3-Clause and actively maintained; already selected in the model-framework decision. Its ADF format carries changing actions and logged probabilities, and official material covers IPS/DM/DR. [Contextual-bandit tutorial](https://vowpalwabbit.org/docs/vowpal_wabbit/python/latest/tutorials/python_Contextual_bandits_and_Vowpal_Wabbit.html), [OPE tutorial](https://vowpalwabbit.org/docs/vowpal_wabbit/python/latest/tutorials/off_policy_evaluation.html), [repository](https://github.com/VowpalWabbit/vowpal_wabbit) | Matches the accepted separate simulated-bandit branch. Simulator-known truth remains the calibration target; do not present this as live uplift evidence. | **Keep the accepted selection.** No additional OPE framework is required for the first qualification. |

## Revised prototype shape

The simulator package remains a sibling service, but the operating surface becomes:

```text
services/kfc-recommendation-simulator/
├── src/...                 # world, traffic, policies, choice, outcomes, artifacts
├── schemas/...             # committed JSON Schemas and Arrow schema declarations
├── app.py                  # thin Streamlit explorer; no domain decisions
├── smoke-bundle/...        # compact reviewed evidence
└── pyproject.toml          # uv-managed, pinned dependencies
```

Recommended commands:

```text
uv run kfc-rec-sim generate --preset <smoke|demo|benchmark>
uv run kfc-rec-sim audit <bundle>
uv run streamlit run app.py -- --bundle <bundle>
```

The Streamlit app should call/read the same public simulator and artifact APIs as the CLI. It should not duplicate utility calculations, eligibility, state transitions, or audit logic. Its responsibilities are limited to:

- select a journey, placement, policy, slate, and outcome;
- show basket/event timelines and candidate/utility component tables;
- filter and chart distributions and planted effects;
- toggle a conspicuously separated oracle reader;
- replay the current immutable seeds;
- invoke a new generation through the same generator API.

The CLI remains usable without Streamlit, and generated artifacts remain valid without MLflow, DVC, Evidently, or any hosted account.

## What must remain KFC-owned

No reviewed free library removes the need to own these contracts:

- canonical product/modifier identity and eligibility evidence;
- four placement semantics and the CMS override/control boundary;
- journey-local latent mission/preferences with no stable customer identity;
- decomposable contextual utility and bounded nonlinear effects;
- exact position-examination and logging-policy/slate propensities;
- complement/substitute and slate redundancy/diversity effects;
- selection, rejection, mutation failure, later removal, checkout, and abandonment transitions;
- deterministic common random draws and potential outcomes for every eligible action;
- world/traffic/policy/outcome seeds and byte-replay hashes;
- physical model-visible/oracle separation and explicit reader boundaries;
- cross-table foreign keys, event-chain invariants, leakage allowlists, and typed rejection evidence;
- KFC-specific planted-effect and causal-recovery acceptance criteria.

These are the POC's explanatory value. Replacing them with a generic generator would make the output easier to produce but harder to trust.

## Hosted-cost boundary

The recommended first slice requires no hosted paid service:

- Streamlit runs locally; Community Cloud is optional.
- Pydantic, `jsonschema`, NumPy, and PyArrow run locally.
- MLflow can use local SQLite and local artifact storage later.
- Evidently OSS runs locally; its hosted product is optional.
- DVC can use a local cache and is not needed until sharing exists.

Do not select a hosted tier merely because the OSS project markets one. If external sharing becomes a requirement, evaluate that deployment decision separately from the simulator's implementation.

## Final decision

**Delegate now:** interactive UI to Streamlit; schema/Parquet mechanics to Pydantic + `jsonschema` + PyArrow.

**Delegate selectively later:** independent choice recovery to `choice-learn` or `statsmodels`; generic reports to Evidently; run comparison to MLflow; large artifact sharing to DVC; optional slate-OPE checks to `sb-obp` after a compatibility spike.

**Keep custom:** the KFC structural causal world, eligibility and event contracts, exact propensities/potential outcomes, deterministic replay, and oracle/leakage boundary.

**Reject for the core:** RecSim NG, SARDINE, SDV, Synthcity, DoWhy GCM, GX Core, lakeFS, SCOPE-RL, and multiple competing UI frameworks.
