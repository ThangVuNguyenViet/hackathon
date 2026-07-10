# KFC Conversational Ordering

This context defines the domain language for the KFC conversational ordering assistant, its live monitor, and operator handoff workflows.

## Language

**Order Stage**:
The operator-facing lifecycle position of a monitored customer session as it moves from gathering order details through cart readiness, fulfillment/payment issues, and confirmed order state.
_Avoid_: Order state, status, latest event

**AI Automation Confidence**:
The system's confidence that the AI can continue handling a monitored customer session without human takeover.
_Avoid_: Confidence, model confidence, planner confidence, customer risk

**Risk Level**:
The operator-facing severity of a monitored customer session based on current customer, payment, fulfillment, safety, or handoff conditions.
_Avoid_: Confidence, priority

**Priority Rank**:
The ordering signal used by the live monitor to decide which sessions should appear first for operator attention.
_Avoid_: Risk, confidence

**Interruption**:
A newer customer message that arrives before an assistant reply is delivered and should steer the pending response. The latest pending customer intent wins until an irreversible side effect has happened.
_Avoid_: Cancellation, retry, duplicate webhook, multi-agent routing

**Irreversible Side Effect**:
An action that the assistant must not silently undo during interruption, including placed orders, payment-link creation, handoff, confirmed voucher/reward acquisition or redemption, and delivered human-agent messages.
_Avoid_: Any tool call, cart preview, menu lookup

**Reversible Cart Mutation**:
A cart change that may be corrected during interruption because no irreversible side effect has happened yet. The final delivered reply should describe the corrected cart state, not the stale intermediate mutation.
_Avoid_: Order cancellation, payment cancellation

**Pre-Order Cancellation**:
A customer message that cancels the current ordering attempt before an irreversible side effect has happened. It abandons the pending ordering intent without human handoff or error handling, while preserving the transcript.
_Avoid_: Refund, post-order cancellation, webhook failure

**Post-Commit Follow-Up**:
A customer message that arrives after an irreversible side effect has happened. It does not replace the completed action; the assistant handles it in the context of the placed order, payment link, handoff, or delivered human message.
_Avoid_: Interruption replacement, silent undo

**Human-Paused Session**:
A session where a human agent has taken over. Customer messages are persisted for the human/operator flow and do not trigger normal AI interruption or coalesced AI replies until AI is explicitly resumed.
_Avoid_: Interruption, AI auto-reply

**Unsupported Attachment**:
A customer attachment that the ordering assistant cannot use as structured ordering input. It is persisted and may receive a short text-request acknowledgement, but it does not steer or cancel a pending text-based ordering response.
_Avoid_: Interruption, order evidence

**Latest Run Typing State**:
The customer-facing typing indicator for the newest valid AI run in a session. Superseded runs must not turn typing off while a newer valid run is still pending.
_Avoid_: Per-message typing state, stale run typing state

**Natural Coalesced Reply**:
A customer-facing assistant reply that addresses the latest pending customer intent without exposing internal run coordination. It may mention a correction when useful, but must not describe supersession or coalescing mechanics.
_Avoid_: Superseded run, coalesced batch, internal steering

**Pending Customer Intent**:
The latest unresolved customer intent formed from one or more steering text messages before an assistant reply is delivered or an irreversible side effect commits.
_Avoid_: Raw webhook event, duplicate retry, individual text only

**KFC Source**:
The first-party Flutter customer chat surface for KFC-owned ordering, treated as an operator-visible conversation source with the same backend, transcript, monitor, handoff, and proof expectations as Messenger and Zalo.
_Avoid_: Retired mock-only source, fixture chat, demo chat, hidden web session

**GenUI Snapshot**:
The immutable customer-facing attachment stored with an assistant turn, including its identity, lifecycle/status, widget kind, title, data, and available actions.
_Avoid_: Widget hint, regenerated UI, current state projection

**GenUI Action Capability**:
An action the customer is authorized to invoke because it was offered by a GenUI Snapshot delivered in the same session, including its allowed inputs, lifecycle, and applicable session-state version.
_Avoid_: Arbitrary client action, UI event name, trusted client payload

**Idempotent Replay**:
The repeated observation of the original completed outcome when the same session request identity and canonical intent are submitted again, without repeating assistant reasoning or side effects.
_Avoid_: New customer turn, regenerated answer, automatic retry with new identity

**Action Reservation**:
The exclusive claim that binds one single-use GenUI Action Capability to the customer request that began consuming it, preventing another request from performing the same action concurrently.
_Avoid_: Completed side effect, action result, UI disabled state

**Durable Session Fingerprint**:
The canonical identity and content summary of a persisted conversation's turns, GenUI Snapshots, evidence events, and monitor projection, used to prove that the same session survives runtime replacement without replay or recalculation.
_Avoid_: Screenshot identity, browser cache, runtime object snapshot, regenerated summary
