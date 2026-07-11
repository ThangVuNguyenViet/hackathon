# KFC Playbook-Aligned Cinematic Storyboard Design

## Purpose

Revise the Team Braise pitch prototype so the content performs the six narrative jobs defined by the AABW Pitching Playbook while retaining the cinematic KFC visual language the presenter approved. The six narrative sections may span eight physical pages because the feature/value section expands into `04A`, `04B`, and `04C`.

The playbook governs information architecture and pacing. It does not become the visual template.

The combo-conversion and size-upgrade story is one live-demo scenario. It must not define the product thesis or make the preceding slides appear designed around that scenario.

## Audience and communication job

The audience is the AABW judging panel, including KFC product stakeholders and technical reviewers.

By the end, judges should believe that Team Braise built a customer-centered commerce agent that turns natural conversation into a customer-approved, verified order, because the pitch shows a concrete customer problem, visible agent action, relevant product value, honest evidence, and a complete live outcome.

## Visual direction

Retain the approved KFC prototype's visual system:

- KFC red, near-black, and warm white as the primary palette.
- Large cinematic typography and strong contrast.
- Food imagery or a single legible product capture where it strengthens the current claim.
- Alternating dark and light compositions to create pace.
- One dominant visual or proof point per slide.
- Minimal supporting copy, with no dense card grids or screenshot collages.

Do not imitate the playbook's blue-and-beige workshop styling. Do not expose playbook taxonomy such as `TEAM + PROMISE` or `EVIDENCE LEVEL` as audience-facing production labels.

## Six-section, eight-page content design

### Slide 1 - Team and promise

Keep the cinematic hero treatment. Identify Team Braise, KFC Commerce Agent, and presenter Thang. Use the complete promise: `For KFC customers, we turn natural conversations into completed orders by coordinating commerce systems, requesting approval, and verifying the result.` Add the credibility line `Commerce execution × Agent engineering × Product experience`.

### Slide 2 - Problem insight

Use the official-challenge-grounded title `High-intent customers are already in chat—but ordering sends them elsewhere.` Present the customer pain: customers must switch from Messenger or Zalo to another app or website; chat cannot place orders, apply vouchers, or check loyalty; current handling is staff-based. Present the solution fit on the same page: complete the ordering journey in chat, connect conversation to ordering/OMS/vouchers/loyalty, and hand off only when human help is needed. Close with `One conversation. One channel. One completed order.`

### Slide 3 - Agentic product behavior

Use the title `Our agent runs a guarded commerce loop.` Show the implemented single-agent workflow: `CONTEXT/GOAL -> PLAN -> SELECT TOOLS -> GUARD -> ACT -> VERIFY + ADAPT`. Context loads the message, recent turns, and verified commerce state. Planning produces intent, entities, context policy, and tool calls. Guarding checks verified items, fulfillment, approval, and claim evidence. Acting executes bounded typed tools. Verification persists verified state and observability, then replans, clarifies, composes text/GenUI, or hands off. Use the proof line `Only verified tool results become customer-visible commerce state.`

### Slide 4A - Complete the order without leaving chat

Present Messenger/Zalo conversational ordering, cart, fulfillment, voucher, loyalty, payment, and replaceable OMS adapter capabilities as one outcome: customers can complete the ordering journey without switching channels. State the problem solved: channel switching, broken ordering journeys, and unnecessary manual staff handling. Keep OMS language honest: the current integration proof is simulated through replaceable adapters, not production KFC compatibility.

### Slide 4B - Turn complex choices into clear customer actions

Present typed GenUI across menu, cart, fulfillment, order review/confirmation, payment, tracking, and handoff as the solution to ambiguous text conversations and difficult multi-step decisions. Use the tall mobile confirmed-order GenUI capture as the dominant product proof. Emphasize that structured customer actions are generated from verified commerce state. Do not call the implementation A2UI or incremental structural streaming.

### Slide 4C - Execute safely and recover when needed

Present safety gates, explicit customer approval, verified state, tool evidence, observable events, human takeover, and AI resume as the solution to unintended actions, invalid orders, unsupported claims, and exceptions that require staff. This is the credibility slide; explain the problem each control solves rather than teaching the infrastructure stack.

### Slide 5 - Nine deep customer-journey tests

Use the title `We evaluated nine complete customer outcomes.` Summarize exactly nine representative scenarios across ordering, fulfillment, payment, and recovery. State what the evaluation checks collectively: `Outcome completed`; `Commerce state valid`; `Approval enforced`; `Failure recovered or handed off`. Present this as deep representative scenario evaluation, never as `9/9`, a pass rate, pilot evidence, or measured business impact. Add a non-technical continuous-quality loop beneath the scenarios: `Observe logs -> Find gaps -> Improve behavior -> Re-evaluate`, supported by `Every journey produces logs and outcome data that feed the next quality cycle.` Do not mention LangSmith or implementation tooling on the audience-facing slide. Testing remains dedicated to Section 5 and must not be used as one of the feature/value stories in Section 4.

### Slide 6 - Demo and close

Use the playbook's five demo beats to preview the exact live combo-and-upsize scenario without reproducing the three Vietnamese customer turns. `GOAL`: feed four within `300K`. `TRIGGER`: ten chicken pieces and four Pepsi. `AGENT ACTS`: recommend two verified combos, then a priced upsize. `OUTCOME`: the customer approves both changes. `PROOF`: a `304K` confirmed cash-on-delivery order. Keep the page screenshot-free and close the storyline with the consent boundary: no combo conversion or upsize occurs before customer approval.

## Scope boundaries

- Build eight main-deck pages across six narrative sections: `01`, `02`, `03`, `04A`, `04B`, `04C`, `05`, and `06`.
- Preserve the previously rejected and flat playbook-first prototypes for comparison.
- Do not create or modify final Google Slides.
- Do not add measured revenue, conversion, latency, production-readiness, or production OMS/POS claims.
- Keep architecture and detailed agent internals in the later technical appendix.

## Acceptance criteria

- The deck clearly retains the cinematic KFC style rather than the playbook's workshop style.
- Each narrative section performs its corresponding playbook content job; `04A–04C` collectively perform the guide's feature-to-value and credibility job.
- Slide 3 visibly communicates context/goal, plan, tool selection, guard, act, verify, and adapt using the latest implemented single-agent workflow.
- Slide 5 contains exactly nine distinct representative scenarios and no `39 use cases`, `9/9`, or pass-rate language.
- Every `04A–04C` page leads with the user or KFC problem solved, then shows the implemented capabilities responsible for that outcome.
- Combo-conversion and size-upgrade language appears only as one item among the nine representative scenarios and in the Slide 6 live-demo story; it does not frame Sections `01–04C`.
- All audience-facing slide copy is English; Vietnamese is reserved for customer messages in the live demo.
- All eight pages pass overflow checks and full-size visual inspection.
- The Messenger and Operations Monitor screenshots on physical Slides 4 and 6 appear without thick rounded frames.
- The revised preview is presented at the Wayfinder HITL approval gate before final Google Slides production.
