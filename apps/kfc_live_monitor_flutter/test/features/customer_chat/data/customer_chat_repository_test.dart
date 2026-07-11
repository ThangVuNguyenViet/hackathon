import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';

void main() {
  test('backend customer chat retries a transient transport failure', () async {
    final requests = <http.Request>[];
    final repository = BackendCustomerChatRepository(
      baseUrl: 'http://localhost:18090',
      retryDelay: Duration.zero,
      client: MockClient((request) async {
        requests.add(request);
        if (requests.length == 1) {
          throw const SocketException('temporary DNS failure');
        }
        return http.Response.bytes(
          utf8.encode(jsonEncode({'responseText': 'Đã kết nối lại.'})),
          200,
          headers: const {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );

    final response = await repository.sendMessage(
      sessionId: 'kfc:anon_customer_1',
      customerId: 'anon_customer_1',
      clientMessageId: 'customer_chat_msg_retry',
      text: 'Cho mình combo 99K',
    );

    expect(response.responseText, 'Đã kết nối lại.');
    expect(requests, hasLength(2));
    expect(requests[1].body, requests[0].body);
  });

  test(
    'backend customer chat does not retry a non-retryable response',
    () async {
      var attempts = 0;
      final repository = BackendCustomerChatRepository(
        baseUrl: 'http://localhost:18090',
        retryDelay: Duration.zero,
        client: MockClient((request) async {
          attempts += 1;
          return http.Response('invalid request', 400);
        }),
      );

      await expectLater(
        repository.sendMessage(
          sessionId: 'kfc:anon_customer_1',
          customerId: 'anon_customer_1',
          clientMessageId: 'customer_chat_msg_bad_request',
          text: 'Cho mình combo 99K',
        ),
        throwsStateError,
      );
      expect(attempts, 1);
    },
  );

  test('backend customer chat posts text turns to KFC source route', () async {
    final requests = <http.Request>[];
    final repository = BackendCustomerChatRepository(
      baseUrl: 'http://localhost:18090',
      client: MockClient((request) async {
        requests.add(request);
        return http.Response(
          jsonEncode({'responseText': 'Dạ KFC hỗ trợ bạn.'}),
          200,
          headers: const {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );

    final response = await repository.sendMessage(
      sessionId: 'kfc:anon_customer_1',
      customerId: 'anon_customer_1',
      clientMessageId: 'customer_chat_msg_1',
      text: 'Cho mình combo 99K',
    );

    expect(response.responseText, 'Dạ KFC hỗ trợ bạn.');
    expect(requests.single.method, 'POST');
    expect(requests.single.url.path, '/chat/kfc/message');
    expect(jsonDecode(requests.single.body), {
      'sessionId': 'kfc:anon_customer_1',
      'customerId': 'anon_customer_1',
      'clientMessageId': 'customer_chat_msg_1',
      'text': 'Cho mình combo 99K',
    });
  });

  test(
    'backend customer chat posts GenUI actions to KFC source route',
    () async {
      final requests = <http.Request>[];
      final repository = BackendCustomerChatRepository(
        baseUrl: 'http://localhost:18090',
        client: MockClient((request) async {
          requests.add(request);
          return http.Response(
            jsonEncode({'responseText': 'Đã cập nhật giỏ hàng.'}),
            200,
            headers: const {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );

      await repository.submitGenUiAction(
        sessionId: 'kfc:anon_customer_1',
        customerId: 'anon_customer_1',
        clientMessageId: 'customer_chat_msg_2',
        action: const KfcGenUiAction(
          attachmentId: 'fixture_menu',
          actionId: 'add_item',
          value: 'Combo 99K',
        ),
      );

      expect(requests.single.method, 'POST');
      expect(requests.single.url.path, '/chat/kfc/genui-action');
      expect(jsonDecode(requests.single.body), {
        'sessionId': 'kfc:anon_customer_1',
        'customerId': 'anon_customer_1',
        'clientMessageId': 'customer_chat_msg_2',
        'action': {
          'attachmentId': 'fixture_menu',
          'actionId': 'add_item',
          'value': 'Combo 99K',
        },
      });
    },
  );
}
