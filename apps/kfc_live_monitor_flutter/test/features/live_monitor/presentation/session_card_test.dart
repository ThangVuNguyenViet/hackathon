import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/live_monitor/domain/chat_session.dart';
import 'package:kfc_live_monitor/features/live_monitor/presentation/widgets/session_card.dart';
import 'package:kfc_live_monitor/features/live_monitor/testing/live_monitor_keys.dart';

import '../../test_app.dart';

void main() {
  testWidgets('session card renders unknown automation confidence', (
    tester,
  ) async {
    final session = ChatSession(
      id: 'messenger:unknown-confidence',
      customerId: 'unknown-confidence',
      customerName: 'Unknown Confidence',
      channel: ChatChannel.messenger,
      severity: SessionSeverity.warning,
      status: SessionStatus.aiHandling,
      orderState: OrderState.collectingInfo,
      lastActivityLabel: 'Live',
      orderLabel: 'Monitoring',
      confidencePercent: null,
      riskLabel: 'Unknown',
      deeplink: const ChatDeeplink.unavailable(reason: 'No link'),
      turns: const [ChatTurn(speaker: 'User', message: 'Hi')],
    );

    await tester.pumpWidget(
      TestApp(
        child: SizedBox(
          width: 420,
          height: 720,
          child: SessionCard(
            session: session,
            onOpenSession: () {},
            onJoinHuman: () {},
            onResumeAi: () {},
          ),
        ),
      ),
    );

    expect(find.text('Unknown'), findsOneWidget);
    expect(find.text('52%'), findsNothing);
    expect(find.text('72%'), findsNothing);
    expect(find.text('92%'), findsNothing);
  });

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
      intelligenceSourceLabel: 'AI judged',
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
          child: SessionCard(
            session: session,
            onOpenSession: () {},
            onJoinHuman: () {},
            onResumeAi: () {},
          ),
        ),
      ),
    );

    expect(find.text('Scenario message 0'), findsNothing);
    for (var index = 1; index < 6; index += 1) {
      expect(find.text('Scenario message $index'), findsOneWidget);
    }
    expect(find.text('AI judged'), findsNothing);
  });

  testWidgets('short transcript messages shrink-wrap their bubble', (
    tester,
  ) async {
    final session = ChatSession(
      id: 'messenger:short-message',
      customerId: 'short-message',
      customerName: 'Short Message',
      channel: ChatChannel.messenger,
      severity: SessionSeverity.warning,
      status: SessionStatus.aiHandling,
      orderState: OrderState.cartReady,
      lastActivityLabel: 'Live',
      orderLabel: 'Scenario order',
      confidencePercent: 95,
      riskLabel: 'Normal',
      deeplink: const ChatDeeplink.available('backend://short-message'),
      turns: const [
        ChatTurn(
          speaker: 'AI',
          message: 'Minh da them combo vao gio hang cho ban.',
        ),
        ChatTurn(speaker: 'User', message: 'hi'),
      ],
    );

    await tester.pumpWidget(
      TestApp(
        child: SizedBox(
          width: 360,
          height: 320,
          child: SessionCard(
            session: session,
            onOpenSession: () {},
            onJoinHuman: () {},
            onResumeAi: () {},
          ),
        ),
      ),
    );

    final bubbleBox = tester
        .renderObjectList<RenderBox>(
          find.ancestor(
            of: find.text('hi'),
            matching: find.byType(DecoratedBox),
          ),
        )
        .reduce(
          (smallest, box) =>
              box.size.width < smallest.size.width ? box : smallest,
        );
    final textBox = tester.renderObject<RenderBox>(find.text('hi'));

    expect(tester.takeException(), isNull);
    expect(bubbleBox.size.width, greaterThan(textBox.size.width));
    expect(bubbleBox.size.width, lessThan(72));
  });

  testWidgets('short transcript messages shrink-wrap their bubble', (
    tester,
  ) async {
    final session = ChatSession(
      id: 'messenger:short-message',
      customerId: 'short-message',
      customerName: 'Short Message',
      channel: ChatChannel.messenger,
      severity: SessionSeverity.warning,
      status: SessionStatus.aiHandling,
      orderState: OrderState.cartReady,
      lastActivityLabel: 'Live',
      orderLabel: 'Scenario order',
      confidencePercent: 95,
      riskLabel: 'Normal',
      deeplink: const ChatDeeplink.available('backend://short-message'),
      turns: const [
        ChatTurn(
          speaker: 'AI',
          message: 'Minh da them combo vao gio hang cho ban.',
        ),
        ChatTurn(speaker: 'User', message: 'hi'),
      ],
    );

    await tester.pumpWidget(
      TestApp(
        child: SizedBox(
          width: 360,
          height: 320,
          child: SessionCard(
            session: session,
            onOpenSession: () {},
            onJoinHuman: () {},
            onResumeAi: () {},
          ),
        ),
      ),
    );

    final bubbleBox = tester
        .renderObjectList<RenderBox>(
          find.ancestor(
            of: find.text('hi'),
            matching: find.byType(DecoratedBox),
          ),
        )
        .reduce(
          (smallest, box) =>
              box.size.width < smallest.size.width ? box : smallest,
        );
    final textBox = tester.renderObject<RenderBox>(find.text('hi'));

    expect(tester.takeException(), isNull);
    expect(bubbleBox.size.width, greaterThan(textBox.size.width));
    expect(bubbleBox.size.width, lessThan(72));
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
        reason: 'Missing META_INBOX_URL_TEMPLATE',
      ),
      turns: const [ChatTurn(speaker: 'User', message: 'Hi')],
    );

    await tester.pumpWidget(
      TestApp(
        child: SizedBox(
          width: 420,
          height: 720,
          child: SessionCard(
            session: session,
            onOpenSession: () {},
            onJoinHuman: () {},
            onResumeAi: () {},
          ),
        ),
      ),
    );

    expect(find.text('Nguyen An'), findsOneWidget);
    expect(find.text('psid_user_1'), findsNothing);
  });

  testWidgets(
    'session card disables open chat and exposes reason when unavailable',
    (tester) async {
      var openCount = 0;
      final session = ChatSession(
        id: 'zalo:zalo_user_1',
        customerId: 'zalo_user_1',
        customerName: 'Tran Binh',
        channel: ChatChannel.zalo,
        severity: SessionSeverity.normal,
        status: SessionStatus.aiHandling,
        orderState: OrderState.collectingInfo,
        lastActivityLabel: 'Live',
        orderLabel: 'Order',
        confidencePercent: 92,
        riskLabel: 'Low',
        deeplink: const ChatDeeplink.unavailable(
          reason: 'Missing ZALO_INBOX_URL_TEMPLATE',
        ),
        turns: const [ChatTurn(speaker: 'User', message: 'Hi')],
      );

      await tester.pumpWidget(
        TestApp(
          child: SizedBox(
            width: 420,
            height: 720,
            child: SessionCard(
              session: session,
              onOpenSession: () => openCount += 1,
              onJoinHuman: () {},
              onResumeAi: () {},
            ),
          ),
        ),
      );

      final openButton = find.byKey(
        LiveMonitorKeys.sessionOpenChatButton('zalo:zalo_user_1'),
      );
      expect(openButton, findsOneWidget);

      await tester.tap(openButton);
      await tester.pumpAndSettle();

      expect(openCount, 0);
      expect(find.byTooltip('Missing ZALO_INBOX_URL_TEMPLATE'), findsOneWidget);
    },
  );

  testWidgets('session card renders interruption status strip', (tester) async {
    final session = ChatSession(
      id: 'messenger:psid_burst',
      customerId: 'psid_burst',
      customerName: 'Burst Customer',
      channel: ChatChannel.messenger,
      severity: SessionSeverity.normal,
      status: SessionStatus.aiHandling,
      orderState: OrderState.cartReady,
      lastActivityLabel: 'Live',
      orderLabel: '2x Combo 99K',
      confidencePercent: 92,
      riskLabel: 'Low',
      deeplink: const ChatDeeplink.available('backend://messenger:psid_burst'),
      interruption: const AgentInterruption(
        status: AgentInterruptionStatus.delivered,
        label: 'Coalesced Reply',
        detail: '2 customer turns / Gen 2',
        generation: 2,
        turnCount: 2,
      ),
      turns: const [
        ChatTurn(speaker: 'User', message: 'Cho mình 1 Combo 99K'),
        ChatTurn(speaker: 'User', message: 'Đổi thành 2 Combo 99K'),
        ChatTurn(speaker: 'AI', message: 'Dạ mình đã cập nhật đơn.'),
      ],
    );

    await tester.pumpWidget(
      TestApp(
        child: SizedBox(
          width: 420,
          height: 720,
          child: SessionCard(
            session: session,
            onOpenSession: () {},
            onJoinHuman: () {},
            onResumeAi: () {},
          ),
        ),
      ),
    );

    expect(
      find.byKey(LiveMonitorKeys.sessionInterruptionStatus(session.id)),
      findsOneWidget,
    );
    expect(find.text('Coalesced Reply'), findsOneWidget);
    expect(find.text('2 customer turns / Gen 2'), findsOneWidget);
  });

  testWidgets('needs-human session exposes join human action', (tester) async {
    var joined = false;
    final session = _session(status: SessionStatus.needsHuman);

    await tester.pumpWidget(
      TestApp(
        child: SizedBox(
          width: 420,
          height: 720,
          child: SessionCard(
            session: session,
            onOpenSession: () {},
            onJoinHuman: () => joined = true,
            onResumeAi: () {},
          ),
        ),
      ),
    );

    final joinButton = find.byKey(
      LiveMonitorKeys.sessionJoinHumanButton(session.id),
    );
    expect(joinButton, findsOneWidget);

    await tester.tap(joinButton);
    await tester.pumpAndSettle();

    expect(joined, isTrue);
  });

  testWidgets('human-joined session exposes resume AI action', (tester) async {
    var resumed = false;
    final session = _session(status: SessionStatus.humanJoined);

    await tester.pumpWidget(
      TestApp(
        child: SizedBox(
          width: 420,
          height: 720,
          child: SessionCard(
            session: session,
            onOpenSession: () {},
            onJoinHuman: () {},
            onResumeAi: () => resumed = true,
          ),
        ),
      ),
    );

    await tester.tap(
      find.byKey(LiveMonitorKeys.sessionResumeAiButton(session.id)),
    );
    await tester.pumpAndSettle();

    expect(resumed, isTrue);
  });

  testWidgets('human-joined session does not expose a human reply composer', (
    tester,
  ) async {
    final session = _session(status: SessionStatus.humanJoined);

    await tester.pumpWidget(
      TestApp(
        child: SizedBox(
          width: 420,
          height: 720,
          child: SessionCard(
            session: session,
            onOpenSession: () {},
            onJoinHuman: () {},
            onResumeAi: () {},
          ),
        ),
      ),
    );

    expect(find.text('Send'), findsNothing);
    expect(
      find.byKey(LiveMonitorKeys.sessionResumeAiButton(session.id)),
      findsOneWidget,
    );
  });

  testWidgets(
    'human-joined session fits grid card and keeps resume action tappable',
    (tester) async {
      var resumed = false;
      final session = _session(
        status: SessionStatus.humanJoined,
        turns: const [
          ChatTurn(
            speaker: 'User',
            message:
                'Toi buc qua, do giao sai het roi. Cho minh gap nhan vien.',
          ),
          ChatTurn(
            speaker: 'AI',
            message: 'Minh se chuyen nhan vien ho tro ngay.',
          ),
          ChatTurn(
            speaker: 'Human',
            message:
                'Em la nhan vien KFC, em dang kiem tra don sai mon cho anh chi.',
          ),
          ChatTurn(speaker: 'User', message: 'Co ai xu ly chua?'),
          ChatTurn(speaker: 'User', message: 'Ok, tiep tuc giup toi.'),
        ],
      );

      await tester.pumpWidget(
        TestApp(
          child: SizedBox(
            width: 360,
            height: 320,
            child: SessionCard(
              key: LiveMonitorKeys.sessionCard(session.id),
              session: session,
              onOpenSession: () {},
              onJoinHuman: () {},
              onResumeAi: () => resumed = true,
            ),
          ),
        ),
      );

      expect(tester.takeException(), isNull);
      expect(
        find.text('Toi buc qua, do giao sai het roi. Cho minh gap nhan vien.'),
        findsNothing,
      );
      expect(find.text('Minh se chuyen nhan vien ho tro ngay.'), findsNothing);
      expect(
        find.text(
          'Em la nhan vien KFC, em dang kiem tra don sai mon cho anh chi.',
        ),
        findsOneWidget,
      );
      expect(find.text('Co ai xu ly chua?'), findsOneWidget);
      expect(find.text('Ok, tiep tuc giup toi.'), findsOneWidget);

      final cardBox = tester.renderObject<RenderBox>(
        find.byKey(LiveMonitorKeys.sessionCard(session.id)),
      );
      final resumeBox = tester.renderObject<RenderBox>(
        find.byKey(LiveMonitorKeys.sessionResumeAiButton(session.id)),
      );
      final cardBottom =
          cardBox.localToGlobal(Offset.zero).dy + cardBox.size.height;
      final resumeBottom =
          resumeBox.localToGlobal(Offset.zero).dy + resumeBox.size.height;
      expect(resumeBottom <= cardBottom, isTrue);

      await tester.tap(
        find.byKey(LiveMonitorKeys.sessionResumeAiButton(session.id)),
      );
      await tester.pumpAndSettle();

      expect(resumed, isTrue);
    },
  );
}

ChatSession _session({
  required SessionStatus status,
  List<ChatTurn> turns = const [
    ChatTurn(speaker: 'User', message: 'I have waited too long.'),
    ChatTurn(speaker: 'AI', message: 'I am checking that now.'),
  ],
}) {
  return ChatSession(
    id: 'messenger:takeover-session',
    customerId: 'takeover-session',
    customerName: 'Nguyen An',
    channel: ChatChannel.messenger,
    severity: status == SessionStatus.needsHuman
        ? SessionSeverity.critical
        : SessionSeverity.warning,
    status: status,
    orderState: OrderState.paymentIssue,
    lastActivityLabel: 'Live',
    orderLabel: 'Payment failed',
    confidencePercent: 52,
    riskLabel: 'Escalated',
    deeplink: const ChatDeeplink.available(
      'backend://messenger:takeover-session',
    ),
    turns: turns,
  );
}
