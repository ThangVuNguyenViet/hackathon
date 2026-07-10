import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';

void main() {
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
