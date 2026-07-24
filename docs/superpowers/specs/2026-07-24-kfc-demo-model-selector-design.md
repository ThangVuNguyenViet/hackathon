# KFC demo model selector design

## Goal

Add a compact model selector to the Flutter KFC demo chatbot. A customer can
switch models during an existing conversation without losing message history.
Messenger remains pinned to the configured default, GPT-4.1 mini.

## Product behavior

- The demo starts with GPT-4.1 mini selected.
- Available demo candidates are:
  - GPT-4.1 mini
  - DeepSeek V4 Flash
  - Qwen 3.7 Max
  - MiniMax M3
- The selected model applies to the next submitted message and remains selected
  until changed.
- Switching models does not clear or fork the conversation.
- A run already in progress keeps the model captured when that run started.
- The selector is disabled while a run or customer confirmation is active.
- Each completed assistant response shows a subtle model label so mixed-model
  conversations remain understandable.
- If a selected candidate is unknown or unavailable, the request fails
  explicitly. The backend must not silently fall back to another model.
- Messenger does not send or accept a demo model override and continues using
  the server-configured GPT-4.1 mini binding.

## UI

Use the existing `shadcn_ui` dependency and add a single `ShadSelect` to the
composer footer. The trigger is a compact pill that shows the selected model.
The menu presents the four full model names with their provider labels. Four
options do not justify searchable selection, grouping, a settings sheet, or a
separate model-management screen.

On narrow layouts the trigger may use the short model label, but the option
rows retain full names. The selector follows the existing KFC typography,
spacing, borders, focus treatment, and keyboard behavior.

The model label on assistant messages is secondary metadata rather than another
chat bubble. It must not compete with customer-facing content or GenUI.

## Request and runtime contract

Add a dedicated optional `candidateId` field to the KFC demo run request. Do not
place the selection in generic request metadata.

The request schema validates the field against the server-owned live-candidate
allowlist. The customer-run coordinator snapshots the resolved candidate and
its full identity onto the accepted run before deferred execution. Execution
uses that snapshot even if the browser selection changes later.

The server exposes configured model bindings as a candidate-keyed collection.
Only candidates with configured credentials are runnable. The default binding
remains GPT-4.1 mini.

The existing session-wide immutable model binding changes to per-run
provenance for KFC demo runs. Each resulting user/assistant turn records the
resolved candidate identity needed for audit and transcript presentation.
Conversation history remains shared across candidates.

Messenger continues through its existing path with no request-level candidate
field. Its run construction supplies the configured default identity directly.

## Data flow

1. The Flutter controller stores the selected candidate, initially
   `openai-gpt-4.1-mini`.
2. Submitting text or a trusted GenUI action sends that candidate with the demo
   run request.
3. The backend validates and resolves the candidate to a configured binding.
4. The accepted run snapshots the model identity.
5. Deferred execution uses the run snapshot and the existing shared
   conversation context.
6. Streaming completion events expose safe model identity metadata.
7. Flutter materializes the assistant message with its model label.

## Error handling

- Unknown candidate: reject the run with `invalid_agent_candidate`.
- Known candidate without configured credentials: reject with
  `agent_candidate_unavailable`.
- A failed model request remains attributed to its captured candidate.
- No candidate field: use GPT-4.1 mini for backward-compatible demo clients.
- Model selection never changes authorization, GenUI authority, tool access, or
  commerce behavior.

## Testing

Backend tests:

- request schema accepts the four live candidates and rejects unknown values;
- a run snapshots the selected candidate before deferred execution;
- two turns in one session can use different candidates and retain history;
- changing selection cannot alter an already accepted run;
- absent selection uses GPT-4.1 mini;
- unavailable candidates fail without fallback;
- Messenger continues to use GPT-4.1 mini and cannot select another model;
- persisted and streamed assistant provenance matches the model that ran.

Flutter tests:

- the selector defaults to GPT-4.1 mini and lists four candidates;
- changing selection retains the transcript;
- the selected candidate is included in subsequent text and GenUI submissions;
- the selector is disabled while a run is active;
- assistant messages show their actual model label;
- narrow layout remains usable.

## Scope boundaries

- No model parameter controls, provider credential UI, model search, favorites,
  comparison mode, parallel responses, or model-specific prompts.
- No StateGraph change.
- No change to Messenger model selection.
- No silent provider or candidate fallback.
