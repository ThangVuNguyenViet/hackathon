import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/live_monitor/testing/live_monitor_keys.dart';
import 'package:patrol/patrol.dart';

import '../api_clients/live_monitor_history_client.dart';

final class LiveMonitor {
  LiveMonitor(this.$);

  final PatrolIntegrationTester $;

  Future<void> waitForHistorySession() async {
    await $(
      LiveMonitorKeys.sessionCard(LiveMonitorHistoryClient.sessionId),
    ).waitUntilVisible();
  }

  Future<void> waitForPersistedHistory() async {
    await $(
      find.text(LiveMonitorHistoryClient.persistedUserMessage),
    ).waitUntilVisible();
    await $(
      find.text(LiveMonitorHistoryClient.persistedAssistantMessage),
    ).waitUntilVisible();
  }

  Future<void> waitForRefreshedHistory() async {
    await $(
      find.text(LiveMonitorHistoryClient.refreshedUserMessage),
    ).waitUntilVisible();
    await $(
      find.text(LiveMonitorHistoryClient.refreshedAssistantMessage),
    ).waitUntilVisible();
  }
}
