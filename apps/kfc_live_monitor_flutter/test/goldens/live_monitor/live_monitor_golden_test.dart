import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_test_goldens/flutter_test_goldens.dart';
import 'package:kfc_live_monitor/app/kfc_monitor_app.dart';
import 'package:kfc_live_monitor/features/live_monitor/application/live_monitor_controller.dart';

import '../../features/live_monitor/support/mock_live_monitor_repository.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testGoldenScene('KFC live monitor primary screen with mock sessions', (
    tester,
  ) async {
    await _loadKfcTestFonts();

    await Gallery(
          'KFC live monitor primary screen',
          directory: Directory(''),
          fileName: 'live_monitor_primary_screen',
          layout: ColumnSceneLayout(),
        )
        .itemFromBuilder(
          description: 'mock chat sessions',
          constraints: BoxConstraints.tight(const Size(1280, 1024)),
          builder: (_) => KfcMonitorApp(
            liveMonitorController: LiveMonitorController(
              repository: const MockLiveMonitorRepository(),
            ),
          ),
        )
        .run(tester);
  });
}

Future<void> _loadKfcTestFonts() async {
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
