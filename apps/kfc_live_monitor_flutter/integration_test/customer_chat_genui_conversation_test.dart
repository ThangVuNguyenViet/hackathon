import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:crypto/crypto.dart';
import 'package:integration_test/integration_test.dart';
import 'package:kfc_live_monitor/app/kfc_customer_chat_app.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_controller.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_state.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';

import 'support/generated_genui_scenario_capture_data.dart';
import 'support/integration_screenshot_catalog.dart';
import 'support/integration_test_error_filter.dart';

const _backendUrl = String.fromEnvironment('KFC_AGENT_BACKEND_URL');
const _persistedBranchesPath = String.fromEnvironment(
  'KFC_GENUI_PERSISTED_BRANCHES',
);
const _goldenPlanPath = String.fromEnvironment('KFC_GENUI_GOLDEN_PLAN');
const _screenshotDir = String.fromEnvironment('KFC_GENUI_SCREENSHOT_DIR');
const _persistedBranchesSha256 = String.fromEnvironment(
  'KFC_GENUI_PERSISTED_BRANCHES_SHA256',
);
const _expectedRuntimeBinding = String.fromEnvironment(
  'KFC_EXPECTED_RUNTIME_BINDING',
);
const _expectedFlutterRelease = String.fromEnvironment(
  'KFC_EXPECTED_FLUTTER_RELEASE',
);
final _adminToken = Platform.environment['KFC_PROOF_ADMIN_TOKEN'] ?? '';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  ignoreMacOsHardwareKeyboardKeyUpNoise();
  final boundaryKey = GlobalKey();
  late final Directory screenshotRoot;
  late final PersistedBranches branches;
  late final GoldenPlan golden;
  final capturePlan = CapturePlan.fromJson(
    jsonDecode(genUiScenarioCapturePlanJson) as Map<String, dynamic>,
  );

  setUpAll(() async {
    for (final entry in {
      'KFC_AGENT_BACKEND_URL': _backendUrl,
      'KFC_GENUI_PERSISTED_BRANCHES': _persistedBranchesPath,
      'KFC_GENUI_GOLDEN_PLAN': _goldenPlanPath,
      'KFC_GENUI_SCREENSHOT_DIR': _screenshotDir,
      'KFC_GENUI_PERSISTED_BRANCHES_SHA256': _persistedBranchesSha256,
      'KFC_EXPECTED_RUNTIME_BINDING': _expectedRuntimeBinding,
      'KFC_EXPECTED_FLUTTER_RELEASE': _expectedFlutterRelease,
      'KFC_PROOF_ADMIN_TOKEN': _adminToken,
    }.entries) {
      if (entry.value.isEmpty) throw TestFailure('${entry.key} is required');
    }
    screenshotRoot = Directory(_screenshotDir);
    await screenshotRoot.create(recursive: true);
    final persistedBytes = await File(_persistedBranchesPath).readAsBytes();
    expect(sha256.convert(persistedBytes).toString(), _persistedBranchesSha256);
    branches = PersistedBranches.fromJson(
      jsonDecode(utf8.decode(persistedBytes)) as Map<String, dynamic>,
      expectedRuntime: _decodeBinding(_expectedRuntimeBinding),
      expectedFlutter: _decodeBinding(_expectedFlutterRelease),
    );
    golden = GoldenPlan.fromJson(
      jsonDecode(await File(_goldenPlanPath).readAsString())
          as Map<String, dynamic>,
    );
    expect(
      branches.scenarios.map((scenario) => scenario.fileName).toList(),
      capturePlan.scenarios.map((scenario) => scenario.fileName).toList(),
    );
    expect(
      branches.scenarios.fold<int>(
        0,
        (sum, scenario) => sum + scenario.customerTurnCount,
      ),
      44,
    );
  });

  testWidgets(
    'runs the approved golden journey serially as the only Flutter live model journey',
    (tester) async {
      final screenshots = IntegrationScreenshotCatalog(
        outputDirectory: screenshotRoot,
        testName: 'golden',
        boundaryKey: boundaryKey,
      );
      final controller = await _pumpCustomerChat(
        tester,
        boundaryKey,
        sessionId: golden.sessionId,
        customerId: golden.customerId,
      );
      final sentTexts = <String>[];
      for (final (index, operation) in golden.operations.indexed) {
        if (operation.text case final text?) {
          sentTexts.add(text);
          await _sendMessage(tester, controller, text);
        } else if (operation.isControl) {
          await _runTrustedControl(controller, golden, operation);
        } else {
          await _submitGoldenAction(tester, controller, operation);
          if (operation.operation == 'confirm_order') {
            await _bindGoldenLifecycle(controller, golden);
          }
        }
        await screenshots.capture(
          tester,
          'step_${(index + 1).toString().padLeft(2, '0')}_${operation.operation}',
          target: find.byKey(boundaryKey),
        );
      }
      expect(sentTexts, const [
        'Có combo gà cay không?',
        'ZaloPay được không?',
        'Thanh toán xong chưa?',
        'Đơn đang làm chưa?',
        'Bao giờ giao tới?',
      ]);
    },
    timeout: const Timeout(Duration(minutes: 10)),
  );

  for (final scenarioPlan in capturePlan.scenarios) {
    testWidgets(
      'hydrates and renders persisted ${scenarioPlan.fileName} without a model call',
      (tester) async {
        final persisted = branches.scenarios.singleWhere(
          (scenario) => scenario.fileName == scenarioPlan.fileName,
        );
        final screenshots = IntegrationScreenshotCatalog(
          outputDirectory: screenshotRoot,
          testName: 'branch_${persisted.scenarioId}',
          boundaryKey: boundaryKey,
        );
        final controller = await _pumpCustomerChat(
          tester,
          boundaryKey,
          sessionId: persisted.sessionId,
          customerId: persisted.customerId,
          messages: const [],
        );
        final visibleMessages = <CustomerChatMessage>[];
        final seenWidgets = <KfcGenUiWidgetKind>{};
        var capturedTurns = 0;
        for (final pair in persisted.pairs) {
          visibleMessages.add(pair.user.toMessage());
          visibleMessages.add(pair.assistant.toMessage());
          final attachment = pair.genUi;
          if (attachment != null) seenWidgets.add(attachment.widgetKind);
          controller.state.value = CustomerChatState(
            sessionId: persisted.sessionId,
            customerId: persisted.customerId,
            messages: List.unmodifiable(visibleMessages),
          );
          await tester.pumpAndSettle(const Duration(milliseconds: 50));
          if (attachment != null) {
            for (final action in attachment.actions) {
              expect(
                find.byKey(
                  CustomerChatKeys.genUiAction(attachment.id, action.id),
                ),
                findsOneWidget,
                reason:
                    '${persisted.scenarioId} must render persisted action ${action.id}',
              );
            }
          }
          capturedTurns += 1;
          await screenshots.capture(
            tester,
            'turn_${capturedTurns.toString().padLeft(2, '0')}',
            target: find.byKey(boundaryKey),
          );
        }
        expect(capturedTurns, persisted.customerTurnCount);
        expect(
          scenarioPlan.requiredWidgetKinds.where(
            (kind) => !seenWidgets.contains(kind),
          ),
          isEmpty,
        );
      },
      timeout: const Timeout(Duration(minutes: 5)),
    );
  }
}

Future<CustomerChatController> _pumpCustomerChat(
  WidgetTester tester,
  GlobalKey boundaryKey, {
  required String sessionId,
  required String customerId,
  List<CustomerChatMessage>? messages,
}) async {
  final controller = CustomerChatController(
    repository: BackendCustomerChatRepository(baseUrl: _backendUrl),
    initialState: messages == null
        ? CustomerChatState.initial(
            sessionId: sessionId,
            customerId: customerId,
          )
        : CustomerChatState(
            sessionId: sessionId,
            customerId: customerId,
            messages: messages,
          ),
  );
  addTearDown(controller.dispose);
  await tester.pumpWidget(
    RepaintBoundary(
      key: boundaryKey,
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
  await controller.sendDraft();
  expect(controller.state.value.errorMessage, isNull);
  await tester.pumpAndSettle(const Duration(milliseconds: 50));
}

Future<void> _submitGoldenAction(
  WidgetTester tester,
  CustomerChatController controller,
  GoldenOperation operation,
) async {
  final attachment = controller.state.value.activeGenUi;
  if (attachment == null) {
    throw TestFailure('No active GenUI for ${operation.actionId}');
  }
  final offered = attachment.actions
      .where((action) => action.id == operation.actionId)
      .firstOrNull;
  if (offered == null) {
    throw TestFailure(
      '${operation.actionId} is not offered by ${attachment.widgetKind.wireName}',
    );
  }
  await controller.submitAction(
    KfcGenUiAction(
      attachmentId: attachment.id,
      actionId: operation.actionId!,
      value: operation.value ?? offered.value,
      payload: operation.payload.isEmpty ? offered.payload : operation.payload,
    ),
  );
  expect(controller.state.value.errorMessage, isNull);
  await tester.pumpAndSettle(const Duration(milliseconds: 50));
}

Future<void> _runTrustedControl(
  CustomerChatController controller,
  GoldenPlan plan,
  GoldenOperation operation,
) async {
  final orderId = _activeOrderId(controller);
  final events = switch (operation.operation) {
    'advance_payment_paid' => const [
      <String, dynamic>{'type': 'payment_paid'},
    ],
    'advance_order_preparing' => const [
      <String, dynamic>{'type': 'order_preparing'},
    ],
    'advance_order_delivering' => [
      const <String, dynamic>{'type': 'order_ready'},
      <String, dynamic>{
        'type': 'delivery_pending',
        'attemptId': 'golden-delivery-${plan.lifecycleScenarioId}',
        'orderId': orderId,
      },
      const <String, dynamic>{'type': 'delivery_assigned'},
      const <String, dynamic>{'type': 'delivery_started'},
    ],
    _ => throw TestFailure('${operation.operation} is not a control'),
  };
  for (final (index, event) in events.indexed) {
    final revision = operation.expectedRevision! + index;
    final response = await http.post(
      Uri.parse(
        '$_backendUrl/admin/lifecycle/instances/${Uri.encodeComponent(plan.lifecycleScenarioId)}/events',
      ),
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer $_adminToken',
      },
      body: jsonEncode({
        'expectedRevision': revision,
        'idempotencyKey': 'golden:${operation.operation}:$revision',
        'event': event,
      }),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw TestFailure(
        'Trusted control ${operation.operation} failed at revision $revision: '
        '${response.statusCode}',
      );
    }
  }
}

Future<void> _bindGoldenLifecycle(
  CustomerChatController controller,
  GoldenPlan plan,
) async {
  final orderId = _activeOrderId(controller);
  final events = [
    <String, dynamic>{'type': 'order_accepted', 'orderId': orderId},
    <String, dynamic>{
      'type': 'payment_pending',
      'attemptId': 'golden-payment-${plan.lifecycleScenarioId}',
      'orderId': orderId,
    },
  ];
  for (final (revision, event) in events.indexed) {
    final response = await http.post(
      Uri.parse(
        '$_backendUrl/admin/lifecycle/instances/${Uri.encodeComponent(plan.lifecycleScenarioId)}/events',
      ),
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer $_adminToken',
      },
      body: jsonEncode({
        'expectedRevision': revision,
        'idempotencyKey': 'golden:bind-order:$revision',
        'event': event,
      }),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw TestFailure(
        'Golden order lifecycle binding failed at revision $revision: '
        '${response.statusCode}',
      );
    }
  }
}

String _activeOrderId(CustomerChatController controller) {
  Object? find(Object? value) {
    if (value is Map) {
      final orderId = value['orderId'];
      if (orderId is String && orderId.isNotEmpty) return orderId;
      for (final nested in value.values) {
        final found = find(nested);
        if (found != null) return found;
      }
    } else if (value is Iterable) {
      for (final nested in value) {
        final found = find(nested);
        if (found != null) return found;
      }
    }
    return null;
  }

  final orderId = find(controller.state.value.activeGenUi?.data);
  if (orderId is! String) {
    throw TestFailure('Confirmed-order GenUI is missing its real orderId');
  }
  return orderId;
}

class PersistedBranches {
  const PersistedBranches(this.scenarios);

  factory PersistedBranches.fromJson(
    Map<String, dynamic> json, {
    required Map<String, dynamic> expectedRuntime,
    required Map<String, dynamic> expectedFlutter,
  }) {
    if (json['schemaVersion'] != 1 ||
        json['artifactKind'] != 'deployed-persisted-genui-branches' ||
        json['scenarioCount'] != 8 ||
        json['customerTurnCount'] != 44 ||
        _canonicalJson(json['runtime']) != _canonicalJson(expectedRuntime) ||
        _canonicalJson(json['flutter']) != _canonicalJson(expectedFlutter)) {
      throw const FormatException(
        'Persisted branches do not match the expected proof bindings',
      );
    }
    return PersistedBranches(
      (json['scenarios'] as List<dynamic>)
          .map(
            (value) =>
                PersistedScenario.fromJson(value as Map<String, dynamic>),
          )
          .toList(growable: false),
    );
  }

  final List<PersistedScenario> scenarios;
}

class PersistedScenario {
  const PersistedScenario({
    required this.scenarioId,
    required this.fileName,
    required this.sessionId,
    required this.customerId,
    required this.pairs,
  });

  factory PersistedScenario.fromJson(Map<String, dynamic> json) {
    final expectedHash = json['sha256'] as String?;
    final unhashed = Map<String, dynamic>.from(json)..remove('sha256');
    final actualHash = sha256
        .convert(utf8.encode(_canonicalJson(unhashed)))
        .toString();
    if (expectedHash == null || expectedHash != actualHash) {
      throw const FormatException('Persisted scenario hash mismatch');
    }
    final sessionId = json['sessionId'] as String;
    final customerId = json['customerId'] as String;
    final pairs = (json['pairs'] as List<dynamic>)
        .map((value) => PersistedPair.fromJson(value as Map<String, dynamic>))
        .toList(growable: false);
    if (pairs.any(
      (pair) =>
          pair.user.role != 'user' ||
          pair.assistant.role != 'assistant' ||
          pair.user.sessionId != sessionId ||
          pair.assistant.sessionId != sessionId ||
          pair.user.externalUserId != customerId ||
          pair.user.deliveryStatus != 'received' ||
          pair.assistant.deliveryStatus != 'sent',
    )) {
      throw const FormatException('Persisted turn binding mismatch');
    }
    return PersistedScenario(
      scenarioId: json['scenarioId'] as String,
      fileName: json['fileName'] as String,
      sessionId: sessionId,
      customerId: customerId,
      pairs: pairs,
    );
  }

  final String scenarioId;
  final String fileName;
  final String sessionId;
  final String customerId;
  int get customerTurnCount => pairs.length;
  final List<PersistedPair> pairs;
}

class PersistedPair {
  const PersistedPair({
    required this.user,
    required this.assistant,
    this.genUi,
  });

  factory PersistedPair.fromJson(Map<String, dynamic> json) {
    final rawGenUi = json['genUiSnapshot'];
    final rawActions = json['actions'];
    final assistant = json['assistant'] as Map<String, dynamic>;
    final assistantMetadata = assistant['metadata'];
    final assistantGenUi = assistantMetadata is Map
        ? assistantMetadata['genUi']
        : null;
    if (rawActions is! List ||
        _canonicalJson(rawActions) !=
            _canonicalJson(rawGenUi is Map ? rawGenUi['actions'] : const []) ||
        _canonicalJson(rawGenUi) != _canonicalJson(assistantGenUi)) {
      throw const FormatException('Persisted GenUI action binding mismatch');
    }
    return PersistedPair(
      user: PersistedTurn.fromJson(json['user'] as Map<String, dynamic>),
      assistant: PersistedTurn.fromJson(
        json['assistant'] as Map<String, dynamic>,
      ),
      genUi: rawGenUi is Map
          ? _validatedGenUi(Map<String, Object?>.from(rawGenUi))
          : null,
    );
  }

  final PersistedTurn user;
  final PersistedTurn assistant;
  final KfcGenUiAttachment? genUi;
}

class PersistedTurn {
  const PersistedTurn({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.text,
    required this.externalUserId,
    required this.deliveryStatus,
    this.genUi,
  });

  factory PersistedTurn.fromJson(Map<String, dynamic> json) {
    final metadata = json['metadata'] as Map<String, dynamic>?;
    final rawGenUi = metadata?['genUi'];
    return PersistedTurn(
      id: json['id'] as String,
      sessionId: json['sessionId'] as String,
      role: json['role'] as String,
      text: json['text'] as String,
      externalUserId: json['externalUserId'] as String?,
      deliveryStatus: json['deliveryStatus'] as String,
      genUi: rawGenUi is Map
          ? _validatedGenUi(Map<String, Object?>.from(rawGenUi))
          : null,
    );
  }

  final String id;
  final String sessionId;
  final String role;
  final String text;
  final String? externalUserId;
  final String deliveryStatus;
  final KfcGenUiAttachment? genUi;

  CustomerChatMessage toMessage() => CustomerChatMessage(
    id: id,
    role: role == 'user'
        ? CustomerChatRole.customer
        : CustomerChatRole.assistant,
    text: text,
    genUi: genUi,
  );
}

class GoldenPlan {
  const GoldenPlan({
    required this.sessionId,
    required this.customerId,
    required this.lifecycleScenarioId,
    required this.operations,
  });

  factory GoldenPlan.fromJson(Map<String, dynamic> json) => GoldenPlan(
    sessionId: json['sessionId'] as String,
    customerId: json['customerId'] as String,
    lifecycleScenarioId: json['lifecycleScenarioId'] as String,
    operations: (json['operations'] as List<dynamic>)
        .map((value) => GoldenOperation.fromJson(value as Map<String, dynamic>))
        .toList(growable: false),
  );

  final String sessionId;
  final String customerId;
  final String lifecycleScenarioId;
  final List<GoldenOperation> operations;
}

class GoldenOperation {
  const GoldenOperation({
    required this.operation,
    this.text,
    this.actionId,
    this.expectedRevision,
    this.raw = const {},
  });

  factory GoldenOperation.fromJson(Map<String, dynamic> json) =>
      GoldenOperation(
        operation: json['operation'] as String,
        text: json['text'] as String?,
        actionId: json['actionId'] as String?,
        expectedRevision: json['expectedRevision'] as int?,
        raw: Map<String, Object?>.from(json),
      );

  final String operation;
  final String? text;
  final String? actionId;
  final int? expectedRevision;
  final Map<String, Object?> raw;

  bool get isControl => operation.startsWith('advance_');
  String? get value => operation == 'select_zalopay' ? 'zalopay_wallet' : null;
  Map<String, Object?> get payload => switch (operation) {
    'add_approved_combo' => {
      'items': [
        {'itemCode': '20702', 'quantity': 1, 'modifierIds': raw['modifierIds']},
      ],
    },
    'submit_approved_address' => {'address': raw['address']},
    'select_zalopay' => {'methodId': 'zalopay_wallet'},
    _ => const {},
  };
}

class CapturePlan {
  const CapturePlan(this.scenarios);

  factory CapturePlan.fromJson(Map<String, dynamic> json) => CapturePlan(
    (json['scenarios'] as List<dynamic>)
        .map(
          (value) =>
              ScenarioCapturePlan.fromJson(value as Map<String, dynamic>),
        )
        .toList(growable: false),
  );

  final List<ScenarioCapturePlan> scenarios;
}

class ScenarioCapturePlan {
  const ScenarioCapturePlan({
    required this.fileName,
    required this.requiredWidgetKinds,
  });

  factory ScenarioCapturePlan.fromJson(Map<String, dynamic> json) =>
      ScenarioCapturePlan(
        fileName: json['fileName'] as String,
        requiredWidgetKinds:
            (json['requiredWidgetKinds'] as List<dynamic>? ?? const [])
                .map(KfcGenUiWidgetKind.fromJson)
                .whereType<KfcGenUiWidgetKind>()
                .toSet(),
      );

  final String fileName;
  final Set<KfcGenUiWidgetKind> requiredWidgetKinds;
}

Map<String, dynamic> _decodeBinding(String value) =>
    jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(value))))
        as Map<String, dynamic>;

String _canonicalJson(Object? value) => jsonEncode(_sortJson(value));

Object? _sortJson(Object? value) {
  if (value is List) return value.map(_sortJson).toList(growable: false);
  if (value is! Map) return value;
  final keys = value.keys.cast<String>().toList()..sort();
  return {for (final key in keys) key: _sortJson(value[key])};
}

KfcGenUiAttachment _validatedGenUi(Map<String, Object?> json) {
  const snapshotKeys = {
    'id',
    'lifecycleStage',
    'widgetKind',
    'status',
    'title',
    'summary',
    'data',
    'actions',
    'selectedAction',
    'expiresAt',
  };
  const actionKeys = {
    'id',
    'label',
    'intent',
    'value',
    'payload',
    'destructive',
  };
  final actions = json['actions'];
  bool nonEmptyString(Object? value) => value is String && value.isNotEmpty;
  bool record(Object? value) => value is Map;
  if (json.keys.any((key) => !snapshotKeys.contains(key)) ||
      !nonEmptyString(json['id']) ||
      !nonEmptyString(json['lifecycleStage']) ||
      KfcGenUiWidgetKind.fromJson(json['widgetKind']) == null ||
      !const {
        'active',
        'answered',
        'expired',
        'blocked',
      }.contains(json['status']) ||
      !nonEmptyString(json['title']) ||
      !record(json['data']) ||
      (json['summary'] != null && json['summary'] is! String) ||
      (json['selectedAction'] != null && json['selectedAction'] is! String) ||
      (json['expiresAt'] != null && json['expiresAt'] is! String) ||
      actions is! List ||
      actions.any((value) {
        if (value is! Map) return true;
        final action = Map<String, Object?>.from(value);
        return action.keys.any((key) => !actionKeys.contains(key)) ||
            !nonEmptyString(action['id']) ||
            !nonEmptyString(action['label']) ||
            (action['intent'] != null &&
                !const {
                  'primary',
                  'secondary',
                  'destructive',
                  'recovery',
                }.contains(action['intent'])) ||
            (action['value'] != null && action['value'] is! String) ||
            (action['payload'] != null && action['payload'] is! Map) ||
            (action['destructive'] != null && action['destructive'] is! bool);
      })) {
    throw const FormatException('Invalid persisted GenUI snapshot');
  }
  return KfcGenUiAttachment.fromJson(json);
}
