import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/app/kfc_customer_chat_app.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';
import 'package:patrol/patrol.dart';

import 'helpers/patrol_screenshot_catalog.dart';

void main() {
  const screenshotRootKey = Key('customer_chat.screenshot_root');

  patrolTest('ordering to checkout captures chat GenUI lifecycle', ($) async {
    await _pumpCustomerChat($, screenshotRootKey);
    final screenshots = PatrolScreenshotCatalog(
      $,
      'customer_chat_genui_conversation_ordering',
    );

    await _sendMessage($, 'Không biết ăn gì, gợi ý combo KFC cho bữa trưa.');
    await _captureVisibleWidget(
      $,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.smartMenuPicker,
      'menu_suggestion_chat',
    );

    await _sendMessage($, 'Cho mình Combo Hợp Gu 99K.');
    await _captureVisibleWidget(
      $,
      screenshots,
      screenshotRootKey,
      KfcGenUiWidgetKind.cartBuilder,
      'cart_builder_chat',
    );

    await _sendMessage(
      $,
      'Giao tới 23 Nguyễn Hữu Thọ, phường Tân Hưng, Quận 7, Hồ Chí Minh.',
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
    await _pumpCustomerChat($, screenshotRootKey);
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
    await _pumpCustomerChat($, screenshotRootKey);
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
  Key screenshotRootKey,
) async {
  await $.pumpWidgetAndSettle(
    RepaintBoundary(key: screenshotRootKey, child: const KfcCustomerChatApp()),
  );
  await $(CustomerChatKeys.screen).waitUntilVisible();
}

Future<void> _sendMessage(PatrolIntegrationTester $, String text) async {
  final input = find.byKey(CustomerChatKeys.messageInput);
  await $(input).waitUntilVisible();
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
  await _waitForWidget($, widgetFinder, kind);
  await $(widgetFinder).scrollTo(alignment: Alignment.center);
  await $(widgetFinder).waitUntilVisible(alignment: Alignment.center);
  await screenshots.capture(label, target: find.byKey(screenshotRootKey));
}

Future<void> _waitForWidget(
  PatrolIntegrationTester $,
  Finder finder,
  KfcGenUiWidgetKind kind,
) async {
  final deadline = DateTime.now().add(const Duration(seconds: 120));
  while (DateTime.now().isBefore(deadline)) {
    await $.tester.pump(const Duration(seconds: 1));
    if (finder.evaluate().isNotEmpty) return;
  }

  throw TestFailure(
    'Timed out waiting for live chat GenUI widget ${kind.wireName}',
  );
}
