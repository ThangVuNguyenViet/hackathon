import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';

class PatrolScreenshotCatalog {
  PatrolScreenshotCatalog(this.$, this.testName);

  static const _serverUrl = String.fromEnvironment(
    'PATROL_SCREENSHOT_SERVER_URL',
    defaultValue: 'http://localhost:18083/screenshot',
  );

  final PatrolIntegrationTester $;
  final String testName;
  int _step = 0;

  int get capturedCount => _step;

  Future<void> capture(String label, {Finder? target}) async {
    _step++;
    final step = _step.toString().padLeft(2, '0');
    final safeLabel = label
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '_')
        .replaceAll(RegExp(r'^_|_$'), '');
    final fileName = '${step}_${safeLabel.isEmpty ? 'screen' : safeLabel}.png';

    final binding = $.tester.binding;
    if (binding is LiveTestWidgetsFlutterBinding) {
      // Hide Flutter's live-test label so screenshots contain only app UI.
      // ignore: invalid_use_of_protected_member
      binding.setLabel('');
      await $.tester.pump(const Duration(milliseconds: 250));
    }

    final image = await _captureImage(target);
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
    final bytes = byteData!.buffer.asUint8List();

    final client = HttpClient();
    try {
      final request = await client
          .postUrl(Uri.parse(_serverUrl))
          .timeout(const Duration(seconds: 5));
      request.headers
        ..contentType = ContentType('image', 'png')
        ..set('x-test-name', testName)
        ..set('x-file-name', fileName)
        ..contentLength = bytes.length;
      request.add(bytes);
      final response = await request.close().timeout(
        const Duration(seconds: 5),
      );
      if (response.statusCode != HttpStatus.ok) {
        throw HttpException(
          'Screenshot receiver returned ${response.statusCode}',
          uri: Uri.parse(_serverUrl),
        );
      }
    } finally {
      client.close(force: true);
    }
  }

  Future<ui.Image> _captureImage(Finder? target) async {
    if (target != null) {
      final boundary = $.tester.renderObject<RenderRepaintBoundary>(target);
      return boundary.toImage(
        pixelRatio: ui.PlatformDispatcher.instance.views.first.devicePixelRatio,
      );
    }

    final renderView = $.tester.binding.renderViews.first;
    final layer = renderView.debugLayer! as OffsetLayer;
    return layer.toImage(renderView.paintBounds);
  }
}
