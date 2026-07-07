import '../domain/chat_session.dart';

abstract interface class LiveMonitorRepository {
  Future<List<ChatSession>> loadSessions();
}
