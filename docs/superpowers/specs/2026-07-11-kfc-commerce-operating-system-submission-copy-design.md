# KFC AI Commerce Operating System Submission Copy Design

## Objective

Reposition the KFC P4 submission from a generic chatbot description to an evidence-backed AI commerce operating system. The copy must explain how the product converts customer intent into governed, observable, and recoverable commerce workflows across automated agents, structured customer UI, and human operations.

## Audience and Success Criteria

The primary audience is hackathon judges evaluating novelty, business relevance, agentic AI usage, technical credibility, and demonstrated execution.

The revised submission succeeds when a judge can identify, without inference:

- why the product is more than a conversational interface;
- which decisions belong to deterministic commerce logic versus the LLM;
- how operators supervise, take over, and return control to AI;
- how the system handles rapid messages, duplicates, failures, and channel continuity;
- how OMS/POS integration is demonstrated without overstating production access; and
- which deployed proofs and evaluation gates support the claims.

## Recommended Narrative

Lead with the product as an **AI commerce operating system for conversational ordering**. Organize the story in four layers:

1. **Customer experience:** Natural-language ordering plus structured GenUI for menu discovery, cart editing, fulfillment, payment, tracking, support, and reviews.
2. **Governed commerce execution:** A deterministic graph and typed tools own business state and side effects. OpenAI performs tool planning and response composition but does not directly mutate commerce state.
3. **Human operations:** Runtime-derived confidence, risk, priority, order stage, warning state, human takeover, AI pause, operator assignment, and contextual AI resume are visible in the live monitor.
4. **Reliability and proof:** Durable events, idempotency, rapid-message coalescing, replaceable commerce adapters, LangSmith evaluation, deployed browser evidence, and outcome-level judging.

## Differentiating Capabilities

The submission copy must include these implemented or demonstrated capabilities:

- First-party KFC chat, Messenger, and Zalo channel boundaries sharing persisted conversation and dashboard state.
- Structured GenUI attachments and actions for menu, cart, fulfillment, payment, tracking, support, and review flows.
- Typed tool contracts and deterministic ownership of cart, order, payment, and dashboard state.
- Human-control lifecycle: warning or escalation, AI pause, operator control, assignment visibility, and AI resume with preserved context.
- Runtime-derived session intelligence, including order stage, automation confidence, risk label, priority, and agent-control mode.
- Rapid-message coalescing, superseded-run handling, duplicate webhook protection, and idempotent delivery processing.
- Cloudflare Worker runtime with Queue-backed webhook processing and D1 persistence for turns, events, and delivery records.
- TinyFish-powered crawling of official KFC Vietnam sources for source-backed catalog data, with provenance, capture time, and URL validation retained in the data-refresh workflow.
- Replaceable commerce gateway contracts with simulated OMS/POS scenarios covering success, rejection, timeout, compensation, duplicate suppression, cancellation, and conflicting state.
- Evidence gates using scenario replay, durable artifacts, LangSmith traces and evaluators, deployed browser proof, and business-outcome judgments.

## Claim Boundaries

The copy must remain explicit about evidence boundaries:

- KFC fixtures are mock upstream/API data, not KFC's production system of record.
- TinyFish crawls public official sources; it does not provide or imply access to KFC's private APIs or production databases.
- OMS/POS orchestration is demonstrated through replaceable simulated adapter contracts.
- Do not claim compatibility with KFC's private APIs, a production OMS/POS, or production readiness.
- Distinguish deterministic fixture-backed tests from live OpenAI execution and deployed browser proof.
- Use “demonstrated,” “implemented,” or “verified” only where the repository or deployed evidence supports the statement.

## Portal Copy Changes

Update these KFC submission fields:

- **Elevator pitch:** Lead with the AI commerce operating system outcome and mention governed order execution plus human operations.
- **About the project:** Rewrite all template sections around the four-layer narrative and differentiating capabilities.
- **Built with:** Keep only verified technologies, include TinyFish for data crawling, and add the important runtime/orchestration components where the portal allows custom entries.
- **Technology partner explanation:** Explain OpenAI's bounded role in planning and language generation while deterministic tools retain business-state authority. Explain that TinyFish crawls official KFC Vietnam sources and preserves provenance for the source-backed catalog refresh workflow.

Keep the project title and target unchanged:

- Project title: `KFC Chatbot & Management dashboard`
- Track: `F&B powered by KFC`
- Problem statement: `P4: AI-powered conversational ordering via chat`

## Verification

Before saving the revised draft:

- confirm the KFC project still targets only KFC P4;
- confirm the separate PhongVu project remains unchanged;
- preview the Markdown for readable headings and bullets;
- verify all URLs and selected technology chips remain intact; and
- advance only to the submission review page, without accepting rules or submitting the project.
