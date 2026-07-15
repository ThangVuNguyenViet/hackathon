# KFC Showcase Replay Design

## Purpose

Add an unlinked public `/demo` surface for presenting PM-curated KFC conversation scenarios to the CTO. Every scenario has independent GenUI and text-only views, a retained complete real-AI result, and a Replay action that runs the fixed customer turns again against the deployed assistant.

This surface demonstrates behavior. It does not author scenarios, grade results, or establish automated-test acceptance.

## Scenario Ownership

- LangSmith annotation queues handle production-trace review, corrections, and human acceptance.
- One designated LangSmith dataset contains Showcase Scenarios: fixed text customer turns plus human-authored acceptance criteria.
- Seed that dataset initially from the nine repo-owned conversation scenarios.
- Assistant replies are never golden wording in the dataset.
- Engineering manually decides whether a Showcase Scenario is worth porting into the repo-owned JSON scenario contracts and tests.
- `/demo` has no create, edit, or delete controls.

## Showcase Flow

1. Opening `/demo` lists the Showcase Scenarios from the designated LangSmith dataset.
2. Selecting a scenario opens its chat presentation and read-only acceptance criteria.
3. GenUI and Text are separate tabs. Each tab has its own latest complete Showcase Result and Replay action.
4. Replay creates a new isolated backend conversation and sends the fixed text customer turns sequentially, waiting for each assistant response to complete before sending the next turn.
5. The initiating browser renders the new transcript turn by turn. Active progress is browser-local and is not synchronized with other viewers.
6. The prior complete result remains available during Replay.
7. Only a fully completed Replay replaces the server-persisted result for that scenario and mode. Failure leaves the prior result intact and reports the failed attempt separately.

## Runtime Truth

- Replay uses the deployed backend and real OpenAI planner/composer models.
- Commerce behavior uses the deployed sandbox fixture environment because live KFC commerce and POS integrations do not exist.
- GenUI and text-only modes use identical assistant capabilities, tools, fixtures, and customer turns. Only response presentation differs.
- GenUI widgets are rendered as returned. Replay does not script or invoke widget actions.
- Replay is public and unauthenticated. This is a deliberate current constraint; do not add auth, CAPTCHA, cross-viewer coordination, or a rate-limit subsystem.

## Result Evidence

Each Showcase Result includes:

- the complete customer and assistant transcript;
- returned GenUI evidence in GenUI mode;
- generation time;
- response mode;
- deployed release SHA;
- planner and response model names;
- LangSmith trace link.

Acceptance criteria appear beside the transcript as presentation context. `/demo` does not run a new evaluator and must not invent pass/fail badges. Existing executable-test or LangSmith evaluation status may be shown only when supplied as external evidence.

## Interface Direction

Use a restrained “KFC Test Kitchen” presentation: warm paper, ink, and KFC-red tokens; scenario cards inspired by kitchen tickets; and the conversation as the dominant surface. Reuse the existing Be Vietnam Pro font, Shad components, theme tokens, and responsive primitives. Add no design dependency.

The desktop layout uses a scenario rail and conversation workspace. Compact layouts collapse the rail and keep GenUI/Text as tabs. Motion is limited to replay progress and turn arrival so it supports, rather than distracts from, the CTO walkthrough.

## Flutter State

Keep beacons in a dedicated `BeaconController`:

- a future beacon loads the scenario catalog and retained results;
- a writable beacon holds the selected scenario and response mode;
- a mutation owns the browser-local Replay attempt;
- derived state selects the visible retained or active transcript.

Widgets consume state with `watch`/`observe`. Do not add widget-owned beacons or manual loading flags.

## Persistence and Integration

- Read the LangSmith dataset through the backend; never expose the LangSmith API key to Flutter.
- Reuse the existing deployed-assistant run path for each fixed customer turn.
- Reuse the existing durable conversation transcript and GenUI snapshot representation.
- Persist only the small mapping needed to identify the latest complete result for each scenario and mode; failed attempts never update it.
- Add LangSmith `session_id` metadata to agent traces so multi-turn Replay conversations group correctly as threads.
- The public route is selected within the existing Flutter web app; do not add a routing package solely for `/demo`.

## Meeting Preparation

Provide one manual showcase-seed command. It runs all Showcase Scenarios in both modes, preserves older results when individual runs fail, and reports missing or stale scenario/mode pairs. It is a pre-meeting operation, not part of every deployment.

## Verification

Leave the smallest checks that protect the feature:

- backend contract tests for LangSmith dataset mapping, sequential turn execution, mode parity, and promote-on-complete persistence;
- one replay failure check proving the previous complete result survives;
- focused Flutter controller and widget tests for catalog loading, mode tabs, Replay progress, fallback access, and evidence rendering;
- static analysis and existing focused backend/Flutter suites;
- one credentialed seed against the deployed Worker before handoff.

## Non-Goals

- Scenario CRUD or approval in `/demo`.
- Automatic synchronization into repo-owned tests.
- New acceptance grading.
- Golden assistant wording.
- Scripted GenUI actions.
- Live KFC commerce or POS calls.
- Multi-presenter synchronization.
- Authentication or abuse prevention in this version.
- Running all scenarios during every deployment.
