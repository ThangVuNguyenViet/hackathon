enum ChatChannel { messenger, zalo }

enum SessionSeverity { normal, warning, critical }

enum SessionStatus { aiHandling, needsHuman, humanJoined, resolved }

enum AgentInterruptionStatus {
  none,
  coalescing,
  scheduled,
  running,
  delivered,
  superseded,
  suppressed,
  failed,
}

enum DeeplinkStatus { available, unavailable }

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

class ChatDeeplink {
  const ChatDeeplink.available(this.url)
    : status = DeeplinkStatus.available,
      reason = null;

  const ChatDeeplink.unavailable({required this.reason})
    : status = DeeplinkStatus.unavailable,
      url = null;

  final DeeplinkStatus status;
  final String? url;
  final String? reason;
}

class AgentInterruption {
  const AgentInterruption({
    required this.status,
    required this.label,
    required this.detail,
    this.generation,
    this.turnCount = 0,
  });

  const AgentInterruption.none()
    : status = AgentInterruptionStatus.none,
      label = '',
      detail = '',
      generation = null,
      turnCount = 0;

  final AgentInterruptionStatus status;
  final String label;
  final String detail;
  final int? generation;
  final int turnCount;

  bool get isVisible => status != AgentInterruptionStatus.none;
}

class ChatSession {
  const ChatSession({
    required this.id,
    required this.customerId,
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
    this.avatarUrl,
    this.contextLabel = 'Order',
    this.cartValueVnd = 0,
    this.assignedToMe = false,
    this.priorityRank,
    this.interruption = const AgentInterruption.none(),
  });

  final String id;
  final String customerId;
  final String customerName;
  final ChatChannel channel;
  final SessionSeverity severity;
  final SessionStatus status;
  final OrderState orderState;
  final String lastActivityLabel;
  final String orderLabel;
  final int confidencePercent;
  final String riskLabel;
  final String? avatarUrl;
  final ChatDeeplink deeplink;
  final List<ChatTurn> turns;
  final String contextLabel;
  final int cartValueVnd;
  final bool assignedToMe;
  final int? priorityRank;
  final AgentInterruption interruption;
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
