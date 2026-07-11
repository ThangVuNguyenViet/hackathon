import 'dart:convert';

import '../domain/customer_run_models.dart';

Stream<CustomerRunEventEnvelope> decodeCustomerRunSse(
  Stream<List<int>> bytes,
) async* {
  var buffer = '';
  await for (final text in bytes.transform(utf8.decoder)) {
    buffer += text.replaceAll('\r\n', '\n');
    while (true) {
      final boundary = buffer.indexOf('\n\n');
      if (boundary < 0) break;
      final frame = buffer.substring(0, boundary);
      buffer = buffer.substring(boundary + 2);
      final dataLines = frame
          .split('\n')
          .where((line) => line.startsWith('data:'))
          .map((line) => line.substring(5).trimLeft())
          .toList(growable: false);
      if (dataLines.isEmpty) continue;
      final decoded = jsonDecode(dataLines.join('\n'));
      if (decoded is! Map) {
        throw const FormatException('SSE data must be an object');
      }
      yield CustomerRunEventEnvelope.fromJson(decoded.cast<String, Object?>());
    }
  }
  if (buffer.trim().isNotEmpty &&
      buffer.split('\n').any((line) => line.startsWith('data:'))) {
    throw const FormatException('Incomplete SSE frame');
  }
}
