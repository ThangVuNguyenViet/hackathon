import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../domain/chat_session.dart';
import 'live_monitor_repository.dart';

const latestTranscriptTurnLimit = 10;

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
    final sessions = <ChatSession>[];
    for (final summary in summaries) {
      final summaryMap = _asMap(summary);
      final sessionId = _asString(summaryMap['sessionId']);
      if (sessionId.isEmpty) continue;
      try {
        sessions.add(await _loadSession(sessionId, summaryMap));
      } on Object {
        sessions.add(_summaryOnlySession(sessionId, summaryMap));
      }
    }
    sessions.sort(
      (a, b) => (a.priorityRank ?? 0).compareTo(b.priorityRank ?? 0),
    );
    return sessions;
  }

  Future<ChatSession> _loadSession(String sessionId, Object? summary) async {
    final summaryMap = _asMap(summary);
    final turnsJson = await _getJson(
      '/dashboard/sessions/${Uri.encodeComponent(sessionId)}/turns',
    );
    final eventsJson = await _getJson(
      '/dashboard/events/${Uri.encodeComponent(sessionId)}',
    );
    final turns = _asList(turnsJson['turns']);
    final events = _asList(eventsJson['events']);
    final channel = _channelFor(sessionId, turns);
    final latestEventType = events.isEmpty
        ? ''
        : _asString(_asMap(events.last)['type']);
    final cart = _latestCart(events);

    return ChatSession(
      id: sessionId,
      customerId: _asString(summaryMap['externalUserId']).isEmpty
          ? sessionId
          : _asString(summaryMap['externalUserId']),
      customerName: _displayNameFor(sessionId, turns, summaryMap),
      channel: channel,
      severity: _severityFor(events),
      status: _statusFor(events),
      orderState: _orderStateFor(events),
      lastActivityLabel: _lastActivityLabel(turns, events),
      orderLabel: _orderLabel(cart, latestEventType),
      confidencePercent: _confidenceFor(events),
      riskLabel: _riskLabelFor(events),
      avatarUrl: _nullableString(summaryMap['avatarUrl']),
      cartValueVnd: _cartTotal(cart),
      deeplink: _deeplinkFor(summaryMap['deeplink']),
      priorityRank: _priorityFor(events),
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
    final severity = _summarySeverityFor(latestEventType);
    return ChatSession(
      id: sessionId,
      customerId: _asString(summaryMap['externalUserId']).isEmpty
          ? sessionId
          : _asString(summaryMap['externalUserId']),
      customerName: _displayNameFor(sessionId, const [], summaryMap),
      channel: _channelFor(sessionId, const []),
      severity: severity,
      status: _summaryStatusFor(latestEventType),
      orderState: _summaryOrderStateFor(latestEventType),
      lastActivityLabel: 'Live',
      orderLabel: latestEventType.isEmpty ? 'Monitoring' : latestEventType,
      confidencePercent: switch (severity) {
        SessionSeverity.critical => 52,
        SessionSeverity.warning => 72,
        SessionSeverity.normal => 92,
      },
      riskLabel: switch (severity) {
        SessionSeverity.critical => 'High',
        SessionSeverity.warning => 'Medium',
        SessionSeverity.normal => 'Low',
      },
      avatarUrl: _nullableString(summaryMap['avatarUrl']),
      deeplink: _deeplinkFor(summaryMap['deeplink']),
      priorityRank: switch (severity) {
        SessionSeverity.critical => 0,
        SessionSeverity.warning => 1,
        SessionSeverity.normal => 2,
      },
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
  Future<void> sendHumanMessage(
    String sessionId, {
    required String agentId,
    required String text,
  }) {
    return _postJson(
      '/dashboard/sessions/${Uri.encodeComponent(sessionId)}/human-message',
      {'agentId': agentId, 'text': text},
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
    return channel.contains('zalo') ? ChatChannel.zalo : ChatChannel.messenger;
  }

  String _displayNameFor(
    String sessionId,
    List<Object?> turns,
    Map<String, dynamic> summary,
  ) {
    final displayName = _asString(summary['displayName']);
    if (displayName.isNotEmpty) return displayName;
    final summaryExternalUserId = _asString(summary['externalUserId']);
    if (summaryExternalUserId.isNotEmpty) return summaryExternalUserId;
    for (final turn in turns.reversed) {
      final externalUserId = _asString(_asMap(turn)['externalUserId']);
      if (externalUserId.isNotEmpty) return externalUserId;
    }
    return sessionId;
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

  SessionSeverity _severityFor(List<Object?> events) {
    final types = events
        .map((event) => _asString(_asMap(event)['type']))
        .toSet();
    if (types.contains('handoff_required') ||
        types.contains('payment_failed')) {
      return SessionSeverity.critical;
    }
    if (types.contains('assistant_reply_sent') && _hasFailedDelivery(events)) {
      return SessionSeverity.warning;
    }
    return SessionSeverity.normal;
  }

  SessionStatus _statusFor(List<Object?> events) {
    for (final event in events.reversed) {
      final map = _asMap(event);
      if (_asString(map['type']) != 'session_updated') continue;
      final updateType = _asString(_asMap(map['payload'])['updateType']);
      if (updateType == 'human_joined') return SessionStatus.humanJoined;
      if (updateType == 'ai_resumed') return SessionStatus.aiHandling;
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

  OrderState _orderStateFor(List<Object?> events) {
    final types = events
        .map((event) => _asString(_asMap(event)['type']))
        .toSet();
    if (types.contains('payment_failed')) return OrderState.paymentIssue;
    if (types.contains('order_created')) return OrderState.confirmed;
    if (types.contains('cart_changed')) return OrderState.cartReady;
    if (types.contains('handoff_required')) return OrderState.omsPending;
    return OrderState.collectingInfo;
  }

  int _confidenceFor(List<Object?> events) => switch (_severityFor(events)) {
    SessionSeverity.critical => 52,
    SessionSeverity.warning => 72,
    SessionSeverity.normal => 92,
  };

  String _riskLabelFor(List<Object?> events) => switch (_severityFor(events)) {
    SessionSeverity.critical => 'High',
    SessionSeverity.warning => 'Medium',
    SessionSeverity.normal => 'Low',
  };

  int _priorityFor(List<Object?> events) => switch (_severityFor(events)) {
    SessionSeverity.critical => 0,
    SessionSeverity.warning => 1,
    SessionSeverity.normal => 2,
  };

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
          label: 'Coalescing',
          detail: _turnDetail(turnCount, generation),
          generation: generation,
          turnCount: turnCount ?? 0,
        ),
        'agent_run_scheduled' => AgentInterruption(
          status: AgentInterruptionStatus.scheduled,
          label: 'AI Run Queued',
          detail: _turnDetail(
            _asList(payload['includedTurnIds']).length,
            generation,
          ),
          generation: generation,
          turnCount: _asList(payload['includedTurnIds']).length,
        ),
        'agent_run_started' => AgentInterruption(
          status: AgentInterruptionStatus.running,
          label: 'AI Running',
          detail: _turnDetail(turnCount, generation),
          generation: generation,
          turnCount: turnCount ?? 0,
        ),
        'agent_run_delivered' => AgentInterruption(
          status: _asString(payload['deliveryStatus']) == 'failed'
              ? AgentInterruptionStatus.failed
              : AgentInterruptionStatus.delivered,
          label: _asString(payload['deliveryStatus']) == 'failed'
              ? 'Reply Failed'
              : 'Coalesced Reply',
          detail: _turnDetail(turnCount, generation),
          generation: generation,
          turnCount: turnCount ?? 0,
        ),
        'agent_run_superseded' => AgentInterruption(
          status: AgentInterruptionStatus.superseded,
          label: 'Superseded',
          detail: generation == null ? 'Newer customer turn' : 'Gen $generation',
          generation: generation,
          turnCount: turnCount ?? 0,
        ),
        'agent_run_delivery_suppressed' => AgentInterruption(
          status: AgentInterruptionStatus.suppressed,
          label: 'Suppressed',
          detail: generation == null ? 'Stale reply blocked' : 'Gen $generation',
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
        label: 'Coalescing',
        detail: 'Pending customer turns',
      ),
      'agent_run_scheduled' => const AgentInterruption(
        status: AgentInterruptionStatus.scheduled,
        label: 'AI Run Queued',
        detail: 'Waiting for worker',
      ),
      'agent_run_started' => const AgentInterruption(
        status: AgentInterruptionStatus.running,
        label: 'AI Running',
        detail: 'Reply in progress',
      ),
      'agent_run_delivered' => const AgentInterruption(
        status: AgentInterruptionStatus.delivered,
        label: 'Coalesced Reply',
        detail: 'Reply sent',
      ),
      'agent_run_superseded' => const AgentInterruption(
        status: AgentInterruptionStatus.superseded,
        label: 'Superseded',
        detail: 'Newer customer turn',
      ),
      'agent_run_delivery_suppressed' => const AgentInterruption(
        status: AgentInterruptionStatus.suppressed,
        label: 'Suppressed',
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

  SessionSeverity _summarySeverityFor(String latestEventType) {
    return switch (latestEventType) {
      'handoff_required' || 'payment_failed' => SessionSeverity.critical,
      'assistant_reply_sent' => SessionSeverity.warning,
      _ => SessionSeverity.normal,
    };
  }

  SessionStatus _summaryStatusFor(String latestEventType) {
    return switch (latestEventType) {
      'handoff_required' || 'payment_failed' => SessionStatus.needsHuman,
      'session_resolved' => SessionStatus.resolved,
      _ => SessionStatus.aiHandling,
    };
  }

  OrderState _summaryOrderStateFor(String latestEventType) {
    return switch (latestEventType) {
      'payment_failed' => OrderState.paymentIssue,
      'order_created' => OrderState.confirmed,
      'cart_changed' => OrderState.cartReady,
      'handoff_required' => OrderState.omsPending,
      _ => OrderState.collectingInfo,
    };
  }

  bool _hasFailedDelivery(List<Object?> events) {
    return events.any((event) {
      final payload = _asMap(_asMap(event)['payload']);
      return payload['deliveryStatus'] == 'failed';
    });
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

  String _orderLabel(Map<String, dynamic>? cart, String latestEventType) {
    if (cart == null) {
      return latestEventType.isEmpty ? 'Monitoring' : latestEventType;
    }
    final items = _asList(cart['items']);
    if (items.isEmpty) return 'Cart updated';
    return items
        .map((item) {
          final map = _asMap(item);
          return '${_asString(map['quantity'])}x ${_asString(map['name'])}';
        })
        .join(', ');
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
    if (value is num) return value.round();
    return int.tryParse(_asString(value));
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
