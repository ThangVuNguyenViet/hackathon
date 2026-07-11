Status: resolved
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 01-audit-pitch-evidence-and-demo-readiness.md
Assignee: Codex (current thread)

## Question

What exact six-slide narrative, takeaway titles, claim wording, transitions, and closing ask will make judges understand the conversation-to-order problem, see genuinely agentic work, believe the outcome, trust Team Braise, and score the pitch against the AABW rubric within five minutes? Resolve every visible claim against the evidence inventory and keep technical depth sufficient for credibility without turning the main story into an architecture lecture.

## Resolution

The main deck is outcome-first because KFC stakeholder feedback prioritizes the product result over an explanation of the internal AI workflow. It follows the AABW six-slide sequence while keeping agent planning and action explicit enough to satisfy the rubric.

### Slide 1 - Team + promise

**TEAM BRAISE**

**KFC Commerce Agent**

**From Conversation to Confirmed Order**

Supporting line: `Agent engineering x Commerce execution x Product experience`

Presenter: `Thang`

Opening:

> We are Team Braise, and we built KFC Commerce Agent. KFC customers should be able to order as naturally as they chat. Our product turns that conversation into a confirmed order by deciding the next commerce step, acting through connected workflows, and verifying the result.

### Slide 2 - Problem insight

**A Helpful Reply Is Not a Completed Order**

Supporting claim: `The workflow breaks when natural customer intent is separated from cart, fulfillment, confirmation, and verified order state.`

Do not cite an internal use-case count on this slide. It reads as team-created coverage rather than customer or business evidence and distracts from the concrete conversation-to-order failure.

### Slide 3 - Agentic workflow expressed as product behavior

**One Conversation. One Completed Order.**

Visible sequence: `Understand goal -> Decide next step -> Act through commerce systems -> Verify order state`

The slide shows the customer request and resulting product state. It does not teach infrastructure. The presenter makes the decision, bounded action, customer approval, and verification explicit so judges do not mistake the product for a reply-only chatbot.

### Slide 4 - Why it wins

**It Doesn't Just Take the Order. It Improves It.**

Supporting claim: `The agent recognizes separately selected items, recommends a better-fit combo or size, updates the cart with customer approval, and preserves a clear path to confirmation.`

Visible sequence: `Loose items -> Relevant combo suggestion -> Customer-approved change -> Better final order`

This reflects direct KFC stakeholder interest in sensible combo conversion, size upsell, and order modification. It does not claim measured conversion or basket-size lift. Human takeover remains supporting safety evidence in the numbered appendix and Q&A, not this slide's headline.

### Slide 5 - Evidence + impact

One dominant proof point:

**9**

**Representative Test Scenarios**

Supporting line: `Summarized across ordering, fulfillment, payment, and recovery; each scenario evaluates a complete customer outcome.`

Clearly labelled footer: `Target business outcome: More KFC conversations converted into completed orders.`

Do not present this as `9/9`, a live pass rate, pilot evidence, or measured business impact. It is a concise summary of the nine representative testing scenarios. The target business outcome is not a measured pilot result. Deterministic-test counts do not appear in the main deck.

### Slide 6 - Demo + close

**Let's Complete an Order**

The visible demo centers on a Vietnamese customer moving from loose-item intent through a relevant combo or size recommendation, customer-approved cart change, explicit confirmation, and verified order. The exact prompts and fallback remain owned by [Design Three-Turn Live Demo And Fallback](./03-design-three-turn-live-demo-and-fallback.md).

The main demo must end on the confirmed customer order and stay within the playbook's maximum demo time. It must not open the Operations Dashboard after showing the confirmed order. Human-control proof belongs earlier as supporting evidence or in the appendix.

Closing ask:

> Choose Team Braise to turn KFC conversations into completed orders.

### Transitions

- Slide 1 -> 2: `But a conversation only creates value when it becomes a valid order.`
- Slide 2 -> 3: `So we designed the product around completing the order - not merely answering the customer.`
- Slide 3 -> 4: `And the best ordering experience should improve the basket while keeping the customer in control.`
- Slide 4 -> 5: `We tested the completed outcomes, not just the quality of the replies.`
- Slide 5 -> 6: `Now let's watch one conversation become a confirmed order.`

### Claim and presentation boundaries

- All visible slide copy is English; Vietnamese appears only in customer messages during the demo.
- Architecture is supporting evidence, not the main character. Detailed runtime, tools, OMS/POS adapters, reliability, evaluation, and human oversight belong in numbered appendix slides.
- Do not claim production KFC OMS/POS compatibility, production readiness, measured revenue/conversion lift, or pilot results.
- The main story is designed for the playbook's five-minute structure and must be rehearsed to finish near 4:45 with a short safety margin.
