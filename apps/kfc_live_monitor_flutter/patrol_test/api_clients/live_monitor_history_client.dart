import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/live_monitor/application/live_monitor_controller.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/dashboard_event_payload.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/dashboard_event_stream.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/live_monitor_repository.dart';
import 'package:kfc_live_monitor/features/live_monitor/domain/chat_session.dart';

final class LiveMonitorHistoryClient {
  static const sessionId = 'messenger:history_psid';
  static const persistedUserMessage = 'Lịch sử: mình đã hỏi Combo Hợp Gu 99K.';
  static const persistedAssistantMessage =
      'Lịch sử: combo đã được thêm vào giỏ.';
  static const refreshedUserMessage = 'Tin mới qua SSE: thêm Pepsi giúp mình.';
  static const refreshedAssistantMessage =
      'Tin mới qua SSE: mình đã ghi nhận Pepsi.';

  final _repository = _HistoryRepository([
    _historySession(const [
      ChatTurn(speaker: 'User', message: persistedUserMessage),
      ChatTurn(speaker: 'AI', message: persistedAssistantMessage),
    ]),
  ]);
  final _eventStream = _DashboardEventStream();

  LiveMonitorController createController() {
    return LiveMonitorController(
      repository: _repository,
      eventStream: _eventStream,
    );
  }

  void emitRefreshedHistory() {
    _repository.sessions = [
      _historySession(const [
        ChatTurn(speaker: 'User', message: persistedUserMessage),
        ChatTurn(speaker: 'AI', message: persistedAssistantMessage),
        ChatTurn(speaker: 'User', message: refreshedUserMessage),
        ChatTurn(speaker: 'AI', message: refreshedAssistantMessage),
      ]),
    ];
    _eventStream.controller.add(
      DashboardEventPayload(
        id: 'dash_history_refresh',
        sessionId: sessionId,
        type: DashboardEventType.conversationTurnCreated,
        payload: const {},
        createdAt: DateTime.parse('2026-07-08T09:10:00.000Z'),
      ),
    );
  }

  void expectHydratedThenRefreshed() {
    expect(_repository.loadCount, 2);
  }

  void dispose() {
    _eventStream.dispose();
  }
}

final class _HistoryRepository implements LiveMonitorRepository {
  _HistoryRepository(this.sessions);

  List<ChatSession> sessions;
  int loadCount = 0;

  @override
  Future<List<ChatSession>> loadSessions() async {
    loadCount += 1;
    return sessions;
  }
}

final class _DashboardEventStream implements DashboardEventStream {
  final controller = StreamController<DashboardEventPayload>.broadcast();
  var _disposed = false;

  @override
  Stream<DashboardEventPayload> connect() => controller.stream;

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    controller.close();
  }
}

ChatSession _historySession(List<ChatTurn> turns) {
  return ChatSession(
    id: LiveMonitorHistoryClient.sessionId,
    customerName: 'history_psid',
    channel: ChatChannel.messenger,
    severity: SessionSeverity.normal,
    status: SessionStatus.aiHandling,
    orderState: OrderState.cartReady,
    lastActivityLabel: 'Live',
    orderLabel: '1x Combo Hợp Gu 99K',
    confidencePercent: 92,
    riskLabel: 'Low',
    deeplink: 'backend://${LiveMonitorHistoryClient.sessionId}',
    turns: turns,
  );
}
