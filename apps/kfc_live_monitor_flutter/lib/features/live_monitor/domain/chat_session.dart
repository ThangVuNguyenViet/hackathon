enum ChatChannel { messenger, zalo }

enum SessionSeverity { normal, warning, critical }

enum SessionStatus { aiHandling, needsHuman, humanJoined, resolved }

enum OrderState {
  collectingInfo,
  cartReady,
  paymentIssue,
  omsPending,
  confirmed,
}

enum SortMode {
  criticalFirst,
  newestActivity,
  confidence,
  cartValue,
  orderStage,
  channel,
}

class ChatTurn {
  const ChatTurn({required this.speaker, required this.message});

  final String speaker;
  final String message;
}

class ChatSession {
  const ChatSession({
    required this.id,
    required this.customerName,
    required this.channel,
    required this.severity,
    required this.status,
    required this.orderState,
    required this.lastActivityLabel,
    required this.orderLabel,
    required this.confidencePercent,
    required this.riskLabel,
    required this.deeplink,
    required this.turns,
    this.contextLabel = 'Order',
    this.cartValueVnd = 0,
    this.assignedToMe = false,
    this.priorityRank,
  });

  final String id;
  final String customerName;
  final ChatChannel channel;
  final SessionSeverity severity;
  final SessionStatus status;
  final OrderState orderState;
  final String lastActivityLabel;
  final String orderLabel;
  final int confidencePercent;
  final String riskLabel;
  final String deeplink;
  final List<ChatTurn> turns;
  final String contextLabel;
  final int cartValueVnd;
  final bool assignedToMe;
  final int? priorityRank;
}

extension ChatChannelLabel on ChatChannel {
  String get label => switch (this) {
    ChatChannel.messenger => 'Messenger',
    ChatChannel.zalo => 'Zalo',
  };
}

extension OrderStateLabel on OrderState {
  String get label => switch (this) {
    OrderState.collectingInfo => 'Collecting Info',
    OrderState.cartReady => 'Cart Ready',
    OrderState.paymentIssue => 'Payment Issue',
    OrderState.omsPending => 'OMS Pending',
    OrderState.confirmed => 'Confirmed',
  };
}

extension SessionSeverityLabel on SessionSeverity {
  String get label => switch (this) {
    SessionSeverity.normal => 'Normal',
    SessionSeverity.warning => 'Warning',
    SessionSeverity.critical => 'Critical',
  };
}

extension SessionStatusLabel on SessionStatus {
  String get label => switch (this) {
    SessionStatus.aiHandling => 'AI Handling',
    SessionStatus.needsHuman => 'Needs Human',
    SessionStatus.humanJoined => 'Human Joined',
    SessionStatus.resolved => 'Resolved',
  };
}
