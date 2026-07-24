# Subagent-driven live scenario harness

This harness qualifies a fixed model against a retained narrative without
replaying the narrative's example turns. A Codex role-player reads only the
goal, preconditions, risks, and intended outcome emitted in the initial JSON
record, then improvises the customer conversation one message at a time.

## Start one attempt

From `services/kfc-agent-backend`:

```bash
npm run scenario:live -- \
  --scenario ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.json \
  --candidate qwen3.7-max \
  --run-id qwen3.7-max-s02-a1 \
  --attempt 1
```

The model is constructed once and pinned to the session. Before any customer
turn, the command runs the ordinary-invocation and typed-tool capability
preflight. A failed preflight is recorded and exits without starting the
scenario.

The command prints a `session_ready` JSON object containing the held-out
narrative and protocol. Send improvised customer messages as newline-delimited
JSON:

```json
{"type":"user","text":"Bọn mình có bốn người nhưng chưa biết chọn gì, tư vấn giúp nhé."}
{"type":"user","text":"Mình muốn xem thêm lựa chọn trong tầm ngân sách đó."}
{"type":"finish","note":"Role-player judged the narrative exploration complete."}
```

Do not copy, enumerate, pipe, or automatically feed `scenario.turns`. They are
historical narrative examples, not a replay script. There are no required
words, semantic assertions, or exact tool sequences.

## Evidence

Every attempt owns a new, non-overwritable directory:

```text
.artifacts/kfc-live-scenarios/<runId>/
├── manifest.json
├── preflight.json
├── trace.jsonl
├── transcript.md
└── codex-review-packet.md
```

`trace.jsonl` is append-only and schema-versioned. It records every improvised
user message, assistant response, tool call before adapter validation, complete
raw local-fixture result, model-facing result or error, timestamps, call IDs,
duration, preflight result, and terminal status. Invalid model tool arguments
are retained even when the maintained adapter rejects them before the handler
runs. The readable transcript includes the same tool evidence. Secret-shaped
keys, bearer credentials, and API-key-shaped strings are redacted before local
write.

Tool timing distinguishes the model's `requestedAt` from the queued tool's
`executionStartedAt`; completion records execution duration and correlates the
lifecycle by call ID.

The final manifest includes the session/scenario/probe correlation IDs and
SHA-256 digests for the preflight, JSONL trace, readable transcript, and Codex
review packet. The scenario entry independently pins the exact source-file
SHA-256.

When LangSmith credentials are configured, the same run also receives
sanitized correlation and control-flow tracing. Raw customer text, tool
arguments, tool results, credentials, addresses, and payment details remain
out of LangSmith. Detailed synthetic evidence belongs only to the ignored local
artifact directory.

Failed attempts are evidence. Never reuse a run ID or delete its directory.
Start a retry with a distinct run ID and incremented `--attempt`.
EOF or a control-stream failure records protocol evidence and terminalizes the
attempt as `abandoned`; only the explicit finish command marks it `completed`.

## Independent review

Give `codex-review-packet.md` to a fresh evaluator that did not implement the
behavior. The evaluator should judge the transcript as a whole: narrative goal
handling, grounding in tool evidence, customer authority, natural recovery,
and safety. It must not impose exact wording or an exact tool sequence.
