import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:kfc_live_monitor/app/kfc_monitor_app.dart';
import 'package:kfc_live_monitor/features/live_monitor/testing/live_monitor_keys.dart';

import 'support/integration_test_error_filter.dart';
import 'support/integration_screenshot_catalog.dart';

const _backendUrl = String.fromEnvironment('KFC_AGENT_BACKEND_URL');
const _screenshotDir = String.fromEnvironment('KFC_GENUI_SCREENSHOT_DIR');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  ignoreMacOsHardwareKeyboardKeyUpNoise();
  late final Directory screenshotRoot;
  late final BackendSeedClient backend;

  setUpAll(() async {
    if (_backendUrl.isEmpty) {
      throw TestFailure(
        'KFC_AGENT_BACKEND_URL is required for backend-backed monitor integration tests.',
      );
    }
    screenshotRoot = await _prepareScreenshotRoot();
    backend = BackendSeedClient(_backendUrl);
    debugPrint('KFC_GENUI_SCREENSHOT_DIR=${screenshotRoot.path}');
  });

  tearDownAll(() {
    backend.close();
  });

  testWidgets('primary monitor renders a backend session card and screenshot', (
    tester,
  ) async {
    final rootKey = GlobalKey();
    final seed = _seed();
    final sessionId = 'messenger:monitor_primary_$seed';
    await backend.seedMessengerWebhook(
      userId: 'monitor_primary_$seed',
      messageId: 'messenger_primary_$seed',
      text: 'Cho mình Combo Hợp Gu 99K để kiểm tra màn hình monitor.',
    );
    final screenshots = IntegrationScreenshotCatalog(
      outputDirectory: screenshotRoot,
      testName: 'live_monitor_primary_screen',
      boundaryKey: rootKey,
    );

    await _pumpMonitor(tester, rootKey);
    await _waitForVisible(
      tester,
      find.byKey(LiveMonitorKeys.sessionCard(sessionId)),
    );
    await _waitForVisible(
      tester,
      find.byKey(LiveMonitorKeys.sessionOpenChatButton(sessionId)),
    );
    await screenshots.capture(
      tester,
      'primary_monitor_grid',
      target: find.byKey(rootKey),
    );
  });

  testWidgets('monitor loads persisted backend history after new turns', (
    tester,
  ) async {
    final rootKey = GlobalKey();
    final seed = _seed();
    final sessionId = 'messenger:monitor_history_$seed';
    const firstText = 'Lịch sử backend: mình đã hỏi Combo Hợp Gu 99K.';
    const refreshedText = 'Tin mới backend: thêm Pepsi giúp mình.';
    await backend.seedMessengerWebhook(
      userId: 'monitor_history_$seed',
      messageId: 'messenger_history_first_$seed',
      text: firstText,
    );
    final screenshots = IntegrationScreenshotCatalog(
      outputDirectory: screenshotRoot,
      testName: 'live_monitor_history_polling',
      boundaryKey: rootKey,
    );

    await _pumpMonitor(tester, rootKey);
    await _waitForVisible(
      tester,
      find.byKey(LiveMonitorKeys.sessionCard(sessionId)),
    );
    await _waitForText(tester, firstText);
    await screenshots.capture(
      tester,
      'persisted_history',
      target: find.byKey(rootKey),
    );

    await backend.seedMessengerWebhook(
      userId: 'monitor_history_$seed',
      messageId: 'messenger_history_refreshed_$seed',
      text: refreshedText,
    );
    await _pumpMonitor(tester, rootKey);
    await _waitForText(tester, refreshedText);
    await screenshots.capture(
      tester,
      'refreshed_history',
      target: find.byKey(rootKey),
    );
  });

  testWidgets('monitor shows backend channel display names', (tester) async {
    final rootKey = GlobalKey();
    final seed = _seed();
    final zaloUserId = 'zalo_monitor_$seed';
    final messengerUserId = 'messenger_monitor_$seed';
    await backend.seedZaloWebhook(
      userId: zaloUserId,
      messageId: 'zalo_profile_$seed',
      displayName: 'Tran Binh',
      text: 'Zalo backend: cho mình 2 phần gà.',
    );
    final screenshots = IntegrationScreenshotCatalog(
      outputDirectory: screenshotRoot,
      testName: 'live_monitor_channel_parity',
      boundaryKey: rootKey,
    );

    await _pumpMonitor(tester, rootKey);
    await _waitForVisible(
      tester,
      find.byKey(LiveMonitorKeys.sessionCard('zalo:$zaloUserId')),
    );
    await _waitForText(tester, 'Tran Binh');
    await _waitForText(tester, 'Zalo backend: cho mình 2 phần gà.');
    await screenshots.capture(
      tester,
      'zalo_history',
      target: find.byKey(rootKey),
    );

    await backend.seedMessengerWebhook(
      userId: messengerUserId,
      messageId: 'messenger_profile_$seed',
      text: 'Messenger backend: kiểm tra tên hiển thị.',
    );
    await _pumpMonitor(tester, rootKey);
    await _waitForVisible(
      tester,
      find.byKey(LiveMonitorKeys.sessionCard('messenger:$messengerUserId')),
    );
    await _waitForText(tester, 'Nguyen An');
    expect(find.text(messengerUserId), findsNothing);
    expect(find.text(zaloUserId), findsNothing);
    await screenshots.capture(
      tester,
      'messenger_display_name',
      target: find.byKey(rootKey),
    );
  });

  testWidgets(
    'backend angry handoff can be joined by a human and resumed to AI',
    (tester) async {
      final rootKey = GlobalKey();
      final seed = _seed();
      final userId = 'monitor_angry_$seed';
      final sessionId = 'messenger:$userId';
      await backend.seedMessengerWebhook(
        userId: userId,
        messageId: 'messenger_angry_$seed',
        text:
            'Mình muốn khiếu nại vì đơn bị thiếu món, cho mình gặp nhân viên.',
      );
      final screenshots = IntegrationScreenshotCatalog(
        outputDirectory: screenshotRoot,
        testName: 'live_monitor_angry_handoff',
        boundaryKey: rootKey,
      );

      await _pumpMonitor(tester, rootKey);
      await _expectSessionStatus(tester, sessionId, 'Needs Human');
      await screenshots.capture(
        tester,
        'needs_human',
        target: find.byKey(rootKey),
      );

      await _tapVisible(
        tester,
        find.byKey(LiveMonitorKeys.sessionJoinHumanButton(sessionId)),
      );
      await _expectSessionStatus(tester, sessionId, 'Human Joined');
      await screenshots.capture(
        tester,
        'human_joined',
        target: find.byKey(rootKey),
      );

      await _tapVisible(
        tester,
        find.byKey(LiveMonitorKeys.sessionResumeAiButton(sessionId)),
      );
      await _expectSessionStatus(tester, sessionId, 'AI Handling');
      await screenshots.capture(
        tester,
        'ai_handling',
        target: find.byKey(rootKey),
      );
    },
  );
}

Future<void> _pumpMonitor(WidgetTester tester, GlobalKey rootKey) async {
  await tester.pumpWidget(
    RepaintBoundary(
      key: rootKey,
      child: KfcMonitorApp(key: ValueKey(_seed())),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
  await _waitForVisible(tester, find.byKey(LiveMonitorKeys.operationsHeader));
}

Future<Directory> _prepareScreenshotRoot() async {
  final fallback = Directory(
    '${Directory.systemTemp.path}/kfc-genui-integration-${DateTime.now().millisecondsSinceEpoch}',
  );
  final requested = _screenshotDir.isEmpty
      ? fallback
      : Directory(_screenshotDir);
  await requested.create(recursive: true);
  return requested;
}

Future<void> _waitForText(WidgetTester tester, String text) {
  return _waitForVisible(tester, find.text(text));
}

Future<void> _waitForVisible(WidgetTester tester, Finder finder) async {
  final deadline = DateTime.now().add(const Duration(seconds: 15));
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isNotEmpty) {
      if (await _bringIntoView(tester, finder)) return;
      throw TestFailure('Found $finder but could not bring it into view');
    }
  }
  throw TestFailure('Timed out waiting for $finder');
}

Future<void> _tapVisible(WidgetTester tester, Finder finder) async {
  await _waitForVisible(tester, finder);
  await tester.tap(finder.hitTestable());
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
}

Future<bool> _bringIntoView(WidgetTester tester, Finder finder) async {
  final hitTestable = finder.hitTestable();
  for (var attempt = 0; attempt < 10; attempt++) {
    if (hitTestable.evaluate().isNotEmpty) return true;
    final scrollable = find.byType(SingleChildScrollView);
    if (scrollable.evaluate().isEmpty) return false;

    final rect = tester.getRect(finder.first);
    final viewportHeight =
        tester.view.physicalSize.height / tester.view.devicePixelRatio;
    final delta = rect.top < 72
        ? const Offset(0, 320)
        : rect.bottom > viewportHeight - 16
        ? const Offset(0, -320)
        : Offset.zero;
    if (delta == Offset.zero) return true;
    await tester.drag(scrollable, delta);
    await tester.pump(const Duration(milliseconds: 100));
  }
  return hitTestable.evaluate().isNotEmpty;
}

Future<void> _expectSessionStatus(
  WidgetTester tester,
  String sessionId,
  String label,
) async {
  final finder = find.descendant(
    of: find.byKey(LiveMonitorKeys.sessionCard(sessionId)),
    matching: find.text(label),
  );
  await _waitForVisible(tester, finder);
}

String _seed() => DateTime.now().microsecondsSinceEpoch.toString();

final class BackendSeedClient {
  BackendSeedClient(String baseUrl)
    : _baseUri = Uri.parse(baseUrl),
      _client = http.Client();

  final Uri _baseUri;
  final http.Client _client;

  Future<void> seedMessengerWebhook({
    required String userId,
    required String messageId,
    required String text,
  }) {
    return _postJson('/webhooks/messenger', {
      'object': 'page',
      'entry': [
        {
          'id': '118976205445198',
          'time': DateTime.now().millisecondsSinceEpoch,
          'messaging': [
            {
              'sender': {'id': userId},
              'recipient': {'id': '118976205445198'},
              'timestamp': DateTime.now().millisecondsSinceEpoch,
              'message': {'mid': messageId, 'text': text},
            },
          ],
        },
      ],
    });
  }

  Future<void> seedZaloWebhook({
    required String userId,
    required String messageId,
    required String displayName,
    required String text,
  }) {
    return _postJson('/webhooks/zalo', {
      'event_name': 'user_send_text',
      'app_id': 'zalo_app_local',
      'sender': {
        'id': userId,
        'name': displayName,
        'avatar': 'https://zalo.local/$userId.jpg',
      },
      'recipient': {'id': 'oa_local'},
      'message': {'msg_id': messageId, 'text': text},
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
  }

  Future<void> _postJson(String path, Map<String, Object?> body) async {
    final response = await _client.post(
      _baseUri.resolve(path),
      headers: const {'content-type': 'application/json; charset=utf-8'},
      body: jsonEncode(body),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw TestFailure(
        'Backend seed failed: ${response.statusCode} $path ${response.body}',
      );
    }
  }

  void close() {
    _client.close();
  }
}
