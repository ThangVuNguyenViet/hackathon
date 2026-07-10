import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_test_goldens/flutter_test_goldens.dart';
import 'package:kfc_live_monitor/app/kfc_monitor_app.dart';
import 'package:kfc_live_monitor/app/theme/kfc_ops_tokens.dart';
import 'package:kfc_live_monitor/features/live_monitor/application/live_monitor_controller.dart';
import 'package:kfc_live_monitor/features/live_monitor/domain/chat_session.dart';
import 'package:kfc_live_monitor/features/live_monitor/presentation/widgets/session_card.dart';

import '../../features/live_monitor/support/mock_live_monitor_repository.dart';
import '../../features/test_app.dart';

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
          itemScaffold: _kfcGoldenItemScaffold,
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

  testGoldenScene('session card preview shrink-wraps short chat bubbles', (
    tester,
  ) async {
    await _loadKfcTestFonts();

    await Gallery(
          'KFC session card short message preview',
          directory: Directory(''),
          fileName: 'session_card_short_message_preview',
          itemScaffold: _kfcGoldenItemScaffold,
          layout: ColumnSceneLayout(),
        )
        .itemFromBuilder(
          description: 'short customer message keeps a compact bubble',
          constraints: BoxConstraints.tight(const Size(360, 320)),
          builder: (_) => const TestApp(
            child: DefaultTextStyle(
              style: _kfcGoldenTextStyle,
              child: ColoredBox(
                color: KfcOpsTokens.surface,
                child: Padding(
                  padding: EdgeInsets.all(KfcOpsTokens.spacingMd),
                  child: SessionCard(
                    session: _shortMessageSession,
                    onOpenSession: _noop,
                    onJoinHuman: _noop,
                    onResumeAi: _noop,
                  ),
                ),
              ),
            ),
          ),
        )
        .run(tester);
  });
}

Widget _kfcGoldenItemScaffold(WidgetTester tester, Widget content) {
  return GoldenImageBounds(child: content);
}

void _noop() {}

const _kfcGoldenTextStyle = TextStyle(
  fontFamily: KfcOpsTokens.fontFamily,
  color: KfcOpsTokens.onSurface,
  fontSize: 14,
  fontWeight: FontWeight.w400,
  height: 20 / 14,
  letterSpacing: 0,
);

const _shortMessageSession = ChatSession(
  id: 'messenger:short-message-golden',
  customerId: 'short-message-golden',
  customerName: 'Thang Vu',
  channel: ChatChannel.messenger,
  severity: SessionSeverity.warning,
  status: SessionStatus.aiHandling,
  orderState: OrderState.cartReady,
  lastActivityLabel: 'Live',
  orderLabel: '1x Combo Ga Rom Ra 245k, 1x Combo Burger ...',
  confidencePercent: 65,
  intelligenceSourceLabel: 'AI judged',
  riskLabel: 'Needs review',
  deeplink: ChatDeeplink.available('backend://messenger:short-message-golden'),
  turns: [
    ChatTurn(
      speaker: 'AI',
      message:
          'Chao ban! Gio hang hien co 1 Combo Ga Rom Ra 245k, 1 Combo Burger Zinger va 2 Pepsi.',
    ),
    ChatTurn(speaker: 'User', message: 'hi'),
    ChatTurn(
      speaker: 'AI',
      message: 'Minh da them combo vao gio hang cho ban.',
    ),
  ],
);

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
