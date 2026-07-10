## Destination

The Flutter customer-facing KFC chat proof replays every current backend GenUI scenario JSON through `KfcCustomerChatApp`, captures a chat screenshot after every scripted user turn, and writes a manifest that maps each PNG to scenario, turn, use cases, and expected GenUI widget when applicable.

## Notes

- Execution is in scope for this map because the user explicitly asked to implement the richer Flutter integration proof now.
- Source of truth for scenario coverage is `ai-talent-tracks/fnb/conversations/*.json`.
- Use normal Flutter `integration_test`, not Patrol.
- Keep the live/non-live runner behavior explicit: fixture mode may include live monitor screenshots; live backend mode focuses on customer chat screenshots.

## Decisions so far

## Not yet specified

- Whether a future ninth scenario should be added to the scenario JSON set. Current `main` only contains eight JSON scenarios.
- Whether the old "50 use cases" framing should be restored or the current UC-01..UC-39 taxonomy remains authoritative.

## Out of scope

- Native Messenger/Zalo UI screenshots. This proof is for the dedicated Flutter customer chat app.

