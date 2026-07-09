import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/dashboard_event_payload.dart';

void main() {
  test('dashboard event payload decodes backend SSE json', () {
    final event = DashboardEventPayload.fromJson('''
      {
        "id": "dash_1",
        "sessionId": "messenger:psid_1",
        "type": "assistant_reply_sent",
        "payload": {
          "deliveryStatus": "sent"
        },
        "createdAt": "2026-07-08T08:54:21.731Z"
      }
    ''');

    expect(event.id, 'dash_1');
    expect(event.sessionId, 'messenger:psid_1');
    expect(event.type, DashboardEventType.assistantReplySent);
    expect(event.payload['deliveryStatus'], 'sent');
    expect(event.createdAt.toUtc(), DateTime.parse('2026-07-08T08:54:21.731Z'));
  });
}
