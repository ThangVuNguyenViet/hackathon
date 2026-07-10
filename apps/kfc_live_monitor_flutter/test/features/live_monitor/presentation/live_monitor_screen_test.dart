import 'dart:async';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/live_monitor/application/live_monitor_controller.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/dashboard_event_payload.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/dashboard_event_stream.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/live_monitor_repository.dart';
import 'package:kfc_live_monitor/features/live_monitor/domain/chat_session.dart';
import 'package:kfc_live_monitor/features/live_monitor/presentation/live_monitor_screen.dart';
import 'package:kfc_live_monitor/features/live_monitor/testing/live_monitor_keys.dart';
import 'package:state_beacon/state_beacon.dart';

import '../support/mock_live_monitor_repository.dart';
import '../../test_app.dart';

void main() {
  testWidgets('monitor screen renders eight chat cards', (tester) async {
    _setDesktopViewport(tester);
    final controller = LiveMonitorController(
      repository: const MockLiveMonitorRepository(),
    );

    await tester.pumpWidget(
      TestApp(child: LiveMonitorScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    expect(find.text('KFC Vietnam Operations'), findsOneWidget);
    expect(find.text('Live AI chat monitor'), findsNothing);
    expect(find.text('Active Sessions: 8'), findsOneWidget);
    expect(find.text('Channel:'), findsOneWidget);
    expect(find.text('Severity:'), findsOneWidget);
    expect(find.text('Status:'), findsOneWidget);
    expect(find.text('Assigned:'), findsOneWidget);
    expect(find.text('Context:'), findsWidgets);
    expect(find.text('Order:'), findsNothing);
    expect(find.text('Sort:'), findsOneWidget);
    expect(find.text('Session M-1001'), findsOneWidget);
    expect(find.text('Session Z-1002'), findsOneWidget);
    expect(find.text('Messenger'), findsWidgets);
    expect(find.text('Zalo'), findsWidgets);
    expect(find.text('Needs Human'), findsWidgets);
    expect(find.text('Risk:'), findsNothing);
    expect(find.text('Confidence:'), findsNWidgets(8));
    expect(find.text('48%'), findsOneWidget);
    expect(find.text('NV'), findsNothing);
    expect(find.text('Payment Issue'), findsNothing);
    expect(find.text('User:'), findsNothing);
    expect(find.text('AI:'), findsNothing);
    expect(find.textContaining('Why is my payment failing???'), findsOneWidget);
    expect(
      find.text('I see the issue. Your bank is blocking the transaction.'),
      findsOneWidget,
    );
  });

  testWidgets('tapping Open chat records deeplink', (tester) async {
    _setDesktopViewport(tester);
    final controller = LiveMonitorController(
      repository: const MockLiveMonitorRepository(),
    );

    await tester.pumpWidget(
      TestApp(child: LiveMonitorScreen(controller: controller)),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Open chat').first);
    await tester.pump();

    expect(
      controller.lastOpenedDeeplink.value,
      'mockchat://messenger/session-payment-m-1001',
    );
  });

  testWidgets('header icons are not exposed as no-op buttons', (tester) async {
    _setDesktopViewport(tester);
    final controller = LiveMonitorController(
      repository: const MockLiveMonitorRepository(),
    );

    await tester.pumpWidget(
      TestApp(child: LiveMonitorScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    expect(find.bySemanticsLabel('Alerts'), findsNothing);
    expect(find.bySemanticsLabel('Profile'), findsNothing);
    expect(find.bySemanticsLabel('Settings'), findsNothing);
  });

  testWidgets('readiness pill reflects missing backend configuration', (
    tester,
  ) async {
    _setDesktopViewport(tester);
    final controller = LiveMonitorController(
      repository: const _ScreenRepository(
        readiness: LiveMonitorReadiness.configMissing(
          message: 'Missing META_INBOX_URL_TEMPLATE',
        ),
      ),
    );

    await tester.pumpWidget(
      TestApp(child: LiveMonitorScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Config missing'), findsOneWidget);
    expect(find.text('Online'), findsNothing);
  });

  testWidgets('shows loading state while current sessions are fetching', (
    tester,
  ) async {
    _setDesktopViewport(tester);
    final repository = _BlockingScreenRepository();
    final controller = LiveMonitorController(repository: repository);

    await tester.pumpWidget(
      TestApp(child: LiveMonitorScreen(controller: controller)),
    );
    await tester.pump();

    expect(find.byKey(LiveMonitorKeys.currentSessionLoading), findsOneWidget);
    expect(find.text('Fetching current sessions'), findsOneWidget);

    repository.sessionsCompleter.complete(const []);
    await tester.pumpAndSettle();

    expect(find.byKey(LiveMonitorKeys.currentSessionLoading), findsNothing);
  });

  testWidgets('hides loading state while current sessions are reloading', (
    tester,
  ) async {
    _setDesktopViewport(tester);
    final initialSessions = await const MockLiveMonitorRepository()
        .loadSessions();
    final repository = _ReloadingScreenRepository(initialSessions);
    final eventStream = _ScreenDashboardEventStream();
    final controller = LiveMonitorController(
      repository: repository,
      eventStream: eventStream,
    );

    await tester.pumpWidget(
      TestApp(child: LiveMonitorScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Session M-1001'), findsOneWidget);

    eventStream.controller.add(
      DashboardEventPayload(
        id: 'reload_1',
        sessionId: 'dashboard:sessions',
        type: DashboardEventType.sessionUpdated,
        payload: const {},
        createdAt: DateTime.parse('2026-07-10T12:00:00.000Z'),
      ),
    );
    await repository.reloadStarted.future;
    await tester.pump();

    expect(controller.state.isLoading, isTrue);
    expect(controller.state.lastData, isNotNull);
    expect(find.byKey(LiveMonitorKeys.currentSessionLoading), findsNothing);
    expect(find.text('Session M-1001'), findsOneWidget);

    repository.sessionsCompleter.complete(initialSessions);
    await tester.pumpAndSettle();
  });
}

class _ScreenRepository implements LiveMonitorRepository {
  const _ScreenRepository({required this.readiness});

  final LiveMonitorReadiness readiness;

  @override
  Future<List<ChatSession>> loadSessions() async => const [];

  @override
  Future<LiveMonitorReadiness> loadReadiness() async => readiness;

  @override
  Future<void> joinHuman(String sessionId, {required String agentId}) async {}

  @override
  Future<void> resumeAi(String sessionId, {required String agentId}) async {}
}

class _BlockingScreenRepository implements LiveMonitorRepository {
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

class _ReloadingScreenRepository implements LiveMonitorRepository {
  _ReloadingScreenRepository(this.initialSessions);

  final List<ChatSession> initialSessions;
  final sessionsCompleter = Completer<List<ChatSession>>();
  final reloadStarted = Completer<void>();
  var _loadCount = 0;

  @override
  Future<List<ChatSession>> loadSessions() {
    _loadCount += 1;
    if (_loadCount == 1) return Future.value(initialSessions);
    if (!reloadStarted.isCompleted) reloadStarted.complete();
    return sessionsCompleter.future;
  }

  @override
  Future<LiveMonitorReadiness> loadReadiness() async {
    return const LiveMonitorReadiness.online();
  }

  @override
  Future<void> joinHuman(String sessionId, {required String agentId}) async {}

  @override
  Future<void> resumeAi(String sessionId, {required String agentId}) async {}
}

class _ScreenDashboardEventStream implements DashboardEventStream {
  final controller = StreamController<DashboardEventPayload>();

  @override
  Stream<DashboardEventPayload> connect() => controller.stream;

  @override
  void dispose() {
    unawaited(controller.close());
  }
}

void _setDesktopViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(1280, 1024);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}
