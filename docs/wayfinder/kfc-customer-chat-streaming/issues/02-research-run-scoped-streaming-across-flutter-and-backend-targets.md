Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by:
Assignee: Codex

## Question

Can an idempotent run-start request plus run-scoped SSE provide reliable semantic progress, text deltas, GenUI snapshots, replay, cancellation, and terminal outcomes across the repo's Flutter targets, local Fastify server, and Cloudflare Worker deployment? Compare it with a single streaming POST and WebSocket transport using current platform constraints. Resolve connection setup, authentication/CORS, buffering, reconnect cursors, persistence, heartbeat, cancellation signaling, resource cleanup, and synchronous fallback. Produce an architecture recommendation and risks; do not implement it.

## Answer

The source-backed [Run-Scoped Streaming Across Flutter And Backend Targets](../assets/run-scoped-streaming-architecture.md) decision adopts an idempotent run-start POST, queue-independent execution, a durable run event log, and an authenticated replay-first SSE GET parsed through `package:http` on Flutter web and native. A JSON long-poll view over the same event log is the buffering fallback.

Cloudflare Queue plus an atomic D1 claim keeps execution alive independently of the SSE request and tolerates at-least-once delivery. Local Fastify uses the same repository/scheduler boundary with immediate dispatch and recovery. Stream loss never means cancellation; Stop is an explicit run command. The legacy synchronous endpoints remain available only when selected before a new run is accepted.

A single streaming POST is rejected as the primary contract because reconnect cannot reattach safely and Worker work may be cancelled after disconnect. WebSocket is deferred because it still needs the durable replay log while adding bidirectional connection state and a native Flutter implementation absent from the repo.
