import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
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
          child: SingleChildScrollView(
            child: KfcGenUiRenderer(
              attachment: kfcGenUiFixture(kind),
              onAction: actions.add,
            ),
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

  testWidgets('cart controls emit item-specific quantity and removal actions', (
    tester,
  ) async {
    final actions = <KfcGenUiAction>[];
    final fixture = kfcGenUiFixture(KfcGenUiWidgetKind.cartBuilder);
    await tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(attachment: fixture, onAction: actions.add),
      ),
    );

    expect(
      find.byKey(
        CustomerChatKeys.genUiAction(fixture.id, 'update_item_quantity'),
      ),
      findsNothing,
    );
    expect(
      find.byKey(CustomerChatKeys.genUiAction(fixture.id, 'remove_item')),
      findsNothing,
    );
    await tester.tap(
      find.byKey(
        CustomerChatKeys.genUiCartQuantityIncrease(fixture.id, 'combo_zinger'),
      ),
    );
    await tester.tap(
      find.byKey(CustomerChatKeys.genUiCartRemove(fixture.id, 'pepsi_large')),
    );

    expect(actions[0].actionId, 'update_item_quantity');
    expect(actions[0].payload, {'itemCode': 'combo_zinger', 'quantity': 2});
    expect(actions[1].actionId, 'remove_item');
    expect(actions[1].payload, {'itemCode': 'pepsi_large'});
  });

  testWidgets(
    'payment picker selects supported methods and disables unsupported ones',
    (tester) async {
      final actions = <KfcGenUiAction>[];
      final fixture = kfcGenUiFixture(KfcGenUiWidgetKind.paymentMethodPicker);
      await tester.pumpWidget(
        TestApp(
          child: KfcGenUiRenderer(attachment: fixture, onAction: actions.add),
        ),
      );

      await tester.tap(find.text('Ví ZaloPay'));
      expect(actions.single.actionId, 'select_payment_method');
      expect(actions.single.payload, {'methodId': 'zalopay'});

      final momoButton = tester.widget<ShadButton>(
        find.ancestor(
          of: find.text('Ví MoMo'),
          matching: find.byType(ShadButton),
        ),
      );
      expect(momoButton.onPressed, isNull);
    },
  );

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
          id: 'add_items',
          label: 'Xác nhận món',
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

  testWidgets('smart menu picker hides internal group budget metadata', (
    tester,
  ) async {
    const fixture = KfcGenUiAttachment(
      id: 'group_menu',
      lifecycleStage: 'menu',
      widgetKind: KfcGenUiWidgetKind.smartMenuPicker,
      status: KfcGenUiStatus.active,
      title: 'Gợi ý nhóm',
      data: {
        'partySize': 5,
        'budgetVnd': 500000,
        'items': [
          {
            'code': 'combo_1',
            'name': 'Combo nhóm',
            'priceVnd': 100000,
            'recommendedQuantity': 5,
            'composedTotalVnd': 500000,
            'budgetDeltaVnd': 0,
            'servingCoverageVerified': false,
          },
        ],
      },
    );
    await tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(attachment: fixture, onAction: (_) {}),
      ),
    );
    expect(find.text('Gợi ý 5 phần · Tổng 500.000đ · còn 0đ'), findsOneWidget);
    expect(find.textContaining('Nhu cầu:'), findsNothing);
    expect(
      find.textContaining('Khẩu phần chưa có dữ liệu xác minh'),
      findsNothing,
    );
  });

  testWidgets('fulfillment renders a plain string address', (tester) async {
    final fixture = kfcGenUiFixture(KfcGenUiWidgetKind.addressFulfillmentCheck);
    await tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(attachment: fixture, onAction: (_) {}),
      ),
    );
    expect(find.text('12 Nguyễn Văn Linh, Quận 7'), findsOneWidget);
    expect(find.text('-, -, -'), findsNothing);
  });

  testWidgets('smart menu picker emits selected item quantity action', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(800, 1400);
    addTearDown(tester.view.resetPhysicalSize);
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final actions = <KfcGenUiAction>[];
    const fixture = KfcGenUiAttachment(
      id: 'backend_menu_quantity',
      lifecycleStage: 'menu',
      widgetKind: KfcGenUiWidgetKind.smartMenuPicker,
      status: KfcGenUiStatus.active,
      title: 'Gợi ý món phù hợp',
      data: {
        'items': [
          {
            'code': '20751',
            'name': 'Combo Hợp Gu 99K',
            'description': '3 Miếng Gà Rán + 1 Burger Tôm',
            'priceVnd': 99000,
          },
          {'code': '20748', 'name': 'Combo Đẫy Đà 129K', 'priceVnd': 129000},
          {
            'code': 'combo_3',
            'name': 'Combo Tiêu Tung Chill 85K',
            'priceVnd': 85000,
          },
          {
            'code': 'combo_4',
            'name': 'Combo Chanh Sang Chảnh 140K',
            'priceVnd': 140000,
          },
          {
            'code': 'combo_5',
            'name': 'Combo Gà Rôm Rả 245K',
            'priceVnd': 245000,
          },
          {'code': 'combo_6', 'name': 'Combo Cùng Vui', 'priceVnd': 199000},
        ],
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'add_items',
          label: 'Xác nhận món',
          intent: KfcGenUiActionIntent.primary,
        ),
      ],
    );

    await tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(attachment: fixture, onAction: actions.add),
      ),
    );

    expect(find.text('Combo Hợp Gu 99K'), findsOneWidget);
    expect(find.text('Combo Cùng Vui'), findsNothing);
    expect(find.text('Xem thêm 3 món'), findsOneWidget);
    expect(find.text('Xác nhận món'), findsOneWidget);
    expect(find.text('Thêm'), findsNothing);

    final decreaseButton = find.byKey(
      CustomerChatKeys.genUiMenuQuantityDecrease(fixture.id, '20751'),
    );
    final increaseButton = find.byKey(
      CustomerChatKeys.genUiMenuQuantityIncrease(fixture.id, '20751'),
    );
    final confirmButton = find.byKey(
      CustomerChatKeys.genUiAction(fixture.id, 'add_items'),
    );
    expect(tester.getSize(decreaseButton), const Size(32, 32));
    expect(tester.getSize(increaseButton), const Size(32, 32));
    expect(tester.getSize(confirmButton).height, 40);
    expect(tester.getSize(confirmButton).width, lessThanOrEqualTo(152));

    await tester.tap(
      find.byKey(
        CustomerChatKeys.genUiMenuQuantityIncrease(fixture.id, '20751'),
      ),
    );
    await tester.pump();
    await tester.tap(
      find.byKey(
        CustomerChatKeys.genUiMenuQuantityIncrease(fixture.id, '20751'),
      ),
    );
    await tester.pump();
    expect(find.text('2 món'), findsOneWidget);
    expect(find.text('Tạm tính 198.000đ'), findsOneWidget);
    await tester.tap(
      find.byKey(CustomerChatKeys.genUiAction(fixture.id, 'add_items')),
    );
    await tester.pump();

    expect(actions.single.actionId, 'add_items');
    expect(actions.single.payload, {
      'items': [
        {'itemCode': '20751', 'quantity': 2},
      ],
    });
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

  for (final state in {
    'requested': 'Cần nhân viên hỗ trợ',
    'queued': 'Đang kết nối nhân viên KFC',
    'joined': 'Nhân viên KFC đã tham gia',
  }.entries) {
    testWidgets('support handoff renders ${state.key} lifecycle state', (
      tester,
    ) async {
      final fixture = kfcGenUiFixture(KfcGenUiWidgetKind.supportHandoff);
      await tester.pumpWidget(
        TestApp(
          child: KfcGenUiRenderer(
            attachment: fixture,
            handoffStatus: state.key,
            onAction: (_) {},
          ),
        ),
      );

      expect(find.text(state.value), findsOneWidget);
      if (state.key != 'requested') {
        expect(find.text('Gặp nhân viên ngay'), findsNothing);
      }
    });
  }

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

  testWidgets('fulfillment renders a structured address as readable text', (
    tester,
  ) async {
    const fixture = KfcGenUiAttachment(
      id: 'backend_fulfillment_address',
      lifecycleStage: 'fulfillment',
      widgetKind: KfcGenUiWidgetKind.addressFulfillmentCheck,
      status: KfcGenUiStatus.active,
      title: 'Kiểm tra giao hàng',
      data: {
        'address': {
          'label': 'Recent address',
          'line1': '23 Nguyễn Hữu Thọ',
          'district': 'Quận 7',
          'city': 'Hồ Chí Minh',
        },
        'fulfillment': {},
      },
      actions: [],
    );

    await tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(attachment: fixture, onAction: (_) {}),
      ),
    );

    expect(find.text('23 Nguyễn Hữu Thọ, Quận 7, Hồ Chí Minh'), findsOneWidget);
    expect(find.textContaining('label:'), findsNothing);
  });

  testWidgets('payment status hides an unknown zero amount', (tester) async {
    const fixture = KfcGenUiAttachment(
      id: 'backend_payment_unknown_amount',
      lifecycleStage: 'post_order',
      widgetKind: KfcGenUiWidgetKind.paymentOrderStatus,
      status: KfcGenUiStatus.active,
      title: 'Trạng thái đơn hàng',
      data: {
        'order': {
          'id': 'KFC-LIVE-2003',
          'status': 'created',
          'cart': {'totalVnd': 0},
        },
        'paymentAttempt': {'status': 'failed', 'amountVnd': 0},
      },
      actions: [],
    );

    await tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(attachment: fixture, onAction: (_) {}),
      ),
    );

    expect(find.text('Số tiền'), findsNothing);
    expect(find.text('0đ'), findsNothing);
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
