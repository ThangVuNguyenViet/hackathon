# KFC Commerce Agent Demo Pitch Map

Labels: wayfinder:map

## Destination

Produce an approved five-minute demo-pitch specification and rehearsal plan for Team Braise's KFC Commerce Agent before final slide production begins.

The map is complete when the six-slide main story, live-demo contract, cinematic visual storyboard, evidence claims, five-slide technical appendix, hybrid speaker script, fallback path, and two-minute technical Q&A answer bank are agreed without unresolved presentation decisions.

## Notes

Domain: hackathon judging, KFC P4 conversational ordering, agent behavior, structured GenUI, customer and operator control state, live demo reliability, evidence boundaries, technical Q&A, and presentation design.

Skills to consult: `wayfinder`, `grilling`, `domain-modeling`, `google-slides`, `presentations`, and `verification-before-completion`. Use visual prototyping before final slide production.

Wayfinder is planning by default. Work one ticket per session. Do not produce or revise the final Google Slides deck while this map remains decision-incomplete.

Settled pitch constraints:

- Team identity: Team Braise. Presenter: Thang.
- Product identity: KFC Commerce Agent.
- Judging format follows the supplied AABW playbook: five-minute pitch plus two-minute Q&A, rehearsed to finish near 4:45.
- Winning belief: Team Braise built a genuinely agentic KFC ordering system that safely completes customer workflows rather than merely producing chatbot replies.
- Opening problem: the conversation-to-order gap. Natural customer intent must become structured, verified commerce state.
- Canonical `agentic` definition: interpret the goal, plan the next action, select bounded tools, pass policy gates, execute verified operations, inspect resulting state, and adapt or hand off.
- Primary demo outcome: complete one order from a natural-language request to explicit confirmation and verified order state.
- Live-demo format: exactly three scripted Vietnamese customer turns centered on customer-approved combo conversion and size upsell, ending on the verified confirmed customer order. Do not open the Operations Dashboard after confirmation; human-control proof belongs in Slide 4 support or the numbered appendix because it cannot coherently fit before confirmation within 60 seconds on current evidence.
- All visible slide copy is English. Customer messages remain Vietnamese.
- Customer progress is assumed to expose verified semantic milestones before rehearsal. Customer UI uses semantic labels; raw tool names belong in technical evidence only.
- Evidence order: live outcome, visible decisions and state changes, human takeover/resume, repeatable scenario/evaluation results, then architecture.
- Main narrative: six slides matching the playbook's team/promise, problem insight, agentic workflow, why it wins, evidence/impact, and demo/close sequence.
- Technical support: five numbered appendix slides covering runtime architecture, agent behavior/state authority, reliability/recovery, evaluation/proof, and OMS/POS adapter contracts.
- Main-deck architecture stays at the concrete agent-behavior level. Infrastructure detail moves to the appendix.
- Core differentiator: one commerce state, two adaptive interfaces - structured customer GenUI and a live operator control plane.
- Business position: convert more chat intent into completed orders while reserving human attention for exceptions.
- OMS/POS slide language: connects conversational ordering to existing OMS/POS workflows through reliable, replaceable adapters. Detailed implementation status belongs in the evidence record and Q&A answer bank.
- Visual direction: cinematic KFC red, black, and warm white; large typography; one legible product moment per slide; no screenshot collages, tiny evidence, generic card grids, or template-looking diagrams.
- Storyboard approval is a mandatory gate before final Google Slides production.
- Rehearsal notes use a hybrid script: exact opening, transitions, demo narration, fallback, and close; concise prompts elsewhere.
- Live demo is primary. A recording of the exact same scenario is preloaded as immediate fallback and is not advertised on visible slides.
- Closing ask: choose Team Braise because it turns KFC chat intent into governed, observable, and recoverable order execution.

Related effort:

- The separate Codex task `Wayfind Flutter agent, text, and GenUI streaming` is charting intermediate agent progress, text streaming, and GenUI/A2UI streaming. This pitch map consumes its eventual decision artifact but does not implement that UI.

## Decisions so far

<!-- Decisions are added here only when child tickets close. -->

- [Audit Pitch Evidence And Demo Readiness](./issues/01-audit-pitch-evidence-and-demo-readiness.md) — Strong deterministic and historical live evidence exists, but the three-turn demo, matching fallback, current live-AI reliability, streaming/A2UI, production OMS/POS, and business-impact claims are not yet proven.
- [Lock Six-Slide Narrative And Claim Language](./issues/02-lock-six-slide-narrative-and-claim-language.md) — The outcome-first six-slide story leads from the conversation-to-order gap through explicit agent action and KFC-prioritized basket improvement to gated 9/9 live evidence and a confirmed-order close.
- [Design Three-Turn Live Demo And Fallback](./issues/03-design-three-turn-live-demo-and-fallback.md) — Three customer turns prove consented loose-item-to-combo conversion, priced size upsell, and a confirmed order; live readiness requires three exact rehearsals with every response at most 18 seconds, the full segment at most 60 seconds, and a snapshot-bound matching recording.

## Not yet specified

- The exact semantic progress milestones and their availability before rehearsal depend on the separate streaming Wayfinder map.

## Out of scope

- Implementing agent-progress streaming, text-token streaming, or GenUI/A2UI streaming; that belongs to the separate streaming Wayfinder effort.
- Changing backend agent behavior, ordering logic, commerce adapters, GenUI widgets, or Operations Dashboard behavior solely to make a presentation claim.
- Producing the final Google Slides deck before the storyboard and pitch specification are approved.
- Claiming measured revenue, conversion, latency, or productivity improvements without verified evidence.
- Claiming production KFC OMS/POS compatibility or production readiness without authoritative integration evidence.

## Frontier

Open, unblocked, unassigned child tickets are the frontier. In this local Markdown tracker, `Blocked by` names unresolved prerequisites.

The current frontier is:

- [Prototype Cinematic KFC Storyboard](./issues/04-prototype-cinematic-kfc-storyboard.md)
- [Design Technical Appendix And Q&A Answer Bank](./issues/05-design-technical-appendix-and-qa-answer-bank.md)
