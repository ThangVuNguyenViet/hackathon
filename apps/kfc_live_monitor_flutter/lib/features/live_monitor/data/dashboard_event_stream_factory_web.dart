import 'dart:async';

import 'package:http/http.dart' as http;

import 'dashboard_event_payload.dart';
import 'dashboard_event_stream.dart';

DashboardEventStream createPlatformDashboardEventStream(String baseUrl) =>
    WebDashboardEventStream(baseUrl: baseUrl);

class WebDashboardEventStream implements DashboardEventStream {
  WebDashboardEventStream({
    required String baseUrl,
    http.Client? client,
    Duration pollInterval = const Duration(seconds: 2),
  }) : _sessionsUri = Uri.parse(baseUrl).resolve('/dashboard/sessions'),
       _client = client ?? http.Client(),
       _pollInterval = pollInterval;

  final Uri _sessionsUri;
  final http.Client _client;
  final Duration _pollInterval;
  final _controller = StreamController<DashboardEventPayload>.broadcast();
  Timer? _timer;
  String? _lastSessionsBody;
  var _pollInFlight = false;
  var _disposed = false;

  @override
  Stream<DashboardEventPayload> connect() {
    _timer ??= Timer.periodic(_pollInterval, (_) {
      _pollSessions();
    });
    _pollSessions();
    return _controller.stream;
  }

  Future<void> _pollSessions() async {
    if (_disposed || _pollInFlight || _controller.isClosed) return;
    _pollInFlight = true;
    try {
      final response = await _client.get(_sessionsUri);
      if (response.statusCode != 200) return;
      final body = response.body;
      if (_lastSessionsBody == null) {
        _lastSessionsBody = body;
        return;
      }
      if (body == _lastSessionsBody) return;
      _lastSessionsBody = body;
      _controller.add(
        DashboardEventPayload(
          id: 'dashboard_poll_${DateTime.now().microsecondsSinceEpoch}',
          sessionId: 'dashboard:sessions',
          type: DashboardEventType.sessionUpdated,
          payload: const {},
          createdAt: DateTime.now().toUtc(),
        ),
      );
    } catch (_) {
      // Polling is best-effort; the repository load path surfaces real errors.
    } finally {
      _pollInFlight = false;
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _timer = null;
    _client.close();
    if (!_controller.isClosed) _controller.close();
  }
}
