# KFC Cinematic Playbook Storyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and validate a six-slide KFC-cinematic storyboard whose content follows the AABW Pitching Playbook without copying the playbook's workshop styling.

**Architecture:** Use the existing cinematic KFC storyboard and its raster assets as the sole visual reference. Create a separate plain JavaScript `@oai/artifact-tool` builder in external scratch, export a distinct PPTX and six-slide preview into the Wayfinder assets folder, then verify rendered layout and claim boundaries before updating the open storyboard ticket.

**Tech Stack:** JavaScript ES modules, `@oai/artifact-tool`, bundled Node.js, bundled LibreOffice/Poppler presentation tools, Python-based presentation QA utilities only for rendering and inspection.

## Global Constraints

- Retain KFC red, near-black, and warm white with large cinematic typography and strong contrast.
- The playbook governs information architecture and pacing; it does not become the visual template.
- Build only the six main slides in this revision.
- Preserve the rejected cinematic prototype and the flat playbook-first prototype for comparison.
- Do not create or modify final Google Slides.
- Slide 3 must visibly communicate `GOAL -> PLAN -> TOOLS -> ACT -> VERIFY`.
- Slide 5 must contain exactly nine distinct representative scenarios and no `39 use cases`, `9/9`, or pass-rate language.
- All visible slide copy is English; Vietnamese remains reserved for customer messages during the live demo.
- Do not add measured revenue, conversion, latency, production-readiness, or production OMS/POS claims.
- Final delivery requires full-size inspection of all six rendered slides and a passing overflow test.

---

## File Structure

- Create: `/var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook/tmp/build-cinematic-playbook.mjs` - source builder for the revised six-slide prototype.
- Create: `/var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook/tmp/source-notes.txt` - communication job and source/provenance record.
- Create: `docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-storyboard-prototype.pptx` - editable review candidate.
- Create: `docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-main-story-preview.png` - six-slide approval preview.
- Modify: `docs/wayfinder/kfc-commerce-agent-demo-pitch/issues/04-prototype-cinematic-kfc-storyboard.md` - record the new candidate and QA state while leaving the HITL ticket open.

### Task 1: Build the six-slide cinematic review candidate

**Files:**
- Create: `/var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook/tmp/build-cinematic-playbook.mjs`
- Create: `/var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook/tmp/source-notes.txt`
- Create: `docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-storyboard-prototype.pptx`

**Interfaces:**
- Consumes: the visual language and assets from `/var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-storyboard/tmp/` and the approved design in `docs/superpowers/specs/2026-07-11-kfc-playbook-aligned-cinematic-storyboard-design.md`.
- Produces: an editable six-slide PPTX and slide-level PNG/layout exports under the new scratch workspace.

- [ ] **Step 1: Initialize the isolated artifact-tool scratch workspace**

Run:

```bash
WORK=/var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook
NODE=/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
SKILL=/Users/vietthangvunguyen/.codex/plugins/cache/openai-primary-runtime/presentations/26.709.11516/skills/presentations
mkdir -p "$WORK/tmp/assets" "$WORK/tmp/preview"
"$NODE" "$SKILL/container_tools/setup_artifact_tool_workspace.mjs" --workspace "$WORK/tmp"
cp /var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-storyboard/tmp/assets/hero.png "$WORK/tmp/assets/"
cp /var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-storyboard/tmp/assets/combo-crop.png "$WORK/tmp/assets/"
cp /var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-storyboard/tmp/assets/order-confirmed.png "$WORK/tmp/assets/"
```

Expected: the scratch workspace resolves `@oai/artifact-tool` and contains the three approved visual-reference assets.

- [ ] **Step 2: Write the source record**

Create `source-notes.txt` with this exact content:

```text
Communication job: By the end, AABW judges should choose Team Braise because KFC Commerce Agent visibly turns natural conversation into a customer-approved, verified order and supports that promise with honest product evidence.

Content source: /Users/vietthangvunguyen/Downloads/AABW_Pitching_Playbook.pdf
Design decision: docs/superpowers/specs/2026-07-11-kfc-playbook-aligned-cinematic-storyboard-design.md
Visual reference: docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-storyboard-prototype.pptx
Claim boundary: nine representative scenarios, not 9/9, a pass rate, a pilot result, or measured business impact.
```

- [ ] **Step 3: Implement the builder with the approved visual system**

Create a plain `.mjs` builder importing:

```javascript
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";
```

Use a `1280 x 720` canvas and this exact palette:

```javascript
const C = {
  red: "#E4002B",
  black: "#0B0B0D",
  warm: "#F7F2E8",
  white: "#FFFFFF",
  gray: "#B8B2A8",
  darkGray: "#27272A",
  paleRed: "#FBE8EC",
  green: "#2DA66E",
};
```

Reuse the existing builder's `writeBlob`, `bytes`, `rect`, `text`, `footer`, `slideBase`, and `addImage` helpers. Use the same Arial typography, red footer marker, 62pt deck title, 46-52pt slide titles, 19-26pt supporting text, and at least 16pt body copy.

Implement these exact audience-facing slide jobs and copy:

1. **Hero / promise:** `TEAM BRAISE`, `KFC Commerce Agent`, `From conversation to confirmed order`, `A natural conversation becomes a customer-approved, verified order.`, `THANG / PRESENTER`. Use `hero.png` full bleed with a near-black left overlay.
2. **Problem insight:** title `Customers are trying to complete an order—not receive an answer.` Establish the customer and goal in one line: `A KFC customer ordering in chat wants the right meal completed.` Establish friction/root cause in a large central statement: `Intent changes across menu, cart, delivery, and payment. Chat context and commerce state drift apart.` Use the KFC evidence line: `KFC stakeholders prioritize sensible combo suggestions, size changes, and order modification.`
3. **Agent behavior:** title `The agent turns intent into verified commerce action`. Show the five visible stages `GOAL`, `PLAN`, `TOOLS`, `ACT`, `VERIFY` with these descriptions: `Party size, budget, delivery need`; `Next missing decision and safe step`; `Catalog, cart, availability, fulfillment, order`; `Recommend and execute approved changes`; `Price, consent, fulfillment, order state`. Pair the sequence with `combo-crop.png` and the line `No irreversible action before explicit confirmation.`
4. **Customer value:** title `It improves the basket without taking control away`. Use the dominant commercial sequence `Loose items -> Better-fit combo -> Relevant size suggestion -> Customer-approved order`. Use supporting credibility copy: `Validation prevents silent invalid state. Operator recovery preserves context when an exception needs a person.`
5. **Evidence:** title `Nine representative customer outcomes`. Show exactly these nine labels grouped across Ordering, Fulfillment, Payment, and Recovery: `01 Clear order + confirmation`; `02 Combo recommendation + upsell`; `06 Natural-language safety`; `07 Personalization + loyalty`; `03 Inventory + address + store`; `08 Payment failure + anomaly`; `09 Payment method`; `04 Post-order support`; `05 Complaint + human handoff`. Add `What it proves: workflow breadth and outcome coverage.` and `Target impact: more conversations completed as orders.`
6. **Demo / close:** title `One minute: loose items to confirmed order`. Show the storyline `GOAL -> TRIGGER -> AGENT ACTS -> OUTCOME -> PROOF` with `Meal for four within budget`; `Natural Vietnamese request`; `Combo and size suggestion, approved cart update, fulfillment`; `Explicit customer confirmation`; `Order ID and verified state`. Pair with `order-confirmed.png`. Close with `Choose Team Braise to turn KFC conversations into completed orders.`

Export each slide as PNG and layout JSON into `tmp/preview`, then export the PPTX to:

```javascript
const FINAL = "/Users/vietthangvunguyen/Workspace/hackathon/docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-storyboard-prototype.pptx";
```

- [ ] **Step 4: Execute the builder**

Run:

```bash
NODE=/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
TMP=/var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook/tmp
"$NODE" "$TMP/build-cinematic-playbook.mjs"
```

Expected: the command exits `0`, exports exactly six slide PNGs, and creates `kfc-cinematic-playbook-storyboard-prototype.pptx`.

- [ ] **Step 5: Commit only the new implementation-plan artifact if a commit checkpoint is needed**

Do not commit generated pitch assets until the user approves the review candidate. Preserve the shared dirty worktree and do not stage unrelated files.

### Task 2: Render and verify the candidate

**Files:**
- Create: `docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-main-story-preview.png`
- Test: `docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-storyboard-prototype.pptx`

**Interfaces:**
- Consumes: the six-slide PPTX from Task 1.
- Produces: a rendered montage plus a QA record proving slide count, scenario count, workflow stages, claim exclusions, and slide-boundary integrity.

- [ ] **Step 1: Render all six slides and create the review montage**

Run:

```bash
PPTX=/Users/vietthangvunguyen/Workspace/hackathon/docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-storyboard-prototype.pptx
SKILL=/Users/vietthangvunguyen/.codex/plugins/cache/openai-primary-runtime/presentations/26.709.11516/skills/presentations
PY=/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
PATH=/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override:/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH
"$PY" "$SKILL/container_tools/render_slides.py" "$PPTX"
"$PY" "$SKILL/container_tools/create_montage.py" --input_dir "${PPTX%.pptx}" --output_file /Users/vietthangvunguyen/Workspace/hackathon/docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-main-story-preview.png --label_mode filename
```

Expected: six rendered PNGs and one labelled montage.

- [ ] **Step 2: Run slide-boundary QA**

Run:

```bash
PPTX=/Users/vietthangvunguyen/Workspace/hackathon/docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-storyboard-prototype.pptx
SKILL=/Users/vietthangvunguyen/.codex/plugins/cache/openai-primary-runtime/presentations/26.709.11516/skills/presentations
PY=/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
"$PY" "$SKILL/container_tools/slides_test.py" "$PPTX"
```

Expected: `Test passed. No overflow detected.`

- [ ] **Step 3: Verify content and claim boundaries programmatically**

Parse `ppt/slides/slide*.xml` from the PPTX and assert:

```text
slide_count == 6
slide_3 contains GOAL, PLAN, TOOLS, ACT, VERIFY
slide_5 contains all nine approved scenario labels exactly once
full_deck does not contain "39 use cases"
full_deck does not contain "9/9"
full_deck does not contain "pass rate"
```

Expected: all assertions pass.

- [ ] **Step 4: Inspect every slide individually at full size**

Open `slide-1.png` through `slide-6.png` with the image viewer. Confirm:

- one-line titles do not wrap;
- body copy remains at least 16pt and readable;
- screenshots are legible and not cropped through critical state;
- arrows and stage labels do not cross text;
- Slide 5's nine scenarios remain visibly distinct;
- Slide 6 clearly ends on order proof and the closing ask.

If an issue is found, edit `build-cinematic-playbook.mjs`, rerun Task 1 Step 4, and repeat all of Task 2.

### Task 3: Record the Wayfinder review candidate

**Files:**
- Modify: `docs/wayfinder/kfc-commerce-agent-demo-pitch/issues/04-prototype-cinematic-kfc-storyboard.md`

**Interfaces:**
- Consumes: the QA-passed PPTX and montage from Task 2.
- Produces: an open HITL ticket pointing to the correct candidate and explaining what changed.

- [ ] **Step 1: Add the cinematic playbook-content candidate to the ticket**

Append a section titled `## Cinematic playbook-content review candidate` containing:

```markdown
This revision keeps the approved cinematic KFC visual language while using the AABW playbook only for content hierarchy and pacing. It replaces the flat workshop-style candidate and remains a six-slide main-story prototype.

- [Editable cinematic playbook-content prototype](../assets/kfc-cinematic-playbook-storyboard-prototype.pptx)
- [Six-slide cinematic preview](../assets/kfc-cinematic-playbook-main-story-preview.png)

Rendered QA passed with no detected overflow. Slide 3 visibly includes goal, plan, tools, act, and verify. Slide 5 contains exactly nine representative customer-outcome scenarios and no `39 use cases`, `9/9`, or pass-rate language. No final Google Slides deck was created or modified.
```

- [ ] **Step 2: Preserve the HITL approval gate**

Keep the ticket status `open`. Do not add the ticket to `Decisions so far` and do not remove it from the map frontier until the user approves the rendered candidate.

- [ ] **Step 3: Verify the scoped diff**

Run:

```bash
git status --short -- docs/wayfinder/kfc-commerce-agent-demo-pitch docs/superpowers
git diff --check -- docs/wayfinder/kfc-commerce-agent-demo-pitch/issues/04-prototype-cinematic-kfc-storyboard.md
```

Expected: only the intended storyboard assets, ticket update, approved design, and implementation plan appear within this pitch scope; `git diff --check` reports no whitespace errors.

- [ ] **Step 4: Present the approval artifact**

Show the six-slide montage and provide one link to the editable PPTX. State that the KFC style was retained, content now follows the playbook, QA passed, and final Google Slides remain untouched. Stop at the Wayfinder approval gate.
