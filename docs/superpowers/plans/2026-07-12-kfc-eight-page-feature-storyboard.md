# KFC Eight-Page Feature Storyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the approved cinematic KFC storyboard as eight physical slides whose content follows the AABW narrative jobs and whose feature section explains the customer or KFC problem each capability solves.

**Architecture:** Keep the existing plain-JavaScript `@oai/artifact-tool` builder and its KFC red, near-black, and warm-white visual system. Replace the current broad Slide 4 with three outcome-led feature pages, update Slides 2 and 3 to the verified challenge and current single-agent workflow, preserve the dedicated nine-scenario evidence section and live-demo close, then validate both rendered layout and claim boundaries.

**Tech Stack:** Node.js ES modules, `@oai/artifact-tool`, PowerPoint export, bundled presentation render/overflow tools, shell-based content assertions.

**Global Constraints:** Preserve the shared dirty `main`; do not stage or modify unrelated application/backend work. Do not create or modify Google Slides. Audience-facing copy is English only. Do not claim production KFC OMS/POS compatibility, A2UI, structural streaming, a `9/9` pass rate, measured business impact, or `39 use cases`.

---

### Task 1: Prepare truthful product evidence assets

**Files:**
- Read: `artifacts/genui-live-proof/2026-07-09T10-34-34-024Z/screenshots/components_addressFulfillmentCheck.png`
- Read: `artifacts/genui-live-proof/2026-07-09T10-34-34-024Z/screenshots/components_supportHandoff.png`
- Create: `/var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook/tmp/assets/address-fulfillment.png`
- Create: `/var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook/tmp/assets/support-handoff.png`

- [ ] **Step 1: Inspect both source captures at full size**

Use image inspection to confirm the first capture visibly represents structured fulfillment choices and the second visibly represents human handoff. Reject any capture whose text is unreadable, whose state contradicts the slide claim, or whose visible interface copy violates the English-only slide constraint. If rejected, use one simple editable English diagram grounded in the same verified behavior instead of fabricating or translating a product screenshot.

- [ ] **Step 2: Copy the accepted captures into the initialized artifact-tool workspace**

Run:

```bash
cp artifacts/genui-live-proof/2026-07-09T10-34-34-024Z/screenshots/components_addressFulfillmentCheck.png /var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook/tmp/assets/address-fulfillment.png
cp artifacts/genui-live-proof/2026-07-09T10-34-34-024Z/screenshots/components_supportHandoff.png /var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook/tmp/assets/support-handoff.png
```

Expected: both destination PNG files exist and are non-empty.

### Task 2: Rebuild the eight-slide cinematic storyboard

**Files:**
- Modify: `/var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook/tmp/build-cinematic-playbook.mjs`
- Modify: `docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-storyboard-prototype.pptx`
- Modify: `docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-main-story-preview.png`

- [ ] **Step 1: Replace Slide 2 with the official customer pain and solution fit**

Use the title `High-intent customers are already in chat—but ordering sends them elsewhere.` Show three pain points—switch channel, cannot order/apply vouchers/check loyalty naturally, and staff-dependent handling—opposite three solution-fit actions—complete ordering in chat, connect to ordering/OMS/vouchers/loyalty, and hand off when human help is needed. End with `One conversation. One channel. One completed order.`

- [ ] **Step 2: Replace Slide 3 with the current guarded single-agent loop**

Show `CONTEXT / GOAL → PLAN → SELECT TOOLS → GUARD → ACT → VERIFY + ADAPT`. Explain the sequence with short phrases and use the proof line `Only verified tool results become customer-visible commerce state.` Do not imply specialist agents or a multi-agent architecture.

- [ ] **Step 3: Replace the current Slide 4 with three feature-to-value pages**

Create:

- `04A / COMPLETE THE JOURNEY` — `Complete the order without leaving chat.` Explain that conversational ordering, cart, fulfillment, vouchers, loyalty, payment, and replaceable adapters solve channel switching, broken ordering journeys, and unnecessary manual handling. Label the adapter evidence `SIMULATED / REPLACEABLE ADAPTER`.
- `04B / CLEAR CUSTOMER ACTIONS` — `Turn complex choices into clear customer actions.` Use one readable structured GenUI capture when its visible copy is English; otherwise use one simple editable English state-to-action diagram. Explain that typed menu, cart, fulfillment, confirmation, payment, tracking, and handoff actions solve ambiguity in multi-step text conversations. State that actions are generated from verified commerce state.
- `04C / SAFE EXECUTION + RECOVERY` — `Execute safely—and recover when needed.` Use one readable handoff capture when its visible copy is English; otherwise use one simple editable English control-and-recovery diagram. Explain that approval gates, verified state, tool evidence, observable events, takeover, and AI resume solve unintended actions, invalid orders, unsupported claims, and staff-required exceptions.

Each physical page must keep one dominant claim and one dominant visual rather than a card grid or screenshot collage.

Use the tall mobile confirmed-order GenUI capture on physical Slide 5. Remove thick rounded screenshot frames from physical Slides 4 and 6. Keep physical Slide 8 screenshot-free but scenario-specific: use the playbook's `GOAL -> TRIGGER -> AGENT ACTS -> OUTCOME -> PROOF` structure for the agreed combo-conversion, priced upsize, explicit approval, and confirmed-order demo.

- [ ] **Step 4: Preserve the evidence and demo sections with corrected numbering**

Keep Section `05` as physical Slide 7 with exactly nine distinct representative scenarios grouped across Ordering, Fulfillment, Payment, and Recovery. Keep Section `06` as physical Slide 8; combo conversion and size upgrade may be central only here and one scenario label in Section 05.

Add a bottom-band continuous-quality loop to Section `05`: `OBSERVE LOGS -> FIND GAPS -> IMPROVE BEHAVIOR -> RE-EVALUATE`. Preserve all nine scenarios and the four validation checks. Use the supporting line `Every journey produces logs and outcome data that feed the next quality cycle.` Do not expose LangSmith or other evaluation infrastructure names.

- [ ] **Step 5: Export the PPTX, all individual previews, layout JSON, and montage**

Run:

```bash
node /var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook/tmp/build-cinematic-playbook.mjs
```

Expected: the builder exits `0`, the PPTX is regenerated, and `preview/slide-01.png` through `preview/slide-08.png` exist.

### Task 3: Validate content, layout, and legibility

**Files:**
- Read: `docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-storyboard-prototype.pptx`
- Read: `/var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook/tmp/preview/slide-01.png` through `slide-08.png`
- Modify if needed: `/var/folders/r1/gtvf9_vd3pg6nxx42fxdhd400000gn/T/codex-presentations/019f50af-c5cd-7e90-983f-123b155abfd4/kfc-cinematic-playbook/tmp/build-cinematic-playbook.mjs`

- [ ] **Step 1: Run the structural and overflow checks**

Run:

```bash
python /Users/vietthangvunguyen/.codex/plugins/cache/openai-primary-runtime/presentations/26.709.11516/skills/presentations/container_tools/slides_test.py docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-storyboard-prototype.pptx
```

Expected: no slide-overflow errors.

- [ ] **Step 2: Assert the claim boundaries from extracted PPTX text**

Unzip the PPTX into a temporary inspection directory and assert:

- exactly eight physical slides;
- Slide 3 includes context/goal, plan, select tools, guard, act, verify, and adapt;
- physical Slides 4–6 contain the three approved feature outcomes;
- physical Slide 7 contains exactly nine numbered scenario labels and contains no `9/9` or `pass rate`;
- combo/upsize language is absent from physical Slides 1–6;
- the deck contains no `39 use cases`, `A2UI`, `streaming`, `production-ready`, or production OMS/POS compatibility claim.

- [ ] **Step 3: Inspect every rendered slide individually at full size**

Check all eight PNGs for clipping, tiny text, accidental wrapping, weak hierarchy, unreadable screenshot crops, unintended overlaps, repeated compositions, and deviations from the cinematic KFC system. Use the montage only to confirm pacing and alternation.

- [ ] **Step 4: Fix and repeat verification until clean**

Apply focused builder changes, rerun the builder, rerun `slides_test.py`, and reinspect any changed slide plus the montage. Expected: every slide is readable and every content assertion passes.

- [ ] **Step 5: Publish the approved local montage filename**

Convert or copy the final eight-slide montage to:

```text
docs/wayfinder/kfc-commerce-agent-demo-pitch/assets/kfc-cinematic-playbook-main-story-preview.png
```

Expected: the preview is an eight-slide contact sheet matching the final PPTX.

### Task 4: Update the Wayfinder approval gate

**Files:**
- Modify: `docs/wayfinder/kfc-commerce-agent-demo-pitch/issues/04-prototype-cinematic-kfc-storyboard.md`

- [ ] **Step 1: Replace the stale six-slide candidate description**

Record that the candidate now spans eight physical pages across six narrative sections: `01`, `02`, `03`, `04A`, `04B`, `04C`, `05`, and `06`. Summarize the outcome-led purpose of `04A–04C`, the dedicated nine-scenario evidence section, and the live-demo-only combo emphasis.

- [ ] **Step 2: Record verification without closing the HITL ticket**

State that overflow and full-size rendered QA passed, no forbidden claim language remains, and no final Google Slides deck was created or modified. Keep `Status: open` because the user must approve the refreshed storyboard.

- [ ] **Step 3: Stop at the approval gate**

Present the refreshed eight-slide preview and one link to the editable local PPTX. Do not advance to appendix production or Google Slides import until the user approves.
