## Task 6 Report: Worker Docs, Zalo Admin Checklist, And UI Proof Harness

### What I implemented

- Added deployment-doc checks for Zalo webhook setup, `ZALO_OA_ID`, OA ID `4225933857518051795`, and customer display-name proof language.
- Documented Zalo OA setup in `docs/deployment/hackathon-free-deploy.md`, including the stable Worker webhook URL shape, OA admin checklist, Worker secrets, smoke proof commands, and display-name requirement.
- Updated the backend README's Messenger/Zalo section to describe shared channel adapters, Zalo event categories, text-only acknowledgement behavior, and dashboard profile/deeplink fields.
- Added Flutter monitor channel-parity documentation.
- Added Patrol channel parity coverage for Messenger and Zalo display names, refreshed per-user history, unavailable Zalo deeplink behavior, available Messenger deeplink behavior, and non-primary chat IDs.
- Extended Patrol live monitor fake-backend helpers for Zalo and Messenger display-name sessions.
- Fixed the Patrol helper after the first live run by scrolling open-chat buttons into view before tapping.
- Reworked the monitor refresh proof away from synthetic dashboard stream events:
  - the web runtime now polls `/dashboard/sessions` and emits refresh signals only when the session payload changes;
  - the Patrol fake backend now mutates repository data and calls `LiveMonitorController.refresh()` directly, matching the Worker polling path;
  - Patrol copy no longer references SSE/EventSource refreshes.

### Tests run and exact results

```bash
bash tests/deployment/deploy_scripts.test.sh
```

Result: passed with exit code `0`.

```bash
cd apps/kfc_live_monitor_flutter
flutter test test/features/live_monitor/data/backend_live_monitor_repository_test.dart \
  test/features/live_monitor/presentation/session_card_test.dart
```

Result: `00:00 +8: All tests passed!`

### Patrol proof

First attempt:

```bash
patrol test -t patrol_test/live_monitor_channel_parity_test.dart -d 12785C7A-F8B5-4317-9BF0-E78E2A252738
```

Result: failed because the Zalo open-chat button existed but was not hit-testable in the current viewport.

Fix: updated `patrol_test/modules/live_monitor.dart` to scroll open-chat buttons into view before tapping.

Second attempt before polling rewrite:

```bash
patrol test -t patrol_test/live_monitor_channel_parity_test.dart -d 12785C7A-F8B5-4317-9BF0-E78E2A252738
```

Result:

```text
Test summary:
Total: 1
Successful: 1
Failed: 0
Skipped: 0
Report: apps/kfc_live_monitor_flutter/build/ios_results_1783584547037.xcresult
Duration: 1m 30s
```

After the polling rewrite, focused Flutter verification passed:

```bash
cd apps/kfc_live_monitor_flutter
flutter test test/features/live_monitor/data/backend_live_monitor_repository_test.dart \
  test/features/live_monitor/presentation/session_card_test.dart \
  test/features/live_monitor/application/live_monitor_controller_test.dart \
  test/features/live_monitor/data/mock_live_monitor_repository_test.dart
```

Result: `00:02 +22: All tests passed!`

Patrol rerun after the polling rewrite was attempted twice:

```bash
patrol test -t patrol_test/live_monitor_channel_parity_test.dart -d 12785C7A-F8B5-4317-9BF0-E78E2A252738
```

Result: the app built and launched, but `xcodebuild test-without-building` produced zero Patrol test events and had to be interrupted. Report: `apps/kfc_live_monitor_flutter/build/ios_results_1783585738513.xcresult`.

```bash
patrol test -t patrol_test/live_monitor_channel_parity_test.dart -d E4646BAE-1B86-40D0-8E9F-F3812E9F9F00
```

Result: the app built and launched on the attached simulator, then `xcodebuild` exited interrupted with zero tests. Report: `apps/kfc_live_monitor_flutter/build/ios_results_1783586384483.xcresult`.

### Files changed across Task 6

- `services/kfc-agent-backend/README.md`
- `docs/deployment/hackathon-free-deploy.md`
- `apps/kfc_live_monitor_flutter/README.md`
- `apps/kfc_live_monitor_flutter/patrol_test/live_monitor_message_history_test.dart`
- `apps/kfc_live_monitor_flutter/patrol_test/live_monitor_channel_parity_test.dart`
- `apps/kfc_live_monitor_flutter/patrol_test/modules/live_monitor.dart`
- `apps/kfc_live_monitor_flutter/patrol_test/api_clients/live_monitor_history_client.dart`
- `apps/kfc_live_monitor_flutter/lib/features/live_monitor/data/dashboard_event_stream_factory_web.dart`
- `apps/kfc_live_monitor_flutter/test/features/live_monitor/application/live_monitor_controller_test.dart`
- `tests/deployment/deploy_scripts.test.sh`

### Commit created

- `17bbd18` - `docs: add Zalo OA setup and monitor proof`
- `cfe3002` - `fix: stabilize monitor channel parity proof`
- `ee931e8` - `fix: poll monitor sessions for parity proof`

### Self-review findings

- The docs reference the stable Worker URL shape and explicitly say a local tunnel is not the production webhook target.
- The docs include the confirmed OA ID and avoid committing or printing token values.
- The Patrol proof uses the monitor fake backend and validates both display-name and history behavior for Messenger and Zalo.
- The generated `patrol_test/test_bundle.dart` was restored after the Patrol run because it is generated per run and should not be committed as a source change.
- The current app no longer uses `EventSource` or `/dashboard/stream` in the web refresh factory.

### Issues or concerns

- Live Zalo Developers configuration and deployed Worker smoke proof are still Task 7/final setup gates; Task 6 only adds repeatable docs and local UI proof harness coverage.
- Patrol reruns after the polling rewrite did not reach test execution in this environment. The app built and launched, but xcodebuild ended/interrupted with zero Patrol test events.
