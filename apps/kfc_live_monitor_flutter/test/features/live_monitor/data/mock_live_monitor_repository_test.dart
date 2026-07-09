import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/live_monitor/domain/chat_session.dart';

import '../support/mock_live_monitor_repository.dart';

void main() {
  test('mock repository returns eight deterministic sessions', () async {
    final repository = MockLiveMonitorRepository();
    final sessions = await repository.loadSessions();

    expect(sessions, hasLength(8));
    expect(sessions.first.customerName, 'Session M-1001');
    expect(sessions.first.channel, ChatChannel.messenger);
    expect(sessions.first.severity, SessionSeverity.critical);
    expect(sessions.first.priorityRank, 0);
    expect(sessions[1].channel, ChatChannel.zalo);
    expect(sessions[1].severity, SessionSeverity.warning);
    expect(
      sessions.map((session) => session.priorityRank),
      List<int>.generate(8, (index) => index),
    );
    expect(
      sessions.any((session) => session.status == SessionStatus.humanJoined),
      isTrue,
    );
    expect(
      sessions.any((session) => session.status == SessionStatus.resolved),
      isTrue,
    );
  });
}
