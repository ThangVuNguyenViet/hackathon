import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../domain/chat_session.dart';
import 'live_monitor_repository.dart';

const latestTranscriptTurnLimit = 10;
const _sessionHydrationConcurrency = 6;

class BackendLiveMonitorRepository implements LiveMonitorRepository {
  BackendLiveMonitorRepository({required String baseUrl, http.Client? client})
    : _baseUri = Uri.parse(baseUrl),
      _client = client ?? http.Client();

  final Uri _baseUri;
  final http.Client _client;

  @override
  Future<LiveMonitorReadiness> loadReadiness() async {
    try {
      final response = await _client.get(_baseUri.resolve('/ready'));
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final ok = body['ok'] == true;
      if (response.statusCode >= 200 && response.statusCode < 300 && ok) {
        return const LiveMonitorReadiness.online();
      }
      return LiveMonitorReadiness.configMissing(
        message: _firstReadinessFailure(body),
      );
    } on Object catch (error) {
      return LiveMonitorReadiness.offline(message: error.toString());
    }
  }

  @override
  Future<List<ChatSession>> loadSessions() async {
    final summariesJson = await _getJson('/dashboard/sessions');
    final summaries = _asList(summariesJson['sessions']);
    final sessions = await _loadSessionDetails(summaries);
    sessions.sort(
      (a, b) => (a.priorityRank ?? 0).compareTo(b.priorityRank ?? 0),
    );
    return sessions;
  }

  Future<List<ChatSession>> _loadSessionDetails(List<Object?> summaries) async {
    final results = List<ChatSession?>.filled(summaries.length, null);
    var nextIndex = 0;

    Future<void> worker() async {
      while (true) {
        final index = nextIndex;
        nextIndex += 1;
        if (index >= summaries.length) return;

        final summaryMap = _asMap(summaries[index]);
        final sessionId = _asString(summaryMap['sessionId']);
        if (sessionId.isEmpty) continue;
        try {
          results[index] = await _loadSession(sessionId, summaryMap);
        } on Object {
          results[index] = _summaryOnlySession(sessionId, summaryMap);
        }
      }
    }

    final workerCount = summaries.length < _sessionHydrationConcurrency
        ? summaries.length
        : _sessionHydrationConcurrency;
    await Future.wait(List.generate(workerCount, (_) => worker()));
    return [for (final session in results) ?session];
  }

  Future<ChatSession> _loadSession(String sessionId, Object? summary) async {
    final summaryMap = _asMap(summary);
    final agentMode = _asString(summaryMap['agentMode']);
    final monitorDisplay = _monitorDisplayFor(
      _sessionIntelligenceFor(summaryMap['sessionIntelligence']),
    );
    final detailJson = await Future.wait([
      _getJson('/dashboard/sessions/${Uri.encodeComponent(sessionId)}/turns'),
      _getJson('/dashboard/events/${Uri.encodeComponent(sessionId)}'),
    ]);
    final turnsJson = detailJson[0];
    final eventsJson = detailJson[1];
    final turns = _asList(turnsJson['turns']);
    final events = _asList(eventsJson['events']);
    final channel = _channelFor(sessionId, turns);
    final cart = _latestCart(events);

    return ChatSession(
      id: sessionId,
      customerId: _asString(summaryMap['externalUserId']).isEmpty
          ? sessionId
          : _asString(summaryMap['externalUserId']),
      customerName: _displayNameFor(sessionId, turns, summaryMap),
      channel: channel,
      severity: _effectiveSeverity(monitorDisplay.severity, agentMode),
      status: _statusFor(events, agentMode: agentMode),
      orderState: monitorDisplay.orderState,
      lastActivityLabel: _lastActivityLabel(turns, events),
      orderLabel: monitorDisplay.contextSummary ?? '',
      confidencePercent: monitorDisplay.confidencePercent,
      intelligenceSourceLabel: monitorDisplay.sourceLabel,
      riskLabel: monitorDisplay.riskLabel,
      avatarUrl: _nullableString(summaryMap['avatarUrl']),
      cartValueVnd: _cartTotal(cart),
      deeplink: _deeplinkFor(summaryMap['deeplink']),
      priorityRank: monitorDisplay.priorityRank,
      interruption: _interruptionFor(events),
      turns: turns
          .map(_chatTurnFromBackend)
          .toList(growable: false)
          .reversed
          .take(latestTranscriptTurnLimit)
          .toList()
          .reversed
          .toList(),
    );
  }

  ChatSession _summaryOnlySession(
    String sessionId,
    Map<String, dynamic> summaryMap,
  ) {
    final latestEventType = _asString(summaryMap['latestEventType']);
    final agentMode = _asString(summaryMap['agentMode']);
    final monitorDisplay = _monitorDisplayFor(
      _sessionIntelligenceFor(summaryMap['sessionIntelligence']),
    );
    return ChatSession(
      id: sessionId,
      customerId: _asString(summaryMap['externalUserId']).isEmpty
          ? sessionId
          : _asString(summaryMap['externalUserId']),
      customerName: _displayNameFor(sessionId, const [], summaryMap),
      channel: _channelFor(sessionId, const []),
      severity: _effectiveSeverity(monitorDisplay.severity, agentMode),
      status: _summaryStatusFor(latestEventType, agentMode),
      orderState: monitorDisplay.orderState,
      lastActivityLabel: 'Live',
      orderLabel: monitorDisplay.contextSummary ?? '',
      confidencePercent: monitorDisplay.confidencePercent,
      intelligenceSourceLabel: monitorDisplay.sourceLabel,
      riskLabel: monitorDisplay.riskLabel,
      avatarUrl: _nullableString(summaryMap['avatarUrl']),
      deeplink: _deeplinkFor(summaryMap['deeplink']),
      priorityRank: monitorDisplay.priorityRank,
      interruption: _summaryInterruptionFor(latestEventType),
      turns: const [],
    );
  }

  Future<Map<String, dynamic>> _getJson(String path) async {
    final response = await _client.get(_baseUri.resolve(path));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Backend request failed: ${response.statusCode} $path');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  @override
  Future<void> joinHuman(String sessionId, {required String agentId}) {
    return _postJson(
      '/dashboard/sessions/${Uri.encodeComponent(sessionId)}/human-join',
      {'agentId': agentId},
    );
  }

  @override
  Future<void> resumeAi(String sessionId, {required String agentId}) {
    return _postJson(
      '/dashboard/sessions/${Uri.encodeComponent(sessionId)}/resume-ai',
      {'agentId': agentId},
    );
  }

  Future<void> _postJson(String path, Map<String, Object?> body) async {
    final response = await _client.post(
      _baseUri.resolve(path),
      headers: const {'content-type': 'application/json; charset=utf-8'},
      body: jsonEncode(body),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Backend request failed: ${response.statusCode} $path');
    }
  }

  ChatTurn _chatTurnFromBackend(Object? value) {
    final turn = _asMap(value);
    final role = _asString(turn['role']);
    return ChatTurn(
      speaker: role == 'user' ? 'User' : 'AI',
      message: _asString(turn['text']),
    );
  }

  ChatChannel _channelFor(String sessionId, List<Object?> turns) {
    final channel = turns.isEmpty
        ? sessionId.split(':').first
        : _asString(_asMap(turns.first)['channel']);
    if (channel.contains('kfc')) return ChatChannel.kfc;
    return channel.contains('zalo') ? ChatChannel.zalo : ChatChannel.messenger;
  }

  String _displayNameFor(
    String sessionId,
    List<Object?> turns,
    Map<String, dynamic> summary,
  ) {
    final displayName = _asString(summary['displayName']);
    if (displayName.isNotEmpty) return displayName;
    final channel = _channelFor(sessionId, turns);
    return switch (channel) {
      ChatChannel.zalo => 'Zalo user',
      ChatChannel.messenger => 'Messenger user',
      ChatChannel.kfc => 'KFC chat user',
    };
  }

  String? _nullableString(Object? value) {
    final text = _asString(value);
    return text.isEmpty ? null : text;
  }

  ChatDeeplink _deeplinkFor(Object? value) {
    final map = _asMap(value);
    final status = _asString(map['status']);
    final url = _nullableString(map['url']);
    if (status == 'available' && url != null) {
      return ChatDeeplink.available(url);
    }
    final reason = _asString(map['reason']);
    return ChatDeeplink.unavailable(
      reason: reason.isEmpty ? 'deeplink_unavailable' : reason,
    );
  }

  String _lastActivityLabel(List<Object?> turns, List<Object?> events) {
    if (turns.isEmpty && events.isEmpty) return 'Live';
    return 'Live';
  }

  SessionStatus _statusFor(List<Object?> events, {String agentMode = ''}) {
    if (agentMode == 'human_paused') return SessionStatus.humanJoined;
    if (agentMode == 'resolved') return SessionStatus.resolved;

    var latestControlIndex = -1;
    var latestControlType = '';
    for (var index = 0; index < events.length; index++) {
      final map = _asMap(events[index]);
      if (_asString(map['type']) != 'session_updated') continue;
      final updateType = _asString(_asMap(map['payload'])['updateType']);
      if (!{
        'human_joined',
        'human_message_sent',
        'ai_resumed',
      }.contains(updateType)) {
        continue;
      }
      latestControlIndex = index;
      latestControlType = updateType;
    }

    if (latestControlType == 'human_joined' ||
        latestControlType == 'human_message_sent') {
      return SessionStatus.humanJoined;
    }

    if (latestControlType == 'ai_resumed') {
      final escalationAfterResume = events
          .skip(latestControlIndex + 1)
          .map((event) => _asString(_asMap(event)['type']))
          .any(
            (type) => type == 'handoff_required' || type == 'payment_failed',
          );
      if (!escalationAfterResume) return SessionStatus.aiHandling;
    }

    final types = events
        .map((event) => _asString(_asMap(event)['type']))
        .toSet();
    if (types.contains('handoff_required') ||
        types.contains('payment_failed')) {
      return SessionStatus.needsHuman;
    }
    if (types.contains('session_resolved')) return SessionStatus.resolved;
    return SessionStatus.aiHandling;
  }

  AgentInterruption _interruptionFor(List<Object?> events) {
    for (final event in events.reversed) {
      final map = _asMap(event);
      final type = _asString(map['type']);
      if (!type.startsWith('agent_run_')) continue;
      final payload = _asMap(map['payload']);
      final generation = _asInt(payload['generation']);
      final turnCount = _asInt(
        payload['includedTurnCount'] ?? payload['pendingTurnCount'],
      );
      return switch (type) {
        'agent_run_pending' => AgentInterruption(
          status: AgentInterruptionStatus.coalescing,
          label: 'Preparing reply',
          detail: _turnDetail(turnCount, generation),
          generation: generation,
          turnCount: turnCount ?? 0,
        ),
        'agent_run_scheduled' => AgentInterruption(
          status: AgentInterruptionStatus.scheduled,
          label: 'Reply queued',
          detail: _turnDetail(
            _asList(payload['includedTurnIds']).length,
            generation,
          ),
          generation: generation,
          turnCount: _asList(payload['includedTurnIds']).length,
        ),
        'agent_run_started' => AgentInterruption(
          status: AgentInterruptionStatus.running,
          label: 'AI is replying',
          detail: _turnDetail(turnCount, generation),
          generation: generation,
          turnCount: turnCount ?? 0,
        ),
        'agent_run_delivered' => AgentInterruption(
          status: _asString(payload['deliveryStatus']) == 'failed'
              ? AgentInterruptionStatus.failed
              : AgentInterruptionStatus.delivered,
          label: _asString(payload['deliveryStatus']) == 'failed'
              ? 'Reply failed'
              : 'Reply sent',
          detail: _turnDetail(turnCount, generation),
          generation: generation,
          turnCount: turnCount ?? 0,
        ),
        'agent_run_superseded' => AgentInterruption(
          status: AgentInterruptionStatus.superseded,
          label: 'Reply replaced',
          detail: generation == null
              ? 'Newer customer turn'
              : 'Gen $generation',
          generation: generation,
          turnCount: turnCount ?? 0,
        ),
        'agent_run_delivery_suppressed' => AgentInterruption(
          status: AgentInterruptionStatus.suppressed,
          label: 'Reply held',
          detail: generation == null
              ? 'Stale reply blocked'
              : 'Gen $generation',
          generation: generation,
          turnCount: turnCount ?? 0,
        ),
        _ => const AgentInterruption.none(),
      };
    }
    return const AgentInterruption.none();
  }

  AgentInterruption _summaryInterruptionFor(String latestEventType) {
    return switch (latestEventType) {
      'agent_run_pending' => const AgentInterruption(
        status: AgentInterruptionStatus.coalescing,
        label: 'Preparing reply',
        detail: 'Pending customer turns',
      ),
      'agent_run_scheduled' => const AgentInterruption(
        status: AgentInterruptionStatus.scheduled,
        label: 'Reply queued',
        detail: 'Waiting for worker',
      ),
      'agent_run_started' => const AgentInterruption(
        status: AgentInterruptionStatus.running,
        label: 'AI is replying',
        detail: 'Reply in progress',
      ),
      'agent_run_delivered' => const AgentInterruption(
        status: AgentInterruptionStatus.delivered,
        label: 'Reply sent',
        detail: 'Reply sent',
      ),
      'agent_run_superseded' => const AgentInterruption(
        status: AgentInterruptionStatus.superseded,
        label: 'Reply replaced',
        detail: 'Newer customer turn',
      ),
      'agent_run_delivery_suppressed' => const AgentInterruption(
        status: AgentInterruptionStatus.suppressed,
        label: 'Reply held',
        detail: 'Stale reply blocked',
      ),
      _ => const AgentInterruption.none(),
    };
  }

  String _turnDetail(int? turnCount, int? generation) {
    final parts = <String>[];
    if (turnCount != null && turnCount > 0) {
      parts.add('$turnCount customer ${turnCount == 1 ? 'turn' : 'turns'}');
    }
    if (generation != null) parts.add('Gen $generation');
    return parts.isEmpty ? 'Run tracked' : parts.join(' / ');
  }

  SessionStatus _summaryStatusFor(String latestEventType, String agentMode) {
    if (agentMode == 'human_paused') return SessionStatus.humanJoined;
    if (agentMode == 'resolved') return SessionStatus.resolved;
    return switch (latestEventType) {
      'handoff_required' || 'payment_failed' => SessionStatus.needsHuman,
      'session_resolved' => SessionStatus.resolved,
      _ => SessionStatus.aiHandling,
    };
  }

  SessionSeverity _effectiveSeverity(
    SessionSeverity severity,
    String agentMode,
  ) {
    return switch (agentMode) {
      'human_paused' => SessionSeverity.critical,
      'resolved' => SessionSeverity.normal,
      _ => severity,
    };
  }

  Map<String, dynamic>? _latestCart(List<Object?> events) {
    for (final event in events.reversed) {
      final payload = _asMap(_asMap(event)['payload']);
      final cart = payload['cart'];
      if (cart is Map<String, dynamic>) return cart;
      if (cart is Map) return Map<String, dynamic>.from(cart);
    }
    return null;
  }

  int _cartTotal(Map<String, dynamic>? cart) {
    if (cart == null) return 0;
    final total = cart['totalVnd'];
    if (total is num) return total.round();
    return int.tryParse(_asString(total)) ?? 0;
  }

  List<Object?> _asList(Object? value) => value is List ? value : const [];

  Map<String, dynamic> _asMap(Object? value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return const {};
  }

  String _asString(Object? value) => value?.toString() ?? '';

  int? _asInt(Object? value) {
    if (value is int) return value;
    if (value is num) return value.round();
    return int.tryParse(_asString(value));
  }

  _MonitorSessionIntelligence? _sessionIntelligenceFor(Object? value) {
    final map = _asMap(value);
    if (map.isEmpty) return null;
    if (map['schemaVersion'] != 1) return null;
    final source = _asString(map['source']);
    if (!_validIntelligenceSources.contains(source)) return null;
    final orderStage = _asString(map['orderStage']);
    final confidence = _asInt(map['aiAutomationConfidencePercent']);
    final riskLevel = _asString(map['riskLevel']);
    final priorityRank = _asInt(map['priorityRank']);
    final contextSummary = _asString(map['contextSummary']).trim();
    if (!_validOrderStages.contains(orderStage)) return null;
    if (!_validRiskLevels.contains(riskLevel)) return null;
    if (confidence == null || confidence < 0 || confidence > 100) return null;
    if (priorityRank == null) return null;
    return _MonitorSessionIntelligence(
      orderStage: orderStage,
      confidencePercent: confidence,
      riskLevel: riskLevel,
      priorityRank: priorityRank,
      sourceLabel: _sourceLabelFor(source),
      source: source,
      contextSummary: contextSummary,
    );
  }

  _MonitorSessionDisplay _monitorDisplayFor(
    _MonitorSessionIntelligence? intelligence,
  ) {
    if (intelligence == null) return _unknownMonitorDisplay;
    final hasAiContext =
        intelligence.source == 'ai_monitor_judge' &&
        intelligence.contextSummary.isNotEmpty;
    return _MonitorSessionDisplay(
      severity: switch (intelligence.riskLevel) {
        'low' => SessionSeverity.normal,
        'medium' => SessionSeverity.warning,
        'high' || 'critical' => SessionSeverity.critical,
        _ => SessionSeverity.warning,
      },
      orderState: switch (intelligence.orderStage) {
        'cart_ready' => OrderState.cartReady,
        'fulfillment_pending' => OrderState.omsPending,
        'payment_issue' => OrderState.paymentIssue,
        'confirmed' => OrderState.confirmed,
        _ => OrderState.collectingInfo,
      },
      contextSummary: hasAiContext ? intelligence.contextSummary : null,
      confidencePercent: intelligence.confidencePercent,
      sourceLabel: intelligence.sourceLabel,
      riskLabel: switch (intelligence.riskLevel) {
        'low' => 'Low',
        'medium' => 'Medium',
        'high' => 'High',
        'critical' => 'Critical',
        _ => 'Unknown',
      },
      priorityRank: intelligence.priorityRank,
    );
  }

  String? _firstReadinessFailure(Map<String, dynamic> body) {
    final checks = _asMap(body['checks']);
    for (final value in checks.values) {
      final check = _asMap(value);
      if (check['ok'] == true) continue;
      final message = _asString(check['message']);
      if (message.isNotEmpty) return message;
    }
    final message = _asString(body['message']);
    return message.isEmpty ? null : message;
  }
}

const _validOrderStages = {
  'collecting_info',
  'cart_ready',
  'fulfillment_pending',
  'payment_issue',
  'confirmed',
};

const _validRiskLevels = {'low', 'medium', 'high', 'critical'};

const _validIntelligenceSources = {
  'ai_monitor_judge',
  'runtime_rule_fallback',
  'backend_deterministic',
};

const _unknownMonitorDisplay = _MonitorSessionDisplay(
  severity: SessionSeverity.warning,
  orderState: OrderState.collectingInfo,
  contextSummary: null,
  confidencePercent: null,
  sourceLabel: null,
  riskLabel: 'Unknown',
  priorityRank: 30,
);

class _MonitorSessionIntelligence {
  const _MonitorSessionIntelligence({
    required this.orderStage,
    required this.confidencePercent,
    required this.riskLevel,
    required this.priorityRank,
    required this.sourceLabel,
    required this.source,
    required this.contextSummary,
  });

  final String orderStage;
  final int confidencePercent;
  final String riskLevel;
  final int priorityRank;
  final String sourceLabel;
  final String source;
  final String contextSummary;
}

class _MonitorSessionDisplay {
  const _MonitorSessionDisplay({
    required this.severity,
    required this.orderState,
    required this.contextSummary,
    required this.confidencePercent,
    required this.sourceLabel,
    required this.riskLabel,
    required this.priorityRank,
  });

  final SessionSeverity severity;
  final OrderState orderState;
  final String? contextSummary;
  final int? confidencePercent;
  final String? sourceLabel;
  final String riskLabel;
  final int priorityRank;
}

String _sourceLabelFor(String source) => switch (source) {
  'ai_monitor_judge' => 'AI judged',
  'runtime_rule_fallback' || 'backend_deterministic' => 'Rule fallback',
  _ => 'Unknown',
};
