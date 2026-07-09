import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/app/kfc_monitor_app.dart';
import 'package:kfc_live_monitor/features/live_monitor/application/live_monitor_controller.dart';

import '../../features/live_monitor/support/mock_live_monitor_repository.dart';

Future<void> runLiveMonitorGolden(WidgetTester tester) async {
  await loadKfcTestFonts();
  tester.view.physicalSize = const Size(1280, 1024);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    KfcMonitorApp(
      liveMonitorController: LiveMonitorController(
        repository: const MockLiveMonitorRepository(),
      ),
    ),
  );
  await tester.pumpAndSettle();

  await expectLater(
    find.byType(KfcMonitorApp),
    matchesGoldenFile('live_monitor_primary_screen.png'),
  );
}

Future<void> loadKfcTestFonts() async {
  final regular = rootBundle.load(
    'assets/fonts/be_vietnam_pro/BeVietnamPro-Regular.ttf',
  );
  final medium = rootBundle.load(
    'assets/fonts/be_vietnam_pro/BeVietnamPro-Medium.ttf',
  );
  final semiBold = rootBundle.load(
    'assets/fonts/be_vietnam_pro/BeVietnamPro-SemiBold.ttf',
  );
  final bold = rootBundle.load(
    'assets/fonts/be_vietnam_pro/BeVietnamPro-Bold.ttf',
  );
  final lucide = rootBundle.load(
    'packages/lucide_icons_flutter/assets/lucide.ttf',
  );

  final loader = FontLoader('Be Vietnam Pro')
    ..addFont(regular)
    ..addFont(medium)
    ..addFont(semiBold)
    ..addFont(bold);
  await loader.load();

  final iconLoader = FontLoader('Lucide')..addFont(lucide);
  await iconLoader.load();

  final packageIconLoader = FontLoader('packages/lucide_icons_flutter/Lucide')
    ..addFont(lucide);
  await packageIconLoader.load();
}
