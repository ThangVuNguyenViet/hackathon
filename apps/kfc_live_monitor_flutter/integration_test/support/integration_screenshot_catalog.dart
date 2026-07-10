import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

class IntegrationScreenshotCatalog {
  IntegrationScreenshotCatalog({
    required this.outputDirectory,
    required this.testName,
    required this.boundaryKey,
  });

  final Directory outputDirectory;
  final String testName;
  final GlobalKey boundaryKey;
  int _step = 0;

  int get capturedCount => _step;

  Future<void> reset() async {
    if (await outputDirectory.exists()) {
      await outputDirectory.delete(recursive: true);
    }
    await outputDirectory.create(recursive: true);
  }

  Future<File> capture(
    WidgetTester tester,
    String label, {
    Finder? target,
    bool settle = true,
  }) async {
    if (settle) {
      await tester.pump(const Duration(milliseconds: 250));
    } else {
      await tester.pump();
    }

    _step++;
    final fileName =
        '${_step.toString().padLeft(2, '0')}_${_safeLabel(label)}.png';
    debugPrint('KFC_GENUI_CAPTURE_START label=$label file=$fileName');
    final bytes = await _captureRenderTreePng(tester, target);
    debugPrint('KFC_GENUI_CAPTURE_BYTES label=$label bytes=${bytes.length}');
    final file = File('${outputDirectory.path}/$testName/$fileName');
    await file.parent
        .create(recursive: true)
        .timeout(
          const Duration(seconds: 5),
          onTimeout: () => throw TimeoutException(
            'Timed out creating screenshot directory ${file.parent.path}',
          ),
        );
    await file
        .writeAsBytes(bytes, flush: true)
        .timeout(
          const Duration(seconds: 5),
          onTimeout: () => throw TimeoutException(
            'Timed out writing screenshot ${file.path}',
          ),
        );
    debugPrint('KFC_GENUI_SCREENSHOT=${file.path}');
    return file;
  }

  Future<Uint8List> _captureRenderTreePng(
    WidgetTester tester,
    Finder? target,
  ) async {
    final boundary = target == null
        ? boundaryKey.currentContext?.findRenderObject()
        : tester.renderObject<RenderRepaintBoundary>(target);
    if (boundary is! RenderRepaintBoundary) {
      throw StateError('Screenshot boundary is unavailable.');
    }
    debugPrint('KFC_GENUI_TO_IMAGE_START');
    final image = await boundary
        .toImage(pixelRatio: 1)
        .timeout(
          const Duration(seconds: 5),
          onTimeout: () =>
              throw TimeoutException('Timed out capturing boundary'),
        );
    debugPrint(
      'KFC_GENUI_TO_IMAGE_DONE width=${image.width} height=${image.height}',
    );
    final byteData = await image
        .toByteData(format: ui.ImageByteFormat.png)
        .timeout(
          const Duration(seconds: 5),
          onTimeout: () => throw TimeoutException('Timed out encoding PNG'),
        );
    debugPrint('KFC_GENUI_ENCODE_DONE bytes=${byteData?.lengthInBytes}');
    if (byteData == null) {
      throw StateError('Failed to encode screenshot PNG.');
    }
    return byteData.buffer.asUint8List();
  }

  String _safeLabel(String label) {
    final safeLabel = label
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '_')
        .replaceAll(RegExp(r'^_|_$'), '');
    return safeLabel.isEmpty ? 'screen' : safeLabel;
  }
}
