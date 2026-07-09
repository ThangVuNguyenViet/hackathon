import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/live_monitor/application/live_monitor_controller.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/live_monitor_repository.dart';
import 'package:kfc_live_monitor/features/live_monitor/domain/chat_session.dart';
import 'package:kfc_live_monitor/features/live_monitor/presentation/live_monitor_screen.dart';

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
    expect(find.text('Order:'), findsWidgets);
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

void _setDesktopViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(1280, 1024);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}
