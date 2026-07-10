# KFC Human Takeover And AI Resume Design

Date: 2026-07-09
Status: Design spec; backend slice partially implemented before this spec was written
Scope: `/Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend` and `/Users/vietthangvunguyen/Workspace/hackathon/apps/kfc_live_monitor_flutter`

## Purpose

KFC's monitor app must let a real operator take over an angry or risky conversation, stop the AI from replying while the operator is active, and later resume AI handling with the full local transcript of what happened during takeover.

The product behavior is:

1. A customer becomes angry or requests help.
2. The AI escalates and the monitor shows a warning or needs-human state.
3. A human operator joins the session.
4. New customer messages are persisted but the AI does not respond.
5. The operator can send messages from the monitor.
6. The operator exits and explicitly resumes AI.
7. The next AI response includes customer and human messages from the takeover period in bounded recent context.

## Design Decision

Use app-owned session control as the source of truth. Do not rely on LangGraph checkpointing or Messenger history as the primary takeover mechanism.

The canonical control state is attached to KFC's app-owned `sessionId`:

```ts
type AgentMode = 'ai_active' | 'human_paused' | 'resolved';
```

The session id remains channel scoped:

```ts
messenger:psid_user_123
zalo:zalo_user_123
```

If LangGraph checkpointing is later added, it must use the same app-owned session id as `thread_id`:

```ts
{ configurable: { thread_id: sessionId } }
```

## Alternatives Considered

### 1. App-Owned Session Gate First

The backend stores `agentMode` per `sessionId`. Webhook handlers check that mode before invoking AI. This is the recommended approach because it directly matches monitor behavior, works for Messenger and Zalo, and does not require migrating `runAgentTurn` into a compiled graph.

### 2. Move Immediately To LangGraph `StateGraph`

LangGraph interrupts are useful for pausing an in-flight graph at a known node, especially before risky tools such as `placeOrder`, `createPaymentLink`, cancellation, refund, or handoff. This is not the right first step because KFC's immediate requirement is session-level pause/resume controlled by the monitor, not exact resume inside an in-flight graph execution.

### 3. Use Messenger History As Source Of Truth

Messenger history sync can reconcile missed messages, but it is not sufficient for runtime control. It does not model monitor actions, human assignment, AI pause/resume, local Zalo/mock parity, or reliable AI-vs-human authorship unless KFC stores that metadata when messages are sent.

## Backend Architecture

### Session Control Store

Add a session-control record per `sessionId`:

```ts
interface SessionControl {
  sessionId: string;
  agentMode: 'ai_active' | 'human_paused' | 'resolved';
  assignedAgentId: string | null;
  updatedAt: string;
}
```

Stores must support:

```ts
getSessionControl(sessionId): Promise<SessionControl>
setSessionControl(sessionId, patch): Promise<SessionControl>
```

Missing rows default to `ai_active`, so existing sessions continue to work.

### Dashboard Control Endpoints

Add backend endpoints for monitor actions:

```http
POST /dashboard/sessions/:sessionId/human-join
POST /dashboard/sessions/:sessionId/human-message
POST /dashboard/sessions/:sessionId/resume-ai
```

`human-join` sets `agentMode = human_paused` and emits a `session_updated` dashboard event:

```json
{
  "updateType": "human_joined",
  "agentMode": "human_paused",
  "agentId": "agent_1"
}
```

`human-message` sends an outbound channel message and stores it as:

```ts
role: 'assistant'
metadata: {
  authorType: 'human_agent',
  agentId: 'agent_1'
}
```

The role remains `assistant` because the customer sees the message as an outbound KFC reply. The metadata distinguishes human-authored replies from AI-authored replies.

`resume-ai` sets `agentMode = ai_active` and emits:

```json
{
  "updateType": "ai_resumed",
  "agentMode": "ai_active",
  "agentId": "agent_1"
}
```

### Webhook Gate

Messenger and Zalo webhook handling must check `agentMode` after dedupe/reservation and before `runAgentTurn`.

When `agentMode = human_paused`:

1. Persist inbound customer message as a `user` turn.
2. Emit monitor-visible `customer_message_received` and `conversation_turn_created` events.
3. Mark webhook delivery processed.
4. Do not call `runAgentTurn`.
5. Do not send an AI reply.

When `agentMode = ai_active`, the existing AI path continues.

### Resume Context

The resumed AI turn uses the existing bounded `recentTurns` assembly. It must include:

- the angry customer message
- the AI handoff/escalation message
- customer messages sent while human was active
- human operator messages stored as assistant turns
- the latest customer message after resume

Tool/system turns remain excluded from prompt context.

## Monitor App Behavior

The monitor should display:

- `Needs Human` when `handoff_required` or `payment_failed` exists and no later takeover event overrides it.
- `Human Joined` when the latest relevant session-control event is `human_joined`.
- `AI Handling` when the latest relevant session-control event is `ai_resumed`.
- `Resolved` when the session is explicitly resolved.

The monitor still needs UI wiring for:

1. Join session.
2. Send human message.
3. Resume AI.
4. Optional resolve session.

These actions should call the dashboard control endpoints and refresh through existing dashboard events/SSE.

## LangGraph Boundary

Do not migrate to `StateGraph` only to manage multi-user sessions. KFC sessions remain app-owned.

Use LangGraph later for in-flight interruption if KFC needs:

- approval before order placement
- approval before payment link generation
- approval before cancellation/refund actions
- exact retry/resume from a graph node
- LangGraph-native graph inspection and checkpoint replay

If this migration happens, the app-owned session id must remain the LangGraph thread id.

## Existing Implementation State

The following pieces were implemented before this spec was written and should be reviewed against this design rather than reverted:

- `AgentMode` and human metadata in backend domain types.
- Session-control storage in memory, D1, and Postgres stores.
- Dashboard routes for human join, human message, and AI resume.
- Messenger/Zalo webhook gate that skips AI during `human_paused`.
- Human outbound messages stored as `assistant` turns with `authorType: human_agent`.
- Backend test for angry escalation, human takeover, and AI resume context.
- Flutter data-layer status mapping for `human_joined` and `ai_resumed`.

## Remaining Work

1. Review and keep or adjust the already-written backend slice.
2. Add monitor repository methods for `human-join`, `human-message`, and `resume-ai`.
3. Add monitor UI controls for the selected session.
4. Add Flutter controller tests for join/send/resume actions.
5. Add a Flutter `integration_test` for the angry takeover flow if the backend can be run in a stable local test configuration.
6. Add D1 migration files if remote Cloudflare D1 deployments use migrations rather than only startup schema initialization.
7. Decide whether to add `resolved` endpoint behavior now or leave it as an existing display state until needed.
8. Keep LangGraph `StateGraph` migration out of this slice unless a separate spec targets in-flight tool approval.

## Test Plan

Backend:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon/services/kfc-agent-backend
npm test -- test/api/human-takeover.test.ts
npm test -- test/channels/messenger-webhook.test.ts test/channels/zalo-webhook.test.ts
npm test
npm run build
```

Flutter data/controller:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon/apps/kfc_live_monitor_flutter
flutter test test/features/live_monitor/data/backend_live_monitor_repository_test.dart
```

Flutter integration test, once UI controls are wired:

```bash
cd /Users/vietthangvunguyen/Workspace/hackathon/apps/kfc_live_monitor_flutter
flutter test --no-pub integration_test/live_monitor_conversation_test.dart -d macos
```

## Acceptance Criteria

- An angry customer scenario emits monitor-visible escalation.
- A human can join the session and the monitor displays `Human Joined`.
- While joined, customer messages are stored but AI does not respond.
- Human-authored replies are stored in the transcript with human metadata.
- A human can resume AI and the monitor returns to AI handling.
- The next AI turn includes takeover-period customer and human messages in bounded context.
- Messenger and Zalo sessions remain isolated by channel-prefixed `sessionId`.
- No LangGraph checkpoint storage is required for this slice.
