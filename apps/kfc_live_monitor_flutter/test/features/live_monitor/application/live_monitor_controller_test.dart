import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/live_monitor/application/live_monitor_controller.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/dashboard_event_payload.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/dashboard_event_stream.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/live_monitor_repository.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/mock_live_monitor_repository.dart';
import 'package:kfc_live_monitor/features/live_monitor/domain/chat_session.dart';

class _MutableLiveMonitorRepository implements LiveMonitorRepository {
  _MutableLiveMonitorRepository(this.sessions);

  List<ChatSession> sessions;
  int loadCount = 0;

  @override
  Future<List<ChatSession>> loadSessions() async {
    loadCount += 1;
    return sessions;
  }
}

class _FakeDashboardEventStream implements DashboardEventStream {
  final controller = StreamController<DashboardEventPayload>.broadcast();
  var disposed = false;

  @override
  Stream<DashboardEventPayload> connect() => controller.stream;

  @override
  void dispose() {
    disposed = true;
    controller.close();
  }
}

const _refreshedSession = ChatSession(
  id: 'messenger:psid_1',
  customerId: 'psid_1',
  customerName: 'psid_1',
  channel: ChatChannel.messenger,
  severity: SessionSeverity.normal,
  status: SessionStatus.aiHandling,
  orderState: OrderState.confirmed,
  lastActivityLabel: 'Live',
  orderLabel: '1x Combo Hợp Gu 99K',
  confidencePercent: 92,
  riskLabel: 'Low',
  deeplink: ChatDeeplink.available('backend://messenger:psid_1'),
  turns: [
    ChatTurn(speaker: 'User', message: 'Xác nhận đơn'),
    ChatTurn(speaker: 'AI', message: 'Đơn hàng đã được xác nhận.'),
  ],
);

void main() {
  test(
    'default visible sessions follow the Stitch monitor grid order',
    () async {
      final controller = LiveMonitorController(
        repository: const MockLiveMonitorRepository(),
      );
      await controller.state.toFuture();

      final sessions = controller.visibleSessions.value;

      expect(sessions, hasLength(8));
      expect(sessions.map((session) => session.customerName), [
        'Nguyễn Văn A',
        'Trần Thị B',
        'KFC-1024',
        'Hoàng M',
        'Lê K',
        'User_882',
        'Phạm P',
        'KFC-1088',
      ]);
    },
  );

  test('channel filter keeps only Zalo sessions', () async {
    final controller = LiveMonitorController(
      repository: const MockLiveMonitorRepository(),
    );
    await controller.state.toFuture();

    controller.setChannelFilter(ChatChannel.zalo);

    expect(controller.visibleSessions.value, isNotEmpty);
    expect(
      controller.visibleSessions.value.every(
        (session) => session.channel == ChatChannel.zalo,
      ),
      isTrue,
    );
  });

  test('openSession records deeplink target', () async {
    final controller = LiveMonitorController(
      repository: const MockLiveMonitorRepository(),
    );
    await controller.state.toFuture();

    controller.openSession('session-human-pham-p');

    expect(
      controller.lastOpenedDeeplink.value,
      'mockchat://zalo/session-human-pham-p',
    );
  });

  test('dashboard stream events refresh backend sessions', () async {
    final repository = _MutableLiveMonitorRepository(const []);
    final eventStream = _FakeDashboardEventStream();
    final controller = LiveMonitorController(
      repository: repository,
      eventStream: eventStream,
    );
    addTearDown(controller.dispose);

    await controller.state.toFuture();
    expect(controller.visibleSessions.value, isEmpty);

    repository.sessions = const [_refreshedSession];
    eventStream.controller.add(
      DashboardEventPayload(
        id: 'dash_1',
        sessionId: 'messenger:psid_1',
        type: DashboardEventType.conversationTurnCreated,
        payload: const {},
        createdAt: DateTime.parse('2026-07-08T08:00:00.000Z'),
      ),
    );
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);

    expect(repository.loadCount, 2);
    expect(controller.visibleSessions.value.single.id, 'messenger:psid_1');
    expect(
      controller.visibleSessions.value.single.turns.last.message,
      'Đơn hàng đã được xác nhận.',
    );
  });

  test('dispose closes dashboard event stream', () async {
    final eventStream = _FakeDashboardEventStream();
    final controller = LiveMonitorController(
      repository: const MockLiveMonitorRepository(),
      eventStream: eventStream,
    );
    await controller.state.toFuture();

    controller.dispose();

    expect(eventStream.disposed, isTrue);
  });
}
