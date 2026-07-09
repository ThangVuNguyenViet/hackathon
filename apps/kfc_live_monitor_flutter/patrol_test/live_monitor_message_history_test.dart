import 'test_app.dart';

void main() {
  testApp(
    'monitor hydrates persisted Messenger history and refreshes from SSE',
    ($, modules, system, apiClients) async {
      await modules.liveMonitor.waitForHistorySession();
      await modules.liveMonitor.waitForPersistedHistory();

      apiClients.liveMonitorHistory.emitRefreshedHistory();

      await modules.liveMonitor.waitForRefreshedHistory();
      apiClients.liveMonitorHistory.expectHydratedThenRefreshed();
    },
  );
}
