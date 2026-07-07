import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/live_monitor/application/live_monitor_controller.dart';
import 'package:kfc_live_monitor/features/live_monitor/presentation/live_monitor_screen.dart';

import '../../test_app.dart';

void main() {
  testWidgets('monitor screen renders eight chat cards', (tester) async {
    _setDesktopViewport(tester);
    final controller = LiveMonitorController();

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
    expect(find.text('Nguyễn Văn A'), findsOneWidget);
    expect(find.text('Trần Thị B'), findsOneWidget);
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
    final controller = LiveMonitorController();

    await tester.pumpWidget(
      TestApp(child: LiveMonitorScreen(controller: controller)),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Open chat').first);
    await tester.pump();

    expect(
      controller.lastOpenedDeeplink.value,
      'mockchat://messenger/session-payment-nguyen-a',
    );
  });
}

void _setDesktopViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(1280, 1024);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}
