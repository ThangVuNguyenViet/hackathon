import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/customer_run_models.dart';

void main() {
  test(
    'starts one typed run and watches its accepted id without restarting',
    () async {
      final requests = <http.Request>[];
      final repository = BackendCustomerChatRepository(
        baseUrl: 'http://localhost:18090',
        client: MockClient((request) async {
          requests.add(request);
          if (request.method == 'POST') {
            return http.Response(
              jsonEncode({
                'schemaVersion': 1,
                'runId': 'run_1',
                'status': 'accepted',
                'nextSequence': 1,
                'replayed': false,
              }),
              202,
            );
          }
          final envelope = jsonEncode({
            'schemaVersion': 1,
            'eventId': 'e1',
            'runId': 'run_1',
            'sequence': 1,
            'type': 'text_delta',
            'occurredAt': '2026-07-11T00:00:00.000Z',
            'payload': {'delta': 'Xin chào'},
          });
          return http.Response(
            'id: 1\nevent: text_delta\ndata: $envelope\n\n',
            200,
            headers: {'content-type': 'text/event-stream; charset=utf-8'},
          );
        }),
      );

      final accepted = await repository.startRun(
        sessionId: 'kfc:c1',
        customerId: 'c1',
        clientMessageId: 'm1',
        text: 'hello',
      );
      final events = await repository.watchRun(accepted.runId, 0).toList();
      expect(accepted.runId, 'run_1');
      expect(
        (events.single.data as CustomerRunTextDeltaData).delta,
        'Xin chào',
      );
      expect(
        requests.where((request) => request.method == 'POST'),
        hasLength(1),
      );
      expect(requests.last.url.queryParameters['after'], '0');
    },
  );

  test('posts cooperative cancellation to the same run', () async {
    final repository = BackendCustomerChatRepository(
      baseUrl: 'http://localhost:18090',
      client: MockClient(
        (request) async => http.Response(
          jsonEncode({'runId': 'run_1', 'status': 'cancelling'}),
          202,
        ),
      ),
    );
    final cancelled = await repository.cancelRun('run_1');
    expect(cancelled.status, 'cancelling');
  });
}
