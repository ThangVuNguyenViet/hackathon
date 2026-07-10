import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/app/theme/kfc_ops_tokens.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/genui/kfc_genui_renderer.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';

import '../../test_app.dart';

void main() {
  for (final kind in KfcGenUiWidgetKind.values) {
    testWidgets('renders ${kind.wireName}', (tester) async {
      final actions = <KfcGenUiAction>[];
      await tester.pumpWidget(
        TestApp(
          child: KfcGenUiRenderer(
            attachment: kfcGenUiFixture(kind),
            onAction: actions.add,
          ),
        ),
      );

      expect(find.byKey(CustomerChatKeys.genUi(kind)), findsOneWidget);
      expect(find.text(kfcGenUiFixture(kind).title), findsOneWidget);
    });
  }

  testWidgets('order review confirm emits confirm_order action', (
    tester,
  ) async {
    final actions = <KfcGenUiAction>[];
    const attachment = KfcGenUiWidgetKind.orderReviewConfirm;
    final fixture = kfcGenUiFixture(attachment);

    await tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(attachment: fixture, onAction: actions.add),
      ),
    );
    await tester.tap(
      find.byKey(CustomerChatKeys.genUiAction(fixture.id, 'confirm_order')),
    );
    await tester.pump();

    expect(actions.single.actionId, 'confirm_order');
  });

  testWidgets('smart menu picker renders backend menu search items', (
    tester,
  ) async {
    const fixture = KfcGenUiAttachment(
      id: 'backend_menu',
      lifecycleStage: 'menu',
      widgetKind: KfcGenUiWidgetKind.smartMenuPicker,
      status: KfcGenUiStatus.active,
      title: 'Gợi ý món phù hợp',
      data: {
        'items': [
          {'code': '41141', 'name': 'Burger Gà Zinger', 'priceVnd': 55000},
        ],
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'add_item',
          label: 'Thêm vào giỏ',
          intent: KfcGenUiActionIntent.primary,
          value: '41141',
        ),
      ],
    );

    await tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(attachment: fixture, onAction: (_) {}),
      ),
    );

    expect(find.text('Burger Gà Zinger'), findsOneWidget);
    expect(find.text('55.000đ'), findsOneWidget);
  });

  testWidgets(
    'order tracking renders backend order id without optimistic fallbacks',
    (tester) async {
      const fixture = KfcGenUiAttachment(
        id: 'backend_tracking',
        lifecycleStage: 'post_payment',
        widgetKind: KfcGenUiWidgetKind.orderTrackingStatus,
        status: KfcGenUiStatus.active,
        title: 'Theo dõi đơn hàng',
        data: {
          'order': {'id': 'KFC-LIVE-2001'},
          'paymentAttempt': {'status': 'paid'},
          'fulfillment': {},
        },
        actions: [
          KfcGenUiActionSpec(
            id: 'track_order',
            label: 'Theo dõi đơn',
            intent: KfcGenUiActionIntent.primary,
          ),
        ],
      );

      await tester.pumpWidget(
        TestApp(
          child: KfcGenUiRenderer(attachment: fixture, onAction: (_) {}),
        ),
      );

      expect(find.text('KFC-LIVE-2001'), findsOneWidget);
      expect(find.text('preparing'), findsNothing);
      expect(find.text('28 phút'), findsNothing);
    },
  );

  testWidgets(
    'support handoff renders friendly labels for backend reason enums',
    (tester) async {
      const fixture = KfcGenUiAttachment(
        id: 'backend_support',
        lifecycleStage: 'support',
        widgetKind: KfcGenUiWidgetKind.supportHandoff,
        status: KfcGenUiStatus.active,
        title: 'Cần nhân viên hỗ trợ',
        summary: 'payment_failed, customer_requested_human',
        data: {
          'reasons': ['payment_failed', 'customer_requested_human'],
        },
        actions: [
          KfcGenUiActionSpec(
            id: 'request_human',
            label: 'Gặp nhân viên ngay',
            intent: KfcGenUiActionIntent.primary,
          ),
        ],
      );

      await tester.pumpWidget(
        TestApp(
          child: KfcGenUiRenderer(attachment: fixture, onAction: (_) {}),
        ),
      );

      expect(find.text('payment_failed'), findsNothing);
      expect(find.text('customer_requested_human'), findsNothing);
      expect(find.text('Thanh toán gặp lỗi'), findsWidgets);
      expect(find.text('Khách yêu cầu gặp nhân viên'), findsWidgets);
    },
  );

  testWidgets('payment status renders friendly backend status labels', (
    tester,
  ) async {
    const fixture = KfcGenUiAttachment(
      id: 'backend_payment',
      lifecycleStage: 'post_order',
      widgetKind: KfcGenUiWidgetKind.paymentOrderStatus,
      status: KfcGenUiStatus.active,
      title: 'Trạng thái đơn hàng',
      data: {
        'order': {'id': 'KFC-LIVE-2002', 'status': 'preparing'},
        'paymentAttempt': {'status': 'pending', 'amountVnd': 145000},
      },
      actions: [],
    );

    await tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(attachment: fixture, onAction: (_) {}),
      ),
    );

    expect(find.text('preparing'), findsNothing);
    expect(find.text('pending'), findsNothing);
    expect(find.text('Đang chuẩn bị'), findsOneWidget);
    expect(find.text('Chờ thanh toán'), findsOneWidget);
  });

  testWidgets('order tracking renders friendly backend status labels', (
    tester,
  ) async {
    const fixture = KfcGenUiAttachment(
      id: 'backend_tracking_paid',
      lifecycleStage: 'post_payment',
      widgetKind: KfcGenUiWidgetKind.orderTrackingStatus,
      status: KfcGenUiStatus.active,
      title: 'Theo dõi đơn hàng',
      data: {
        'order': {'id': 'KFC-LIVE-2003', 'status': 'preparing'},
        'paymentAttempt': {'status': 'paid'},
        'fulfillment': {},
      },
      actions: [],
    );

    await tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(attachment: fixture, onAction: (_) {}),
      ),
    );

    expect(find.text('preparing'), findsNothing);
    expect(find.text('paid'), findsNothing);
    expect(find.text('Đang chuẩn bị'), findsOneWidget);
    expect(find.text('Đã thanh toán'), findsOneWidget);
  });

  testWidgets('uses action intent instead of action id for primary styling', (
    tester,
  ) async {
    const fixture = KfcGenUiAttachment(
      id: 'fixture_fulfillment',
      lifecycleStage: 'fulfillment',
      widgetKind: KfcGenUiWidgetKind.addressFulfillmentCheck,
      status: KfcGenUiStatus.active,
      title: 'Giao hàng',
      data: {
        'address': '12 Nguyễn Văn Linh, Quận 7',
        'fulfillment': {
          'storeName': 'KFC Nguyễn Văn Linh',
          'etaMinutes': 28,
          'feeVnd': 18000,
        },
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'accept_fulfillment',
          label: 'Giao đến địa chỉ này',
          intent: KfcGenUiActionIntent.primary,
        ),
      ],
    );

    await tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(attachment: fixture, onAction: (_) {}),
      ),
    );

    final actionFinder = find.byKey(
      CustomerChatKeys.genUiAction(fixture.id, 'accept_fulfillment'),
    );
    final box = tester.widget<DecoratedBox>(
      find.descendant(of: actionFinder, matching: find.byType(DecoratedBox)),
    );
    final decoration = box.decoration as BoxDecoration;

    expect(decoration.color, KfcOpsTokens.primary);
  });
}
