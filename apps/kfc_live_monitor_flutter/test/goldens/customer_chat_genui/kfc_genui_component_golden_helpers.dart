import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_test_goldens/flutter_test_goldens.dart';
import 'package:kfc_live_monitor/app/theme/kfc_ops_tokens.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/genui/kfc_genui_renderer.dart';

import '../../features/test_app.dart';

Future<void> runKfcGenUiCatalogGolden(WidgetTester tester) async {
  await _seedGoldenMenuImages();
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
  await _seedGoldenMenuImages();
  final frameSize = switch (kind) {
    KfcGenUiWidgetKind.smartMenuPicker => const Size(390, 844),
    KfcGenUiWidgetKind.fullMenuBrowser => const Size(390, 780),
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
              KfcGenUiWidgetKind.fullMenuBrowser ||
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
  final keepsMenuImages =
      kind == KfcGenUiWidgetKind.smartMenuPicker ||
      kind == KfcGenUiWidgetKind.fullMenuBrowser;
  return KfcGenUiAttachment(
    id: fixture.id,
    lifecycleStage: fixture.lifecycleStage,
    widgetKind: fixture.widgetKind,
    status: fixture.status,
    title: fixture.title,
    summary: fixture.summary,
    data: keepsMenuImages
        ? fixture.data
        : _withoutRemoteMedia(fixture.data) as Map<String, Object?>,
    actions: fixture.actions,
    selectedAction: fixture.selectedAction,
    expiresAt: fixture.expiresAt,
  );
}

const _goldenMenuImages = <String, _GoldenMenuImage>{
  'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL':
      _GoldenMenuImage.combo,
  'https://static.kfcvietnam.com.vn/images/items/lg/FS-BUCKET5COB.jpg?v=LNN7PL':
      _GoldenMenuImage.bucket,
  'https://static.kfcvietnam.com.vn/images/items/lg/Burger-Flava.jpg?v=LNN7PL':
      _GoldenMenuImage.burger,
  'https://static.kfcvietnam.com.vn/images/items/lg/ZINGER.jpg?v=LNN7PL':
      _GoldenMenuImage.burger,
  'https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-M.jpg?v=LNN7PL':
      _GoldenMenuImage.drink,
  'https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-ZERO-M.jpg?v=LNN7PL':
      _GoldenMenuImage.zeroDrink,
};

enum _GoldenMenuImage { combo, bucket, burger, drink, zeroDrink }

Future<void> _seedGoldenMenuImages() async {
  for (final entry in _goldenMenuImages.entries) {
    final provider = NetworkImage(entry.key);
    PaintingBinding.instance.imageCache.evict(provider);
    final image = await _drawGoldenMenuImage(entry.value);
    PaintingBinding.instance.imageCache.putIfAbsent(
      provider,
      () => OneFrameImageStreamCompleter(
        SynchronousFuture(ImageInfo(image: image)),
      ),
    );
  }
}

Future<ui.Image> _drawGoldenMenuImage(_GoldenMenuImage kind) async {
  const size = ui.Size.square(144);
  final recorder = ui.PictureRecorder();
  final canvas = ui.Canvas(recorder);
  final paint = ui.Paint()..isAntiAlias = true;

  paint.color = const ui.Color(0xFFFFF4E6);
  canvas.drawRect(ui.Offset.zero & size, paint);
  paint.color = const ui.Color(0xFFFFFFFF);
  canvas.drawCircle(const ui.Offset(72, 76), 57, paint);

  switch (kind) {
    case _GoldenMenuImage.combo:
      _drawBurger(canvas, const ui.Offset(30, 55), 0.72);
      _drawBucket(canvas, const ui.Offset(72, 46), 0.62);
      _drawDrink(canvas, const ui.Offset(104, 52), 0.55, zero: false);
    case _GoldenMenuImage.bucket:
      _drawBucket(canvas, const ui.Offset(43, 31), 1.1);
    case _GoldenMenuImage.burger:
      _drawBurger(canvas, const ui.Offset(28, 41), 1.38);
    case _GoldenMenuImage.drink:
      _drawDrink(canvas, const ui.Offset(45, 25), 1.28, zero: false);
    case _GoldenMenuImage.zeroDrink:
      _drawDrink(canvas, const ui.Offset(45, 25), 1.28, zero: true);
  }

  return recorder.endRecording().toImage(144, 144);
}

void _drawBurger(ui.Canvas canvas, ui.Offset origin, double scale) {
  final paint = ui.Paint()..isAntiAlias = true;
  ui.RRect layer(double top, double height, double radius) =>
      ui.RRect.fromRectAndRadius(
        ui.Rect.fromLTWH(
          origin.dx,
          origin.dy + top * scale,
          62 * scale,
          height * scale,
        ),
        ui.Radius.circular(radius * scale),
      );
  paint.color = const ui.Color(0xFFE7A84A);
  canvas.drawRRect(layer(0, 19, 14), paint);
  paint.color = const ui.Color(0xFF65A843);
  canvas.drawRRect(layer(17, 6, 3), paint);
  paint.color = const ui.Color(0xFF7B3F20);
  canvas.drawRRect(layer(22, 11, 5), paint);
  paint.color = const ui.Color(0xFFF4C95D);
  canvas.drawRRect(layer(32, 6, 2), paint);
  paint.color = const ui.Color(0xFFD98A35);
  canvas.drawRRect(layer(37, 15, 7), paint);
}

void _drawBucket(ui.Canvas canvas, ui.Offset origin, double scale) {
  final paint = ui.Paint()..isAntiAlias = true;
  paint.color = const ui.Color(0xFFD9A441);
  for (final center in [
    const ui.Offset(11, 10),
    const ui.Offset(28, 4),
    const ui.Offset(43, 12),
  ]) {
    canvas.drawCircle(origin + center * scale, 12 * scale, paint);
  }
  final path = ui.Path()
    ..moveTo(origin.dx, origin.dy + 15 * scale)
    ..lineTo(origin.dx + 54 * scale, origin.dy + 15 * scale)
    ..lineTo(origin.dx + 47 * scale, origin.dy + 63 * scale)
    ..lineTo(origin.dx + 7 * scale, origin.dy + 63 * scale)
    ..close();
  paint.color = const ui.Color(0xFFC8102E);
  canvas.drawPath(path, paint);
  paint.color = const ui.Color(0xFFFFFFFF);
  canvas.drawRect(
    ui.Rect.fromLTWH(
      origin.dx + 22 * scale,
      origin.dy + 18 * scale,
      10 * scale,
      43 * scale,
    ),
    paint,
  );
}

void _drawDrink(
  ui.Canvas canvas,
  ui.Offset origin,
  double scale, {
  required bool zero,
}) {
  final paint = ui.Paint()..isAntiAlias = true;
  paint
    ..color = const ui.Color(0xFF263B80)
    ..strokeWidth = 4 * scale;
  canvas.drawLine(
    origin + ui.Offset(32 * scale, 4 * scale),
    origin + ui.Offset(45 * scale, -16 * scale),
    paint,
  );
  final cup = ui.Path()
    ..moveTo(origin.dx, origin.dy)
    ..lineTo(origin.dx + 54 * scale, origin.dy)
    ..lineTo(origin.dx + 45 * scale, origin.dy + 70 * scale)
    ..lineTo(origin.dx + 9 * scale, origin.dy + 70 * scale)
    ..close();
  paint.color = zero ? const ui.Color(0xFF222222) : const ui.Color(0xFF1769AA);
  canvas.drawPath(cup, paint);
  paint.color = const ui.Color(0xFFC8102E);
  canvas.drawCircle(
    origin + ui.Offset(27 * scale, 33 * scale),
    13 * scale,
    paint,
  );
  paint.color = const ui.Color(0xFFFFFFFF);
  canvas.drawCircle(
    origin + ui.Offset(27 * scale, 29 * scale),
    8 * scale,
    paint,
  );
}

Object? _withoutRemoteMedia(Object? value) {
  if (value is List<Object?>) {
    return value.map(_withoutRemoteMedia).toList(growable: false);
  }
  if (value is Map<String, Object?>) {
    return <String, Object?>{
      for (final entry in value.entries)
        if (entry.key != 'imageUrl' && entry.key != 'media')
          entry.key: _withoutRemoteMedia(entry.value),
    };
  }
  return value;
}
