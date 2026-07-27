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
  const catalogSize = Size(1280, 2400);
  tester.view.physicalSize = catalogSize;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await Gallery(
        'KFC GenUI MVP Catalog',
        directory: Directory(''),
        fileName: 'kfc_genui_catalog',
        layout: ColumnSceneLayout(),
      )
      .itemFromBuilder(
        description: 'full widget catalog',
        constraints: BoxConstraints.tight(catalogSize),
        builder: (_) => const _KfcGenUiGoldenFrame(
          child: _CatalogSurface(kinds: KfcGenUiWidgetKind.values),
        ),
      )
      .run(tester);
}

Future<void> runKfcGenUiComponentGolden(
  WidgetTester tester,
  KfcGenUiWidgetKind kind,
) async {
  final frameSize = switch (kind) {
    KfcGenUiWidgetKind.smartMenuPicker => const Size(390, 844),
    KfcGenUiWidgetKind.productDetailCard => const Size(390, 700),
    KfcGenUiWidgetKind.modifierPicker => const Size(390, 700),
    KfcGenUiWidgetKind.promotionGallery => const Size(390, 844),
    KfcGenUiWidgetKind.allergenEvidence => const Size(390, 700),
    KfcGenUiWidgetKind.cartBuilder => const Size(390, 620),
    KfcGenUiWidgetKind.orderReviewConfirm => const Size(390, 660),
    _ => const Size(560, 420),
  };
  tester.view.physicalSize = frameSize;
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
        constraints: BoxConstraints.tight(frameSize),
        builder: (_) => _KfcGenUiGoldenFrame(
          child: Padding(
            padding: const EdgeInsets.all(KfcOpsTokens.gutter),
            child: switch (kind) {
              KfcGenUiWidgetKind.smartMenuPicker ||
              KfcGenUiWidgetKind.productDetailCard ||
              KfcGenUiWidgetKind.modifierPicker ||
              KfcGenUiWidgetKind.promotionGallery ||
              KfcGenUiWidgetKind.allergenEvidence ||
              KfcGenUiWidgetKind.cartBuilder ||
              KfcGenUiWidgetKind.orderReviewConfirm => Align(
                alignment: Alignment.topCenter,
                child: KfcGenUiRenderer(
                  attachment: _goldenFixture(kind),
                  onAction: (_) {},
                ),
              ),
              _ => KfcGenUiRenderer(
                attachment: _goldenFixture(kind),
                onAction: (_) {},
              ),
            },
          ),
        ),
      )
      .run(tester);
}

class _KfcGenUiGoldenFrame extends StatelessWidget {
  const _KfcGenUiGoldenFrame({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return TestApp(
      child: DefaultTextStyle(
        style: const TextStyle(
          fontFamily: KfcOpsTokens.fontFamily,
          color: KfcOpsTokens.onSurface,
          fontSize: 14,
          fontWeight: FontWeight.w400,
          height: 20 / 14,
          letterSpacing: 0,
        ),
        child: child,
      ),
    );
  }
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
                      attachment: _goldenFixture(kind),
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

KfcGenUiAttachment _goldenFixture(KfcGenUiWidgetKind kind) {
  final fixture = kfcGenUiFixture(kind);
  return KfcGenUiAttachment(
    id: fixture.id,
    lifecycleStage: fixture.lifecycleStage,
    widgetKind: fixture.widgetKind,
    status: fixture.status,
    title: fixture.title,
    summary: fixture.summary,
    data: _withoutRemoteMedia(fixture.data) as Map<String, Object?>,
    actions: fixture.actions,
    selectedAction: fixture.selectedAction,
    expiresAt: fixture.expiresAt,
    authority: fixture.authority,
  );
}

Object? _withoutRemoteMedia(Object? value) {
  if (value is List<Object?>) {
    return value.map(_withoutRemoteMedia).toList(growable: false);
  }
  if (value is Map<String, Object?>) {
    return <String, Object?>{
      for (final entry in value.entries)
        if (entry.key == 'imageUrl')
          entry.key: null
        else if (entry.key != 'media')
          entry.key: _withoutRemoteMedia(entry.value),
    };
  }
  return value;
}
