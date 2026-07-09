import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_test_goldens/flutter_test_goldens.dart';
import 'package:kfc_live_monitor/app/theme/kfc_ops_tokens.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/genui/kfc_genui_renderer.dart';

import '../../features/test_app.dart';

Future<void> runKfcGenUiCatalogGolden(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1280, 1200);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await Gallery(
        'KFC GenUI MVP Catalog',
        directory: Directory(''),
        fileName: 'kfc_genui_catalog',
        layout: ColumnSceneLayout(),
      )
      .itemFromBuilder(
        description: 'six-widget MVP catalog',
        constraints: BoxConstraints.tight(const Size(1280, 1200)),
        builder: (_) => TestApp(
          child: const _CatalogSurface(kinds: KfcGenUiWidgetKind.values),
        ),
      )
      .run(tester);
}

Future<void> runKfcGenUiComponentGolden(
  WidgetTester tester,
  KfcGenUiWidgetKind kind,
) async {
  tester.view.physicalSize = const Size(560, 420);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await Gallery(
        'KFC GenUI ${kind.wireName}',
        directory: Directory(''),
        fileName: kind.wireName,
        layout: ColumnSceneLayout(),
      )
      .itemFromBuilder(
        description: kind.wireName,
        constraints: BoxConstraints.tight(const Size(560, 420)),
        builder: (_) => TestApp(
          child: Padding(
            padding: const EdgeInsets.all(KfcOpsTokens.gutter),
            child: KfcGenUiRenderer(
              attachment: kfcGenUiFixture(kind),
              onAction: (_) {},
            ),
          ),
        ),
      )
      .run(tester);
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
