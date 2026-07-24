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
    expect(find.byType(Image), findsOneWidget);
    await tester.tap(
      find.byKey(CustomerChatKeys.genUiAction(fixture.id, 'confirm_order')),
    );
    await tester.pump();

    expect(actions.single.actionId, 'confirm_order');
  });

  testWidgets('cart controls stay local until one atomic update', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 620);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
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
    expect(find.byType(Image), findsNWidgets(2));
    expect(
      tester.getSize(
        find.byKey(
          CustomerChatKeys.genUiCartQuantityDecrease(
            fixture.id,
            'combo_zinger',
          ),
        ),
      ),
      const Size.square(32),
    );
    expect(
      tester.getSize(
        find.byKey(
          CustomerChatKeys.genUiCartQuantityIncrease(
            fixture.id,
            'combo_zinger',
          ),
        ),
      ),
      const Size.square(32),
    );
    await tester.tap(
      find.byKey(
        CustomerChatKeys.genUiCartQuantityIncrease(fixture.id, 'combo_zinger'),
      ),
    );
    await tester.tap(
      find.byKey(CustomerChatKeys.genUiCartRemove(fixture.id, 'pepsi_large')),
    );
    await tester.pump();

    expect(actions, isEmpty);
    expect(find.text('178.000đ'), findsWidgets);
    final update = find.byKey(
      CustomerChatKeys.genUiAction(fixture.id, 'update_cart'),
    );
    expect(update, findsOneWidget);
    await tester.tap(update);
    await tester.pump();

    expect(actions.single.actionId, 'update_cart');
    expect(actions.single.payload, {
      'items': [
        {'itemCode': 'combo_zinger', 'quantity': 2},
        {'itemCode': 'pepsi_large', 'quantity': 0},
      ],
    });
  });

  testWidgets('answered menu collapses to the selected dish quantities', (
    tester,
  ) async {
    final source = kfcGenUiFixture(KfcGenUiWidgetKind.smartMenuPicker);
    final answered = KfcGenUiAttachment(
      id: source.id,
      lifecycleStage: source.lifecycleStage,
      widgetKind: source.widgetKind,
      status: KfcGenUiStatus.answered,
      title: source.title,
      summary: source.summary,
      data: {
        ...source.data,
        '_completedAction': {
          'actionId': 'add_items',
          'payload': {
            'items': [
              {'itemCode': '20751', 'quantity': 2},
            ],
          },
        },
      },
      actions: source.actions,
      selectedAction: 'add_items',
    );

    await tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(attachment: answered, onAction: (_) {}),
      ),
    );

    expect(find.text('Đã hoàn tất · Xác nhận món'), findsOneWidget);
    expect(find.text('2 × Combo Hợp Gu 99K'), findsOneWidget);
    expect(
      find.byKey(CustomerChatKeys.genUiAction(source.id, 'add_items')),
      findsNothing,
    );
    expect(
      find.byKey(
        CustomerChatKeys.genUiMenuQuantityIncrease(source.id, '20751'),
      ),
      findsNothing,
    );
  });

  testWidgets('an older actionable widget collapses to read-only', (
    tester,
  ) async {
    final fixture = kfcGenUiFixture(KfcGenUiWidgetKind.smartMenuPicker);

    await tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(
          attachment: fixture,
          interactive: false,
          onAction: (_) {},
        ),
      ),
    );

    expect(find.text('Nội dung trước đó · chỉ xem'), findsWidgets);
    expect(
      find.byKey(CustomerChatKeys.genUiAction(fixture.id, 'add_items')),
      findsNothing,
    );
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
      expect(actions.single.payload, {'methodId': 'zalopay_wallet'});

      final momoButton = tester.widget<ShadButton>(
        find.ancestor(
          of: find.text('Ví MoMo'),
          matching: find.byType(ShadButton),
        ),
      );
      expect(momoButton.onPressed, isNull);
    },
  );

  testWidgets(
    'payment picker preserves the provider display label without changing method authority',
    (tester) async {
      final actions = <KfcGenUiAction>[];
      const displayName = '  Provider display label  ';
      const fixture = KfcGenUiAttachment(
        id: 'payment-display-authority',
        lifecycleStage: 'payment_method',
        widgetKind: KfcGenUiWidgetKind.paymentMethodPicker,
        status: KfcGenUiStatus.active,
        title: 'Payment',
        data: {
          'paymentMethodCollection': {
            'collectionKey': 'payment:all',
            'collectionRevision': 'collection-revision-1',
            'providerRevision': 'provider-revision-1',
          },
          'methods': [
            {
              'methodId': 'opaque-method',
              'displayName': displayName,
              'supported': true,
              'supportStatus': 'listed_supported',
            },
          ],
        },
        actions: [
          KfcGenUiActionSpec(
            id: 'select_payment_method',
            label: 'Select payment method',
          ),
        ],
      );
      await tester.pumpWidget(
        TestApp(
          child: KfcGenUiRenderer(attachment: fixture, onAction: actions.add),
        ),
      );

      await tester.tap(find.text(displayName));

      expect(actions.single.actionId, 'select_payment_method');
      expect(actions.single.value, displayName);
      expect(actions.single.payload, {'methodId': 'opaque-method'});
      expect(fixture.authorizesAction(actions.single), isTrue);
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
            'category': 'Combo',
            'description': '3 Miếng Gà Rán + 1 Burger Tôm',
            'priceVnd': 99000,
          },
          {
            'code': '20748',
            'name': 'Combo Đẫy Đà 129K',
            'category': 'Combo',
            'priceVnd': 129000,
          },
          {
            'code': 'combo_3',
            'name': 'Combo Tiêu Tung Chill 85K',
            'category': 'Combo',
            'priceVnd': 85000,
          },
          {
            'code': 'combo_4',
            'name': 'Combo Chanh Sang Chảnh 140K',
            'category': 'Combo',
            'priceVnd': 140000,
          },
          {
            'code': 'combo_5',
            'name': 'Combo Gà Rôm Rả 245K',
            'category': 'Combo',
            'priceVnd': 245000,
          },
          {
            'code': 'combo_6',
            'name': 'Combo Cùng Vui',
            'category': 'Combo',
            'priceVnd': 199000,
          },
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
    expect(find.text('Combo Cùng Vui'), findsOneWidget);
    expect(find.textContaining('Xem thêm'), findsNothing);
    expect(find.text('0/5 món khác nhau đã chọn'), findsOneWidget);
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
    'smart menu categories expose every item and cap five distinct selections',
    (tester) async {
      tester.view.physicalSize = const Size(800, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final actions = <KfcGenUiAction>[];
      const fixture = KfcGenUiAttachment(
        id: 'categorized_menu',
        lifecycleStage: 'menu',
        widgetKind: KfcGenUiWidgetKind.smartMenuPicker,
        status: KfcGenUiStatus.active,
        title: 'Toàn bộ thực đơn',
        data: {
          'categories': [
            {'categoryId': 'provider/combo', 'label': 'Combo'},
            {'categoryId': 'provider/drinks', 'label': 'Nước Uống'},
          ],
          'items': [
            {
              'code': 'combo_1',
              'name': 'Combo 1',
              'categoryId': 'provider/combo',
              'category': 'Combo',
              'priceVnd': 100000,
            },
            {
              'code': 'combo_2',
              'name': 'Combo 2',
              'categoryId': 'provider/combo',
              'category': 'Combo',
              'priceVnd': 110000,
            },
            {
              'code': 'combo_3',
              'name': 'Combo 3',
              'categoryId': 'provider/combo',
              'category': 'Combo',
              'priceVnd': 120000,
            },
            {
              'code': 'drink_1',
              'name': 'Nước 1',
              'categoryId': 'provider/drinks',
              'category': 'Nước Uống',
              'priceVnd': 20000,
            },
            {
              'code': 'drink_2',
              'name': 'Nước 2',
              'categoryId': 'provider/drinks',
              'category': 'Nước Uống',
              'priceVnd': 22000,
            },
            {
              'code': 'drink_3',
              'name': 'Nước 3',
              'categoryId': 'provider/drinks',
              'category': 'Nước Uống',
              'priceVnd': 24000,
            },
          ],
          'selectionLimit': 5,
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

      expect(find.text('Combo 1'), findsOneWidget);
      expect(find.text('Combo 3'), findsOneWidget);
      expect(find.text('Nước 1'), findsNothing);
      for (final code in ['combo_1', 'combo_2', 'combo_3']) {
        await tester.tap(
          find.byKey(
            CustomerChatKeys.genUiMenuQuantityIncrease(fixture.id, code),
          ),
        );
        await tester.pump();
      }

      await tester.tap(
        find.byKey(
          CustomerChatKeys.genUiMenuCategory(fixture.id, 'provider/drinks'),
        ),
      );
      await tester.pump();
      expect(find.text('Combo 1'), findsNothing);
      expect(find.text('Nước 1'), findsOneWidget);
      expect(find.text('Nước 3'), findsOneWidget);
      for (final code in ['drink_1', 'drink_2']) {
        await tester.tap(
          find.byKey(
            CustomerChatKeys.genUiMenuQuantityIncrease(fixture.id, code),
          ),
        );
        await tester.pump();
      }

      expect(find.text('5/5 món khác nhau đã chọn'), findsOneWidget);
      final sixthIncrease = tester.widget<ShadIconButton>(
        find.byKey(
          CustomerChatKeys.genUiMenuQuantityIncrease(fixture.id, 'drink_3'),
        ),
      );
      expect(sixthIncrease.enabled, isFalse);

      await tester.tap(
        find.byKey(CustomerChatKeys.genUiAction(fixture.id, 'add_items')),
      );
      await tester.pump();
      expect(actions.single.payload, {
        'items': [
          {'itemCode': 'combo_1', 'quantity': 1},
          {'itemCode': 'combo_2', 'quantity': 1},
          {'itemCode': 'combo_3', 'quantity': 1},
          {'itemCode': 'drink_1', 'quantity': 1},
          {'itemCode': 'drink_2', 'quantity': 1},
        ],
      });
    },
  );

  testWidgets(
    'smart menu keeps duplicate labels distinct and selection stable on rename',
    (tester) async {
      tester.view.physicalSize = const Size(800, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      KfcGenUiAttachment fixture(String secondLabel) => KfcGenUiAttachment(
        id: 'stable_category_identity',
        lifecycleStage: 'menu',
        widgetKind: KfcGenUiWidgetKind.smartMenuPicker,
        status: KfcGenUiStatus.active,
        title: 'Toàn bộ thực đơn',
        data: {
          'categories': [
            {'categoryId': 'provider/category-a', 'label': 'Cùng nhãn'},
            {'categoryId': 'provider/category-b', 'label': secondLabel},
          ],
          'items': const [
            {
              'code': 'item-a',
              'name': 'Món A',
              'categoryId': 'provider/category-a',
              'category': 'Nhãn cũ A',
              'priceVnd': 10000,
            },
            {
              'code': 'item-b',
              'name': 'Món B',
              'categoryId': 'provider/category-b',
              'category': 'Nhãn cũ B',
              'priceVnd': 20000,
            },
          ],
        },
      );

      await tester.pumpWidget(
        TestApp(
          child: KfcGenUiRenderer(
            attachment: fixture('Cùng nhãn'),
            onAction: (_) {},
          ),
        ),
      );

      expect(find.text('Cùng nhãn'), findsNWidgets(2));
      expect(
        find.byKey(
          CustomerChatKeys.genUiMenuCategory(
            'stable_category_identity',
            'provider/category-a',
          ),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(
          CustomerChatKeys.genUiMenuCategory(
            'stable_category_identity',
            'provider/category-b',
          ),
        ),
        findsOneWidget,
      );
      expect(find.text('Món A'), findsOneWidget);
      expect(find.text('Món B'), findsNothing);

      await tester.tap(
        find.byKey(
          CustomerChatKeys.genUiMenuCategory(
            'stable_category_identity',
            'provider/category-b',
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Món A'), findsNothing);
      expect(find.text('Món B'), findsOneWidget);

      await tester.pumpWidget(
        TestApp(
          child: KfcGenUiRenderer(
            attachment: fixture('Nhãn đã đổi'),
            onAction: (_) {},
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Nhãn đã đổi'), findsOneWidget);
      expect(find.text('Món A'), findsNothing);
      expect(find.text('Món B'), findsOneWidget);
    },
  );

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

  testWidgets(
    'payment status keeps durable pending separate from a failed current check',
    (tester) async {
      const fixture = KfcGenUiAttachment(
        id: 'backend_payment_check_failed',
        lifecycleStage: 'post_order',
        widgetKind: KfcGenUiWidgetKind.paymentOrderStatus,
        status: KfcGenUiStatus.active,
        title: 'Trạng thái đơn hàng',
        data: {
          'order': {
            'id': 'KFC-LIVE-2002',
            'status': 'created',
            'paymentStatus': 'pending',
            'amountVnd': 117000,
          },
          'paymentAttempt': {'status': 'pending'},
          'paymentStatusEvidence': {
            'resolution': 'current_tool',
            'statuses': {'order': 'pending', 'paymentAttempt': 'pending'},
            'currentCheck': {
              'executionOutcome': 'error',
              'errorCode': 'payment_failed',
            },
          },
        },
        actions: [],
      );

      await tester.pumpWidget(
        TestApp(
          child: KfcGenUiRenderer(attachment: fixture, onAction: (_) {}),
        ),
      );

      expect(find.text('Chờ thanh toán'), findsOneWidget);
      expect(find.text('117.000đ'), findsOneWidget);
      expect(find.text('Lần kiểm tra gần nhất'), findsOneWidget);
      expect(
        find.text('Không xác minh được trạng thái thanh toán'),
        findsOneWidget,
      );
      expect(find.text('payment_failed'), findsNothing);
      expect(find.text('Thanh toán thất bại'), findsNothing);
    },
  );

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
    expect(tester.getSize(actionFinder).height, 40);
  });
}
