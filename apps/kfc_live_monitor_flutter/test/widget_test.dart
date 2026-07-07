import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/app/kfc_monitor_app.dart';

void main() {
  testWidgets('app renders live monitor screen', (tester) async {
    tester.view.physicalSize = const Size(1280, 1024);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(const KfcMonitorApp());
    await tester.pumpAndSettle();

    expect(find.text('KFC Vietnam Operations'), findsOneWidget);
    expect(find.text('Active Sessions: 8'), findsOneWidget);
  });
}
