import 'package:kfc_live_monitor/features/live_monitor/data/live_monitor_repository.dart';
import 'package:kfc_live_monitor/features/live_monitor/domain/chat_session.dart';

class MockLiveMonitorRepository implements LiveMonitorRepository {
  const MockLiveMonitorRepository();

  @override
  Future<LiveMonitorReadiness> loadReadiness() async {
    return const LiveMonitorReadiness.online();
  }

  @override
  Future<void> joinHuman(String sessionId, {required String agentId}) async {}

  @override
  Future<void> resumeAi(String sessionId, {required String agentId}) async {}

  @override
  Future<List<ChatSession>> loadSessions() async => const [
    ChatSession(
      id: 'session-payment-m-1001',
      customerId: 'm-1001',
      customerName: 'Session M-1001',
      channel: ChatChannel.messenger,
      severity: SessionSeverity.critical,
      status: SessionStatus.needsHuman,
      orderState: OrderState.paymentIssue,
      lastActivityLabel: '2m ago',
      orderLabel: 'Zinger Meal + Pepsi',
      confidencePercent: 48,
      riskLabel: 'High',
      cartValueVnd: 145000,
      priorityRank: 0,
      deeplink: ChatDeeplink.available(
        'mockchat://messenger/session-payment-m-1001',
      ),
      turns: [
        ChatTurn(
          speaker: 'User',
          message:
              'Why is my payment failing??? I\'ve tried three different cards and none of them seem to work.',
        ),
        ChatTurn(
          speaker: 'AI',
          message: 'I\'m sorry. Let me check your card status in our system.',
        ),
        ChatTurn(
          speaker: 'User',
          message: 'It says \'Declined\' but I have funds.',
        ),
        ChatTurn(
          speaker: 'AI',
          message: 'I see the issue. Your bank is blocking the transaction.',
        ),
      ],
    ),
    ChatSession(
      id: 'session-voucher-z-1002',
      customerId: 'z-1002',
      customerName: 'Session Z-1002',
      channel: ChatChannel.zalo,
      severity: SessionSeverity.warning,
      status: SessionStatus.aiHandling,
      orderState: OrderState.cartReady,
      lastActivityLabel: '45s ago',
      orderLabel: '3pc Spicy Chicken',
      confidencePercent: 82,
      riskLabel: 'Medium',
      cartValueVnd: 129000,
      priorityRank: 1,
      deeplink: ChatDeeplink.available(
        'mockchat://zalo/session-voucher-z-1002',
      ),
      turns: [
        ChatTurn(
          speaker: 'User',
          message:
              'I want spicy chicken, but I can\'t find the voucher in my app.',
        ),
        ChatTurn(
          speaker: 'AI',
          message:
              'Please check the \'Rewards\' tab in the bottom navigation bar.',
        ),
        ChatTurn(
          speaker: 'User',
          message: 'It\'s not there! This is frustrating.',
        ),
        ChatTurn(
          speaker: 'AI',
          message:
              'Let me refresh your account. Please check again in 10 seconds.',
        ),
      ],
    ),
    ChatSession(
      id: 'session-address-m-1003',
      customerId: 'm-1003',
      customerName: 'Session M-1003',
      channel: ChatChannel.messenger,
      severity: SessionSeverity.normal,
      status: SessionStatus.aiHandling,
      orderState: OrderState.omsPending,
      lastActivityLabel: '1m ago',
      orderLabel: 'Family Bucket',
      confidencePercent: 95,
      riskLabel: 'Low',
      cartValueVnd: 269000,
      priorityRank: 2,
      deeplink: ChatDeeplink.available(
        'mockchat://messenger/session-address-m-1003',
      ),
      turns: [
        ChatTurn(
          speaker: 'AI',
          message:
              'Where should we deliver your order? Please provide a full address.',
        ),
        ChatTurn(
          speaker: 'User',
          message: 'Address is 123 Lê Lợi, Quận 1. Near the big park.',
        ),
        ChatTurn(
          speaker: 'AI',
          message: 'Got it. Confirming delivery time with the kitchen...',
        ),
        ChatTurn(
          speaker: 'AI',
          message: 'Estimated delivery time is 25 minutes.',
        ),
      ],
    ),
    ChatSession(
      id: 'session-escalation-z-1004',
      customerId: 'z-1004',
      customerName: 'Session Z-1004',
      channel: ChatChannel.zalo,
      severity: SessionSeverity.critical,
      status: SessionStatus.needsHuman,
      orderState: OrderState.omsPending,
      lastActivityLabel: '30s ago',
      orderLabel: '2x Pepsi, KFC50 Voucher',
      confidencePercent: 52,
      riskLabel: 'High',
      cartValueVnd: 78000,
      priorityRank: 3,
      deeplink: ChatDeeplink.available(
        'mockchat://zalo/session-escalation-z-1004',
      ),
      turns: [
        ChatTurn(
          speaker: 'AI',
          message: 'Your order is being prepared and will be ready soon.',
        ),
        ChatTurn(
          speaker: 'User',
          message: 'This is taking too long, cancel everything! I\'m leaving.',
        ),
        ChatTurn(
          speaker: 'AI',
          message: 'One moment while I connect a human agent to assist you.',
        ),
        ChatTurn(speaker: 'User', message: 'Hurry up, I don\'t have all day.'),
      ],
    ),
    ChatSession(
      id: 'session-resolved-m-1005',
      customerId: 'm-1005',
      customerName: 'Session M-1005',
      channel: ChatChannel.messenger,
      severity: SessionSeverity.normal,
      status: SessionStatus.resolved,
      orderState: OrderState.confirmed,
      lastActivityLabel: '5m ago',
      orderLabel: 'Popcorn Chicken',
      confidencePercent: 99,
      riskLabel: 'Low',
      cartValueVnd: 145000,
      priorityRank: 4,
      deeplink: ChatDeeplink.available(
        'mockchat://messenger/session-resolved-m-1005',
      ),
      turns: [
        ChatTurn(
          speaker: 'AI',
          message: 'Total is 145,000 VND. Confirm order?',
        ),
        ChatTurn(
          speaker: 'User',
          message: 'Yes, confirm order. Please deliver as soon as possible.',
        ),
        ChatTurn(
          speaker: 'AI',
          message: 'Order #552 confirmed. Enjoy your meal!',
        ),
        ChatTurn(speaker: 'User', message: 'Thank you!'),
      ],
    ),
    ChatSession(
      id: 'session-loyalty-m-1006',
      customerId: 'm-1006',
      customerName: 'Session M-1006',
      channel: ChatChannel.messenger,
      severity: SessionSeverity.warning,
      status: SessionStatus.aiHandling,
      orderState: OrderState.cartReady,
      lastActivityLabel: '3m ago',
      orderLabel: '1500 loyalty pts',
      confidencePercent: 75,
      riskLabel: 'Medium',
      cartValueVnd: 99000,
      contextLabel: 'Context',
      priorityRank: 5,
      deeplink: ChatDeeplink.available(
        'mockchat://messenger/session-loyalty-m-1006',
      ),
      turns: [
        ChatTurn(
          speaker: 'AI',
          message: 'That voucher is expired. Would you like to use points?',
        ),
        ChatTurn(
          speaker: 'User',
          message: 'Can I use points for this? How many do I have?',
        ),
        ChatTurn(
          speaker: 'AI',
          message: 'Yes, you have 1500 points available for redemption.',
        ),
        ChatTurn(
          speaker: 'User',
          message: 'Okay, use 500 points for this order.',
        ),
      ],
    ),
    ChatSession(
      id: 'session-human-z-1007',
      customerId: 'z-1007',
      customerName: 'Session Z-1007',
      channel: ChatChannel.zalo,
      severity: SessionSeverity.normal,
      status: SessionStatus.humanJoined,
      orderState: OrderState.cartReady,
      lastActivityLabel: '10s ago',
      orderLabel: 'Zinger Burger',
      confidencePercent: 90,
      riskLabel: 'Low',
      cartValueVnd: 89000,
      assignedToMe: true,
      priorityRank: 6,
      deeplink: ChatDeeplink.available('mockchat://zalo/session-human-z-1007'),
      turns: [
        ChatTurn(
          speaker: 'User',
          message: 'Can I add extra gravy? I really love the gravy.',
        ),
        ChatTurn(
          speaker: 'Me',
          message: 'Sure, I\'ve added that to your cart. Anything else?',
        ),
        ChatTurn(
          speaker: 'User',
          message: 'Thanks! Ready to pay now. Send the link.',
        ),
        ChatTurn(
          speaker: 'Me',
          message: 'Payment link sent. Let me know if you have trouble.',
        ),
      ],
    ),
    ChatSession(
      id: 'session-info-m-1008',
      customerId: 'm-1008',
      customerName: 'Session M-1008',
      channel: ChatChannel.messenger,
      severity: SessionSeverity.normal,
      status: SessionStatus.aiHandling,
      orderState: OrderState.collectingInfo,
      lastActivityLabel: '1m ago',
      orderLabel: 'Collecting info',
      confidencePercent: 88,
      riskLabel: 'Low',
      cartValueVnd: 0,
      priorityRank: 7,
      deeplink: ChatDeeplink.available(
        'mockchat://messenger/session-info-m-1008',
      ),
      turns: [
        ChatTurn(
          speaker: 'User',
          message: 'What is in the Family Bucket? I need to know for 4 people.',
        ),
        ChatTurn(
          speaker: 'AI',
          message: '8pc Chicken, 2 Large Fries, and 4 Pepsi cans.',
        ),
        ChatTurn(
          speaker: 'User',
          message: 'Does it include drinks? Oh wait, you just said it does.',
        ),
        ChatTurn(
          speaker: 'AI',
          message: 'No problem! Would you like to add anything else?',
        ),
      ],
    ),
  ];
}
