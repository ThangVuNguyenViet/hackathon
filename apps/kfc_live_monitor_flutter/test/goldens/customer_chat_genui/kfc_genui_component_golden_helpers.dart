import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/app/theme/kfc_ops_tokens.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/genui/kfc_genui_renderer.dart';

import '../../features/test_app.dart';
import '../live_monitor/live_monitor_golden_helpers.dart';

Future<void> runKfcGenUiCatalogGolden(WidgetTester tester) async {
  await loadKfcTestFonts();
  tester.view.physicalSize = const Size(1280, 1200);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    TestApp(child: const _CatalogSurface(kinds: KfcGenUiWidgetKind.values)),
  );
  await tester.pumpAndSettle();

  await expectLater(
    find.byType(_CatalogSurface),
    matchesGoldenFile('kfc_genui_catalog.png'),
  );
}

Future<void> runKfcGenUiComponentGolden(
  WidgetTester tester,
  KfcGenUiWidgetKind kind,
) async {
  await loadKfcTestFonts();
  tester.view.physicalSize = const Size(560, 420);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    TestApp(
      child: Padding(
        padding: const EdgeInsets.all(KfcOpsTokens.gutter),
        child: KfcGenUiRenderer(
          attachment: kfcGenUiFixture(kind),
          onAction: (_) {},
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();

  await expectLater(
    find.byType(KfcGenUiRenderer),
    matchesGoldenFile('${kind.wireName}.png'),
  );
}

class _CatalogSurface extends StatelessWidget {
  const _CatalogSurface({required this.kinds});

  final List<KfcGenUiWidgetKind> kinds;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: KfcOpsTokens.surface,
      child: Padding(
        padding: const EdgeInsets.all(KfcOpsTokens.marginDesktop),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'KFC GenUI MVP Catalog',
              style: TextStyle(
                color: KfcOpsTokens.primary,
                fontSize: 24,
                fontWeight: FontWeight.w900,
                height: 32 / 24,
                letterSpacing: 0,
              ),
            ),
            const SizedBox(height: KfcOpsTokens.spacingMd),
            Wrap(
              spacing: KfcOpsTokens.gutter,
              runSpacing: KfcOpsTokens.gutter,
              children: [
                for (final kind in kinds)
                  SizedBox(
                    width: 388,
                    child: KfcGenUiRenderer(
                      attachment: kfcGenUiFixture(kind),
                      onAction: (_) {},
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
