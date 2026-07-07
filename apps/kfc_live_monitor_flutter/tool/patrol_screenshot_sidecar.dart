import 'dart:io';

const _defaultOutputRoot = 'docs/app_screenshots/live_monitor';
const _port = 18083;

Future<void> main(List<String> args) async {
  final outputRoot = Directory(args.isEmpty ? _defaultOutputRoot : args.first);
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, _port);
  stdout.writeln(
    'Patrol screenshot sidecar listening on '
    'http://localhost:$_port/screenshot',
  );
  stdout.writeln('Writing screenshots to ${outputRoot.path}');

  await for (final request in server) {
    if (request.method != 'POST' || request.uri.path != '/screenshot') {
      request.response.statusCode = HttpStatus.notFound;
      await request.response.close();
      continue;
    }

    final testName = _safeSegment(
      request.headers.value('x-test-name') ?? 'unknown_test',
    );
    final fileName = _safePngFileName(
      request.headers.value('x-file-name') ?? 'screenshot.png',
    );
    final bytes = await request.expand((chunk) => chunk).toList();

    final dir = Directory('${outputRoot.path}/$testName');
    if (!dir.existsSync()) {
      dir.createSync(recursive: true);
    }

    final file = File('${dir.path}/$fileName');
    await file.writeAsBytes(bytes, flush: true);
    stdout.writeln('saved ${file.path}');

    request.response.statusCode = HttpStatus.ok;
    await request.response.close();
  }
}

String _safePngFileName(String value) {
  final safe = _safeSegment(value.replaceAll(RegExp(r'\.png$'), ''));
  return '$safe.png';
}

String _safeSegment(String value) {
  final safe = value
      .trim()
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9_-]+'), '_')
      .replaceAll(RegExp(r'^_+|_+$'), '');
  return safe.isEmpty ? 'unknown_test' : safe;
}
