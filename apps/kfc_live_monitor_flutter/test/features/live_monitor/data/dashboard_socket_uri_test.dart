import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/live_monitor/data/dashboard_socket_uri.dart';

void main() {
  test('uses secure WebSocket for HTTPS backends', () {
    expect(
      dashboardSocketUri('https://api.example.com/base').toString(),
      'wss://api.example.com/dashboard/socket',
    );
  });

  test('uses plain WebSocket for local HTTP backends', () {
    expect(
      dashboardSocketUri('http://127.0.0.1:18090').toString(),
      'ws://127.0.0.1:18090/dashboard/socket',
    );
  });

  test('resolves same-origin HTTPS backend paths to secure WebSocket', () {
    expect(
      dashboardSocketUri(
        '/',
        currentUri: Uri.parse('https://kfc-ai-live-monitor.pages.dev/'),
      ).toString(),
      'wss://kfc-ai-live-monitor.pages.dev/dashboard/socket',
    );
  });
}
