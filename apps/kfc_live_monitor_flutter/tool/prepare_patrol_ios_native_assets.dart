import 'dart:io';

Future<void> main() async {
  final candidates =
      Directory('.dart_tool/hooks_runner/shared/objective_c/build')
          .listSync(recursive: true)
          .whereType<File>()
          .where((file) => file.uri.pathSegments.last == 'objective_c.dylib')
          .toList()
        ..sort((a, b) => b.lastModifiedSync().compareTo(a.lastModifiedSync()));

  if (candidates.isEmpty) {
    stderr.writeln(
      'No generated objective_c.dylib found. Run flutter pub get first.',
    );
    exitCode = 1;
    return;
  }

  final frameworkDir = Directory(
    'build/native_assets/ios/objective_c.framework',
  )..createSync(recursive: true);
  final binary = File('${frameworkDir.path}/objective_c');
  candidates.first.copySync(binary.path);

  File('${frameworkDir.path}/Info.plist').writeAsStringSync('''
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>objective_c</string>
  <key>CFBundleIdentifier</key>
  <string>dev.dart.objective-c</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>objective_c</string>
  <key>CFBundlePackageType</key>
  <string>FMWK</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
</dict>
</plist>
''');

  stdout.writeln('Prepared ${frameworkDir.path}');
}
