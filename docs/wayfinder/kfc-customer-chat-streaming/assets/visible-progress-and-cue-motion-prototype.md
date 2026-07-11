# Visible Progress And Cue Motion Prototype

## Decision

Use a **compact morphing response block** at the assistant edge of the transcript. It begins as a claim-free activity cue, replaces that cue with one verified customer-safe status, and then becomes the assistant response without creating a second typing bubble. The KFC mark remains spatially stable while the content changes.

This is a behavior and motion prototype, not executable Flutter code. It does not invent runtime events, add Cue to the app, or decide the streaming contracts owned by later tickets.

## Approaches considered

### 1. Compact morphing response block — selected

A small KFC mark anchors one line of progress. At the first text delta, the same block expands into the response, retaining a muted completion summary above the streamed text.

- Closest to the restrained Claude/Codex feel.
- Makes progress and answer read as one continuous response.
- Uses little vertical space and does not resemble a technical activity log.
- Keeps the motion model small: entrance, semantic replacement, and progress-to-answer morph.

### 2. Full assistant progress bubble — rejected

Place every active status inside the same bordered bubble style as a completed assistant message.

- Stronger visual grouping, but gives a transient status too much weight.
- Produces an awkward bubble-to-bubble handoff when response text begins.
- Makes short no-tool turns feel slower and heavier.

### 3. Expandable work log — rejected

Show a collapsed heading with optional historical steps.

- Offers more apparent transparency, but conflicts with the single-status domain model.
- Encourages exposure of planner/tool detail and turns internal churn into customer UI.
- Adds interaction, accessibility, and ordering complexity without helping ordering completion.

## Visual anatomy

The response block is left-aligned and uses the existing transcript width. It is not surrounded by a large card while progress is active.

```text
┌─────┬─────────────────────────────────────────┐
│ KFC │  ●  Đang kiểm tra menu…                │
└─────┴─────────────────────────────────────────┘
```

- **Anchor:** a 28–32 px KFC mark, smaller than the header mark and fixed across the run.
- **Activity cue:** a small three-dot cue before evidence exists; a single restrained red activity dot after a semantic status exists.
- **Status:** Be Vietnam Pro, 13 px, regular/medium weight, existing secondary text color.
- **Width:** content-sized on wide layouts; constrained to the assistant transcript width. On narrow screens, copy may wrap to two lines and must not truncate canonical wording.
- **Color:** KFC red is an accent for activity and Stop, not a filled progress surface. Completion uses success color only for the small check mark. Failures use critical text without a large alarming banner.
- **Spacing:** 8 px between mark, cue, and text; enough height for a 44 px Stop target without making the progress row itself button-like.

## Stateboard

### 1. Immediate claim-free waiting

Shown immediately after Send, before run acceptance or semantic evidence.

```text
[KFC]  •  •  •
```

The dots breathe with low amplitude. There is no label such as “thinking,” “checking,” or “working,” because no backend fact supports one yet.

### 2. Verified semantic progress

The first accepted customer-safe family replaces the dots. Exactly one active status is visible.

```text
[KFC]  ●  Đang xem yêu cầu của bạn…
                 ↓ verified family changes
[KFC]  ●  Đang kiểm tra menu…
                 ↓ verified mutation begins
[KFC]  ●  Đang cập nhật giỏ hàng…
```

Repeated events in one family do not animate. A later distinct family replaces the current line; no checklist or history is added.

### 3. Response composition

If composition lasts long enough to be perceptible, the semantic line becomes:

```text
[KFC]  ●  Đang chuẩn bị câu trả lời…
```

Immediate deterministic responses may skip this state.

### 4. First text delta and loading-to-done collapse

At the first text delta, the active progress line becomes a muted completion summary and the answer begins in the same response block.

```text
[KFC]  ✓  Đã kiểm tra menu và cập nhật giỏ hàng.
       Mình đã thêm Combo Hợp Gu 99K vào giỏ…
```

- The KFC mark does not jump.
- The summary is smaller and visually secondary to the answer.
- Text grows naturally; individual tokens do not fade, bounce, or slide.
- No separate typing indicator remains.
- For an immediate no-tool answer, omit the summary and render the text directly.

### 5. Progressive GenUI snapshots

The latest complete valid GenUI snapshot appears below the streamed text in the same assistant response block.

```text
[KFC]  ✓  Đã kiểm tra menu.
       Mình gợi ý các combo sau:

       ┌──────────────────────────────┐
       │ complete GenUI snapshot r1   │
       └──────────────────────────────┘
                         ↓ valid r2 replaces r1 atomically
       ┌──────────────────────────────┐
       │ complete GenUI snapshot r2   │
       └──────────────────────────────┘
```

- Never animate individual fields or incomplete component patches into view.
- A new valid revision crossfades and gently resizes the whole snapshot region.
- The final authoritative snapshot settles without an extra “done” celebration.
- Revision labels shown above are explanatory only and never appear in customer UI.
- Exact revision, validation, and authority semantics remain owned by **Design Versioned GenUI Structural Streaming**.

### 6. Stop

While the lifecycle says Stop is safe, replace the composer Send affordance with a 44 px stop control using a square-in-circle icon and the accessibility label `Dừng trả lời`.

```text
[KFC]  ●  Đang kiểm tra menu…                   [ ■ ]
                         customer taps Stop
[KFC]  ●  Đang dừng…                            [disabled]
                         durable cancellation
[KFC]  ■  Đã dừng.
```

Retain partial text with a subdued `Chưa hoàn tất.` marker. Remove provisional GenUI. Do not imply reversal of an irreversible action. Exact safe points remain owned by **Design Run Lifecycle, Ordering, Replay, And Recovery Contracts**.

### 7. Reconnect

Freeze the last verified status and add one secondary line. Do not replace the semantic status with a spinner.

```text
[KFC]  ●  Đang kiểm tra menu…
            Đang kết nối lại…
```

The connection line uses a subtle opacity breath. After replay catches up it disappears, and the response block continues from authoritative state without an entrance replay.

### 8. Terminal failure

Replace active progress with the approved phase-specific customer wording.

```text
[KFC]  !  Chưa thể cập nhật giỏ hàng.
```

Use a small critical icon/text treatment rather than the current full-width raw-error banner. Show Retry only when the later lifecycle decision proves it safe and idempotent. Never expose the exception.

### 9. Supersession

- If the older run has no text, remove its empty response block without an exit flourish.
- If partial text exists, retain it and add `Đã dừng câu trả lời trước.` beneath it.
- Create the active response block only for the newest valid run.
- Preserve completed irreversible outcomes as normal transcript evidence.
- Never show “superseded,” run IDs, or coordination detail.

## Cue motion specification

Cue is a future implementation dependency; it is not currently declared by the Flutter app. Use declarative triggers and one Cue scene per coordinated transition group.

| Transition group | Cue intent | Visible acts | Motion |
|---|---|---|---|
| Response-block entrance | Mount once for a newly accepted customer send | Fade in plus 4–6 px upward settle | `.smooth()`; approximately 160–220 ms perceptual duration |
| Claim-free activity | Ambient loop within the waiting scene | Three dot opacity/scale breaths with 120 ms stagger | Gentle, low amplitude, roughly 1.1 s cycle |
| Semantic status replacement | Restart only when the projected family key changes | Old copy fades; new copy fades with a 2–4 px vertical settle | `Cue.onChange`, `.smooth()`; no bounce |
| Progress to response | Change once at the first text delta | Activity cue becomes check/summary; answer region reveals and sizes naturally | One `Cue.onChange` scene using fade plus gentle size/clip; `.smooth()` |
| GenUI revision replacement | Change only after a complete valid snapshot is accepted | Whole snapshot crossfade plus gentle height adjustment | One revision scene; `.spatial()` for size and `.smooth()` for opacity |
| Reconnect line | Toggle on transport loss | Secondary line fades and clips open; low-amplitude opacity breath while disconnected | `.gentle()`; no movement of frozen status |
| Terminal/cancelled state | Change once on durable terminal evidence | Active indicator and copy crossfade to terminal icon/copy | `.smooth()`; failure does not shake |

Implementation constraints inherited from Cue:

- Use a widget class for each reusable response-block part; do not use widget-returning helper functions.
- One `Cue` coordinates each transition group; stagger child `Actor`s rather than nesting independent scene triggers.
- Always provide an explicit motion.
- Prefer declarative `onMount`, `onChange`, and `onToggle`; no imperative controller is needed by this prototype.
- Add debug labels to the progress, response-morph, reconnect, and GenUI scenes so deterministic tests can identify them.

## Pacing and churn control

- Show the claim-free cue immediately.
- A semantic status is eligible only after its evidence arrives. Never generate labels from elapsed time.
- Coalesce rapid family changes into the latest verified family rather than flashing every state. Target a 250 ms stabilization window and a 600 ms minimum visible dwell for ordinary semantic changes.
- First text, terminal outcomes, Stop acknowledgement, and reconnect are priority transitions and bypass the ordinary dwell.
- Do not replay entrance motion after reconnect or event replay.
- Do not animate scroll on every text delta; keep the latest response visible without fighting a customer who has scrolled upward.

The numbers are prototype targets for motion tuning, not transport timing guarantees.

## Reduced motion

When the platform requests reduced motion:

- replace repeating dots with a static three-dot mark;
- use `CueMotion.none` for entrance, status replacement, response morph, reconnect, terminal, and GenUI revision scenes;
- keep all state and text updates functionally identical;
- retain icons, copy, and color so meaning never depends on motion;
- do not auto-animate transcript scrolling.

## Accessibility and interaction

- Announce only distinct semantic statuses through a polite live region; dot cycles and repeated evidence are silent.
- The first text delta announces the answer, not both the completion summary and the same answer simultaneously.
- Stop has a 44 px minimum target and a stable Vietnamese semantic label.
- Status, failure, reconnect, and completion remain distinguishable without color.
- Dynamic type may wrap progress to two lines; it must not clip canonical copy.
- GenUI replacement preserves sensible focus. A revision must not steal focus or silently activate an action.

## Acceptance walkthroughs

### Menu then cart

1. Send creates a claim-free three-dot response block.
2. Verified run start produces `Đang xem yêu cầu của bạn…`.
3. Verified menu lookup start produces `Đang kiểm tra menu…`.
4. Verified cart mutation start produces `Đang cập nhật giỏ hàng…`.
5. First text delta morphs the row to `Đã kiểm tra menu và cập nhật giỏ hàng.` and streams the answer beneath it.
6. A complete valid cart snapshot appears atomically beneath the text.

### Reconnect during lookup

1. `Đang kiểm tra menu…` remains frozen.
2. `Đang kết nối lại…` appears as the secondary line.
3. Replay removes the secondary line and advances only from durable evidence.
4. Entrance and already-observed status animations do not replay.

### Stop during partial answer

1. The composer exposes Stop while cancellation is allowed.
2. Tap changes the row to `Đang dừng…` and disables repeated taps.
3. Durable cancellation changes it to `Đã dừng.`.
4. Existing partial text remains with `Chưa hoàn tất.`; provisional GenUI is removed.

### Reduced motion

The same scenario and copy render with static state changes, no looping dots, no crossfades, no size morphs, and no animated scrolling.

## Boundaries for later tickets

- **Design Text-Delta Streaming And Partial-Response Safety** defines buffering, chunk reduction, first-delta authority, incomplete markers, and transcript persistence.
- **Design Versioned GenUI Structural Streaming** defines revision validation, provisional versus authoritative state, atomic replacement, and action compatibility.
- **Design Run Lifecycle, Ordering, Replay, And Recovery Contracts** defines Stop eligibility, supersession, terminal reduction, gaps, replay, and reconnect truth.
- **Design Test Matrix And Feature-Flagged Rollout** turns these motion targets into widget, golden, semantics, reduced-motion, and deterministic-timing coverage.

No additional child ticket is required by this prototype.
