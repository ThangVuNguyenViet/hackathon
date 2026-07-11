# KFC AI Commerce Operating System Submission Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite and verify the KFC P4 hackathon submission so judges understand it as an evidence-backed AI commerce operating system rather than a reply-only chatbot.

**Architecture:** Update only the existing KFC project draft in the AABW portal. Preserve the KFC P4 target and existing links, replace the overview and story copy with the approved commerce-operating-system narrative, add verified technologies and partner usage, then advance to Step 4 without accepting rules or submitting.

**Tech Stack:** AABW Builder Hub, Chrome browser automation, OpenAI, TinyFish, LangGraph.js, TypeScript, Fastify, Flutter, Cloudflare Workers, Cloudflare Queues, Cloudflare D1, LangSmith

---

### Task 1: Update the KFC project overview

**Files:**
- Reference: `docs/superpowers/specs/2026-07-11-kfc-commerce-operating-system-submission-copy-design.md`
- Modify externally: AABW project `a4dfb07d-6f2e-47ba-be3d-3832f3fb3b72`, Step 2

- [ ] **Step 1: Open the KFC project and verify its identity**

Open:

```text
https://aitalent.genaifund.ai/hackathon/my-projects?project=a4dfb07d-6f2e-47ba-be3d-3832f3fb3b72
```

Verify the project title is `KFC Chatbot & Management dashboard`, the team is `Braise Team`, and the target is exactly:

```text
F&B powered by KFC
P4: AI-powered conversational ordering via chat
```

Expected: no Retail/PhongVu track or problem statement is selected in this project.

- [ ] **Step 2: Replace the elevator pitch**

Fill the `* Elevator pitch` field with:

```text
An AI commerce operating system for KFC conversational ordering that turns customer intent into governed, observable, and recoverable commerce workflows. It combines structured GenUI, deterministic order execution, live human takeover and AI resume, multichannel continuity, and evidence-backed OMS/POS orchestration—far beyond a reply-only chatbot.
```

- [ ] **Step 3: Save and confirm the KFC-only overview**

Click `Save draft`, verify `Draft saved.`, then click `Confirm your track/s`.

Expected: the project advances to Step 3 and the project overview step displays a checkmark.

### Task 2: Replace the judge-facing project story

**Files:**
- Reference: `docs/superpowers/specs/2026-07-11-kfc-commerce-operating-system-submission-copy-design.md`
- Modify externally: AABW project `a4dfb07d-6f2e-47ba-be3d-3832f3fb3b72`, `* About the project`

- [ ] **Step 1: Replace the full About text**

Fill `* About the project` with exactly:

```markdown
## Inspiration

Customers already ask questions and make buying decisions inside messaging apps, but conventional ordering bots stop at FAQs or redirect people into another app. We wanted KFC conversational ordering to operate like a real commerce system: understand intent, present actionable UI, execute governed workflows, expose operational risk, and bring in a human without losing context.

## What it does

KFC Chatbot & Management dashboard is an **AI commerce operating system for conversational ordering**. It converts free-form customer intent into structured menu discovery, cart changes, fulfillment choices, payment guidance, order tracking, support, and review flows. GenUI cards and actions let customers act inside the conversation instead of relying on text alone.

The same operating model spans first-party KFC chat, Messenger, and Zalo boundaries with persisted turns and dashboard events. Operators see live order stage, automation confidence, risk, priority, and control state rather than a disconnected transcript.

## Why this is not just another chatbot

- **Deterministic commerce authority:** LangGraph policy and typed tools own cart, order, payment, and dashboard state. OpenAI plans tools and composes language but does not directly mutate commerce state.
- **Structured GenUI:** Menu, cart, fulfillment, payment, tracking, support, and review attachments turn conversation into an actionable ordering interface.
- **Real human-control lifecycle:** The system can raise warnings, request handoff, pause AI, expose the assigned operator, preserve context during intervention, and resume AI explicitly.
- **Conversation interruption handling:** Rapid customer-message bursts are coalesced into one current run; stale runs are superseded, duplicate webhooks are suppressed, and delivery processing is idempotent.
- **Runtime intelligence:** The live monitor consumes backend-derived order stage, confidence, risk, priority, and agent mode instead of hard-coded dashboard labels.
- **Replaceable commerce integration:** A typed commerce gateway demonstrates simulated OMS/POS placement, rejection, timeout, compensation, duplicate suppression, cancellation, and conflicting-state behavior without pretending to use KFC's private production APIs.
- **Evidence-gated quality:** Scenario replay, durable D1 evidence, LangSmith traces and evaluators, deployed browser proof, and business-outcome judgments verify more than whether a chatbot returned text.
- **Source-backed catalog data:** TinyFish crawls official KFC Vietnam public sources for catalog refreshes while preserving provenance, capture time, and URL validation.

## How we built it

The agent backend uses TypeScript, Fastify, and LangGraph.js with typed KFC tools and explicit state transitions. OpenAI provides bounded tool planning and response composition. Cloudflare Workers receive public webhooks, reserve idempotency in D1, enqueue work through Cloudflare Queues, and persist conversation turns, dashboard events, and delivery records. Flutter powers the customer chat and live operations monitor deployed on Cloudflare Pages.

For commerce integration, the backend calls a replaceable gateway contract. The proof environment runs separate simulated OMS and POS services so success and failure semantics can be tested independently. TinyFish supplies reproducible, source-restricted crawling of official KFC Vietnam data used to refresh source-backed fixtures.

## Challenges we ran into

The hardest problem was preserving natural conversation without allowing probabilistic model output to become commerce truth. We separated language generation from deterministic state ownership, made side effects typed and observable, and added explicit human-control and interruption state. We also separated fixture-backed tests, live OpenAI execution, simulated OMS/POS proof, and deployed browser evidence so each claim has an honest boundary.

## Accomplishments that we're proud of

- A deployed customer ordering surface and live operator monitor backed by one event model.
- Structured GenUI that turns chat into menu, cart, fulfillment, payment, tracking, and support actions.
- Human takeover and contextual AI resume with visible control ownership.
- Queue-backed webhook processing, durable D1 evidence, and duplicate-safe delivery handling.
- Multi-scenario commerce proof covering successful and adverse OMS/POS outcomes.
- Native LangSmith experiments, deterministic evaluators, deployed browser videos, and outcome-level judgments.

## What we learned

An agent becomes commercially useful when it is surrounded by deterministic contracts, durable state, explicit control transfer, and observable proof. The conversational model is one component of the operating system—not the system of record.

## What's next for KFC

Connect the typed adapters to approved KFC sandbox or production interfaces, strengthen authentication and reconciliation, expand source-backed catalog freshness, and continue hardening channel parity, observability, and customer-data protection.

## Built with

OpenAI, TinyFish, LangGraph.js, TypeScript, Fastify, Flutter, Cloudflare Workers, Cloudflare Queues, Cloudflare D1, Cloudflare Pages, and LangSmith.
```

- [ ] **Step 2: Preview the Markdown**

Select the `preview` control associated with `* About the project`.

Expected: all headings and eight differentiator bullets render distinctly; no `Untitled`, template-only headings, or collapsed paragraph appears.

- [ ] **Step 3: Return to write mode**

Select the corresponding `write` control.

Expected: the textarea contains the complete approved Markdown unchanged.

### Task 3: Update verified technologies and partner usage

**Files:**
- Reference: `services/kfc-agent-backend/README.md`
- Reference: `docs/superpowers/specs/2026-07-11-kfc-commerce-operating-system-submission-copy-design.md`
- Modify externally: AABW project `a4dfb07d-6f2e-47ba-be3d-3832f3fb3b72`, technology fields

- [ ] **Step 1: Set the Built with technologies**

Preserve existing verified chips and add these entries where available or as custom tools:

```text
OpenAI
TinyFish
LangGraph.js
TypeScript
Fastify
Flutter
Cloudflare Workers
Cloudflare Queues
Cloudflare D1
Cloudflare Pages
LangSmith
```

Remove any unverified `Google Gemini` or `Azure` chips if they reappear.

Expected: the field contains only technologies used by the KFC project.

- [ ] **Step 2: Select the AABW technology partners**

Select exactly these partner chips:

```text
OpenAI
tinyfish
```

Expected: both chips appear under `* Which AABW technology partner tools, platforms, or services did your team use in your project?`.

- [ ] **Step 3: Replace the partner explanation**

Fill `* Briefly explain how you used each technology partner's tools, platform or services.` with:

```text
OpenAI powers bounded tool planning, customer-facing response composition, and evaluator paths. Typed KFC tools and deterministic LangGraph policy retain authority over cart, order, payment, control, and dashboard state, so the model cannot directly mutate commerce truth. TinyFish crawls official KFC Vietnam public sources for source-backed catalog refreshes; the workflow retains provenance, capture timestamps, and URL validation. Crawled fixtures are mock upstream data—not KFC's private APIs or production system of record.
```

### Task 4: Save and verify without submitting

**Files:**
- Modify externally: AABW project `a4dfb07d-6f2e-47ba-be3d-3832f3fb3b72`, Steps 3 and 4
- Verify externally: PhongVu project `8a2c1fec-b902-49cf-8d4a-b2e4dc01c2da`

- [ ] **Step 1: Verify preserved KFC links**

Confirm these fields remain unchanged:

```text
Demo URL: https://kfc-ai-chatbot.pages.dev
GitHub / repository URL: https://github.com/ThangVuNguyenViet/hackathon
Video demo link: https://github.com/ThangVuNguyenViet/hackathon/blob/main/artifacts/kfc-fixture-backed-proof/live-from-start-bstream-guarded-final/videos/messenger-chat-live-ai-from-start.mp4
```

- [ ] **Step 2: Save the KFC details**

Click `Save draft` and wait for `Draft saved.`.

Expected: no required-field error is shown.

- [ ] **Step 3: Advance to submission review**

Click `Save & continue`.

Expected: Step 4/4 appears with all previous steps checked and the submission target reads:

```text
F&B powered by KFC: P4: AI-powered conversational ordering via chat
```

- [ ] **Step 4: Verify no final submission occurred**

Confirm the Official Rules checkbox and public-visibility checkbox remain unchecked and the `Submit project` button has not been activated.

- [ ] **Step 5: Verify the separate PhongVu draft is unchanged**

Open project `8a2c1fec-b902-49cf-8d4a-b2e4dc01c2da` read-only and verify:

```text
Project title: PhongVu AI Sales Agent
Track: Retail powered by Phong Vu
Problem statement: P1: AI sales agent for e-commerce website/app
```

Expected: no KFC story, KFC links, or KFC technology changes were copied into the PhongVu draft.
