import 'live_monitor_history_client.dart';

final class ApiClients {
  final liveMonitorHistory = LiveMonitorHistoryClient();

  void dispose() {
    liveMonitorHistory.dispose();
  }
}
