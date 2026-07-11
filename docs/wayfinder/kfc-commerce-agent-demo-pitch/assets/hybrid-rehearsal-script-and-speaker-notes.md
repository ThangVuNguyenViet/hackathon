# Hybrid Rehearsal Script And Speaker Notes

Prepared for [Write Hybrid Rehearsal Script And Speaker Notes](../issues/06-write-hybrid-rehearsal-script-and-speaker-notes.md) on 2026-07-12.

## Delivery contract

- Presenter: Thang.
- Demo operator: one teammate.
- Spoken pitch and Q&A: English.
- Slide copy: English.
- Customer demo submissions: Vietnamese.
- Main pitch target: finish at `4:40`, leaving five seconds of safety before `4:45`.
- Main presentation: eight physical slides across Sections `01`, `02`, `03`, `04A`, `04B`, `04C`, `05`, and `06`.
- Appendix `A1-A5`: Q&A only; never present sequentially in the five-minute pitch.
- Thang answers every judge question. The teammate operates only the live demo and fallback recording.

## Master timeline

| Time | Surface | Narrative job |
| --- | --- | --- |
| `0:00-0:25` | Slide 1 | Team + promise |
| `0:25-1:00` | Slide 2 | Customer problem + solution fit |
| `1:00-1:35` | Slide 3 | Agent workflow |
| `1:35-2:05` | Slide 4A | Complete the journey in chat |
| `2:05-2:35` | Slide 4B | Turn complexity into clear actions |
| `2:35-3:05` | Slide 4C | Safe execution + human recovery |
| `3:05-3:40` | Slide 5 | Nine representative outcomes + improvement loop |
| `3:40-4:40` | Section 06 / physical Slide 8, customer app, Slide 8 | Live demo + confirmed-order close |
| `4:40-4:45` | Physical Slide 8 | Safety buffer; stop speaking |

## Slide 1 - Team + promise (`0:00-0:25`)

### Exact script

`Good morning. We're Team Braise. KFC customers already start ordering in conversation—but completing that order still sends them elsewhere. We built KFC Commerce Agent to keep the customer in chat and carry the journey through to a verified order.`

### Presenter action

- Face the judges for the whole opening.
- Do not point at the hero image.
- Advance to Slide 2 immediately after `verified order`.

### Transition

`The problem is not starting the conversation. It is finishing the commerce journey.`

## Slide 2 - Customer problem + solution fit (`0:25-1:00`)

### Prompted narration

`A high-intent customer may begin in Messenger or Zalo, but then has to switch channels, rebuild the order, check fulfillment, and wait for staff. That is where intent and commerce state drift apart. Our solution keeps the journey in one conversation while coordinating the cart, fulfillment, confirmation, and the moments where a person should step in.`

### Emphasis

- Point once to `TODAY` and once to `WITH KFC COMMERCE AGENT`.
- Land on: `One conversation. One channel. One completed order.`

### Transition

`To finish that journey safely, the system must do more than generate a helpful reply.`

## Slide 3 - Agent workflow (`1:00-1:35`)

### Prompted narration

`One agent keeps a verified working state. It understands the current goal, plans the next safe action, selects bounded commerce tools, and passes policy gates before execution. After each action, it inspects the resulting state and either continues, asks for clarification, or hands off. Only successful tool results become customer-visible commerce state.`

### Emphasis

- Trace the sequence once: `Context and goal -> Plan -> Select tools -> Guard -> Act -> Verify and adapt`.
- Do not describe a supervisor or specialist-agent system.
- Do not narrate infrastructure, model names, or raw tool names.

### Transition

`That governed loop produces three customer-facing advantages.`

## Slide 4A - Complete the journey in chat (`1:35-2:05`)

### Prompted narration

`First, the customer does not have to abandon the conversation. The agent coordinates Messenger, cart state, fulfillment, and confirmation as one journey. The screenshot shows a customer reaching explicit order confirmation in chat. The current commerce backend is simulated through a replaceable adapter—not presented as KFC production OMS.`

### Transition

`But a long text thread is still a poor interface for every decision.`

## Slide 4B - Clear customer actions (`2:05-2:35`)

### Prompted narration

`Second, verified state becomes structured GenUI. Instead of burying store, ETA, fee, payment, and confirmation inside paragraphs, the customer gets a clear next action. The model does not invent this screen independently; it is rendered from the backend's typed commerce state.`

### Transition

`And when the happy path breaks, customer control must remain explicit.`

## Slide 4C - Safe execution + human recovery (`2:35-3:05`)

### Prompted narration

`Third, the Operations Monitor exposes the live channel, conversation context, confidence, and control state. An operator can join, which pauses AI replies, respond in the same channel, and explicitly resume AI with the takeover context preserved. Human help is part of the workflow, not a disconnected escalation inbox.`

### Transition

`We evaluate the complete customer outcome—not just whether the final message sounds plausible.`

## Slide 5 - Evidence + continuous improvement (`3:05-3:40`)

### Prompted narration

`We designed nine representative journeys across ordering, fulfillment, payment, and recovery. For each journey, we inspect four things: was the customer outcome completed, was commerce state valid, was approval enforced, and did failure recover or hand off correctly? Logs and outcome data then feed the next cycle: observe, find gaps, improve behavior, and re-evaluate.`

### Evidence boundary

- Say `nine representative journeys` or `nine representative scenarios`.
- Do not say `9/9`, `all live tests pass`, or imply customer research, pilot results, or measured business impact.

### Transition

`Now let's see the KFC-prioritized scenario: improve the basket without taking control away.`

## Section 06 / physical Slide 8 - Live demo + close (`3:40-4:40`)

### Roles

- Thang: controls slides, narrates, and keeps eye contact with judges.
- Teammate: controls the prepared customer-chat tab and fallback recording.
- Teammate does not speak.

### `3:40-3:48` - Set the storyline

Thang:

`The customer needs food for four within a 300,000-dong budget. Watch the agent improve the basket without changing it before approval.`

Thang switches from physical Slide 8 to the prepared customer-chat tab.

### Turn 1 - Loose items and grounded combo recommendation

At about `3:48`, teammate submits the prefilled message:

`Cho mình 10 miếng gà và 4 Pepsi cỡ vừa cho 4 người, ngân sách đồ ăn 300.000đ, giao đến Big C Đồng Nai, thanh toán khi nhận hàng.`

Thang narrates while the request runs:

`The customer starts with loose items and a budget. The agent must not change the cart before permission.`

If verified semantic progress labels are visibly present, Thang may read those exact labels aloud. If no proof-bound progress labels are visible and more narration is needed, use only:

`The request is running; the current build does not expose internal sub-steps.`

When the correct recommendation appears, Thang says:

`It found two verified combos that fit the same need and reduce the food subtotal from 404,000 to 258,000 dong—but it waits for the customer.`

### Turn 2 - Customer-approved combo conversion and priced upsize

Teammate immediately submits:

`Đổi sang 2 Combo Đẫy Đà 129K nhé.`

Thang says:

`With approval, the cart changes. Now it offers four large-drink upgrades for 28,000 dong and discloses the resulting price before confirmation.`

Do not claim the upsize is applied until the UI shows that the system is waiting for the final customer approval.

### Turn 3 - Informed approval and confirmed order

Teammate immediately submits:

`Đồng ý nâng cả 4 Pepsi lên cỡ lớn. Tổng món 286.000đ, phí giao 18.000đ; xác nhận đặt đơn và thanh toán khi nhận hàng.`

When the confirmed order appears, Thang says:

`The customer approved both modifications and the disclosed total. The result is one verified confirmed cash-on-delivery order.`

Hold the confirmed-order result for about two seconds. Do not open the Operations Monitor.

Thang returns to physical Slide 8.

### Exact close

`Choose Team Braise to turn KFC conversations into completed orders—while keeping customers and operators in control.`

Stop. Do not add `thank you` unless the moderator expects it.

## Live fallback contract

### Automatic trigger

The teammate switches immediately to the preloaded recording when:

- 18 seconds elapse after any submission without the complete expected response and GenUI;
- the returned recommendation, card, item composition, price, saving, cart, fulfillment fee, payment state, or final order differs from the checkpoint;
- an error, stale session, duplicate order, or early order appears.

The teammate does not wait for a second signal from Thang.

### Exact spoken transition

`I'll switch to the recorded run of this exact scenario.`

### Playback rule

- If the live path is still consistent through the last checkpoint, resume the recording from the matching cue.
- If the live state is inconsistent, restart the recording from its clean-start cue.
- Do not explain the failure, add a fourth customer turn, repair the cart onstage, or switch to another scenario.
- Continue using the same demo narration and exact closing line.

## Behind-schedule script

Use this cut order without discussion:

1. Slide 4A: `The agent completes the ordering journey in chat through a simulated, replaceable commerce adapter.`
2. Slide 4B: `Structured GenUI turns verified state into clear customer actions.`
3. Slide 4C: `The monitor lets staff join, respond, and return control explicitly.`
4. Slide 5: `We evaluate nine representative outcomes across ordering, fulfillment, payment, and recovery.`
5. Skip the Slide 5 continuous-improvement explanation.

Never cut:

- the customer approvals in Turns 2 and 3;
- the confirmed-order reveal;
- the exact closing line.

If the clock reaches `4:30` before Turn 3 is complete, use the fallback recording immediately from the nearest valid cue.

## Q&A operating pattern (`4:45-6:45`)

Thang answers every question. The teammate remains silent and keeps the appendix ready.

For each answer:

1. Lead with the conclusion.
2. Give one implementation fact or evidence example.
3. State the boundary if the question reaches beyond current proof.
4. Stop within about 20 seconds.

Do not begin by reading an appendix slide. Answer first, then reveal the supporting appendix if useful.

## Appendix routing notes

| Judge question | Open | First sentence |
| --- | --- | --- |
| `What happens after the customer sends a message?` | `A1` | `One request enters one governed commerce loop.` |
| `What makes it agentic?` | `A1` or `A2` | `The agent succeeds by changing verified commerce state, not by generating plausible text.` |
| `Can the LLM bypass confirmation or hallucinate an order?` | `A2` | `The model proposes; typed tools, safety gates, and persisted state decide what can execute.` |
| `Is it multi-agent?` | `A2` | `No. It is intentionally one commerce agent loop with one state authority.` |
| `What if messages arrive quickly or the run becomes stale?` | `A3` | `New intent may supersede safe work, but irreversible work is protected.` |
| `How does human takeover work?` | `A3` | `A session has one explicit control owner: AI or the joined operator.` |
| `How do you know it is reliable?` | `A4` | `We separate deterministic, scenario, live UI, and live-model proof layers.` |
| `Did all nine scenarios pass?` | `A4` | `They are nine representative journey designs, not a blended public pass-rate claim.` |
| `Can it connect to KFC OMS/POS?` | `A5` | `We demonstrated the integration shape through replaceable simulated adapters.` |
| `What happens on ambiguous POS failure?` | `A5` | `We preserve raw outcomes and attempt defined compensation, but production reconciliation remains a separate requirement.` |

Use the exact expanded answers in [Technical Appendix And Q&A Answer Bank](./technical-appendix-and-qa-answer-bank.md).

## Rehearsal gate

Do not classify the live demo as ready until all are true:

1. Three consecutive rehearsals use the exact three Vietnamese submissions.
2. Every complete response and expected GenUI appears within 18 seconds.
3. The full customer segment, including narration and submissions, completes within 60 seconds.
4. One session contains the correct combo conversion, upsize, totals, and exactly one confirmed order.
5. The fallback recording proves the same scenario and identified runtime snapshot.
6. The teammate successfully rehearses both matching-cue continuation and clean-start fallback.
7. Thang completes the whole pitch by `4:40` in three consecutive rehearsals.

## Google Slides speaker-note mapping

When final production is authorized:

- Put each slide's `Exact script`, `Prompted narration`, `Transition`, `Presenter action`, and `Evidence boundary` into that slide's speaker notes.
- Put the full three-turn script, teammate cues, timeout, fallback, and exact close into physical Slide 8 notes.
- Put the relevant 20-second answer, evidence pointer, and claim boundary into each appendix slide's notes.
- Keep Vietnamese customer messages in physical Slide 8 notes only; do not add them as permanent visible slide text.
