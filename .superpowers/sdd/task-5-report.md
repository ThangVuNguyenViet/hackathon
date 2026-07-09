## Task 5 Report: Flutter Monitor Display Names, History, And Deeplink States

### What I implemented

- Added typed deeplink support in the live monitor domain with `DeeplinkStatus` and `ChatDeeplink`, plus `customerId` and optional `avatarUrl` on `ChatSession`.
- Updated `BackendLiveMonitorRepository` to map backend `displayName`, `externalUserId`, `avatarUrl`, and typed `deeplink` data from `/dashboard/sessions`.
- Kept customer display names as the primary session label in `SessionCard` and removed any need to show the chat ID in the header.
- Updated the open-chat button to disable itself when the deeplink is unavailable and show the backend reason in a tooltip.
- Updated mock and Patrol fixture sessions plus controller behavior so constructor changes compile and open-session tracking still records the deeplink URL.

### Tests run and exact results

- RED:
  - `cd apps/kfc_live_monitor_flutter && flutter test test/features/live_monitor/data/backend_live_monitor_repository_test.dart test/features/live_monitor/presentation/session_card_test.dart`
  - Result: failed as expected on missing `customerId`, `avatarUrl`, and typed deeplink model members.
- GREEN:
  - `cd apps/kfc_live_monitor_flutter && flutter test test/features/live_monitor/data/backend_live_monitor_repository_test.dart test/features/live_monitor/presentation/session_card_test.dart test/features/live_monitor/application/live_monitor_controller_test.dart test/features/live_monitor/data/mock_live_monitor_repository_test.dart`
  - Result: `00:06 +11: All tests passed!`

### TDD Evidence

- RED: verified with failing focused Flutter tests before implementation.
- GREEN: verified with focused Flutter tests after implementation and fixture fallout updates.

### Files changed and staged

- `apps/kfc_live_monitor_flutter/lib/features/live_monitor/domain/chat_session.dart`
- `apps/kfc_live_monitor_flutter/lib/features/live_monitor/data/backend_live_monitor_repository.dart`
- `apps/kfc_live_monitor_flutter/lib/features/live_monitor/presentation/widgets/session_card.dart`
- `apps/kfc_live_monitor_flutter/test/features/live_monitor/data/backend_live_monitor_repository_test.dart`
- `apps/kfc_live_monitor_flutter/test/features/live_monitor/presentation/session_card_test.dart`
- `apps/kfc_live_monitor_flutter/lib/features/live_monitor/data/mock_live_monitor_repository.dart`
- `apps/kfc_live_monitor_flutter/lib/features/live_monitor/application/live_monitor_controller.dart`
- `apps/kfc_live_monitor_flutter/test/features/live_monitor/application/live_monitor_controller_test.dart`
- `apps/kfc_live_monitor_flutter/patrol_test/api_clients/live_monitor_history_client.dart`
- `.superpowers/sdd/task-5-report.md`

### Commit created

- Pending at report write time. Created immediately after staging the files above.

### Self-review findings

- The repository now prefers backend `displayName` and falls back to turn-level `externalUserId`, then `sessionId`.
- `LiveMonitorController.openSession` now records only `deeplink.url`, so unavailable deeplinks safely store `null`.
- Session card accessibility reflects the disabled deeplink state through button semantics and tooltip messaging.

### Issues or concerns

- No functional concerns from the focused Flutter test surface that changed in this task.
