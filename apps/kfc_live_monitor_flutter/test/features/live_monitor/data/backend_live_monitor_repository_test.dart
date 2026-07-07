import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/backend_live_monitor_repository.dart';
import 'package:kfc_live_monitor/features/live_monitor/domain/chat_session.dart';

http.Response jsonResponse(String body) => http.Response.bytes(
  utf8.encode(body),
  200,
  headers: const {'content-type': 'application/json; charset=utf-8'},
);

void main() {
  test(
    'backend repository maps transcript and dashboard events into sessions',
    () async {
      final repository = BackendLiveMonitorRepository(
        baseUrl: 'http://localhost:18090',
        client: MockClient((request) async {
          final path = request.url.path;
          if (path == '/dashboard/sessions') {
            return jsonResponse(
              '{"sessions":[{"sessionId":"messenger:psid_user_1","latestEventType":"payment_failed","updatedAt":"2026-07-07T00:00:00.000Z"}]}',
            );
          }
          if (path == '/dashboard/sessions/messenger%3Apsid_user_1/turns') {
            return jsonResponse(
              '{"turns":[{"role":"user","text":"Cho mình 1 Combo 99K","channel":"messenger","externalUserId":"psid_user_1"},{"role":"assistant","text":"Dạ mình đã thêm Combo 99K vào giỏ.","channel":"messenger","externalUserId":"psid_user_1"}]}',
            );
          }
          if (path == '/dashboard/events/messenger%3Apsid_user_1') {
            return jsonResponse(
              '{"events":[{"type":"cart_changed","payload":{"cart":{"items":[{"name":"Combo 99K","quantity":1}],"totalVnd":99000}}},{"type":"payment_failed","payload":{"message":"failed"}}]}',
            );
          }
          return http.Response('not found', 404);
        }),
      );

      final sessions = await repository.loadSessions();

      expect(sessions, hasLength(1));
      expect(sessions.single.id, 'messenger:psid_user_1');
      expect(sessions.single.customerName, 'psid_user_1');
      expect(sessions.single.channel, ChatChannel.messenger);
      expect(sessions.single.severity, SessionSeverity.critical);
      expect(sessions.single.status, SessionStatus.needsHuman);
      expect(sessions.single.orderState, OrderState.paymentIssue);
      expect(sessions.single.orderLabel, '1x Combo 99K');
      expect(sessions.single.cartValueVnd, 99000);
      expect(sessions.single.turns.map((turn) => turn.message), [
        'Cho mình 1 Combo 99K',
        'Dạ mình đã thêm Combo 99K vào giỏ.',
      ]);
    },
  );
}
