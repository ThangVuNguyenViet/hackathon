import 'test_app.dart';

void main() {
  testApp('monitor shows channel display names and refreshed history', (
    $,
    modules,
    system,
    apiClients,
  ) async {
    await modules.liveMonitor.waitForHistorySession();
    await modules.liveMonitor.waitForPersistedHistory();

    apiClients.liveMonitorHistory.emitZaloSessionWithDisplayName();
    await modules.liveMonitor.waitForZaloDisplayName();
    await modules.liveMonitor.waitForZaloPersistedHistory();
    await modules.liveMonitor.openZaloChat();
    apiClients.liveMonitorHistory.expectNoOpenedDeeplink();

    apiClients.liveMonitorHistory.emitMessengerSessionWithDisplayName();
    await modules.liveMonitor.waitForMessengerDisplayName();
    await modules.liveMonitor.openMessengerChat();
    apiClients.liveMonitorHistory.expectOpenedMessengerDeeplink();
    await modules.liveMonitor.expectChatIdNotPrimary();
  });
}
