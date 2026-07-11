import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:http/http.dart' as http;
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
const _scenarioFilter = String.fromEnvironment('KFC_GENUI_SCENARIO_FILTER');

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
    if (_scenarioFilter.isNotEmpty &&
        !scenarioPlan.fileName.contains(_scenarioFilter)) {
      continue;
    }
    final script = _loadScenarioScript(scenarioPlan.fileName);
    testWidgets(
      'replays ${script.id} and captures every customer turn',
      (tester) async {
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
        final seenWidgets = <KfcGenUiWidgetKind>{};
        var joinedHandoffCaptured = false;

        for (final turn in script.userTurns) {
          await _sendMessage(tester, controller, turn.text);

          var latestWidget = _latestWidget(controller);
          if (latestWidget != null) {
            seenWidgets.add(latestWidget);
          }
          if (latestWidget == KfcGenUiWidgetKind.addressFulfillmentCheck &&
              scenarioPlan.requiredWidgetKinds.contains(
                KfcGenUiWidgetKind.orderReviewConfirm,
              ) &&
              !seenWidgets.contains(KfcGenUiWidgetKind.orderReviewConfirm)) {
            await _submitLatestAction(
              tester,
              controller,
              screenshots,
              'accept_fulfillment',
              captureKey: 'turn_${turn.index}_accept_fulfillment',
            );
            latestWidget = _latestWidget(controller);
            if (latestWidget != null) seenWidgets.add(latestWidget);
          }
          if (turn == script.userTurns.last &&
              scenarioPlan.requiredWidgetKinds.contains(
                KfcGenUiWidgetKind.paymentOrderStatus,
              )) {
            for (
              var step = 0;
              step < 3 &&
                  !seenWidgets.contains(KfcGenUiWidgetKind.paymentOrderStatus);
              step++
            ) {
              final actionId = switch (latestWidget) {
                KfcGenUiWidgetKind.cartBuilder => 'continue_to_fulfillment',
                KfcGenUiWidgetKind.addressFulfillmentCheck =>
                  'accept_fulfillment',
                KfcGenUiWidgetKind.orderReviewConfirm => 'confirm_order',
                _ => null,
              };
              if (actionId == null) break;
              await _submitLatestAction(
                tester,
                controller,
                screenshots,
                actionId,
                captureKey: 'turn_${turn.index}_step_$step',
              );
              latestWidget = _latestWidget(controller);
              if (latestWidget != null) seenWidgets.add(latestWidget);
            }
          }
          final latestAssistant = controller.state.value.messages
              .where((message) => message.role == CustomerChatRole.assistant)
              .last;
          if (latestAssistant.genUi != null) {
            expect(
              latestAssistant.text.length,
              lessThanOrEqualTo(420),
              reason:
                  '${script.id} turn ${turn.index} rendered ${latestWidget?.wireName} with a wall-of-text assistant response.',
            );
          }
          await screenshots.capture(
            tester,
            _captureLabel(turn.index),
            target: find.byKey(screenshotRootKey),
          );
          if (!joinedHandoffCaptured &&
              script.id == '05-khieu-nai-va-human-handoff' &&
              latestWidget == KfcGenUiWidgetKind.supportHandoff &&
              controller.state.value.handoffStatus == 'queued') {
            await _joinFirstPartyHandoff(tester, controller);
            await screenshots.capture(
              tester,
              'handoff_joined',
              target: find.byKey(screenshotRootKey),
              fileName: 'handoff_joined.png',
            );
            joinedHandoffCaptured = true;
          }
        }

        final missingWidgets = scenarioPlan.requiredWidgetKinds
            .where((kind) => !seenWidgets.contains(kind))
            .map((kind) => kind.wireName)
            .toList(growable: false);
        expect(
          missingWidgets,
          isEmpty,
          reason:
              '${script.id} missed required scenario GenUI widget(s); saw ${seenWidgets.map((kind) => kind.wireName).join(', ')}',
        );
      },
      timeout: const Timeout(Duration(minutes: 20)),
    );
  }
}

Future<void> _joinFirstPartyHandoff(
  WidgetTester tester,
  CustomerChatController controller,
) async {
  final encodedSessionId = Uri.encodeComponent(
    controller.state.value.sessionId,
  );
  final headers = {'content-type': 'application/json'};
  final join = await http.post(
    Uri.parse('$_backendUrl/dashboard/sessions/$encodedSessionId/human-join'),
    headers: headers,
    body: jsonEncode({'agentId': 'integration_agent'}),
  );
  expect(join.statusCode, 200);
  final message = await http.post(
    Uri.parse(
      '$_backendUrl/dashboard/sessions/$encodedSessionId/human-message',
    ),
    headers: headers,
    body: jsonEncode({
      'agentId': 'integration_agent',
      'text': 'Em là nhân viên KFC, em đang kiểm tra trường hợp này.',
    }),
  );
  expect(message.statusCode, 200);

  for (var attempt = 0; attempt < 24; attempt++) {
    await tester.pump(const Duration(milliseconds: 500));
    await Future<void>.delayed(const Duration(milliseconds: 50));
    if (controller.state.value.handoffStatus == 'joined' &&
        controller.state.value.messages.any(
          (turn) => turn.text.contains('Em là nhân viên KFC'),
        )) {
      await tester.pumpAndSettle(const Duration(milliseconds: 50));
      return;
    }
  }
  throw TestFailure('First-party handoff did not reach joined state.');
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
  await tester.pumpAndSettle(const Duration(milliseconds: 50));
}

Future<void> _submitLatestAction(
  WidgetTester tester,
  CustomerChatController controller,
  IntegrationScreenshotCatalog screenshots,
  String actionId, {
  required String captureKey,
}) async {
  final attachment = controller.state.value.messages
      .where((message) => message.role == CustomerChatRole.assistant)
      .last
      .genUi;
  final action = attachment?.actions
      .where((candidate) => candidate.id == actionId)
      .firstOrNull;
  if (action == null) return;

  await controller.submitAction(
    KfcGenUiAction.fromSpec(attachment: attachment!, spec: action),
  );
  debugPrint(
    'KFC_GENUI_ACTION action=$actionId widget=${_latestWidget(controller)?.wireName} '
    'error=${controller.state.value.errorMessage}',
  );
  expect(controller.state.value.errorMessage, isNull);
  await tester.pumpAndSettle(const Duration(milliseconds: 50));
  final widgetKind = _latestWidget(controller);
  if (widgetKind == null) return;
  final scrollable = find.descendant(
    of: find.byKey(CustomerChatKeys.transcript),
    matching: find.byType(Scrollable),
  );
  for (var attempt = 0; attempt < 3; attempt++) {
    final position = tester.state<ScrollableState>(scrollable).position;
    position.jumpTo(position.maxScrollExtent);
    await tester.pump(const Duration(milliseconds: 100));
  }
  await tester.pump(const Duration(milliseconds: 300));
  final file = await screenshots.capture(
    tester,
    'action_${actionId}_${widgetKind.wireName}',
    pumpBeforeCapture: false,
    fileName: 'action_${captureKey}_${actionId}_${widgetKind.wireName}.png',
  );
  debugPrint('KFC_GENUI_ACTION_SCREENSHOT=${file.path}');
}

KfcGenUiWidgetKind? _latestWidget(CustomerChatController controller) {
  return controller.state.value.messages
      .where((message) => message.role == CustomerChatRole.assistant)
      .lastOrNull
      ?.genUi
      ?.widgetKind;
}

String _captureLabel(int turnIndex) {
  return 'turn_${turnIndex.toString().padLeft(2, '0')}';
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
    required this.requiredWidgetKinds,
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
      requiredWidgetKinds: (json['requiredWidgetKinds'] as List<dynamic>? ?? [])
          .map((value) {
            final kind = KfcGenUiWidgetKind.fromJson(value);
            if (kind == null) {
              throw TestFailure('Unknown required GenUI widget kind $value');
            }
            return kind;
          })
          .toSet(),
      expectedWidgetsByUserTurn: expected,
    );
  }

  final String fileName;
  final Set<KfcGenUiWidgetKind> requiredWidgetKinds;
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
