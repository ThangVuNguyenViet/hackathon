# HTTP/D1 live scenario bridge

This command is a thin stdin/evidence bridge over an already-running KFC chat
service and its D1-backed protected evidence APIs. It does not construct or
call a model locally. A Codex role-player uses its own subscription, reads only
the emitted narrative, then improvises one customer turn or observed action at
a time.

## Start one attempt

From `services/kfc-agent-backend`:

```bash
export KFC_AGENT_BACKEND_URL='https://<deployed-worker>'
export KFC_DEMO_ADMIN_TOKEN='<protected-evidence-token>'

npm run scenario:live -- \
  --scenario ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.json \
  --candidate openai-gpt-4.1-mini \
  --run-id openai-gpt-4.1-mini-s02-a1 \
  --attempt 1
```

`--candidate` is an expected deployed binding, not a local model selection. The
bridge fails before customer work when deep readiness reports a different
candidate. `--customer-id` may override the default fresh identity
`live-<run-id>`. `--base-url` may be used instead of
`KFC_AGENT_BACKEND_URL`.

The command prints a `session_ready` JSON object containing the held-out
narrative, deployed environment manifest, and protocol. Send newline-delimited
JSON:

```json
{"type":"user","text":"Bọn mình có bốn người nhưng chưa biết chọn gì, tư vấn giúp nhé."}
{"type":"action","assistantTurnId":"<observed assistant ID>","attachmentId":"<observed attachment ID>","actionId":"<observed action ID>"}
{"type":"finish","note":"Role-player judged the narrative exploration complete."}
```

User text is forwarded byte-for-byte as supplied in the JSON value. Assistant
records include customer-safe text, the complete returned GenUI snapshot, and
its action IDs. The role-player may submit one exact observed
`assistantTurnId`/`attachmentId`/`actionId` tuple. The bridge validates that
tuple against prior output and forwards it; it never chooses an action,
constructs action payloads, or synthesizes a reference. The chat service
independently verifies the assistant-turn and D1 attachment authority.
Both forwarded turn kinds use authenticated live-scenario chat endpoints. The
service converts the validated scenario/run correlation into its server-issued
agent trace context, so every agent turn is queryable in LangSmith by the same
`scenarioId` and `probeRunId` preserved in the evidence packet.
After a recommendation offer is successfully written to stdout, the bridge
records the exact server-authored impression binding once, matching the real
client's impression-after-render boundary.

Do not copy, enumerate, pipe, or automatically feed `scenario.turns`. They are
historical narrative examples, not a replay script. There are no required
words, semantic assertions, or exact tool sequences.

## Evidence

Every attempt owns a new, non-overwritable directory:

```text
.artifacts/kfc-live-scenarios/<runId>/
├── manifest.json
├── environment.json
├── trace.jsonl
├── transcript.md
├── evidence-packet.json
└── codex-review-packet.md
```

`environment.json` preserves deep readiness: deployed release/source commit,
agent and monitor bindings, recommendation shadow/model revision, Sanity
snapshot binding, and LangSmith project configuration. `trace.jsonl` preserves
the exact stdin/HTTP timeline and every rendered action reference.

On `finish`, the bridge fetches the protected KFC proof envelope plus the
correlated recommendation inspection and order-flow state. The self-contained
`evidence-packet.json` therefore contains:

- the improvised transcript and full customer-safe GenUI responses;
- exact rendered and submitted action references;
- the final D1 pack state and cumulative tool trace;
- complete append-only recommendation events for the active order flow;
- detailed redacted recommendation technical evidence;
- LangSmith trace references;
- model, shadow/model revision, and Sanity bindings;
- deployed and bridge source commits; and
- the complete environment manifest.

The final manifest contains SHA-256 digests for every evidence artifact and
independently pins the scenario source SHA-256. Configured credentials,
secret-shaped keys, bearer values, and authorization/cookie headers are
redacted before local write. Narrative customer and assistant prose remains in
the transcript by design. Protected technical evidence is fetched only with
the admin credential and the credential itself is never persisted.

Failed attempts are evidence. Never reuse a run ID or delete its directory.
Start a retry with a distinct run ID and incremented `--attempt`.
EOF or a control-stream failure records protocol evidence and terminalizes the
attempt as `abandoned`. An explicit finish marks it `completed` only when the
protected proof envelope reports complete final D1 evidence. An incomplete
HTTP 409 envelope is preserved in the packet, marks the attempt `failed`, and
causes the bridge to exit nonzero.

## Independent review

Give `codex-review-packet.md` to a fresh evaluator that did not implement the
behavior. The evaluator should judge the transcript as a whole: narrative goal
handling, grounding in tool evidence, customer authority, natural recovery,
and safety. It must not impose exact wording or an exact tool sequence. The
verdict vocabulary is `successful`, `partial`, `unsuccessful`, or
`insufficient_evidence`, with evidence citations.
