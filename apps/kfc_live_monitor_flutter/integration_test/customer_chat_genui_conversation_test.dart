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

const _backendUrl = String.fromEnvironment('KFC_AGENT_BACKEND_URL');
const _screenshotDir = String.fromEnvironment('KFC_GENUI_SCREENSHOT_DIR');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  ignoreMacOsHardwareKeyboardKeyUpNoise();
  final screenshotRootKey = GlobalKey();
  late final Directory screenshotRoot;

  setUpAll(() async {
    if (_backendUrl.isEmpty) {
      throw TestFailure(
        'KFC_AGENT_BACKEND_URL is required for backend-backed customer chat integration tests.',
      );
    }
    screenshotRoot = await _prepareScreenshotRoot();
    debugPrint('KFC_GENUI_SCREENSHOT_DIR=${screenshotRoot.path}');
  });

  testWidgets('ordering to checkout captures chat GenUI lifecycle', (
    tester,
  ) async {
    final seed = DateTime.now().microsecondsSinceEpoch;
    final sessionId = 'web:kfc-customer-integration-ordering-$seed';
    final customerId = 'web_customer_integration_ordering_$seed';
    final screenshots = IntegrationScreenshotCatalog(
      outputDirectory: screenshotRoot,
      testName: 'customer_chat_genui_conversation_ordering',
      boundaryKey: screenshotRootKey,
    );

    final controller = await _pumpCustomerChat(
      tester,
      screenshotRootKey,
      sessionId: sessionId,
      customerId: customerId,
    );
    await _sendMessage(
      tester,
      controller,
      'Không biết ăn gì, gợi ý combo KFC cho bữa trưa, chưa thêm vào giỏ vội.',
    );
    await _captureVisibleWidget(
      tester,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.smartMenuPicker,
      'menu_suggestion_chat',
    );

    await _sendMessage(
      tester,
      controller,
      'Thêm Combo Hợp Gu 99K vào giỏ cho mình.',
    );
    await _captureVisibleWidget(
      tester,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.cartBuilder,
      'cart_builder_chat',
    );

    await _sendMessage(
      tester,
      controller,
      'Giao tới Số 121 đường Phạm Văn Thuận, P.Tân Tiến, Tp Biên Hòa, tỉnh Đồng Nai.',
    );
    await _captureVisibleWidget(
      tester,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.addressFulfillmentCheck,
      'fulfillment_check_chat',
    );

    await _sendMessage(tester, controller, 'Giao đến địa chỉ này.');
    await _captureVisibleWidget(
      tester,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.orderReviewConfirm,
      'order_review_chat',
    );

    await _submitAction(tester, controller, 'confirm_order');
    await _captureVisibleWidget(
      tester,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.paymentOrderStatus,
      'payment_status_chat',
    );
  });

  testWidgets('post payment order tracking captures chat GenUI', (
    tester,
  ) async {
    final controller = await _pumpCustomerChat(tester, screenshotRootKey);
    final screenshots = IntegrationScreenshotCatalog(
      outputDirectory: screenshotRoot,
      testName: 'customer_chat_genui_conversation_tracking',
      boundaryKey: screenshotRootKey,
    );

    await _sendMessage(
      tester,
      controller,
      'Mình đã thanh toán đơn KFC-1024, theo dõi đơn giúp mình.',
    );
    await _captureVisibleWidget(
      tester,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.orderTrackingStatus,
      'paid_order_tracking_chat',
    );
  });

  testWidgets('support path captures handoff GenUI in chat', (tester) async {
    final controller = await _pumpCustomerChat(tester, screenshotRootKey);
    final screenshots = IntegrationScreenshotCatalog(
      outputDirectory: screenshotRoot,
      testName: 'customer_chat_genui_conversation_support',
      boundaryKey: screenshotRootKey,
    );

    await _sendMessage(
      tester,
      controller,
      'Mình muốn khiếu nại vì đơn bị thiếu món, cho mình gặp nhân viên.',
    );
    await _captureVisibleWidget(
      tester,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.supportHandoff,
      'support_handoff_chat',
    );
  });
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
  String? sessionId,
  String? customerId,
}) async {
  final controller = CustomerChatController(
    repository: BackendCustomerChatRepository(baseUrl: _backendUrl),
    initialState: sessionId == null || customerId == null
        ? CustomerChatState.initial()
        : CustomerChatState.initial(
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
  await tester.pump(const Duration(milliseconds: 250));
}

Future<void> _submitAction(
  WidgetTester tester,
  CustomerChatController controller,
  String actionId,
) async {
  KfcGenUiAttachment? genUi;
  for (final message in controller.state.value.messages) {
    if (message.genUi != null) {
      genUi = message.genUi;
    }
  }
  if (genUi == null) {
    throw TestFailure('No GenUI attachment is available for action $actionId');
  }
  KfcGenUiActionSpec? spec;
  for (final action in genUi.actions) {
    if (action.id == actionId) {
      spec = action;
      break;
    }
  }
  if (spec == null) {
    throw TestFailure(
      'GenUI attachment ${genUi.id} does not expose action $actionId',
    );
  }
  await controller.submitAction(
    KfcGenUiAction.fromSpec(attachment: genUi, spec: spec),
  );
  final messages = controller.state.value.messages;
  final lastMessage = messages.isEmpty ? null : messages.last;
  debugPrint(
    'KFC_GENUI_ACTION action=$actionId '
    'widget=${lastMessage?.genUi?.widgetKind.wireName} '
    'messages=${messages.length} '
    'error=${controller.state.value.errorMessage}',
  );
  await tester.pump(const Duration(milliseconds: 250));
}

Future<void> _captureVisibleWidget(
  WidgetTester tester,
  IntegrationScreenshotCatalog screenshots,
  GlobalKey screenshotRootKey,
  KfcGenUiWidgetKind kind,
  String label,
) async {
  final widgetFinder = find.byKey(CustomerChatKeys.genUi(kind));
  try {
    await _waitForWidget(tester, widgetFinder, kind);
  } catch (_) {
    await screenshots.capture(
      tester,
      '${label}_timeout_waiting_${kind.wireName}',
      target: find.byKey(screenshotRootKey),
      settle: false,
    );
    rethrow;
  }
  await _bringWidgetIntoView(tester, widgetFinder, kind);
  await tester.pump(const Duration(milliseconds: 300));
  await screenshots.capture(
    tester,
    label,
    target: find.byKey(screenshotRootKey),
  );
}

Future<void> _bringWidgetIntoView(
  WidgetTester tester,
  Finder widgetFinder,
  KfcGenUiWidgetKind kind,
) async {
  final hitTestable = widgetFinder.hitTestable();
  for (var attempt = 0; attempt < 6; attempt++) {
    if (hitTestable.evaluate().isNotEmpty) {
      debugPrint('KFC_GENUI_VISIBLE kind=${kind.wireName} attempt=$attempt');
      return;
    }
    final transcript = find.byKey(CustomerChatKeys.transcript);
    if (transcript.evaluate().isEmpty) break;
    await tester.drag(transcript, const Offset(0, -360));
    await tester.pump(const Duration(milliseconds: 150));
  }
  debugPrint('KFC_GENUI_VISIBLE_UNCONFIRMED kind=${kind.wireName}');
}

Future<void> _waitForWidget(
  WidgetTester tester,
  Finder finder,
  KfcGenUiWidgetKind kind,
) async {
  final deadline = DateTime.now().add(const Duration(seconds: 240));
  var elapsedSeconds = 0;
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(seconds: 1));
    if (finder.evaluate().isNotEmpty) return;
    elapsedSeconds += 1;
    if (elapsedSeconds % 10 == 0) {
      debugPrint(
        'KFC_GENUI_WAIT kind=${kind.wireName} elapsed=${elapsedSeconds}s',
      );
    }
    final transcript = find.byKey(CustomerChatKeys.transcript);
    if (transcript.evaluate().isNotEmpty) {
      await tester.drag(transcript, const Offset(0, -520));
      await tester.pump(const Duration(milliseconds: 200));
    }
  }

  throw TestFailure(
    'Timed out waiting for live chat GenUI widget ${kind.wireName}',
  );
}
