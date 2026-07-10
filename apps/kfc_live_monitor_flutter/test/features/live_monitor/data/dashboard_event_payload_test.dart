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

  test('dashboard event payload decodes agent run lifecycle events', () {
    final event = DashboardEventPayload.fromJson('''
      {
        "id": "dash_2",
        "sessionId": "messenger:psid_1",
        "type": "agent_run_pending",
        "payload": {
          "generation": 2,
          "pendingTurnCount": 2
        },
        "createdAt": "2026-07-08T08:54:22.731Z"
      }
    ''');

    expect(event.type, DashboardEventType.agentRunPending);
    expect(event.payload['pendingTurnCount'], 2);
  });

  test('dashboard event payload decodes session intelligence updates', () {
    final event = DashboardEventPayload.fromJson('''
      {
        "id": "dash_intelligence_1",
        "sessionId": "messenger:psid_1",
        "type": "session_intelligence_updated",
        "payload": {
          "sessionIntelligence": {
            "schemaVersion": 1,
            "orderStage": "cart_ready",
            "aiAutomationConfidencePercent": 85,
            "riskLevel": "low",
            "priorityRank": 51,
            "reasons": ["cart_verified"],
            "contextSummary": "",
            "evaluatedCustomerTurnCount": 1,
            "evidence": {
              "dashboardEventTypes": ["cart_changed"],
              "toolNames": ["updateCart"],
              "escalationReasons": [],
              "safetyGateReasons": []
            },
            "source": "runtime_rule_fallback",
            "updatedAt": "2026-07-09T00:00:03.000Z"
          }
        },
        "createdAt": "2026-07-09T00:00:03.000Z"
      }
    ''');

    expect(event.type, DashboardEventType.sessionIntelligenceUpdated);
    expect(event.payload['sessionIntelligence'], isA<Map<String, dynamic>>());
  });
}
