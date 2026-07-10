import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/live_monitor/application/live_monitor_controller.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/dashboard_event_payload.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/dashboard_event_stream.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/live_monitor_repository.dart';
import 'package:kfc_live_monitor/features/live_monitor/domain/chat_session.dart';

final class LiveMonitorHistoryClient {
  static const sessionId = 'messenger:history_psid';
  static const messengerCustomerId = 'history_psid';
  static const messengerDisplayName = 'Nguyen An';
  static const persistedUserMessage = 'Lịch sử: mình đã hỏi Combo Hợp Gu 99K.';
  static const persistedAssistantMessage =
      'Lịch sử: combo đã được thêm vào giỏ.';
  static const refreshedUserMessage =
      'Tin mới qua polling: thêm Pepsi giúp mình.';
  static const refreshedAssistantMessage =
      'Tin mới qua polling: mình đã ghi nhận Pepsi.';
  static const messengerDeeplink = 'https://m.me/history_psid';
  static const zaloSessionId = 'zalo:zalo_user_1';
  static const zaloCustomerId = 'zalo_user_1';
  static const zaloDisplayName = 'Tran Binh';
  static const zaloPersistedUserMessage = 'Zalo lịch sử: cho mình 2 phần gà.';
  static const zaloPersistedAssistantMessage =
      'Zalo lịch sử: mình đã ghi nhận 2 phần gà.';

  final _repository = _HistoryRepository([
    _historySession(
      turns: const [
        ChatTurn(speaker: 'User', message: persistedUserMessage),
        ChatTurn(speaker: 'AI', message: persistedAssistantMessage),
      ],
    ),
  ]);
  final _eventStream = _PassiveDashboardEventStream();
  LiveMonitorController? _controller;

  LiveMonitorController createController() {
    final controller = LiveMonitorController(
      repository: _repository,
      eventStream: _eventStream,
    );
    _controller = controller;
    return controller;
  }

  Future<void> pollRefreshedHistory() async {
    _repository.sessions = [
      _historySession(
        turns: const [
          ChatTurn(speaker: 'User', message: persistedUserMessage),
          ChatTurn(speaker: 'AI', message: persistedAssistantMessage),
          ChatTurn(speaker: 'User', message: refreshedUserMessage),
          ChatTurn(speaker: 'AI', message: refreshedAssistantMessage),
        ],
      ),
    ];
    await _refreshController();
  }

  void expectHydratedThenRefreshed() {
    expect(_repository.loadCount, 2);
  }

  Future<void> pollZaloSessionWithDisplayName() async {
    _repository.sessions = [
      _historySession(
        turns: const [
          ChatTurn(speaker: 'User', message: persistedUserMessage),
          ChatTurn(speaker: 'AI', message: persistedAssistantMessage),
        ],
      ),
      _zaloSession(),
    ];
    await _refreshController();
  }

  Future<void> pollMessengerSessionWithDisplayName() async {
    _repository.sessions = [
      _historySession(
        customerName: messengerDisplayName,
        deeplink: const ChatDeeplink.available(messengerDeeplink),
        turns: const [
          ChatTurn(speaker: 'User', message: persistedUserMessage),
          ChatTurn(speaker: 'AI', message: persistedAssistantMessage),
          ChatTurn(speaker: 'User', message: refreshedUserMessage),
          ChatTurn(speaker: 'AI', message: refreshedAssistantMessage),
        ],
      ),
      _zaloSession(),
    ];
    await _refreshController();
  }

  Future<void> seedAngryHandoffSession() async {
    _repository.sessions = [_angryHandoffSession()];
    await _refreshController();
  }

  void expectNoOpenedDeeplink() {
    expect(_controller?.lastOpenedDeeplink.value, isNull);
  }

  void expectOpenedMessengerDeeplink() {
    expect(_controller?.lastOpenedDeeplink.value, messengerDeeplink);
  }

  void dispose() {
    _eventStream.dispose();
  }

  Future<void> _refreshController() async {
    final controller = _controller;
    if (controller == null) {
      throw StateError('Live monitor controller has not been created');
    }
    await controller.refresh();
  }
}

final class _HistoryRepository implements LiveMonitorRepository {
  _HistoryRepository(this.sessions);

  List<ChatSession> sessions;
  int loadCount = 0;

  @override
  Future<LiveMonitorReadiness> loadReadiness() async {
    return const LiveMonitorReadiness.online();
  }

  @override
  Future<List<ChatSession>> loadSessions() async {
    loadCount += 1;
    return sessions;
  }

  @override
  Future<void> joinHuman(String sessionId, {required String agentId}) async {
    _replaceSession(
      sessionId,
      (session) => _copySession(
        session,
        status: SessionStatus.humanJoined,
        severity: SessionSeverity.warning,
      ),
    );
  }

  @override
  Future<void> sendHumanMessage(
    String sessionId, {
    required String agentId,
    required String text,
  }) async {
    _replaceSession(
      sessionId,
      (session) => _copySession(
        session,
        turns: [
          ...session.turns,
          ChatTurn(speaker: 'Human', message: text),
        ],
      ),
    );
  }

  @override
  Future<void> resumeAi(String sessionId, {required String agentId}) async {
    _replaceSession(
      sessionId,
      (session) => _copySession(
        session,
        status: SessionStatus.aiHandling,
        severity: SessionSeverity.normal,
      ),
    );
  }

  void _replaceSession(
    String sessionId,
    ChatSession Function(ChatSession session) update,
  ) {
    sessions = [
      for (final session in sessions)
        if (session.id == sessionId) update(session) else session,
    ];
  }
}

abstract final class LiveMonitorEscalationHandoff {
  static const sessionId = 'messenger:psid_escalation';
  static const customerId = 'psid_escalation';
  static const customerName = 'Session M-ESCALATION';
  static const userMessage = 'Tôi bực quá, đồ giao sai hết rồi';
  static const assistantHandoffMessage =
      'Mình sẽ chuyển nhân viên hỗ trợ ngay.';
  static const humanReply = 'Em đang kiểm tra đơn sai món cho anh/chị.';
}

final class _PassiveDashboardEventStream implements DashboardEventStream {
  final _controller = StreamController<DashboardEventPayload>.broadcast();
  var _disposed = false;

  @override
  Stream<DashboardEventPayload> connect() => _controller.stream;

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _controller.close();
  }
}

ChatSession _historySession({
  String customerName = LiveMonitorHistoryClient.messengerCustomerId,
  ChatDeeplink deeplink = const ChatDeeplink.unavailable(
    reason: 'Missing META_INBOX_URL_TEMPLATE',
  ),
  required List<ChatTurn> turns,
}) {
  return ChatSession(
    id: LiveMonitorHistoryClient.sessionId,
    customerId: LiveMonitorHistoryClient.messengerCustomerId,
    customerName: customerName,
    channel: ChatChannel.messenger,
    severity: SessionSeverity.normal,
    status: SessionStatus.aiHandling,
    orderState: OrderState.cartReady,
    lastActivityLabel: 'Live',
    orderLabel: '1x Combo Hợp Gu 99K',
    confidencePercent: 92,
    riskLabel: 'Low',
    deeplink: deeplink,
    turns: turns,
  );
}

ChatSession _angryHandoffSession() {
  return const ChatSession(
    id: LiveMonitorEscalationHandoff.sessionId,
    customerId: LiveMonitorEscalationHandoff.customerId,
    customerName: LiveMonitorEscalationHandoff.customerName,
    channel: ChatChannel.messenger,
    severity: SessionSeverity.critical,
    status: SessionStatus.needsHuman,
    orderState: OrderState.omsPending,
    lastActivityLabel: 'Live',
    orderLabel: 'Sai món cần hỗ trợ',
    confidencePercent: 48,
    riskLabel: 'Escalated',
    deeplink: ChatDeeplink.available('backend://messenger:psid_escalation'),
    turns: [
      ChatTurn(
        speaker: 'User',
        message: LiveMonitorEscalationHandoff.userMessage,
      ),
      ChatTurn(
        speaker: 'AI',
        message: LiveMonitorEscalationHandoff.assistantHandoffMessage,
      ),
    ],
  );
}

ChatSession _copySession(
  ChatSession session, {
  SessionSeverity? severity,
  SessionStatus? status,
  List<ChatTurn>? turns,
}) {
  return ChatSession(
    id: session.id,
    customerId: session.customerId,
    customerName: session.customerName,
    channel: session.channel,
    severity: severity ?? session.severity,
    status: status ?? session.status,
    orderState: session.orderState,
    lastActivityLabel: session.lastActivityLabel,
    orderLabel: session.orderLabel,
    confidencePercent: session.confidencePercent,
    riskLabel: session.riskLabel,
    deeplink: session.deeplink,
    turns: turns ?? session.turns,
    avatarUrl: session.avatarUrl,
    contextLabel: session.contextLabel,
    cartValueVnd: session.cartValueVnd,
    assignedToMe: session.assignedToMe,
    priorityRank: session.priorityRank,
    interruption: session.interruption,
  );
}

ChatSession _zaloSession() {
  return ChatSession(
    id: LiveMonitorHistoryClient.zaloSessionId,
    customerId: LiveMonitorHistoryClient.zaloCustomerId,
    customerName: LiveMonitorHistoryClient.zaloDisplayName,
    channel: ChatChannel.zalo,
    severity: SessionSeverity.normal,
    status: SessionStatus.aiHandling,
    orderState: OrderState.collectingInfo,
    lastActivityLabel: 'Live',
    orderLabel: '2x Gà Rán',
    confidencePercent: 88,
    riskLabel: 'Low',
    deeplink: const ChatDeeplink.unavailable(
      reason: 'Missing ZALO_INBOX_URL_TEMPLATE',
    ),
    turns: const [
      ChatTurn(
        speaker: 'User',
        message: LiveMonitorHistoryClient.zaloPersistedUserMessage,
      ),
      ChatTurn(
        speaker: 'AI',
        message: LiveMonitorHistoryClient.zaloPersistedAssistantMessage,
      ),
    ],
  );
}
