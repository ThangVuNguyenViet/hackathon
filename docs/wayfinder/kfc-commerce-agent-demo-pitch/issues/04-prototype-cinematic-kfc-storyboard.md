Status: resolved
Type: prototype
Labels: wayfinder:prototype
Parent: ../map.md
Blocked by: 02-lock-six-slide-narrative-and-claim-language.md, 03-design-three-turn-live-demo-and-fallback.md
Assignee: Codex (current thread)

## Question

What should the six main narrative sections, now spanning eight physical pages, and five technical appendix slides look like as a low-fidelity storyboard? Create reviewable thumbnails using the approved English copy, KFC red/black/warm-white direction, large typography, one legible product moment per evidence slide, a concrete agent-behavior visual, and readable technical diagrams. Prove hierarchy, pacing, evidence crop, and live-demo handoff before any final Google Slides production.

## Rejected prototype

The following prototype was reviewed and rejected because its slide jobs do not match the AABW playbook closely enough:

- [Editable cinematic storyboard prototype](../assets/kfc-cinematic-storyboard-prototype.pptx)
- [Six-slide main-story preview](../assets/kfc-main-story-preview.png)
- [Full storyboard preview](../assets/kfc-cinematic-storyboard-preview.png)

Its cinematic KFC red, near-black, and warm-white visual direction may still inform a later revision, but the content structure must be redesigned against the playbook before approval.

The rejected six-slide attempt was:

1. `KFC Commerce Agent` - cinematic Team Braise promise and presenter identity.
2. `A helpful reply is not a completed order` - `CHAT != ORDER`, followed by intent, cart, fulfillment, and confirmed-order state.
3. `One conversation. One completed order.` - explicit understand, decide, act, and verify behavior beside one legible GenUI product moment.
4. `It doesn't just take the order. It improves it.` - loose items become a customer-approved better-fit combo and size upgrade.
5. `9 Representative test scenarios` - exactly nine named scenarios grouped as Ordering `01/02/06/07`, Fulfillment `03`, Payment `08/09`, and Recovery `04/05`; no internal coverage-count or pass-rate language.
6. `Let's complete an order` - live-demo handoff and the confirmed-order close.

The five numbered appendix compositions remain unapproved at storyboard fidelity. Their final sourced wording and 20-second answers remain owned by [Design Technical Appendix And Q&A Answer Bank](./05-design-technical-appendix-and-qa-answer-bank.md).

The rejected candidate's Slide 3 and Slide 6 product captures remain historical placeholders. No final Google Slides deck was created or modified.

### Required revision

Rebuild the main storyboard so every slide directly performs the corresponding AABW playbook job: complete team/promise sentence; specific problem insight with user, goal, friction, root cause, and evidence; visible goal/plan/tools/act/verify behavior; differentiated user value plus credibility; strongest actual evidence plus clearly labelled impact; and a one-minute goal/trigger/agent/outcome/proof demo ending.

## Playbook-first review candidate

The revised six-slide main story now follows the supplied playbook's visual and information hierarchy directly. It uses warm-white and navy canvases, restrained blue and KFC-red accents, large typography, thin rules, and one structured argument per slide. It deliberately excludes the technical appendix until the main story is approved.

- [Editable playbook-first storyboard prototype](../assets/kfc-playbook-first-storyboard-prototype.pptx)
- [Six-slide playbook-first preview](../assets/kfc-playbook-first-main-story-preview.png)

The six slide jobs are:

1. Team identity plus one complete customer promise.
2. Problem insight stated as who, goal, friction, root cause, and stakeholder evidence.
3. Visible `GOAL -> PLAN -> TOOLS -> ACT -> VERIFY` behavior with explicit confirmation before irreversible action.
4. Design choices translated into KFC and customer value, with credibility labels.
5. Exactly nine representative customer-outcome scenarios, clearly labelled as scenario evaluation rather than a pass rate, plus a target impact rather than a measured result.
6. A one-minute `GOAL -> TRIGGER -> AGENT ACTS -> OUTCOME -> PROOF` demo handoff ending on the verified order.

Rendered QA passed with no detected slide overflow. The prototype contains no `39 use cases`, `9/9`, or pass-rate language. This ticket remains open at its HITL approval gate; no final Google Slides deck has been created or modified.

## Cinematic playbook-content review candidate

This revision keeps the approved cinematic KFC visual language while using the AABW playbook only for content hierarchy and pacing. The six narrative sections now span eight physical pages: `01`, `02`, `03`, `04A`, `04B`, `04C`, `05`, and `06`.

- [Editable cinematic playbook-content prototype](../assets/kfc-cinematic-playbook-storyboard-prototype.pptx)
- [Eight-page cinematic preview](../assets/kfc-cinematic-playbook-main-story-preview.png)

The refreshed candidate now performs these jobs:

1. Complete Team Braise promise and presenter identity.
2. Official challenge-grounded customer pain plus direct solution fit.
3. Current guarded single-agent loop: context/goal, plan, select tools, guard, act, verify, and adapt.
4. `04A` solves channel switching and broken ordering journeys by coordinating the full order in chat through a clearly labelled simulated, replaceable adapter.
5. `04B` solves ambiguous multi-step text decisions by turning verified commerce state into structured customer actions.
6. `04C` solves unsafe execution and exceptions with approval gates, tool evidence, observability, human takeover, and AI resume.
7. Section `05` remains dedicated to exactly nine deep representative customer-journey tests across ordering, fulfillment, payment, and recovery.
8. Section `06` is the live-demo handoff and the only page where combo conversion and size recommendation become the central story.

Rendered QA passed with no detected overflow after full-size inspection of all eight pages. The deck contains no `39 use cases`, `9/9`, pass-rate, A2UI, streaming, measured-impact, or production OMS/POS compatibility language. No final Google Slides deck was created or modified.

The content is now generalized across Sections `01–04C`. Combo recommendation appears only as one representative scenario in Section `05`; the specific combo-and-size path is reserved for Section `06`, the live-demo handoff.

This ticket remains open at its HITL approval gate. The next step is user approval or revision of this eight-page main-story prototype; appendix production and Google Slides import have not started.

### Product screenshot revision

The three Section `04` pages now use distinct real product surfaces:

- `04A` uses the fixture-backed Messenger proof crop that reaches explicit order confirmation. A fresh Chrome replay of the preferred demo prompt did not return the expected combo-conversion behavior, so that replay was not used as successful evidence.
- `04B` uses a GenUI fulfillment/order-review capture from the passed `2026-07-11T08-54-21-074Z` live-AI integration run.
- `04C` uses the supplied Operations Monitor session card showing Messenger conversation context, confidence, the current `AI Handling` state, and an explicit operator `Join` action.

The screenshot mapping supports three separate claims—customer channel, structured action, and operator control—without repeating the same product surface.

### Continuous evaluation revision

Section `05` now closes with the audience-facing loop `Observe logs -> Find gaps -> Improve behavior -> Re-evaluate`. The supporting line explains that every journey produces logs and outcome data for the next quality cycle. The slide keeps all nine representative scenarios and four validation checks, while omitting LangSmith and other evaluation infrastructure names.

### Screenshot and demo simplification revision

The tall mobile confirmed-order GenUI capture moved from physical Slide 8 to physical Slide 5, where it is the dominant structured-action proof. Physical Slides 4 and 6 now show the Messenger and Operations Monitor captures flat, without thick rounded screenshot frames. Physical Slide 8 is screenshot-free but now previews the actual combo-and-upsize live demo through the playbook's five beats: feed four within budget; start from ten chicken pieces and four Pepsi; recommend two verified combos and a priced upsize; require approval for both changes; finish on the `304K` confirmed cash-on-delivery order.

## Resolution

Thang approved the eight-page cinematic playbook-content storyboard for production handoff. The approved main story uses Sections `01`, `02`, `03`, `04A`, `04B`, `04C`, `05`, and `06`; preserves the KFC red/black/warm-white visual language; uses the supplied Messenger, mobile GenUI, and Operations Monitor product evidence; and ends with the playbook-aligned combo-conversion and priced-upsize live-demo storyline. The verified local PPTX passed full-slide visual inspection and overflow QA. Final Google Slides production remains gated on the unresolved technical appendix, rehearsal notes, and final specification approval tickets.
