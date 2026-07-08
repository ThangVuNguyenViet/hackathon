import 'dart:async';
import 'dart:html' as html;

import 'dashboard_event_stream.dart';

DashboardEventStream createPlatformDashboardEventStream(String baseUrl) =>
    WebDashboardEventStream(baseUrl: baseUrl);

class WebDashboardEventStream implements DashboardEventStream {
  WebDashboardEventStream({required String baseUrl})
    : _streamUri = Uri.parse(baseUrl).resolve('/dashboard/stream');

  final Uri _streamUri;
  final _controller = StreamController<void>.broadcast();
  html.EventSource? _eventSource;
  late final html.EventListener _dashboardEventListener = (_) {
    _emitRefresh();
  };

  @override
  Stream<void> connect() {
    _eventSource ??= html.EventSource(_streamUri.toString())
      ..addEventListener('dashboard', _dashboardEventListener)
      ..onMessage.listen((_) {
        _emitRefresh();
      })
      ..onError.listen((_) {
        _emitRefresh();
      });
    return _controller.stream;
  }

  void _emitRefresh() {
    if (!_controller.isClosed) _controller.add(null);
  }

  @override
  void dispose() {
    _eventSource?.removeEventListener('dashboard', _dashboardEventListener);
    _eventSource?.close();
    _eventSource = null;
    if (!_controller.isClosed) _controller.close();
  }
}
