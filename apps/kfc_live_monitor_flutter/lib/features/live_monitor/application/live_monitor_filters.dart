import '../domain/chat_session.dart';

class LiveMonitorFilters {
  const LiveMonitorFilters({
    this.channel,
    this.severity,
    this.status,
    this.assignedToMe,
    this.orderState,
    this.sortMode = SortMode.criticalFirst,
  });

  final ChatChannel? channel;
  final SessionSeverity? severity;
  final SessionStatus? status;
  final bool? assignedToMe;
  final OrderState? orderState;
  final SortMode sortMode;

  LiveMonitorFilters copyWith({
    ChatChannel? channel,
    bool clearChannel = false,
    SessionSeverity? severity,
    bool clearSeverity = false,
    SessionStatus? status,
    bool clearStatus = false,
    bool? assignedToMe,
    bool clearAssignedToMe = false,
    OrderState? orderState,
    bool clearOrderState = false,
    SortMode? sortMode,
  }) {
    return LiveMonitorFilters(
      channel: clearChannel ? null : (channel ?? this.channel),
      severity: clearSeverity ? null : (severity ?? this.severity),
      status: clearStatus ? null : (status ?? this.status),
      assignedToMe: clearAssignedToMe
          ? null
          : (assignedToMe ?? this.assignedToMe),
      orderState: clearOrderState ? null : (orderState ?? this.orderState),
      sortMode: sortMode ?? this.sortMode,
    );
  }
}
