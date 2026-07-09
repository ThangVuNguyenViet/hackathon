import '../domain/chat_session.dart';

enum LiveMonitorReadinessStatus { online, configMissing, offline }

final class LiveMonitorReadiness {
  const LiveMonitorReadiness._({
    required this.status,
    required this.label,
    this.message,
  });

  const LiveMonitorReadiness.online({String? message})
    : this._(
        status: LiveMonitorReadinessStatus.online,
        label: 'Online',
        message: message,
      );

  const LiveMonitorReadiness.configMissing({String? message})
    : this._(
        status: LiveMonitorReadinessStatus.configMissing,
        label: 'Config missing',
        message: message,
      );

  const LiveMonitorReadiness.offline({String? message})
    : this._(
        status: LiveMonitorReadinessStatus.offline,
        label: 'Offline',
        message: message,
      );

  final LiveMonitorReadinessStatus status;
  final String label;
  final String? message;
}

abstract interface class LiveMonitorRepository {
  Future<LiveMonitorReadiness> loadReadiness();

  Future<List<ChatSession>> loadSessions();

  Future<void> joinHuman(String sessionId, {required String agentId});

  Future<void> sendHumanMessage(
    String sessionId, {
    required String agentId,
    required String text,
  });

  Future<void> resumeAi(String sessionId, {required String agentId});
}
