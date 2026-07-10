import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:kfc_live_monitor/app/kfc_customer_chat_app.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_controller.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_state.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';

import 'support/integration_test_error_filter.dart';
import 'support/integration_screenshot_catalog.dart';
import 'support/generated_genui_scenario_capture_data.dart';

const _backendUrl = String.fromEnvironment('KFC_AGENT_BACKEND_URL');
const _screenshotDir = String.fromEnvironment('KFC_GENUI_SCREENSHOT_DIR');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  ignoreMacOsHardwareKeyboardKeyUpNoise();
  final screenshotRootKey = GlobalKey();
  late final Directory screenshotRoot;
  final capturePlan = _loadCapturePlan();

  setUpAll(() async {
    if (_backendUrl.isEmpty) {
      throw TestFailure(
        'KFC_AGENT_BACKEND_URL is required for backend-backed customer chat integration tests.',
      );
    }
    screenshotRoot = await _prepareScreenshotRoot();
    debugPrint('KFC_GENUI_SCREENSHOT_DIR=${screenshotRoot.path}');
  });

  for (final scenarioPlan in capturePlan.scenarios) {
    final script = _loadScenarioScript(scenarioPlan.fileName);
    testWidgets('replays ${script.id} and captures every customer turn', (
      tester,
    ) async {
      final seed = DateTime.now().microsecondsSinceEpoch;
      final screenshots = IntegrationScreenshotCatalog(
        outputDirectory: screenshotRoot,
        testName: 'customer_chat_scenario_${script.id}',
        boundaryKey: screenshotRootKey,
      );
      final controller = await _pumpCustomerChat(
        tester,
        screenshotRootKey,
        sessionId: 'kfc:anon_customer_integration_${script.id}_$seed',
        customerId: 'anon_customer_integration_${script.id}_$seed',
      );

      for (final turn in script.userTurns) {
        await _sendMessage(tester, controller, turn.text);

        final expectedWidget = scenarioPlan.expectedWidgetFor(turn.index);
        await _scrollTranscriptToLatest(tester);
        await screenshots.capture(
          tester,
          _captureLabel(
            turn.index,
            _latestWidget(controller) ?? expectedWidget,
          ),
          target: find.byKey(screenshotRootKey),
        );

        if (expectedWidget != null) {
          await _expectLatestWidget(
            tester,
            controller,
            expectedWidget,
            script.id,
            turn.index,
          );
        }
      }
    });
  }
}

CapturePlan _loadCapturePlan() {
  final json = jsonDecode(genUiScenarioCapturePlanJson) as Map<String, dynamic>;
  return CapturePlan.fromJson(json);
}

ScenarioScript _loadScenarioScript(String fileName) {
  final scenarioJson = genUiScenarioJsonByFileName[fileName];
  if (scenarioJson == null) {
    throw TestFailure(
      'Scenario $fileName is missing from generated test data.',
    );
  }
  final json = jsonDecode(scenarioJson) as Map<String, dynamic>;
  return ScenarioScript.fromJson(json);
}

Future<Directory> _prepareScreenshotRoot() async {
  final fallback = Directory(
    '${Directory.systemTemp.path}/kfc-genui-integration-${DateTime.now().millisecondsSinceEpoch}',
  );
  final requested = _screenshotDir.isEmpty
      ? fallback
      : Directory(_screenshotDir);
  try {
    await requested.create(recursive: true);
    return requested;
  } on FileSystemException catch (error) {
    if (_screenshotDir.isEmpty) rethrow;
    debugPrint('KFC_GENUI_SCREENSHOT_DIR_FALLBACK_REASON=$error');
    await fallback.create(recursive: true);
    return fallback;
  }
}

Future<CustomerChatController> _pumpCustomerChat(
  WidgetTester tester,
  GlobalKey screenshotRootKey, {
  required String sessionId,
  required String customerId,
}) async {
  final controller = CustomerChatController(
    repository: BackendCustomerChatRepository(baseUrl: _backendUrl),
    initialState: CustomerChatState.initial(
      sessionId: sessionId,
      customerId: customerId,
    ),
  );
  addTearDown(controller.dispose);
  await tester.pumpWidget(
    RepaintBoundary(
      key: screenshotRootKey,
      child: KfcCustomerChatApp(controller: controller),
    ),
  );
  await tester.pumpAndSettle();
  expect(find.byKey(CustomerChatKeys.screen), findsOneWidget);
  return controller;
}

Future<void> _sendMessage(
  WidgetTester tester,
  CustomerChatController controller,
  String text,
) async {
  controller.updateDraft(text);
  await tester.pump(const Duration(milliseconds: 50));
  await controller.sendDraft();
  final messages = controller.state.value.messages;
  final lastMessage = messages.isEmpty ? null : messages.last;
  debugPrint(
    'KFC_GENUI_SENT widget=${lastMessage?.genUi?.widgetKind.wireName} '
    'messages=${messages.length} '
    'error=${controller.state.value.errorMessage}',
  );
  expect(controller.state.value.errorMessage, isNull);
  await tester.pump(const Duration(milliseconds: 250));
}

Future<void> _expectLatestWidget(
  WidgetTester tester,
  CustomerChatController controller,
  KfcGenUiWidgetKind expectedWidget,
  String scenarioId,
  int turnIndex,
) async {
  final deadline = DateTime.now().add(const Duration(seconds: 30));
  while (DateTime.now().isBefore(deadline)) {
    final latestAssistant = controller.state.value.messages
        .where((message) => message.role == CustomerChatRole.assistant)
        .lastOrNull;
    if (latestAssistant?.genUi?.widgetKind == expectedWidget) {
      expect(
        latestAssistant!.text.length,
        lessThanOrEqualTo(420),
        reason:
            '$scenarioId turn $turnIndex rendered ${expectedWidget.wireName} with a wall-of-text assistant response.',
      );
      await _bringWidgetIntoView(tester, expectedWidget);
      return;
    }
    await tester.pump(const Duration(milliseconds: 250));
  }

  final latest = controller.state.value.messages
      .where((message) => message.role == CustomerChatRole.assistant)
      .lastOrNull;
  throw TestFailure(
    '$scenarioId turn $turnIndex expected latest GenUI ${expectedWidget.wireName}, '
    'got ${latest?.genUi?.widgetKind.wireName ?? 'none'} with text: ${latest?.text}',
  );
}

KfcGenUiWidgetKind? _latestWidget(CustomerChatController controller) {
  return controller.state.value.messages
      .where((message) => message.role == CustomerChatRole.assistant)
      .lastOrNull
      ?.genUi
      ?.widgetKind;
}

Future<void> _bringWidgetIntoView(
  WidgetTester tester,
  KfcGenUiWidgetKind kind,
) async {
  final widgetFinder = find.byKey(CustomerChatKeys.genUi(kind));
  final hitTestable = widgetFinder.hitTestable();
  for (var attempt = 0; attempt < 8; attempt++) {
    if (hitTestable.evaluate().isNotEmpty) return;
    await _scrollTranscript(tester, const Offset(0, -360));
  }
}

Future<void> _scrollTranscriptToLatest(WidgetTester tester) async {
  for (var attempt = 0; attempt < 3; attempt++) {
    await _scrollTranscript(tester, const Offset(0, -420));
  }
}

Future<void> _scrollTranscript(WidgetTester tester, Offset offset) async {
  final transcript = find.byKey(CustomerChatKeys.transcript);
  if (transcript.evaluate().isEmpty) return;
  await tester.drag(transcript, offset);
  await tester.pump(const Duration(milliseconds: 120));
}

String _captureLabel(int turnIndex, KfcGenUiWidgetKind? widgetKind) {
  return 'turn_${turnIndex.toString().padLeft(2, '0')}_${_widgetToken(widgetKind)}';
}

String _widgetToken(KfcGenUiWidgetKind? widgetKind) {
  if (widgetKind == null) return 'chat';
  return widgetKind.wireName
      .replaceAllMapped(
        RegExp(r'[A-Z]'),
        (match) => '_${match.group(0)!.toLowerCase()}',
      )
      .replaceFirst(RegExp(r'^_'), '');
}

class CapturePlan {
  const CapturePlan({required this.scenarios});

  factory CapturePlan.fromJson(Map<String, dynamic> json) {
    final scenarios = (json['scenarios'] as List<dynamic>? ?? [])
        .map(
          (entry) =>
              ScenarioCapturePlan.fromJson(entry as Map<String, dynamic>),
        )
        .toList(growable: false);
    if (scenarios.isEmpty) {
      throw TestFailure('Capture plan does not contain scenarios.');
    }
    return CapturePlan(scenarios: scenarios);
  }

  final List<ScenarioCapturePlan> scenarios;
}

class ScenarioCapturePlan {
  const ScenarioCapturePlan({
    required this.fileName,
    required this.expectedWidgetsByUserTurn,
  });

  factory ScenarioCapturePlan.fromJson(Map<String, dynamic> json) {
    final expected = <int, KfcGenUiWidgetKind>{};
    final rawExpected =
        json['expectedWidgetsByUserTurn'] as Map<String, dynamic>? ?? {};
    for (final entry in rawExpected.entries) {
      final turnIndex = int.parse(entry.key);
      final kind = KfcGenUiWidgetKind.fromJson(entry.value);
      if (kind == null) {
        throw TestFailure('Unknown GenUI widget kind ${entry.value}');
      }
      expected[turnIndex] = kind;
    }
    return ScenarioCapturePlan(
      fileName: json['fileName'] as String,
      expectedWidgetsByUserTurn: expected,
    );
  }

  final String fileName;
  final Map<int, KfcGenUiWidgetKind> expectedWidgetsByUserTurn;

  KfcGenUiWidgetKind? expectedWidgetFor(int turnIndex) {
    return expectedWidgetsByUserTurn[turnIndex];
  }
}

class ScenarioScript {
  const ScenarioScript({required this.id, required this.userTurns});

  factory ScenarioScript.fromJson(Map<String, dynamic> json) {
    final turns = (json['turns'] as List<dynamic>? ?? [])
        .map((entry) => ScenarioTurn.fromJson(entry as Map<String, dynamic>))
        .where((turn) => turn.speaker == 'User')
        .toList(growable: false);
    if (turns.isEmpty) {
      throw TestFailure('Scenario ${json['id']} does not contain user turns.');
    }
    return ScenarioScript(id: json['id'] as String, userTurns: turns);
  }

  final String id;
  final List<ScenarioTurn> userTurns;
}

class ScenarioTurn {
  const ScenarioTurn({
    required this.index,
    required this.speaker,
    required this.text,
  });

  factory ScenarioTurn.fromJson(Map<String, dynamic> json) {
    return ScenarioTurn(
      index: json['index'] as int,
      speaker: json['speaker'] as String,
      text: json['text'] as String,
    );
  }

  final int index;
  final String speaker;
  final String text;
}
