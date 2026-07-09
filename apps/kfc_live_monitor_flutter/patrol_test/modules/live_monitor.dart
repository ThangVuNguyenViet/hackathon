import 'package:flutter/widgets.dart';
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

  Future<void> waitForZaloDisplayName() async {
    await $(
      LiveMonitorKeys.sessionCard(LiveMonitorHistoryClient.zaloSessionId),
    ).waitUntilVisible();
    await $(
      find.text(LiveMonitorHistoryClient.zaloDisplayName),
    ).waitUntilVisible();
  }

  Future<void> waitForZaloPersistedHistory() async {
    await $(
      find.text(LiveMonitorHistoryClient.zaloPersistedUserMessage),
    ).waitUntilVisible();
    await $(
      find.text(LiveMonitorHistoryClient.zaloPersistedAssistantMessage),
    ).waitUntilVisible();
  }

  Future<void> waitForMessengerDisplayName() async {
    await $(
      LiveMonitorKeys.sessionCard(LiveMonitorHistoryClient.sessionId),
    ).waitUntilVisible();
    await $(
      find.text(LiveMonitorHistoryClient.messengerDisplayName),
    ).waitUntilVisible();
  }

  Future<void> openZaloChat() async {
    await $(
      LiveMonitorKeys.sessionCard(LiveMonitorHistoryClient.zaloSessionId),
    ).waitUntilVisible(alignment: Alignment.topCenter);
    final openChatButton = $(
      LiveMonitorKeys.sessionOpenChatButton(
        LiveMonitorHistoryClient.zaloSessionId,
      ),
    );
    await openChatButton.scrollTo();
    await openChatButton.tap();
  }

  Future<void> openMessengerChat() async {
    await $(
      LiveMonitorKeys.sessionCard(LiveMonitorHistoryClient.sessionId),
    ).waitUntilVisible(alignment: Alignment.topCenter);
    final openChatButton = $(
      LiveMonitorKeys.sessionOpenChatButton(LiveMonitorHistoryClient.sessionId),
    );
    await openChatButton.scrollTo();
    await openChatButton.tap();
  }

  Future<void> expectChatIdNotPrimary() async {
    expect(
      find.text(LiveMonitorHistoryClient.messengerCustomerId),
      findsNothing,
    );
    expect(find.text(LiveMonitorHistoryClient.zaloCustomerId), findsNothing);
  }
}
