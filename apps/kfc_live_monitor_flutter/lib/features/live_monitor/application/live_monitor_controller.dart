import 'package:state_beacon/state_beacon.dart';

import '../data/mock_live_monitor_repository.dart';
import '../data/live_monitor_repository.dart';
import '../domain/chat_session.dart';
import 'live_monitor_filters.dart';
import 'live_monitor_state.dart';

class LiveMonitorController extends BeaconController {
  LiveMonitorController({
    LiveMonitorRepository repository = const MockLiveMonitorRepository(),
  }) : _repository = repository;

  final LiveMonitorRepository _repository;

  late final state = B.future(
    () async => LiveMonitorState(sessions: await _repository.loadSessions()),
  );

  late final filters = B.writable(const LiveMonitorFilters());

  late final lastOpenedDeeplink = B.writable<String?>(null);

  late final monitorState = B.derived(() {
    final loadedState = state.value.lastData;
    return LiveMonitorState(
      sessions: loadedState?.sessions ?? const <ChatSession>[],
      filters: filters.value,
      lastOpenedDeeplink: lastOpenedDeeplink.value,
    );
  });

  late final visibleSessions = B.derived(() {
    final current = monitorState.value;
    final filters = current.filters;
    final filtered = current.sessions.where((session) {
      if (filters.channel != null && session.channel != filters.channel) {
        return false;
      }
      if (filters.severity != null && session.severity != filters.severity) {
        return false;
      }
      if (filters.status != null && session.status != filters.status) {
        return false;
      }
      if (filters.assignedToMe != null &&
          session.assignedToMe != filters.assignedToMe) {
        return false;
      }
      if (filters.orderState != null &&
          session.orderState != filters.orderState) {
        return false;
      }
      return true;
    }).toList();

    filtered.sort((a, b) => _compareSessions(a, b, filters.sortMode));
    return filtered;
  });

  void setAssignedFilter(bool? assignedToMe) {
    filters.value = filters.value.copyWith(
      assignedToMe: assignedToMe,
      clearAssignedToMe: assignedToMe == null,
    );
  }

  void setChannelFilter(ChatChannel? channel) {
    filters.value = filters.value.copyWith(
      channel: channel,
      clearChannel: channel == null,
    );
  }

  void setOrderStateFilter(OrderState? orderState) {
    filters.value = filters.value.copyWith(
      orderState: orderState,
      clearOrderState: orderState == null,
    );
  }

  void setSeverityFilter(SessionSeverity? severity) {
    filters.value = filters.value.copyWith(
      severity: severity,
      clearSeverity: severity == null,
    );
  }

  void setSortMode(SortMode sortMode) {
    filters.value = filters.value.copyWith(sortMode: sortMode);
  }

  void setStatusFilter(SessionStatus? status) {
    filters.value = filters.value.copyWith(
      status: status,
      clearStatus: status == null,
    );
  }

  void openSession(String sessionId) {
    final session = monitorState.value.sessions.firstWhere(
      (candidate) => candidate.id == sessionId,
    );
    lastOpenedDeeplink.value = session.deeplink;
  }

  int _compareSessions(ChatSession a, ChatSession b, SortMode sortMode) {
    return switch (sortMode) {
      SortMode.criticalFirst => _criticalFirstRank(
        a,
      ).compareTo(_criticalFirstRank(b)),
      SortMode.newestActivity => a.lastActivityLabel.compareTo(
        b.lastActivityLabel,
      ),
      SortMode.confidence => b.confidencePercent.compareTo(a.confidencePercent),
      SortMode.cartValue => b.cartValueVnd.compareTo(a.cartValueVnd),
      SortMode.orderStage => a.orderState.index.compareTo(b.orderState.index),
      SortMode.channel => a.channel.label.compareTo(b.channel.label),
    };
  }

  int _severityRank(SessionSeverity severity) => switch (severity) {
    SessionSeverity.critical => 0,
    SessionSeverity.warning => 1,
    SessionSeverity.normal => 2,
  };

  int _criticalFirstRank(ChatSession session) {
    return session.priorityRank ?? _severityRank(session.severity);
  }
}
