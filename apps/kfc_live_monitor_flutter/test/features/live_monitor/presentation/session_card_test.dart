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
      customerName: 'Scenario 01',
      channel: ChatChannel.messenger,
      severity: SessionSeverity.normal,
      status: SessionStatus.aiHandling,
      orderState: OrderState.cartReady,
      lastActivityLabel: 'Live',
      orderLabel: 'Scenario order',
      confidencePercent: 95,
      riskLabel: 'Normal',
      deeplink: 'backend://messenger:scenario-01',
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
}
