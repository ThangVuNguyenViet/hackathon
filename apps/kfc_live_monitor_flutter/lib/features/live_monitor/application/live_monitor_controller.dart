import 'package:state_beacon/state_beacon.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/dashboard_event_stream.dart';
import '../data/dashboard_event_payload.dart';
import '../data/mock_live_monitor_repository.dart';
import '../data/live_monitor_repository.dart';
import '../domain/chat_session.dart';
import 'live_monitor_filters.dart';
import 'live_monitor_state.dart';

typedef ExternalUrlLauncher = Future<void> Function(Uri uri);

class LiveMonitorController extends BeaconController {
  LiveMonitorController({
    LiveMonitorRepository repository = const MockLiveMonitorRepository(),
    DashboardEventStream? eventStream,
    ExternalUrlLauncher? openExternalUrl,
  }) : _repository = repository,
       _eventStream = eventStream,
       _openExternalUrl = openExternalUrl ?? _launchExternalUrl {
    _unsubscribeLiveEvents = _liveEvents.subscribe((event) {
      if (event.isData || event.isError) {
        refresh();
      }
    }, startNow: false);
  }

  static const _localAgentId = 'monitor_agent_local';

  final LiveMonitorRepository _repository;
  final DashboardEventStream? _eventStream;
  final ExternalUrlLauncher _openExternalUrl;
  Future<void>? _activeRefresh;
  late final void Function() _unsubscribeLiveEvents;

  late final _liveEvents = B.stream<DashboardEventPayload>(
    () =>
        _eventStream?.connect() ?? const Stream<DashboardEventPayload>.empty(),
    shouldSleep: false,
  );

  late final state = B.future(() async {
    _liveEvents.value;
    return _loadMonitorState();
  });

  late final filters = B.writable(const LiveMonitorFilters());

  late final lastOpenedDeeplink = B.writable<String?>(null);

  late final monitorState = B.derived(() {
    final loadedState = state.value.lastData;
    return LiveMonitorState(
      sessions: loadedState?.sessions ?? const <ChatSession>[],
      readiness: loadedState?.readiness ?? const LiveMonitorReadiness.offline(),
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

  Future<void> openSession(String sessionId) async {
    final session = monitorState.value.sessions.firstWhere(
      (candidate) => candidate.id == sessionId,
    );
    final url = session.deeplink.url;
    if (url == null) return;
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    lastOpenedDeeplink.value = url;
    await _openExternalUrl(uri);
  }

  Future<void> joinHuman(String sessionId) async {
    await _repository.joinHuman(sessionId, agentId: _localAgentId);
    await refresh();
  }

  Future<void> sendHumanMessage(String sessionId, String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;
    await _repository.sendHumanMessage(
      sessionId,
      agentId: _localAgentId,
      text: trimmed,
    );
    await refresh();
  }

  Future<void> resumeAi(String sessionId) async {
    await _repository.resumeAi(sessionId, agentId: _localAgentId);
    await refresh();
  }

  Future<void> refresh() {
    final activeRefresh = _activeRefresh;
    if (activeRefresh != null) return activeRefresh;

    final refresh = state.updateWith(
      _loadMonitorState,
    );
    _activeRefresh = refresh.whenComplete(() {
      _activeRefresh = null;
    });
    return _activeRefresh!;
  }

  @override
  void dispose() {
    _unsubscribeLiveEvents();
    _eventStream?.dispose();
    super.dispose();
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

  Future<LiveMonitorState> _loadMonitorState() async {
    final readiness = await _repository.loadReadiness();
    final sessions = await _repository.loadSessions();
    return LiveMonitorState(sessions: sessions, readiness: readiness);
  }

  static Future<void> _launchExternalUrl(Uri uri) async {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}
