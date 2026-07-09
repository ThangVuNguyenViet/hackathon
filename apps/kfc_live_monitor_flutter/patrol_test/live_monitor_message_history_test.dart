import 'test_app.dart';

void main() {
  testApp(
    'monitor hydrates persisted Messenger history and refreshes from Worker-backed polling',
    ($, modules, system, apiClients) async {
      await modules.liveMonitor.waitForHistorySession();
      await modules.liveMonitor.waitForPersistedHistory();

      await apiClients.liveMonitorHistory.pollRefreshedHistory();

      await modules.liveMonitor.waitForRefreshedHistory();
      apiClients.liveMonitorHistory.expectHydratedThenRefreshed();
    },
  );
}
