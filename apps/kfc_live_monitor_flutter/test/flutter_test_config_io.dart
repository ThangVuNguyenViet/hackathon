import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  TestWidgetsFlutterBinding.ensureInitialized();
  if (kIsWeb) {
    await testMain();
    return;
  }
  _installFontAssetFallbacks();
  await _loadFontFamily(
    family: 'Be Vietnam Pro',
    files: const [
      'assets/fonts/be_vietnam_pro/BeVietnamPro-Regular.ttf',
      'assets/fonts/be_vietnam_pro/BeVietnamPro-Medium.ttf',
      'assets/fonts/be_vietnam_pro/BeVietnamPro-SemiBold.ttf',
      'assets/fonts/be_vietnam_pro/BeVietnamPro-Bold.ttf',
    ],
  );
  await _loadFontFamily(
    family: 'Lucide',
    files: [_lucideFontPath('lucide.ttf')],
  );
  await _loadFontFamily(
    family: 'packages/lucide_icons_flutter/Lucide',
    files: [_lucideFontPath('lucide.ttf')],
  );
  await testMain();
}

void _installFontAssetFallbacks() {
  final codec = const StringCodec();
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMessageHandler('flutter/assets', (message) async {
        final key = codec.decodeMessage(message);
        if (key == null) return null;

        if (key == 'FontManifest.json') {
          final file = File('build/unit_test_assets/FontManifest.json');
          if (file.existsSync()) {
            final content = file.readAsStringSync();
            final modifiedContent = content.replaceFirst(
              '[',
              '[${_fontManifestEntries.join(',')},',
            );
            return ByteData.view(
              Uint8List.fromList(modifiedContent.codeUnits).buffer,
            );
          }
        }

        if (key.startsWith('assets/fonts/')) {
          final file = File(key);
          if (file.existsSync()) {
            return ByteData.view(file.readAsBytesSync().buffer);
          }
        }

        if (key.startsWith('packages/lucide_icons_flutter/assets/')) {
          final fileName = key.split('/').last;
          final file = File(_lucideFontPath(fileName));
          if (file.existsSync()) {
            return ByteData.view(file.readAsBytesSync().buffer);
          }
        }

        if (key.startsWith('packages/shadcn_ui/fonts/')) {
          final fileName = Uri.decodeComponent(key.split('/').last);
          final file = File(_packageAssetPath('shadcn_ui', 'fonts/$fileName'));
          if (file.existsSync()) {
            return ByteData.view(file.readAsBytesSync().buffer);
          }
        }

        if (key.contains('Geist')) {
          return ByteData.view(
            File(
              'assets/fonts/be_vietnam_pro/BeVietnamPro-Regular.ttf',
            ).readAsBytesSync().buffer,
          );
        }

        final fallback = File('build/unit_test_assets/$key');
        if (fallback.existsSync()) {
          return ByteData.view(fallback.readAsBytesSync().buffer);
        }

        return null;
      });
}

String _lucideFontPath(String fileName) {
  return _packageAssetPath('lucide_icons_flutter', 'assets/$fileName');
}

String _packageAssetPath(String packageName, String packageRelativePath) {
  final packageConfig = _findPackageConfig();
  if (!packageConfig.existsSync()) {
    throw StateError('Missing .dart_tool/package_config.json');
  }
  final decoded = jsonDecode(packageConfig.readAsStringSync()) as Map;
  final packages = decoded['packages'] as List;
  final package = packages.cast<Map>().firstWhere(
    (entry) => entry['name'] == packageName,
    orElse: () => throw StateError('$packageName not found'),
  );
  final rootUri = Uri.parse(package['rootUri'] as String);
  final root = rootUri.isAbsolute
      ? rootUri.toFilePath()
      : packageConfig.parent.uri.resolveUri(rootUri).toFilePath();
  final configured = File('$root/$packageRelativePath');
  if (configured.existsSync()) return configured.path;

  final hostedCache = Directory(
    '${Platform.environment['HOME']}/.pub-cache/hosted/pub.dev',
  );
  if (hostedCache.existsSync()) {
    for (final entry in hostedCache.listSync()) {
      if (entry is! Directory) continue;
      if (!entry.path.split('/').last.startsWith('$packageName-')) continue;
      final fallback = File('${entry.path}/$packageRelativePath');
      if (fallback.existsSync()) return fallback.path;
    }
  }
  return configured.path;
}

File _findPackageConfig() {
  var directory = Directory.current;
  while (true) {
    final candidate = File('${directory.path}/.dart_tool/package_config.json');
    if (candidate.existsSync()) return candidate;
    final parent = directory.parent;
    if (parent.path == directory.path) return candidate;
    directory = parent;
  }
}

const _fontManifestEntries = [
  '{"family":"Be Vietnam Pro","fonts":[{"weight":400,"asset":"assets/fonts/be_vietnam_pro/BeVietnamPro-Regular.ttf"},{"weight":500,"asset":"assets/fonts/be_vietnam_pro/BeVietnamPro-Medium.ttf"},{"weight":600,"asset":"assets/fonts/be_vietnam_pro/BeVietnamPro-SemiBold.ttf"},{"weight":700,"asset":"assets/fonts/be_vietnam_pro/BeVietnamPro-Bold.ttf"}]}',
  '{"family":"packages/lucide_icons_flutter/Lucide","fonts":[{"asset":"packages/lucide_icons_flutter/assets/lucide.ttf"}]}',
];

Future<void> _loadFontFamily({
  required String family,
  required List<String> files,
}) async {
  final loader = FontLoader(family);
  for (final path in files) {
    final file = File(path);
    if (!file.existsSync()) {
      throw StateError('Missing test font asset: $path');
    }
    loader.addFont(Future.value(ByteData.view(file.readAsBytesSync().buffer)));
  }
  await loader.load();
}
