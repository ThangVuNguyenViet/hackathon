import '../domain/chat_session.dart';
import '../data/live_monitor_repository.dart';
import 'live_monitor_filters.dart';

class LiveMonitorState {
  const LiveMonitorState({
    required this.sessions,
    this.readiness = const LiveMonitorReadiness.offline(),
    this.filters = const LiveMonitorFilters(),
    this.lastOpenedDeeplink,
  });

  final List<ChatSession> sessions;
  final LiveMonitorReadiness readiness;
  final LiveMonitorFilters filters;
  final String? lastOpenedDeeplink;

  int get activeCount => sessions.length;

  int get criticalCount => sessions
      .where((session) => session.severity == SessionSeverity.critical)
      .length;

  int get warningCount => sessions
      .where((session) => session.severity == SessionSeverity.warning)
      .length;

  LiveMonitorState copyWith({
    List<ChatSession>? sessions,
    LiveMonitorReadiness? readiness,
    LiveMonitorFilters? filters,
    String? lastOpenedDeeplink,
    bool clearLastOpenedDeeplink = false,
  }) {
    return LiveMonitorState(
      sessions: sessions ?? this.sessions,
      readiness: readiness ?? this.readiness,
      filters: filters ?? this.filters,
      lastOpenedDeeplink: clearLastOpenedDeeplink
          ? null
          : (lastOpenedDeeplink ?? this.lastOpenedDeeplink),
    );
  }
}
