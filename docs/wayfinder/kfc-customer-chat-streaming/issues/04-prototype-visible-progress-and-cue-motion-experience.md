Status: resolved
Type: prototype
Labels: wayfinder:prototype
Parent: ../map.md
Blocked by: 01-audit-runtime-evidence-available-to-customer-streaming.md, 03-define-customer-safe-progress-language-and-projection-rules.md
Assignee: Codex

## Question

What should the Claude/Codex-inspired visible progress experience look and feel like in the KFC Flutter customer chat? With the user in the loop, create the smallest reviewable prototype covering initial loading, verified semantic status changes, transition to streaming text, loading-to-done collapse, partial text, progressive GenUI snapshots, Stop, reconnect, failure, supersession, and reduced motion. Use the `cue-animations` skill and keep motion subtle and coordinated through one Cue scene per transition group. The prototype must not depend on fabricated runtime claims and must not implement production behavior.

## Answer

The user delegated the detailed product choices after establishing the Claude/Codex direction and subtle-loading preference. The [Visible Progress And Cue Motion Prototype](../assets/visible-progress-and-cue-motion-prototype.md) selects a compact morphing response block: an immediate claim-free dot cue becomes one verified semantic status, then transforms at the first text delta into a muted deterministic summary above naturally streaming text. Complete valid GenUI snapshots replace atomically below the response.

Stop lives in the composer, reconnect is a secondary line over frozen verified progress, terminal failures remain compact and customer-safe, and superseded empty blocks disappear without exposing coordination detail. Cue motion is declarative, subtle, and coordinated through one scene per transition group; reduced motion preserves every state while removing loops, fades, morphs, and animated scrolling.
