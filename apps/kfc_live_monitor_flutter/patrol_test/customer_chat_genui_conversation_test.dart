import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/app/kfc_customer_chat_app.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_controller.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_state.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';
import 'package:patrol/patrol.dart';

import 'helpers/patrol_screenshot_catalog.dart';

const _backendUrl = String.fromEnvironment(
  'KFC_AGENT_BACKEND_URL',
  defaultValue: 'http://127.0.0.1:18090',
);

void main() {
  const screenshotRootKey = Key('customer_chat.screenshot_root');

  patrolTest('ordering to checkout captures chat GenUI lifecycle', ($) async {
    final seed = DateTime.now().microsecondsSinceEpoch;
    final sessionId = 'web:kfc-customer-patrol-ordering-$seed';
    final customerId = 'web_customer_patrol_ordering_$seed';
    final controller = _backendController(
      sessionId: sessionId,
      customerId: customerId,
    );
    final screenshots = PatrolScreenshotCatalog(
      $,
      'customer_chat_genui_conversation_ordering',
    );

    await _pumpCustomerChat(
      $,
      screenshotRootKey,
      controller: controller,
    );
    await _sendMessage(
      $,
      'Không biết ăn gì, gợi ý combo KFC cho bữa trưa, chưa thêm vào giỏ vội.',
    );
    await _captureVisibleWidget(
      $,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.smartMenuPicker,
      'menu_suggestion_chat',
    );

    await _sendMessage($, 'Thêm Combo Hợp Gu 99K vào giỏ cho mình.');
    await _captureVisibleWidget(
      $,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.cartBuilder,
      'cart_builder_chat',
    );

    await _sendMessage(
      $,
      'Giao tới Số 121 đường Phạm Văn Thuận, P.Tân Tiến, Tp Biên Hòa, tỉnh Đồng Nai.',
    );
    await _captureVisibleWidget(
      $,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.addressFulfillmentCheck,
      'fulfillment_check_chat',
    );

    await _sendMessage($, 'Giao đến địa chỉ này.');
    await _captureVisibleWidget(
      $,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.orderReviewConfirm,
      'order_review_chat',
    );

    await _sendMessage($, 'Xác nhận đơn, thanh toán Momo.');
    await _captureVisibleWidget(
      $,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.paymentOrderStatus,
      'payment_status_chat',
    );
  });

  patrolTest('post payment order tracking captures chat GenUI', ($) async {
    final seed = DateTime.now().microsecondsSinceEpoch;
    await _pumpCustomerChat(
      $,
      screenshotRootKey,
      controller: _backendController(
        sessionId: 'web:kfc-customer-patrol-tracking-$seed',
        customerId: 'web_customer_patrol_tracking_$seed',
      ),
    );
    final screenshots = PatrolScreenshotCatalog(
      $,
      'customer_chat_genui_conversation_tracking',
    );

    await _sendMessage(
      $,
      'Mình đã thanh toán đơn KFC-1024, theo dõi đơn giúp mình.',
    );
    await _captureVisibleWidget(
      $,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.orderTrackingStatus,
      'paid_order_tracking_chat',
    );
  });

  patrolTest('support path captures handoff GenUI in chat', ($) async {
    final seed = DateTime.now().microsecondsSinceEpoch;
    await _pumpCustomerChat(
      $,
      screenshotRootKey,
      controller: _backendController(
        sessionId: 'web:kfc-customer-patrol-support-$seed',
        customerId: 'web_customer_patrol_support_$seed',
      ),
    );
    final screenshots = PatrolScreenshotCatalog(
      $,
      'customer_chat_genui_conversation_support',
    );

    await _sendMessage(
      $,
      'Mình muốn khiếu nại vì đơn bị thiếu món, cho mình gặp nhân viên.',
    );
    await _captureVisibleWidget(
      $,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.supportHandoff,
      'support_handoff_chat',
    );
  });
}

Future<void> _pumpCustomerChat(
  PatrolIntegrationTester $,
  Key screenshotRootKey, {
  CustomerChatController? controller,
}) async {
  await $.pumpWidgetAndSettle(
    RepaintBoundary(
      key: screenshotRootKey,
      child: KfcCustomerChatApp(controller: controller),
    ),
  );
  await $(CustomerChatKeys.screen).waitUntilVisible();
}

CustomerChatController _backendController({
  required String sessionId,
  required String customerId,
}) {
  return CustomerChatController(
    repository: BackendCustomerChatRepository(baseUrl: _backendUrl),
    initialState: CustomerChatState.initial(
      sessionId: sessionId,
      customerId: customerId,
    ),
  );
}

Future<void> _sendMessage(PatrolIntegrationTester $, String text) async {
  final input = find.byKey(CustomerChatKeys.messageInput);
  await $(input).waitUntilVisible();
  await $(input).tap();
  await $.tester.enterText(input, text);
  await $.tester.pumpAndSettle();

  final sendButton = $(CustomerChatKeys.sendButton);
  await sendButton.waitUntilVisible();
  await sendButton.tap();
  await $.tester.pump(const Duration(milliseconds: 250));
}

Future<void> _captureVisibleWidget(
  PatrolIntegrationTester $,
  PatrolScreenshotCatalog screenshots,
  Key screenshotRootKey,
  KfcGenUiWidgetKind kind,
  String label,
) async {
  final widgetFinder = find.byKey(CustomerChatKeys.genUi(kind));
  try {
    await _waitForWidget($, widgetFinder, kind);
  } catch (_) {
    await screenshots.capture(
      '${label}_timeout_waiting_${kind.wireName}',
      target: find.byKey(screenshotRootKey),
    );
    rethrow;
  }
  await Scrollable.ensureVisible(
    widgetFinder.evaluate().first,
    alignment: 0.5,
    duration: const Duration(milliseconds: 250),
  );
  await $.tester.pumpAndSettle();
  await screenshots.capture(label, target: find.byKey(screenshotRootKey));
}

Future<void> _waitForWidget(
  PatrolIntegrationTester $,
  Finder finder,
  KfcGenUiWidgetKind kind,
) async {
  final deadline = DateTime.now().add(const Duration(seconds: 240));
  while (DateTime.now().isBefore(deadline)) {
    await $.tester.pump(const Duration(seconds: 1));
    if (finder.evaluate().isNotEmpty) return;
    final transcript = find.byKey(CustomerChatKeys.transcript);
    if (transcript.evaluate().isNotEmpty) {
      await $.tester.drag(transcript, const Offset(0, -520));
      await $.tester.pump(const Duration(milliseconds: 200));
    }
  }

  throw TestFailure(
    'Timed out waiting for live chat GenUI widget ${kind.wireName}',
  );
}
