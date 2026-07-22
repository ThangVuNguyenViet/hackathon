import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/genui/kfc_genui_renderer.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../test_app.dart';

const _paymentMethodCollectionAuthority = <String, Object?>{
  'collectionKey': 'payment-methods:all',
  'collectionRevision': 'payment-collection-revision-1',
  'providerRevision': 'payment-provider-revision-1',
};

void main() {
  testWidgets('actionless smart-menu snapshot cannot select or emit', (
    tester,
  ) async {
    final emitted = <KfcGenUiAction>[];
    final attachment = _menu(actions: const []);
    await _pump(tester, attachment, emitted.add);

    final increase = tester.widget<ShadIconButton>(
      find.byKey(
        CustomerChatKeys.genUiMenuQuantityIncrease(attachment.id, '20751'),
      ),
    );
    final confirm = tester.widget<ShadButton>(
      find.byKey(CustomerChatKeys.genUiAction(attachment.id, 'add_items')),
    );
    expect(increase.onPressed, isNull);
    expect(confirm.onPressed, isNull);

    await tester.tap(
      find.byKey(
        CustomerChatKeys.genUiMenuQuantityIncrease(attachment.id, '20751'),
      ),
    );
    await tester.tap(
      find.byKey(CustomerChatKeys.genUiAction(attachment.id, 'add_items')),
    );
    expect(emitted, isEmpty);
  });

  testWidgets('smart-menu emits only through matching bound capability', (
    tester,
  ) async {
    final emitted = <KfcGenUiAction>[];
    final attachment = _menu(
      actions: const [
        KfcGenUiActionSpec(
          id: 'add_items',
          label: 'Xác nhận món',
          payload: {
            'items': [
              {'itemCode': '20751', 'quantity': 1},
            ],
          },
        ),
      ],
    );
    await _pump(tester, attachment, emitted.add);

    await tester.tap(
      find.byKey(
        CustomerChatKeys.genUiMenuQuantityIncrease(attachment.id, '20751'),
      ),
    );
    await tester.pump();
    await tester.tap(
      find.byKey(CustomerChatKeys.genUiAction(attachment.id, 'add_items')),
    );
    expect(emitted.single.payload, {
      'items': [
        {'itemCode': '20751', 'quantity': 1},
      ],
    });

    await tester.tap(
      find.byKey(
        CustomerChatKeys.genUiMenuQuantityIncrease(attachment.id, '20751'),
      ),
    );
    await tester.pump();
    final confirm = tester.widget<ShadButton>(
      find.byKey(CustomerChatKeys.genUiAction(attachment.id, 'add_items')),
    );
    expect(confirm.onPressed, isNull);
  });

  testWidgets('production smart-menu enables verified customizable items', (
    tester,
  ) async {
    final emitted = <KfcGenUiAction>[];
    const attachment = KfcGenUiAttachment(
      id: 'production_menu_eligibility',
      lifecycleStage: 'menu',
      widgetKind: KfcGenUiWidgetKind.smartMenuPicker,
      status: KfcGenUiStatus.active,
      title: 'Chọn món',
      expiresAt: '2099-07-21T00:00:00.000Z',
      authority: KfcGenUiAuthority(
        schemaVersion: 'kfc-genui-v1',
        sessionId: 'kfc:customer_1',
        customerId: 'customer_1',
        verifiedRevision:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        actionLifecycle: 'one_shot',
        issuedAt: '2026-07-19T00:00:00.000Z',
        expiresAt: '2099-07-21T00:00:00.000Z',
      ),
      data: {
        'items': [
          {'code': 'available', 'name': 'Có thể chọn', 'available': true},
          {'code': 'missing_flag', 'name': 'Thiếu cờ'},
          {
            'code': 'customizable',
            'name': 'Cần tùy chỉnh',
            'available': true,
            'isCustomize': true,
            'hasModifiers': true,
          },
        ],
      },
      actions: [KfcGenUiActionSpec(id: 'add_items', label: 'Xác nhận')],
    );
    await _pump(tester, attachment, emitted.add);

    ShadIconButton increase(String itemCode) => tester.widget<ShadIconButton>(
      find.byKey(
        CustomerChatKeys.genUiMenuQuantityIncrease(attachment.id, itemCode),
      ),
    );

    expect(increase('available').onPressed, isNotNull);
    expect(increase('missing_flag').onPressed, isNull);
    expect(increase('customizable').onPressed, isNotNull);
    await tester.tap(
      find.byKey(
        CustomerChatKeys.genUiMenuQuantityIncrease(
          attachment.id,
          'customizable',
        ),
      ),
    );
    await tester.pump();
    expect(
      find.descendant(
        of: find.byKey(
          CustomerChatKeys.genUiMenuQuantity(attachment.id, 'customizable'),
        ),
        matching: find.text('1'),
      ),
      findsOneWidget,
    );
    await tester.tap(
      find.byKey(CustomerChatKeys.genUiAction(attachment.id, 'add_items')),
    );
    expect(emitted.single.payload, {
      'items': [
        {'itemCode': 'customizable', 'quantity': 1},
      ],
    });
  });

  testWidgets('cart rows require matching actions and cap quantity at 99', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 620);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final emitted = <KfcGenUiAction>[];
    final actionless = _cart(quantity: 1, actions: const []);
    await _pump(tester, actionless, emitted.add);

    expect(_cartIncrease(tester, actionless).onPressed, isNull);
    expect(_cartRemove(tester, actionless).onPressed, isNull);
    await tester.tap(
      find.byKey(
        CustomerChatKeys.genUiCartQuantityIncrease(
          actionless.id,
          'combo_zinger',
        ),
      ),
    );
    await tester.tap(
      find.byKey(
        CustomerChatKeys.genUiCartRemove(actionless.id, 'combo_zinger'),
      ),
    );
    expect(emitted, isEmpty);

    final authoritative = _cart(
      quantity: 99,
      actions: const [
        KfcGenUiActionSpec(
          id: 'update_item_quantity',
          label: 'Đổi số lượng',
          payload: {'itemCode': 'combo_zinger'},
        ),
        KfcGenUiActionSpec(
          id: 'remove_item',
          label: 'Xóa món',
          payload: {'itemCode': 'combo_zinger'},
        ),
      ],
    );
    await _pump(tester, authoritative, emitted.add);
    expect(_cartIncrease(tester, authoritative).onPressed, isNull);
    expect(_cartRemove(tester, authoritative).onPressed, isNotNull);
    await tester.tap(
      find.byKey(
        CustomerChatKeys.genUiCartRemove(authoritative.id, 'combo_zinger'),
      ),
    );
    expect(emitted.single.payload, {'itemCode': 'combo_zinger'});
  });

  testWidgets('incoming invalid cart quantities fail closed', (tester) async {
    tester.view.physicalSize = const Size(390, 620);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    const actions = [
      KfcGenUiActionSpec(id: 'update_item_quantity', label: 'Đổi số lượng'),
      KfcGenUiActionSpec(id: 'remove_item', label: 'Xóa món'),
    ];

    for (final quantity in <num>[100, 1.5]) {
      final attachment = _cart(quantity: quantity, actions: actions);
      await _pump(tester, attachment, (_) {});
      expect(_cartIncrease(tester, attachment).onPressed, isNull);
      expect(_cartRemove(tester, attachment).onPressed, isNull);
    }
  });

  testWidgets('smart-menu quantity cannot exceed 99', (tester) async {
    final emitted = <KfcGenUiAction>[];
    final attachment = _menu(
      actions: const [
        KfcGenUiActionSpec(id: 'add_items', label: 'Xác nhận món'),
      ],
    );
    await _pump(tester, attachment, emitted.add);
    final increaseFinder = find.byKey(
      CustomerChatKeys.genUiMenuQuantityIncrease(attachment.id, '20751'),
    );

    for (var quantity = 0; quantity < 99; quantity += 1) {
      await tester.tap(increaseFinder);
      await tester.pump();
    }

    final increase = tester.widget<ShadIconButton>(increaseFinder);
    expect(increase.onPressed, isNull);
    await tester.tap(
      find.byKey(CustomerChatKeys.genUiAction(attachment.id, 'add_items')),
    );
    expect((emitted.single.payload['items']! as List).single, {
      'itemCode': '20751',
      'quantity': 99,
    });
  });

  testWidgets('smart-menu clears local selection when attachment changes', (
    tester,
  ) async {
    const actions = [
      KfcGenUiActionSpec(id: 'add_items', label: 'Xác nhận món'),
    ];
    final first = _menu(actions: actions);
    await _pump(tester, first, (_) {});
    await tester.tap(
      find.byKey(CustomerChatKeys.genUiMenuQuantityIncrease(first.id, '20751')),
    );
    await tester.pump();
    expect(find.text('1 món'), findsOneWidget);

    final replacement = _menu(
      id: 'authority_menu_replacement',
      actions: actions,
    );
    await _pump(tester, replacement, (_) {});

    expect(find.text('0 món'), findsOneWidget);
    final confirm = tester.widget<ShadButton>(
      find.byKey(CustomerChatKeys.genUiAction(replacement.id, 'add_items')),
    );
    expect(confirm.onPressed, isNull);
  });

  testWidgets('a mismatched action value cannot label another cart row', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 620);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final attachment = _cart(
      quantity: 1,
      actions: const [
        KfcGenUiActionSpec(
          id: 'remove_item',
          label: 'Xóa Pepsi',
          value: 'Pepsi lớn',
        ),
      ],
    );
    await _pump(tester, attachment, (_) {});

    expect(_cartRemove(tester, attachment).onPressed, isNull);
  });

  testWidgets('payment methods require exact supported method binding', (
    tester,
  ) async {
    final emitted = <KfcGenUiAction>[];
    final attachment = _payment(
      actions: const [
        KfcGenUiActionSpec(
          id: 'select_payment_method',
          label: 'Chọn COD',
          payload: {'methodId': 'cod'},
        ),
      ],
    );
    await _pump(tester, attachment, emitted.add);

    final zaloButton = tester.widget<ShadButton>(
      find.ancestor(
        of: find.text('Ví ZaloPay'),
        matching: find.byType(ShadButton),
      ),
    );
    expect(zaloButton.onPressed, isNull);
    await tester.tap(find.text('Ví ZaloPay'));
    expect(emitted, isEmpty);

    await tester.tap(find.text('Thanh toán khi nhận hàng'));
    expect(emitted.single.payload, {'methodId': 'cod'});
  });

  testWidgets(
    'payment methods preserve an arbitrary long opaque provider id exactly',
    (tester) async {
      final methodId =
          'ví.điện-tử/α?provider=opaque#${List.filled(300, '長').join()}';
      final emitted = <KfcGenUiAction>[];
      final attachment = KfcGenUiAttachment(
        id: 'payment_opaque_id',
        lifecycleStage: 'payment_method',
        widgetKind: KfcGenUiWidgetKind.paymentMethodPicker,
        status: KfcGenUiStatus.active,
        title: 'Chọn thanh toán',
        data: {
          'paymentMethodCollection': _paymentMethodCollectionAuthority,
          'methods': [
            {
              'methodId': methodId,
              'displayName': 'Opaque provider method',
              'supported': true,
              'supportStatus': 'listed_supported',
            },
          ],
        },
        actions: const [
          KfcGenUiActionSpec(
            id: 'select_payment_method',
            label: 'Chọn phương thức',
          ),
        ],
      );
      await _pump(tester, attachment, emitted.add);

      await tester.tap(find.text('Opaque provider method'));

      expect(emitted.single.payload, {'methodId': methodId});
    },
  );

  testWidgets('payment methods require explicit provider support status', (
    tester,
  ) async {
    final emitted = <KfcGenUiAction>[];
    const attachment = KfcGenUiAttachment(
      id: 'payment_support_status',
      lifecycleStage: 'payment_method',
      widgetKind: KfcGenUiWidgetKind.paymentMethodPicker,
      status: KfcGenUiStatus.active,
      title: 'Chọn thanh toán',
      data: {
        'paymentMethodCollection': _paymentMethodCollectionAuthority,
        'methods': [
          {
            'methodId': 'missing_status',
            'displayName': 'Thiếu trạng thái',
            'supported': true,
          },
          {
            'methodId': 'provider_rejected',
            'displayName': 'Nhà cung cấp từ chối',
            'supported': true,
            'supportStatus': 'not_listed_in_policy',
          },
        ],
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'select_payment_method',
          label: 'Chọn phương thức',
        ),
      ],
    );
    await _pump(tester, attachment, emitted.add);

    for (final label in ['Thiếu trạng thái', 'Nhà cung cấp từ chối']) {
      final button = tester.widget<ShadButton>(
        find.ancestor(of: find.text(label), matching: find.byType(ShadButton)),
      );
      expect(button.onPressed, isNull);
      await tester.tap(find.text(label));
    }
    expect(emitted, isEmpty);
  });

  testWidgets('provisional and terminal-retained attachments cannot emit', (
    tester,
  ) async {
    final emitted = <KfcGenUiAction>[];
    final authoritative = _payment(
      actions: const [
        KfcGenUiActionSpec(
          id: 'select_payment_method',
          label: 'Chọn phương thức',
        ),
      ],
    );

    for (final finality in [
      KfcGenUiInteractionFinality.provisional,
      KfcGenUiInteractionFinality.retainedAfterTerminalFailure,
    ]) {
      await _pump(
        tester,
        authoritative.withInteractionFinality(finality),
        emitted.add,
      );
      final codButton = tester.widget<ShadButton>(
        find.ancestor(
          of: find.text('Thanh toán khi nhận hàng'),
          matching: find.byType(ShadButton),
        ),
      );
      expect(codButton.onPressed, isNull);
      await tester.tap(find.text('Thanh toán khi nhận hàng'));
    }
    expect(emitted, isEmpty);

    await _pump(tester, authoritative, emitted.add);
    await tester.tap(find.text('Ví ZaloPay'));
    expect(emitted.single.payload, {'methodId': 'zalopay'});
  });

  testWidgets('modifier requires exact encoded id and full payload binding', (
    tester,
  ) async {
    final emitted = <KfcGenUiAction>[];
    const modifierData = {
      'modifierTree': {
        'itemCode': 'item_1',
        'modifierGroups': [
          {
            'groupId': 'flavor/size',
            'options': [
              {'modifierId': 'hot spicy', 'name': 'Cay'},
            ],
          },
        ],
      },
    };
    const validAction = KfcGenUiActionSpec(
      id: 'customize_item:flavor%2Fsize:hot%20spicy',
      label: 'Cay',
      value: 'Cay',
      payload: {
        'itemCode': 'item_1',
        'groupId': 'flavor/size',
        'modifierId': 'hot spicy',
      },
    );
    final invalidActions = [
      const KfcGenUiActionSpec(
        id: 'customize_item:wrong:hot%20spicy',
        label: 'Cay',
        value: 'Cay',
        payload: {
          'itemCode': 'item_1',
          'groupId': 'flavor/size',
          'modifierId': 'hot spicy',
        },
      ),
      const KfcGenUiActionSpec(
        id: 'customize_item:flavor%2Fsize:hot%20spicy',
        label: 'Cay',
        value: 'Lựa chọn khác',
        payload: {
          'itemCode': 'item_1',
          'groupId': 'flavor/size',
          'modifierId': 'hot spicy',
        },
      ),
      const KfcGenUiActionSpec(
        id: 'customize_item:flavor%2Fsize:hot%20spicy',
        label: 'Cay',
        value: 'Cay',
        payload: {
          'itemCode': 'other_item',
          'groupId': 'flavor/size',
          'modifierId': 'hot spicy',
        },
      ),
      const KfcGenUiActionSpec(
        id: 'customize_item:flavor%2Fsize:hot%20spicy',
        label: 'Cay',
        value: 'Cay',
        payload: {
          'itemCode': 'item_1',
          'groupId': 'other_group',
          'modifierId': 'hot spicy',
        },
      ),
      const KfcGenUiActionSpec(
        id: 'customize_item:flavor%2Fsize:hot%20spicy',
        label: 'Cay',
        value: 'Cay',
        payload: {
          'itemCode': 'item_1',
          'groupId': 'flavor/size',
          'modifierId': 'other_modifier',
        },
      ),
    ];
    for (final (index, action) in invalidActions.indexed) {
      await _pump(
        tester,
        KfcGenUiAttachment(
          id: 'modifier_invalid_$index',
          lifecycleStage: 'modifier',
          widgetKind: KfcGenUiWidgetKind.modifierPicker,
          status: KfcGenUiStatus.active,
          title: 'Tùy chỉnh',
          data: modifierData,
          actions: [action],
        ),
        emitted.add,
      );
      expect(find.text('Cay'), findsNothing);
    }

    final overlongModifierId = 'x' * 129;
    await _pump(
      tester,
      KfcGenUiAttachment(
        id: 'modifier_overlong',
        lifecycleStage: 'modifier',
        widgetKind: KfcGenUiWidgetKind.modifierPicker,
        status: KfcGenUiStatus.active,
        title: 'Tùy chỉnh',
        data: {
          'modifierTree': {
            'itemCode': 'item_1',
            'modifierGroups': [
              {
                'groupId': 'flavor',
                'options': [
                  {'modifierId': overlongModifierId, 'name': 'Quá dài'},
                ],
              },
            ],
          },
        },
        actions: [
          KfcGenUiActionSpec(
            id: 'customize_item:flavor:$overlongModifierId',
            label: 'Quá dài',
            value: 'Quá dài',
            payload: {
              'itemCode': 'item_1',
              'groupId': 'flavor',
              'modifierId': overlongModifierId,
            },
          ),
        ],
      ),
      emitted.add,
    );
    expect(find.text('Quá dài'), findsNothing);

    const valid = KfcGenUiAttachment(
      id: 'modifier_valid',
      lifecycleStage: 'modifier',
      widgetKind: KfcGenUiWidgetKind.modifierPicker,
      status: KfcGenUiStatus.active,
      title: 'Tùy chỉnh',
      data: modifierData,
      actions: [validAction],
    );
    await _pump(tester, valid, emitted.add);
    await tester.tap(
      find.byKey(
        CustomerChatKeys.genUiModifierOption(
          valid.id,
          'flavor/size',
          'hot spicy',
        ),
      ),
    );
    expect(emitted.single, isA<KfcGenUiAction>());
    expect(emitted.single.actionId, 'customize_item:flavor%2Fsize:hot%20spicy');
    expect(emitted.single.value, 'Cay');
    expect(emitted.single.payload, validAction.payload);
  });
}

Future<void> _pump(
  WidgetTester tester,
  KfcGenUiAttachment attachment,
  ValueChanged<KfcGenUiAction> onAction,
) async {
  await tester.pumpWidget(
    TestApp(
      child: SingleChildScrollView(
        child: KfcGenUiRenderer(attachment: attachment, onAction: onAction),
      ),
    ),
  );
}

KfcGenUiAttachment _menu({
  String id = 'authority_menu',
  required List<KfcGenUiActionSpec> actions,
}) {
  return KfcGenUiAttachment(
    id: id,
    lifecycleStage: 'menu',
    widgetKind: KfcGenUiWidgetKind.smartMenuPicker,
    status: KfcGenUiStatus.active,
    title: 'Chọn món',
    data: const {
      'items': [
        {'code': '20751', 'name': 'Combo Hợp Gu', 'priceVnd': 99000},
      ],
    },
    actions: actions,
  );
}

KfcGenUiAttachment _cart({
  required num quantity,
  required List<KfcGenUiActionSpec> actions,
}) {
  return KfcGenUiAttachment(
    id: 'authority_cart_$quantity',
    lifecycleStage: 'cart',
    widgetKind: KfcGenUiWidgetKind.cartBuilder,
    status: KfcGenUiStatus.active,
    title: 'Giỏ hàng',
    data: {
      'cart': {
        'items': [
          {
            'itemCode': 'combo_zinger',
            'name': 'Combo Zinger',
            'quantity': quantity,
            'unitPriceVnd': 89000,
          },
        ],
      },
    },
    actions: actions,
  );
}

KfcGenUiAttachment _payment({required List<KfcGenUiActionSpec> actions}) {
  return KfcGenUiAttachment(
    id: 'authority_payment',
    lifecycleStage: 'payment_method',
    widgetKind: KfcGenUiWidgetKind.paymentMethodPicker,
    status: KfcGenUiStatus.active,
    title: 'Chọn thanh toán',
    data: const {
      'paymentMethodCollection': _paymentMethodCollectionAuthority,
      'methods': [
        {
          'methodId': 'cod',
          'displayName': 'Thanh toán khi nhận hàng',
          'supported': true,
          'supportStatus': 'listed_supported',
        },
        {
          'methodId': 'zalopay',
          'displayName': 'Ví ZaloPay',
          'supported': true,
          'supportStatus': 'listed_supported',
        },
      ],
    },
    actions: actions,
  );
}

ShadIconButton _cartIncrease(
  WidgetTester tester,
  KfcGenUiAttachment attachment,
) {
  return tester.widget<ShadIconButton>(
    find.byKey(
      CustomerChatKeys.genUiCartQuantityIncrease(attachment.id, 'combo_zinger'),
    ),
  );
}

ShadIconButton _cartRemove(WidgetTester tester, KfcGenUiAttachment attachment) {
  return tester.widget<ShadIconButton>(
    find.byKey(CustomerChatKeys.genUiCartRemove(attachment.id, 'combo_zinger')),
  );
}
