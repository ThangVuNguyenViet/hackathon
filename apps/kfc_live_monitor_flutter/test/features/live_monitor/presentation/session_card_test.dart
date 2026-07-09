import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/live_monitor/domain/chat_session.dart';
import 'package:kfc_live_monitor/features/live_monitor/presentation/widgets/session_card.dart';

import '../../test_app.dart';

void main() {
  testWidgets('session card renders the latest transcript turns', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(420, 720);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final session = ChatSession(
      id: 'messenger:scenario-01',
      customerId: 'scenario-01',
      customerName: 'Scenario 01',
      channel: ChatChannel.messenger,
      severity: SessionSeverity.normal,
      status: SessionStatus.aiHandling,
      orderState: OrderState.cartReady,
      lastActivityLabel: 'Live',
      orderLabel: 'Scenario order',
      confidencePercent: 95,
      riskLabel: 'Normal',
      deeplink: const ChatDeeplink.available('backend://messenger:scenario-01'),
      turns: List.generate(
        6,
        (index) => ChatTurn(
          speaker: index.isEven ? 'User' : 'AI',
          message: 'Scenario message $index',
        ),
      ),
    );

    await tester.pumpWidget(
      TestApp(
        child: SizedBox(
          width: 420,
          height: 720,
          child: SessionCard(session: session, onOpenSession: () {}),
        ),
      ),
    );

    expect(find.text('Scenario message 0'), findsNothing);
    for (var index = 1; index < 6; index += 1) {
      expect(find.text('Scenario message $index'), findsOneWidget);
    }
  });

  testWidgets('session card shows display name before chat id', (tester) async {
    final session = ChatSession(
      id: 'messenger:psid_user_1',
      customerId: 'psid_user_1',
      customerName: 'Nguyen An',
      channel: ChatChannel.messenger,
      severity: SessionSeverity.normal,
      status: SessionStatus.aiHandling,
      orderState: OrderState.collectingInfo,
      lastActivityLabel: 'Live',
      orderLabel: 'Order',
      confidencePercent: 92,
      riskLabel: 'Low',
      deeplink: const ChatDeeplink.unavailable(
        reason: 'messenger_deeplink_unverified',
      ),
      turns: const [ChatTurn(speaker: 'User', message: 'Hi')],
    );

    await tester.pumpWidget(
      TestApp(
        child: SizedBox(
          width: 420,
          height: 720,
          child: SessionCard(session: session, onOpenSession: () {}),
        ),
      ),
    );

    expect(find.text('Nguyen An'), findsOneWidget);
    expect(find.text('psid_user_1'), findsNothing);
  });
}
