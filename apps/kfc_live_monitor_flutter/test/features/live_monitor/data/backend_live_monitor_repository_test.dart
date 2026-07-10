import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/backend_live_monitor_repository.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/live_monitor_repository.dart';
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
              '{"sessions":[{"sessionId":"messenger:psid_user_1","displayName":"Nguyen An","externalUserId":"psid_user_1","avatarUrl":"https://graph.local/a.jpg","deeplink":{"status":"unavailable","url":null,"reason":"Missing META_INBOX_URL_TEMPLATE"},"latestEventType":"payment_failed","updatedAt":"2026-07-07T00:00:00.000Z"}]}',
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
      expect(sessions.single.customerName, 'Nguyen An');
      expect(sessions.single.customerId, 'psid_user_1');
      expect(sessions.single.avatarUrl, 'https://graph.local/a.jpg');
      expect(sessions.single.channel, ChatChannel.messenger);
      expect(sessions.single.severity, SessionSeverity.critical);
      expect(sessions.single.status, SessionStatus.needsHuman);
      expect(sessions.single.orderState, OrderState.paymentIssue);
      expect(sessions.single.orderLabel, '1x Combo 99K');
      expect(sessions.single.cartValueVnd, 99000);
      expect(sessions.single.deeplink.status, DeeplinkStatus.unavailable);
      expect(
        sessions.single.deeplink.reason,
        'Missing META_INBOX_URL_TEMPLATE',
      );
      expect(sessions.single.turns.map((turn) => turn.message), [
        'Cho mình 1 Combo 99K',
        'Dạ mình đã thêm Combo 99K vào giỏ.',
      ]);
    },
  );

  test('backend repository maps Zalo display names and history', () async {
    final repository = BackendLiveMonitorRepository(
      baseUrl: 'http://localhost:18090',
      client: MockClient((request) async {
        final path = request.url.path;
        if (path == '/dashboard/sessions') {
          return jsonResponse(
            '{"sessions":[{"sessionId":"zalo:zalo_user_1","displayName":"Tran Binh","externalUserId":"zalo_user_1","avatarUrl":null,"deeplink":{"status":"unavailable","url":null,"reason":"Missing ZALO_INBOX_URL_TEMPLATE"},"latestEventType":"assistant_reply_sent","updatedAt":"2026-07-09T00:00:00.000Z"}]}',
          );
        }
        if (path == '/dashboard/sessions/zalo%3Azalo_user_1/turns') {
          return jsonResponse(
            '{"turns":[{"role":"user","text":"Cho mình combo 99K","channel":"zalo","externalUserId":"zalo_user_1"},{"role":"assistant","text":"Dạ mình hỗ trợ bạn.","channel":"zalo","externalUserId":"zalo_user_1"}]}',
          );
        }
        if (path == '/dashboard/events/zalo%3Azalo_user_1') {
          return jsonResponse(
            '{"events":[{"type":"assistant_reply_sent","payload":{"deliveryStatus":"sent"}}]}',
          );
        }
        return http.Response('not found', 404);
      }),
    );

    final sessions = await repository.loadSessions();

    expect(sessions.single.customerName, 'Tran Binh');
    expect(sessions.single.customerId, 'zalo_user_1');
    expect(sessions.single.channel, ChatChannel.zalo);
    expect(sessions.single.turns.map((turn) => turn.message), [
      'Cho mình combo 99K',
      'Dạ mình hỗ trợ bạn.',
    ]);
  });

  test('backend repository maps agent interruption lifecycle events', () async {
    final repository = BackendLiveMonitorRepository(
      baseUrl: 'http://localhost:18090',
      client: MockClient((request) async {
        final path = request.url.path;
        if (path == '/dashboard/sessions') {
          return jsonResponse(
            '{"sessions":[{"sessionId":"messenger:psid_burst","latestEventType":"agent_run_delivered","updatedAt":"2026-07-09T00:00:00.000Z"}]}',
          );
        }
        if (path == '/dashboard/sessions/messenger%3Apsid_burst/turns') {
          return jsonResponse(
            '{"turns":[{"role":"user","text":"Cho mình 1 Combo 99K","channel":"messenger","externalUserId":"psid_burst"},{"role":"user","text":"Đổi thành 2 Combo 99K","channel":"messenger","externalUserId":"psid_burst"},{"role":"assistant","text":"Dạ mình đã cập nhật đơn.","channel":"messenger","externalUserId":"psid_burst"}]}',
          );
        }
        if (path == '/dashboard/events/messenger%3Apsid_burst') {
          return jsonResponse(
            '{"events":[{"type":"agent_run_pending","payload":{"generation":1,"pendingTurnCount":1}},{"type":"agent_run_pending","payload":{"generation":2,"pendingTurnCount":2}},{"type":"agent_run_scheduled","payload":{"generation":2,"includedTurnIds":["pending_1","pending_2"]}},{"type":"agent_run_delivered","payload":{"generation":2,"includedTurnCount":2,"deliveryStatus":"sent"}}]}',
          );
        }
        return http.Response('not found', 404);
      }),
    );

    final session = (await repository.loadSessions()).single;

    expect(session.interruption.status, AgentInterruptionStatus.delivered);
    expect(session.interruption.label, 'Coalesced Reply');
    expect(session.interruption.detail, '2 customer turns / Gen 2');
    expect(session.interruption.generation, 2);
    expect(session.interruption.turnCount, 2);
  });

  test(
    'backend repository maps human takeover and resume session status from session updates',
    () async {
      var eventsBody =
          '{"events":[{"type":"handoff_required","payload":{"reasons":["angry_customer"]}},{"type":"session_updated","payload":{"updateType":"human_joined","agentMode":"human_paused","agentId":"agent_1"}}]}';
      final repository = BackendLiveMonitorRepository(
        baseUrl: 'http://localhost:18090',
        client: MockClient((request) async {
          final path = request.url.path;
          if (path == '/dashboard/sessions') {
            return jsonResponse(
              '{"sessions":[{"sessionId":"messenger:psid_escalation","latestEventType":"session_updated","updatedAt":"2026-07-09T00:00:00.000Z"}]}',
            );
          }
          if (path == '/dashboard/sessions/messenger%3Apsid_escalation/turns') {
            return jsonResponse(
              '{"turns":[{"role":"user","text":"Tôi bực quá","channel":"messenger","externalUserId":"psid_escalation"}]}',
            );
          }
          if (path == '/dashboard/events/messenger%3Apsid_escalation') {
            return jsonResponse(eventsBody);
          }
          return http.Response('not found', 404);
        }),
      );

      final joinedSessions = await repository.loadSessions();
      expect(joinedSessions.single.status, SessionStatus.humanJoined);

      eventsBody =
          '{"events":[{"type":"handoff_required","payload":{"reasons":["angry_customer"]}},{"type":"session_updated","payload":{"updateType":"human_joined","agentMode":"human_paused","agentId":"agent_1"}},{"type":"session_updated","payload":{"updateType":"ai_resumed","agentMode":"ai_active","agentId":"agent_1"}}]}';

      final resumedSessions = await repository.loadSessions();
      expect(resumedSessions.single.status, SessionStatus.aiHandling);
    },
  );

  test('backend repository posts human join action', () async {
    final requests = <http.Request>[];
    final repository = BackendLiveMonitorRepository(
      baseUrl: 'http://localhost:18090',
      client: MockClient((request) async {
        requests.add(request);
        return jsonResponse('{"ok":true}');
      }),
    );

    await repository.joinHuman('messenger:psid_escalation', agentId: 'agent_1');

    expect(requests.single.method, 'POST');
    expect(
      requests.single.url.path,
      '/dashboard/sessions/messenger%3Apsid_escalation/human-join',
    );
    expect(jsonDecode(requests.single.body), {'agentId': 'agent_1'});
  });

  test('backend repository posts resume AI action', () async {
    final requests = <http.Request>[];
    final repository = BackendLiveMonitorRepository(
      baseUrl: 'http://localhost:18090',
      client: MockClient((request) async {
        requests.add(request);
        return jsonResponse('{"ok":true}');
      }),
    );

    await repository.resumeAi('messenger:psid_escalation', agentId: 'agent_1');

    expect(requests.single.method, 'POST');
    expect(
      requests.single.url.path,
      '/dashboard/sessions/messenger%3Apsid_escalation/resume-ai',
    );
    expect(jsonDecode(requests.single.body), {'agentId': 'agent_1'});
  });

  test('backend repository posts human message action', () async {
    final requests = <http.Request>[];
    final repository = BackendLiveMonitorRepository(
      baseUrl: 'http://localhost:18090',
      client: MockClient((request) async {
        requests.add(request);
        return jsonResponse('{"ok":true}');
      }),
    );

    await repository.sendHumanMessage(
      'zalo:zalo_user_1',
      agentId: 'agent_1',
      text: 'Dang kiem tra don cho anh.',
    );

    expect(requests.single.method, 'POST');
    expect(
      requests.single.url.path,
      '/dashboard/sessions/zalo%3Azalo_user_1/human-message',
    );
    expect(jsonDecode(requests.single.body), {
      'agentId': 'agent_1',
      'text': 'Dang kiem tra don cho anh.',
    });
  });

  test(
    'backend repository falls back to summary external user id before session id',
    () async {
      final repository = BackendLiveMonitorRepository(
        baseUrl: 'http://localhost:18090',
        client: MockClient((request) async {
          final path = request.url.path;
          if (path == '/dashboard/sessions') {
            return jsonResponse(
              '{"sessions":[{"sessionId":"messenger:psid_user_1","displayName":"","externalUserId":"psid_user_1","avatarUrl":null,"deeplink":{"status":"unavailable","url":null,"reason":"Missing META_INBOX_URL_TEMPLATE"}}]}',
            );
          }
          if (path == '/dashboard/sessions/messenger%3Apsid_user_1/turns') {
            return jsonResponse(
              '{"turns":[{"role":"user","text":"Hello","channel":"messenger"},{"role":"assistant","text":"Hi","channel":"messenger"}]}',
            );
          }
          if (path == '/dashboard/events/messenger%3Apsid_user_1') {
            return jsonResponse('{"events":[]}');
          }
          return http.Response('not found', 404);
        }),
      );

      final sessions = await repository.loadSessions();

      expect(sessions.single.customerName, 'psid_user_1');
      expect(sessions.single.customerName, isNot('messenger:psid_user_1'));
    },
  );

  test(
    'backend repository keeps summary session when detail hydration fails',
    () async {
      final repository = BackendLiveMonitorRepository(
        baseUrl: 'http://localhost:18090',
        client: MockClient((request) async {
          final path = request.url.path;
          if (path == '/dashboard/sessions') {
            return jsonResponse(
              '{"sessions":[{"sessionId":"zalo:zalo_user_1","displayName":"Tran Binh","externalUserId":"zalo_user_1","avatarUrl":"https://zalo.local/avatar.jpg","deeplink":{"status":"available","url":"https://oa.zalo.me/chatv2"},"latestEventType":"assistant_reply_sent","updatedAt":"2026-07-09T00:00:00.000Z"}]}',
            );
          }
          if (path == '/dashboard/sessions/zalo%3Azalo_user_1/turns') {
            return http.Response('', 503);
          }
          if (path == '/dashboard/events/zalo%3Azalo_user_1') {
            return jsonResponse('{"events":[]}');
          }
          return http.Response('not found', 404);
        }),
      );

      final sessions = await repository.loadSessions();

      expect(sessions, hasLength(1));
      expect(sessions.single.id, 'zalo:zalo_user_1');
      expect(sessions.single.customerName, 'Tran Binh');
      expect(sessions.single.customerId, 'zalo_user_1');
      expect(sessions.single.channel, ChatChannel.zalo);
      expect(sessions.single.severity, SessionSeverity.warning);
      expect(sessions.single.deeplink.status, DeeplinkStatus.available);
      expect(sessions.single.turns, isEmpty);
    },
  );

  test('backend repository keeps the latest ten transcript turns', () async {
    final backendTurns = List.generate(12, (index) {
      final role = index.isEven ? 'user' : 'assistant';
      return '{"role":"$role","text":"Turn $index","channel":"messenger","externalUserId":"psid_user_1"}';
    }).join(',');
    final repository = BackendLiveMonitorRepository(
      baseUrl: 'http://localhost:18090',
      client: MockClient((request) async {
        final path = request.url.path;
        if (path == '/dashboard/sessions') {
          return jsonResponse(
            '{"sessions":[{"sessionId":"messenger:psid_user_1","latestEventType":"cart_changed","updatedAt":"2026-07-07T00:00:00.000Z"}]}',
          );
        }
        if (path == '/dashboard/sessions/messenger%3Apsid_user_1/turns') {
          return jsonResponse('{"turns":[$backendTurns]}');
        }
        if (path == '/dashboard/events/messenger%3Apsid_user_1') {
          return jsonResponse(
            '{"events":[{"type":"cart_changed","payload":{"cart":{"items":[],"totalVnd":0}}}]}',
          );
        }
        return http.Response('not found', 404);
      }),
    );

    final sessions = await repository.loadSessions();

    expect(sessions.single.turns.map((turn) => turn.message), [
      'Turn 2',
      'Turn 3',
      'Turn 4',
      'Turn 5',
      'Turn 6',
      'Turn 7',
      'Turn 8',
      'Turn 9',
      'Turn 10',
      'Turn 11',
    ]);
  });

  test('backend repository maps readiness into monitor status', () async {
    final repository = BackendLiveMonitorRepository(
      baseUrl: 'http://localhost:18090',
      client: MockClient((request) async {
        expect(request.url.path, '/ready');
        return jsonResponse(
          '{"ok":false,"checks":{"messenger":{"ok":false,"message":"Missing META_INBOX_URL_TEMPLATE"},"zalo":{"ok":true}}}',
        );
      }),
    );

    final readiness = await repository.loadReadiness();

    expect(readiness.status, LiveMonitorReadinessStatus.configMissing);
    expect(readiness.label, 'Config missing');
    expect(readiness.message, 'Missing META_INBOX_URL_TEMPLATE');
  });
}
