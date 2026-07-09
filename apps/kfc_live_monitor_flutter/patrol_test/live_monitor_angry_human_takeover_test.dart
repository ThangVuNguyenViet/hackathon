import 'api_clients/live_monitor_history_client.dart';
import 'test_app.dart';

void main() {
  testApp('angry handoff can be joined by a human and resumed to AI', (
    $,
    modules,
    system,
    apiClients,
  ) async {
    await apiClients.liveMonitorHistory.seedAngryHandoffSession();
    await modules.liveMonitor.expectSessionStatus(
      LiveMonitorEscalationHandoff.sessionId,
      'Needs Human',
    );

    await modules.liveMonitor.joinHuman(LiveMonitorEscalationHandoff.sessionId);
    await modules.liveMonitor.expectSessionStatus(
      LiveMonitorEscalationHandoff.sessionId,
      'Human Joined',
    );

    await modules.liveMonitor.sendHumanMessage(
      LiveMonitorEscalationHandoff.sessionId,
      LiveMonitorEscalationHandoff.humanReply,
    );
    await modules.liveMonitor.expectTranscriptContains(
      LiveMonitorEscalationHandoff.sessionId,
      LiveMonitorEscalationHandoff.humanReply,
    );

    await modules.liveMonitor.resumeAi(LiveMonitorEscalationHandoff.sessionId);
    await modules.liveMonitor.expectSessionStatus(
      LiveMonitorEscalationHandoff.sessionId,
      'AI Handling',
    );
  });
}
