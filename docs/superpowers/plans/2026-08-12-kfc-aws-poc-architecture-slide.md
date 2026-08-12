# KFC AWS POC Architecture Slide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace slide 12 with a presentation-readable, AWS solution-architect-quality diagram that faithfully represents only the approved KFC recommendation POC.

**Architecture:** Keep KFC channels and KFC-approved POC data outside one AWS Cloud boundary. Inside it, group the ten approved AWS services into Online Serving, Data and Model Preparation, and Observability zones; let actual AWS service behavior and a sequential relevance-to-business-ranking POC flow determine connector direction.

**Tech Stack:** Graphviz DOT, official AWS icon PNG assets, Google Slides API, Google Drive export, PDF raster inspection.

## Global Constraints

- POC scope only; do not add production-only networking, identity, encryption, resilience, or disaster-recovery components.
- Preserve the existing slide title, deck typography, margins, and adjacent slides.
- Keep the KFC channels node compact and outside the AWS boundary.
- Do not visually imitate Mermaid or treat its existing arrows as authoritative; update its semantics after the architecture is finalized so the documentation does not contradict the slide.
- Preserve unrelated dirty files and unresolved merge conflicts.
- Do not commit while the checkout has unresolved merge conflicts.

---

### Task 1: Recompose the architecture source

**Files:**
- Modify: `docs/recommendations/kfc-aws-poc-architecture.dot`
- Reference: `docs/recommendations/kfc-aws-poc-scope-executive.md:22`
- Reference: `docs/superpowers/specs/2026-08-12-kfc-aws-poc-architecture-slide-design.md`

**Interfaces:**
- Consumes: the ten approved AWS service nodes, official icon files under `docs/recommendations/assets/aws-icons`, and current official AWS service behavior.
- Produces: a valid Graphviz graph with `channels`, `poc_data`, `cluster_aws`, `cluster_online`, `cluster_data`, and `cluster_observability` visual regions.

- [ ] **Step 1: Record the semantic edge inventory**

Use this recommended POC inventory while editing:

```text
channels <-> api: request / response
api <-> lambda: invoke / response
lambda <-> dynamo: read/write menu and serving state
lambda <-> personalize: context and events / relevance candidates and scores
lambda <-> sagemaker: candidates and business context / final ranked list
lambda -> secrets: retrieve KFC API credentials
poc_data -> s3: land approved batch data
s3 <-> athena: query/transform raw and curated datasets
s3 -> personalize: historical dataset import
s3 -> sagemaker: training data and model artifacts
ecr -> sagemaker: custom inference image
api -> cloudwatch: metrics and logs
lambda -> cloudwatch: metrics and logs
personalize -> cloudwatch: metrics
sagemaker -> cloudwatch: endpoint metrics and logs
```

- [ ] **Step 2: Replace the flat card ranks with three solution-architecture zones**

Edit the DOT so the main visual hierarchy is:

```dot
subgraph cluster_aws {
  label="AWS Cloud — KFC recommendation POC";
  subgraph cluster_online { label="Online serving"; }
  subgraph cluster_data { label="Data and model preparation"; }
  subgraph cluster_observability { label="Observability"; }
}
```

Keep `channels` and `poc_data` outside `cluster_aws`; place API Gateway, Lambda, Personalize, SageMaker, DynamoDB, and Secrets Manager in `cluster_online`; S3, Athena, and ECR in `cluster_data`; and CloudWatch in `cluster_observability`.

- [ ] **Step 3: Apply the approved visual hierarchy**

Use KFC red for the request/response entry path, numbered dark-neutral connectors for online orchestration, green for data/model flows, purple for DynamoDB serving-state access, and dashed pink connectors from emitting services into CloudWatch. Prefer paired one-way arrows or clearly labeled bidirectional connectors where the request and response are both material.

- [ ] **Step 4: Validate and render the DOT**

Run:

```bash
mkdir -p .codex-kfc-aws-poc-architecture/render
dot -Tpng -Gdpi=180 docs/recommendations/kfc-aws-poc-architecture.dot \
  -o .codex-kfc-aws-poc-architecture/render/kfc-aws-poc-architecture.png
dot -Tsvg docs/recommendations/kfc-aws-poc-architecture.dot \
  -o .codex-kfc-aws-poc-architecture/render/kfc-aws-poc-architecture.svg
```

Expected: both outputs exist, Graphviz exits `0`, and the PNG preserves transparent background and readable labels.

### Task 2: Align the Markdown semantic reference

**Files:**
- Modify: `docs/recommendations/kfc-aws-poc-scope-executive.md:22`
- Inspect: `docs/recommendations/kfc-aws-poc-architecture.dot`

**Interfaces:**
- Consumes: the finalized Task 1 architecture semantics.
- Produces: a compact Mermaid block that describes the same service responsibilities and direction without dictating the slide layout.

- [ ] **Step 1: Update the Mermaid relationship semantics**

Update the Mermaid block to express the Task 1 inventory, including telemetry flowing into CloudWatch and Lambda retrieving secrets. Expected: the Markdown and slide no longer contradict each other.

- [ ] **Step 2: Confirm service inventory preservation**

Expected: the Markdown still contains exactly the approved ten AWS services and adds no production-only component.

### Task 3: Verify semantic and visual correctness

**Files:**
- Inspect: `.codex-kfc-aws-poc-architecture/render/kfc-aws-poc-architecture.png`
- Inspect: `docs/recommendations/kfc-aws-poc-architecture.dot`
- Reference: `docs/recommendations/kfc-aws-poc-scope-executive.md:22`

**Interfaces:**
- Consumes: Task 1 PNG and DOT plus Task 2 Markdown.
- Produces: an approved image ready for the native Google Slides image element `kfc_arch_graph`.

- [ ] **Step 1: Compare architecture semantics**

Check the recommended inventory from Task 1 against both DOT and the updated Mermaid. Expected: no contradictory edge direction or altered service responsibility.

- [ ] **Step 2: Inspect the PNG at original resolution**

Open the PNG with the image viewer. Expected: compact channel source, obvious red request path, clear zone hierarchy, no edge crossing through a node, no clipped icons, and no overlapping labels.

- [ ] **Step 3: Iterate only on verified visual defects**

If the render has a collision, adjust only `nodesep`, `ranksep`, cluster margins, invisible rank constraints, or the affected concise label, then rerun Task 1 Step 4 and Task 2 Steps 1-2.

### Task 4: Replace slide 12 in place

**Files:**
- Modify externally: Google Slides presentation `1JxRg3mRN6IKPsxVprpkW3SR8cx6bEo2A1LKo0nJu6Qk`, slide `g3f6cb3a2cda_0_3`
- Upload: `.codex-kfc-aws-poc-architecture/render/kfc-aws-poc-architecture.png`

**Interfaces:**
- Consumes: the verified Task 3 PNG.
- Produces: the updated native slide with the diagram image fully contained and undistorted.

- [ ] **Step 1: Read the live presentation and slide geometry**

Fetch the current presentation revision and slide 12 object state. Confirm the target image object is `kfc_arch_graph` and preserve the title, subtitle, and legend unless a concrete fit defect requires a local adjustment.

- [ ] **Step 2: Replace the image with aspect-ratio preservation**

Use the Google Slides image replacement operation with `CENTER_INSIDE` and the current revision ID. Do not independently distort width and height.

- [ ] **Step 3: Confirm the live element state**

Fetch slide 12 again. Expected: `kfc_arch_graph` references the new image and remains within the diagram frame below the subtitle and above the legend.

### Task 5: Validate the live deck

**Files:**
- Export externally: the live Google Slides deck as PDF
- Render locally: `.codex-kfc-aws-poc-architecture/live-render/`

**Interfaces:**
- Consumes: the updated live deck.
- Produces: high-resolution visual proof that slide 12 is correct in the actual presentation.

- [ ] **Step 1: Export and render all slides**

Use the Google Slides skill export-and-render helper at 180 DPI with a fresh output directory. Expected: 16 rendered pages mapped to 16 native slide IDs.

- [ ] **Step 2: Inspect slide 12 at full size**

Expected: no clipping, overlap, unintended wrapping, distorted icon, hidden title, or legend collision; the KFC channels node is subordinate to the AWS system.

- [ ] **Step 3: Verify adjacent-slide preservation**

Compare slides 11 and 13 in the fresh render with their pre-edit content. Expected: no changes.

- [ ] **Step 4: Report completion**

Provide the slide link, reusable DOT source path, the semantic edge audit result, and the live render QA result. State that unrelated conflicts and dirty files were preserved.
