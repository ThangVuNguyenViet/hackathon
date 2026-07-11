# KFC Pitch Content Realignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revise the six-slide cinematic KFC prototype so Slides 1–5 explain the broad commerce-agent product and only Slide 6 centers the combo-and-size demo scenario.

**Architecture:** Modify the existing external-scratch `@oai/artifact-tool` builder without changing its approved KFC visual system. Regenerate the distinct storyboard PPTX and preview in place, verify the detailed AABW slide requirements and claim boundaries, then update the open Wayfinder ticket with the revised QA state.

**Tech Stack:** JavaScript ES modules, `@oai/artifact-tool`, bundled Node.js, bundled presentation renderers, Python presentation utilities for verification only.

## Global Constraints

- Preserve KFC red, near-black, warm white, cinematic typography, and current visual pacing.
- Preserve the six-slide main-deck structure.
- Slides 1–4 must not be framed around combo conversion or size upgrade.
- Slide 5 may mention combo recommendation only as one of nine representative scenarios.
- Slide 6 is the only slide where the combo-and-size scenario takes center stage.
- Do not create or modify final Google Slides.
- Keep exactly nine representative scenarios with no `39 use cases`, `9/9`, or pass-rate language.
- All visible slide copy is English; Vietnamese appears only inside product captures or live-demo customer messages.
- Run full-slide rendered inspection and overflow QA before presenting the candidate.

---

### Task 1: Realign the six-slide content

**Files:**
- Modify: `/var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook/tmp/build-cinematic-playbook.mjs`
- Modify: `docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-storyboard-prototype.pptx`

**Interfaces:**
- Consumes: the approved exact copy in `docs/superpowers/specs/2026-07-11-kfc-playbook-aligned-cinematic-storyboard-design.md` and the existing cinematic builder.
- Produces: the regenerated six-slide PPTX plus slide PNG/layout exports in the existing scratch preview directory.

- [ ] **Step 1: Replace Slide 1 copy while preserving its hero composition**

Use these exact audience-facing elements:

```text
TEAM BRAISE
KFC Commerce Agent
For KFC customers, we turn natural conversations into completed orders
by coordinating commerce systems, requesting approval, and verifying the result.
Commerce execution × Agent engineering × Product experience
THANG / PRESENTER
```

Keep the existing full-bleed food image, black left overlay, and red accent.

- [ ] **Step 2: Replace Slide 2 with the broad product insight**

Use:

```text
The hard part is keeping the conversation and the order in sync.
Customer intent changes while the order moves through menu, cart, fulfillment, payment, and confirmation.
Chat context and commerce state can drift apart before the order is complete.
WHAT WE LEARNED
KFC feedback prioritizes the completed customer outcome over the AI workflow behind it.
```

Remove all combo, size-change, and order-modification language from Slide 2.

- [ ] **Step 3: Generalize Slide 3 agent behavior**

Use the title:

```text
The agent coordinates the order—not just the reply.
```

Keep the five stages and descriptions:

```text
GOAL — Understand the customer’s objective
PLAN — Decide the next safe commerce step
TOOLS — Use catalog, cart, availability, fulfillment, and order systems
ACT — Execute approved changes
VERIFY — Check price, consent, fulfillment, and order state
```

Replace the combo screenshot with a cinematic, native-shape order-state progression containing:

```text
REQUEST UNDERSTOOD → CART PREPARED → FULFILLMENT CHECKED → APPROVAL RECEIVED → ORDER VERIFIED
```

Retain the line `No irreversible action before explicit confirmation.`

- [ ] **Step 4: Replace Slide 4 with broad product value and credibility**

Use the title:

```text
It completes the journey without taking control away.
```

Show exactly four proof/value statements:

```text
REAL — End-to-end ordering — Conversation becomes a completed order
RELIABLE — Validation and recovery — Invalid state never silently proceeds
CONTROLLED — Explicit customer approval — No material change without consent
EVALUATED — Representative customer journeys — Outcomes tested beyond one happy path
```

Do not mention loose items, combos, size suggestions, or the live-demo scenario.

- [ ] **Step 5: Strengthen Slide 5 without changing its evidence claim**

Use the title:

```text
We evaluated nine complete customer outcomes.
```

Keep exactly the nine existing grouped scenario labels. Add the four evaluation checks:

```text
OUTCOME COMPLETED
COMMERCE STATE VALID
APPROVAL ENFORCED
FAILURE RECOVERED OR HANDED OFF
```

Retain `Target impact: more conversations completed as orders.` Do not claim a measured impact or pass rate.

- [ ] **Step 6: Keep the specific scenario only on Slide 6**

Use the title:

```text
Watch one conversation become a confirmed order.
```

Keep the existing `GOAL → TRIGGER → AGENT ACTS → OUTCOME → PROOF` structure and confirmed-order capture. The combo and size recommendation may appear only here as the `AGENT ACTS` detail.

- [ ] **Step 7: Regenerate the PPTX and scratch previews**

Run:

```bash
NODE=/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
TMP=/var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook/tmp
"$NODE" "$TMP/build-cinematic-playbook.mjs"
```

Expected: exit code `0`, exactly six scratch slide PNGs, and a regenerated `kfc-cinematic-playbook-storyboard-prototype.pptx`.

### Task 2: Verify and record the realigned candidate

**Files:**
- Modify: `docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-main-story-preview.png`
- Modify: `docs/wayfinder/kfc-commerce-agent-demo-pitch/issues/04-prototype-cinematic-kfc-storyboard.md`

**Interfaces:**
- Consumes: the regenerated PPTX from Task 1.
- Produces: a QA-passed montage and an open Wayfinder ticket recording the corrected scenario boundary.

- [ ] **Step 1: Render, montage, and test slide boundaries**

Run:

```bash
PPTX=/Users/vietthangvunguyen/Workspace/hackathon/docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-storyboard-prototype.pptx
SKILL=/Users/vietthangvunguyen/.codex/plugins/cache/openai-primary-runtime/presentations/26.709.11516/skills/presentations
PY=/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
PATH=/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override:/Users/vietthangvunguyen/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH
"$PY" "$SKILL/container_tools/render_slides.py" "$PPTX"
"$PY" "$SKILL/container_tools/create_montage.py" --input_dir "${PPTX%.pptx}" --output_file /Users/vietthangvunguyen/Workspace/hackathon/docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-main-story-preview.png --label_mode filename
"$PY" "$SKILL/container_tools/slides_test.py" "$PPTX"
```

Expected: six rendered slides, a refreshed montage, and `Test passed. No overflow detected.`

- [ ] **Step 2: Verify content boundaries programmatically**

Assert from the PPTX slide XML:

```text
slide_count == 6
Slide 3 contains GOAL, PLAN, TOOLS, ACT, VERIFY
Slide 4 contains REAL, RELIABLE, CONTROLLED, EVALUATED
Slide 5 contains all nine scenario labels exactly once
Slides 1–4 contain none of: combo, size suggestion, loose items, upsell
Full deck contains none of: 39 use cases, 9/9, pass rate
```

Expected: every assertion passes.

- [ ] **Step 3: Inspect all six slides individually at full size**

Confirm that titles do not wrap unexpectedly, all body copy is readable, Slide 3’s order-state progression is clear, Slide 4 remains product-wide, Slide 5 is legible despite the evidence detail, and Slide 6 ends on the verified order outcome.

- [ ] **Step 4: Update the open Wayfinder ticket**

Append this statement to `Cinematic playbook-content review candidate`:

```markdown
The content was realigned after review so Slides 1–4 describe the general commerce-agent product. Combo conversion and size upgrade now appear only as one representative scenario on Slide 5 and as the specific live-demo path on Slide 6.
```

Keep the ticket open and do not modify final Google Slides.

- [ ] **Step 5: Present the refreshed approval artifact**

Show the montage and link the editable PPTX. Report the content-boundary QA result and stop at the Wayfinder approval gate.
