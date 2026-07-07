import '../domain/chat_session.dart';
import 'live_monitor_repository.dart';

class MockLiveMonitorRepository implements LiveMonitorRepository {
  const MockLiveMonitorRepository();

  @override
  Future<List<ChatSession>> loadSessions() async => const [
    ChatSession(
      id: 'session-payment-nguyen-a',
      customerName: 'Nguyễn Văn A',
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
      deeplink: 'mockchat://messenger/session-payment-nguyen-a',
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
      id: 'session-voucher-tran-b',
      customerName: 'Trần Thị B',
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
      deeplink: 'mockchat://zalo/session-voucher-tran-b',
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
      id: 'session-address-kfc-1024',
      customerName: 'KFC-1024',
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
      deeplink: 'mockchat://messenger/session-address-kfc-1024',
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
      id: 'session-angry-hoang-m',
      customerName: 'Hoàng M',
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
      deeplink: 'mockchat://zalo/session-angry-hoang-m',
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
      id: 'session-resolved-le-k',
      customerName: 'Lê K',
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
      deeplink: 'mockchat://messenger/session-resolved-le-k',
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
      id: 'session-loyalty-user-882',
      customerName: 'User_882',
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
      deeplink: 'mockchat://messenger/session-loyalty-user-882',
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
      id: 'session-human-pham-p',
      customerName: 'Phạm P',
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
      deeplink: 'mockchat://zalo/session-human-pham-p',
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
      id: 'session-info-kfc-1088',
      customerName: 'KFC-1088',
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
      deeplink: 'mockchat://messenger/session-info-kfc-1088',
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
