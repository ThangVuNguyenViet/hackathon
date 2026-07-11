import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/live_monitor/application/live_monitor_controller.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/dashboard_event_payload.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/dashboard_event_stream.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/live_monitor_repository.dart';
import 'package:kfc_live_monitor/features/live_monitor/domain/chat_session.dart';
import 'package:state_beacon/state_beacon.dart';

import '../support/mock_live_monitor_repository.dart';

class _MutableLiveMonitorRepository implements LiveMonitorRepository {
  _MutableLiveMonitorRepository(
    this.sessions, {
    this.readiness = const LiveMonitorReadiness.online(),
    this.joinCompleter,
    this.reloadCompleter,
  });

  List<ChatSession> sessions;
  LiveMonitorReadiness readiness;
  final Completer<void>? joinCompleter;
  final Completer<List<ChatSession>>? reloadCompleter;
  int loadCount = 0;
  int readinessLoadCount = 0;
  final actions = <String>[];

  @override
  Future<List<ChatSession>> loadSessions() async {
    loadCount += 1;
    if (loadCount > 1 && reloadCompleter != null) {
      return reloadCompleter!.future;
    }
    return sessions;
  }

  @override
  Future<LiveMonitorReadiness> loadReadiness() async {
    readinessLoadCount += 1;
    return readiness;
  }

  @override
  Future<void> joinHuman(String sessionId, {required String agentId}) async {
    actions.add('join:$sessionId:$agentId');
    await joinCompleter?.future;
  }

  @override
  Future<void> resumeAi(String sessionId, {required String agentId}) async {
    actions.add('resume:$sessionId:$agentId');
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

class _BlockingLiveMonitorRepository implements LiveMonitorRepository {
  final sessionsCompleter = Completer<List<ChatSession>>();

  @override
  Future<List<ChatSession>> loadSessions() => sessionsCompleter.future;

  @override
  Future<LiveMonitorReadiness> loadReadiness() async {
    return const LiveMonitorReadiness.online();
  }

  @override
  Future<void> joinHuman(String sessionId, {required String agentId}) async {}

  @override
  Future<void> resumeAi(String sessionId, {required String agentId}) async {}
}

const _refreshedSession = ChatSession(
  id: 'messenger:psid_1',
  customerId: 'psid_1',
  customerName: 'Nguyen An',
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
        'Session M-1001',
        'Session Z-1002',
        'Session M-1003',
        'Session Z-1004',
        'Session M-1005',
        'Session M-1006',
        'Session Z-1007',
        'Session M-1008',
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

  test('openSession opens deeplink with configured launcher', () async {
    final opened = <Uri>[];
    final controller = LiveMonitorController(
      repository: const MockLiveMonitorRepository(),
      openExternalUrl: (uri) async => opened.add(uri),
    );
    await controller.state.toFuture();

    await controller.openSession('session-human-z-1007');

    expect(
      controller.lastOpenedDeeplink.value,
      'mockchat://zalo/session-human-z-1007',
    );
    expect(opened, [Uri.parse('mockchat://zalo/session-human-z-1007')]);
  });

  test('dashboard refresh signals reload backend sessions', () async {
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

  test(
    'refresh state stays active while current sessions are loading',
    () async {
      final repository = _BlockingLiveMonitorRepository();
      final controller = LiveMonitorController(repository: repository);
      addTearDown(controller.dispose);

      final refresh = controller.refresh();
      await Future<void>.delayed(Duration.zero);

      expect(controller.state.isLoading, isTrue);

      repository.sessionsCompleter.complete(const [_refreshedSession]);
      await refresh;

      expect(controller.state.isLoading, isFalse);
      expect(controller.visibleSessions.value.single.id, 'messenger:psid_1');
    },
  );

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

  test('joinHuman calls repository and refreshes sessions', () async {
    final repository = _MutableLiveMonitorRepository(const [_refreshedSession]);
    final controller = LiveMonitorController(repository: repository);
    addTearDown(controller.dispose);
    await controller.state.toFuture();

    await controller.joinHuman('messenger:psid_1');
    await Future<void>.delayed(Duration.zero);

    expect(repository.actions, ['join:messenger:psid_1:monitor_agent_local']);
    expect(repository.loadCount, 2);
  });

  test(
    'joinHuman projects Human Joined immediately and does not await full refresh',
    () async {
      final joinCompleter = Completer<void>();
      final reloadCompleter = Completer<List<ChatSession>>();
      final repository = _MutableLiveMonitorRepository(
        const [_refreshedSession],
        joinCompleter: joinCompleter,
        reloadCompleter: reloadCompleter,
      );
      final controller = LiveMonitorController(repository: repository);
      addTearDown(controller.dispose);
      await controller.state.toFuture();

      final join = controller.joinHuman('messenger:psid_1');
      await Future<void>.delayed(Duration.zero);

      expect(
        controller.visibleSessions.value.single.status,
        SessionStatus.humanJoined,
      );
      expect(
        controller.visibleSessions.value.single.severity,
        SessionSeverity.critical,
      );

      joinCompleter.complete();
      await join;
      await Future<void>.delayed(Duration.zero);
      expect(repository.loadCount, 2);

      reloadCompleter.complete(const [_refreshedSession]);
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
    },
  );

  test('initial state includes monitor readiness', () async {
    final repository = _MutableLiveMonitorRepository(
      const [_refreshedSession],
      readiness: const LiveMonitorReadiness.configMissing(
        message: 'Missing META_INBOX_URL_TEMPLATE',
      ),
    );
    final controller = LiveMonitorController(repository: repository);
    addTearDown(controller.dispose);

    await controller.state.toFuture();

    expect(repository.readinessLoadCount, 1);
    expect(
      controller.monitorState.value.readiness.status,
      LiveMonitorReadinessStatus.configMissing,
    );
    expect(controller.monitorState.value.readiness.label, 'Config missing');
  });

  test('resumeAi calls repository and refreshes sessions', () async {
    final repository = _MutableLiveMonitorRepository(const [_refreshedSession]);
    final controller = LiveMonitorController(repository: repository);
    addTearDown(controller.dispose);
    await controller.state.toFuture();

    await controller.resumeAi('messenger:psid_1');
    await Future<void>.delayed(Duration.zero);

    expect(repository.actions, ['resume:messenger:psid_1:monitor_agent_local']);
    expect(repository.loadCount, 2);
  });
}
