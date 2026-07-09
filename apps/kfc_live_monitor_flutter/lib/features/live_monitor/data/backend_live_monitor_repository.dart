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
  Future<List<ChatSession>> loadSessions() async {
    final summariesJson = await _getJson('/dashboard/sessions');
    final summaries = _asList(summariesJson['sessions']);
    final sessions = await Future.wait(
      summaries.map(
        (summary) =>
            _loadSession(_asString(_asMap(summary)['sessionId']), summary),
      ),
    );
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

  Future<Map<String, dynamic>> _getJson(String path) async {
    final response = await _client.get(_baseUri.resolve(path));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Backend request failed: ${response.statusCode} $path');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
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
}
