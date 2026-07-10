import 'dart:async';
import 'dart:js_interop';

import 'package:web/web.dart' as web;

import 'dashboard_event_payload.dart';
import 'dashboard_event_stream.dart';
import 'dashboard_socket_uri.dart';

DashboardEventStream createPlatformDashboardEventStream(String baseUrl) =>
    WebDashboardEventStream(baseUrl: baseUrl);

class WebDashboardEventStream implements DashboardEventStream {
  WebDashboardEventStream({
    required String baseUrl,
    Duration reconnectDelay = const Duration(seconds: 2),
  }) : _socketUri = dashboardSocketUri(baseUrl),
       _reconnectDelay = reconnectDelay;

  final Uri _socketUri;
  final Duration _reconnectDelay;
  final _controller = StreamController<DashboardEventPayload>.broadcast();
  web.WebSocket? _socket;
  Timer? _reconnectTimer;
  var _disposed = false;

  @override
  Stream<DashboardEventPayload> connect() {
    if (_socket == null) _openSocket();
    return _controller.stream;
  }

  void _openSocket() {
    if (_disposed || _controller.isClosed) return;
    final socket = web.WebSocket(_socketUri.toString());
    _socket = socket;
    socket.onopen = ((web.Event _) {
      if (_disposed || _controller.isClosed) return;
      _controller.add(
        DashboardEventPayload(
          id: 'dashboard_socket_connected',
          sessionId: 'dashboard:sessions',
          type: DashboardEventType.sessionUpdated,
          payload: const {},
          createdAt: DateTime.now().toUtc(),
        ),
      );
    }).toJS;
    socket.onmessage = ((web.MessageEvent event) {
      if (_disposed || _controller.isClosed) return;
      final data = event.data;
      if (data == null || !data.typeofEquals('string')) return;
      try {
        _controller.add(
          DashboardEventPayload.fromJson((data as JSString).toDart),
        );
      } catch (_) {
        // Ignore malformed frames and keep the live connection available.
      }
    }).toJS;
    socket.onclose = ((web.Event _) {
      if (identical(_socket, socket)) _socket = null;
      _scheduleReconnect();
    }).toJS;
  }

  void _scheduleReconnect() {
    if (_disposed || _reconnectTimer != null) return;
    _reconnectTimer = Timer(_reconnectDelay, () {
      _reconnectTimer = null;
      _openSocket();
    });
  }

  @override
  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _socket?.close();
    _socket = null;
    if (!_controller.isClosed) _controller.close();
  }
}
