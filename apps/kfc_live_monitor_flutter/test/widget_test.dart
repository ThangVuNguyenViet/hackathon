import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/app/kfc_monitor_app.dart';

void main() {
  testWidgets('app reports missing backend config instead of mock sessions', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1280, 1024);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(const KfcMonitorApp());
    await tester.pumpAndSettle();

    expect(find.text('KFC Vietnam Operations'), findsOneWidget);
    expect(find.text('Config missing'), findsOneWidget);
    expect(find.text('Missing KFC_AGENT_BACKEND_URL'), findsOneWidget);
    expect(find.text('Active Sessions: 8'), findsNothing);
  });

  testWidgets('app helper reports missing backend config without a backend URL', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1280, 1024);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      KfcMonitorApp(
        liveMonitorController: createLiveMonitorController(
          backendUrl: '',
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('KFC Vietnam Operations'), findsOneWidget);
    expect(find.text('Config missing'), findsOneWidget);
    expect(find.text('Missing KFC_AGENT_BACKEND_URL'), findsOneWidget);
    expect(find.text('Active Sessions: 8'), findsNothing);
    expect(find.text('Session M-1001'), findsNothing);
  });
}
