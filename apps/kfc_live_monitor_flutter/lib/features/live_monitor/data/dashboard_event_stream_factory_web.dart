import 'dart:async';
import 'dart:html' as html;

import 'dashboard_event_payload.dart';
import 'dashboard_event_stream.dart';

DashboardEventStream createPlatformDashboardEventStream(String baseUrl) =>
    WebDashboardEventStream(baseUrl: baseUrl);

class WebDashboardEventStream implements DashboardEventStream {
  WebDashboardEventStream({required String baseUrl})
    : _streamUri = Uri.parse(baseUrl).resolve('/dashboard/stream');

  final Uri _streamUri;
  final _controller = StreamController<DashboardEventPayload>.broadcast();
  html.EventSource? _eventSource;
  late final html.EventListener _dashboardEventListener = (event) {
    _emitEvent(event);
  };

  @override
  Stream<DashboardEventPayload> connect() {
    _eventSource ??= html.EventSource(_streamUri.toString())
      ..addEventListener('dashboard', _dashboardEventListener)
      ..onMessage.listen((event) {
        _emitEvent(event);
      });
    return _controller.stream;
  }

  void _emitEvent(html.Event event) {
    if (_controller.isClosed) return;
    if (event is html.MessageEvent) {
      final data = event.data?.toString();
      if (data == null || data.isEmpty) return;
      try {
        _controller.add(DashboardEventPayload.fromJson(data));
      } catch (_) {
        // Ignore malformed stream payloads. They are not valid dashboard data.
      }
    }
  }

  @override
  void dispose() {
    _eventSource?.removeEventListener('dashboard', _dashboardEventListener);
    _eventSource?.close();
    _eventSource = null;
    if (!_controller.isClosed) _controller.close();
  }
}
