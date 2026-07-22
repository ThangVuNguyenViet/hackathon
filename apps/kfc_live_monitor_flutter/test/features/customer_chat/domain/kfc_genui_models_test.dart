import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';

const _paymentMethodCollectionAuthority = <String, Object?>{
  'collectionKey': 'payment-methods:all',
  'collectionRevision': 'payment-collection-revision-1',
  'providerRevision': 'payment-provider-revision-1',
};

void main() {
  test('parses a backend GenUI attachment', () {
    final attachment = KfcGenUiAttachment.fromJson({
      'id': 'att_1',
      'lifecycleStage': 'checkout',
      'widgetKind': 'orderReviewConfirm',
      'status': 'active',
      'title': 'Xác nhận đơn',
      'data': {
        'cart': {'totalVnd': 145000},
      },
      'actions': [
        {
          'id': 'confirm_order',
          'label': 'Xác nhận',
          'value': 'confirmed',
          'intent': 'primary',
        },
      ],
    });

    expect(attachment.widgetKind, KfcGenUiWidgetKind.orderReviewConfirm);
    expect(attachment.actions.single.id, 'confirm_order');
    expect(attachment.actions.single.intent, KfcGenUiActionIntent.primary);
  });

  test('preserves exact categorized-menu ids independently of labels', () {
    final attachment = KfcGenUiAttachment.fromJson({
      'id': 'categorized_menu',
      'lifecycleStage': 'menu',
      'widgetKind': 'smartMenuPicker',
      'status': 'active',
      'title': 'Toàn bộ thực đơn',
      'data': {
        'categories': [
          {'categoryId': 'provider/category-a', 'label': 'Cùng nhãn'},
          {'categoryId': 'provider/category-b', 'label': 'Cùng nhãn'},
        ],
        'items': [
          {
            'code': 'item-a',
            'name': 'Món A',
            'categoryId': 'provider/category-a',
            'category': 'Nhãn hiển thị cũ A',
          },
          {
            'code': 'item-b',
            'name': 'Món B',
            'categoryId': 'provider/category-b',
            'category': 'Nhãn hiển thị cũ B',
          },
        ],
      },
      'actions': const <Object?>[],
    });

    expect(attachment.data['categories'], [
      {'categoryId': 'provider/category-a', 'label': 'Cùng nhãn'},
      {'categoryId': 'provider/category-b', 'label': 'Cùng nhãn'},
    ]);
    expect(
      (attachment.data['items']! as List<Object?>)
          .map((item) => (item! as Map<Object?, Object?>)['categoryId'])
          .toList(),
      ['provider/category-a', 'provider/category-b'],
    );
  });

  test('defaults missing action intent but rejects malformed semantics', () {
    final missing = KfcGenUiActionSpec.fromJson({
      'id': 'customize_item',
      'label': 'Tùy chỉnh combo',
    });

    expect(missing.intent, KfcGenUiActionIntent.secondary);
    expect(
      () => KfcGenUiActionSpec.fromJson({
        'id': 'customize_item',
        'label': 'Tùy chỉnh combo',
        'intent': 'unexpected',
      }),
      throwsFormatException,
    );
    expect(
      () => KfcGenUiActionSpec.fromJson({
        'id': 'customize_item',
        'label': 'Tùy chỉnh combo',
        'destructive': 'false',
      }),
      throwsFormatException,
    );
  });

  test('rejects unknown widget kinds', () {
    expect(
      () => KfcGenUiAttachment.fromJson({
        'id': 'att_bad',
        'lifecycleStage': 'bad',
        'widgetKind': 'unknown',
        'status': 'active',
        'title': 'Bad',
        'data': <String, Object?>{},
        'actions': const <Object?>[],
      }),
      throwsFormatException,
    );
  });

  test('unknown attachment status fails closed for actions', () {
    final attachment = KfcGenUiAttachment.fromJson({
      'id': 'att_unknown_status',
      'lifecycleStage': 'checkout',
      'widgetKind': 'orderReviewConfirm',
      'status': 'new_backend_status',
      'title': 'Xác nhận đơn',
      'data': <String, Object?>{},
      'actions': [
        {'id': 'confirm_order', 'label': 'Xác nhận'},
      ],
    });

    expect(attachment.status, KfcGenUiStatus.blocked);
    expect(attachment.canSubmitActions, isFalse);
    expect(attachment.actionableActions, isEmpty);
  });

  test(
    'action binding rejects duplicate ids and mismatched payload bindings',
    () {
      const duplicate = KfcGenUiAttachment(
        id: 'att_duplicate',
        lifecycleStage: 'payment_method',
        widgetKind: KfcGenUiWidgetKind.paymentMethodPicker,
        status: KfcGenUiStatus.active,
        title: 'Thanh toán',
        actions: [
          KfcGenUiActionSpec(id: 'select_payment_method', label: 'Chọn một'),
          KfcGenUiActionSpec(id: 'select_payment_method', label: 'Chọn hai'),
        ],
      );
      const bound = KfcGenUiAttachment(
        id: 'att_bound',
        lifecycleStage: 'payment_method',
        widgetKind: KfcGenUiWidgetKind.paymentMethodPicker,
        status: KfcGenUiStatus.active,
        title: 'Thanh toán',
        data: {
          'paymentMethodCollection': _paymentMethodCollectionAuthority,
          'methods': [
            {
              'methodId': 'cod',
              'displayName': 'COD',
              'supported': true,
              'supportStatus': 'listed_supported',
            },
          ],
        },
        actions: [
          KfcGenUiActionSpec(
            id: 'select_payment_method',
            label: 'Chọn COD',
            payload: {'methodId': 'cod'},
          ),
        ],
      );

      expect(
        duplicate.bindAction(
          actionId: 'select_payment_method',
          payload: {'methodId': 'cod'},
        ),
        isNull,
      );
      expect(
        bound.bindAction(
          actionId: 'select_payment_method',
          payload: {'methodId': 'zalopay'},
        ),
        isNull,
      );
      expect(
        bound
            .bindAction(
              actionId: 'select_payment_method',
              payload: {'methodId': 'cod'},
            )
            ?.payload,
        {'methodId': 'cod'},
      );
    },
  );

  test('bound action identifiers match backend canonical limits', () {
    const menu = KfcGenUiAttachment(
      id: 'att_menu',
      lifecycleStage: 'menu',
      widgetKind: KfcGenUiWidgetKind.smartMenuPicker,
      status: KfcGenUiStatus.active,
      title: 'Chọn món',
      data: {
        'items': [
          {'code': 'sku', 'name': 'Món hợp lệ'},
        ],
      },
      actions: [KfcGenUiActionSpec(id: 'add_items', label: 'Xác nhận')],
    );
    const invalidDetail = KfcGenUiAttachment(
      id: 'att_detail',
      lifecycleStage: 'menu',
      widgetKind: KfcGenUiWidgetKind.productDetailCard,
      status: KfcGenUiStatus.active,
      title: 'Chi tiết',
      data: {
        'item': {'code': 'sku', 'name': 'Món hợp lệ'},
        'items': [
          {'code': 'sku', 'name': 'Món hợp lệ'},
        ],
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'add_item',
          label: 'Thêm',
          payload: {'itemCode': 'sku', 'quantity': 100},
        ),
      ],
    );

    expect(
      menu.bindAction(
        actionId: 'add_items',
        payload: {
          'items': [
            {'itemCode': 'sku', 'quantity': 1},
            {'itemCode': ' sku ', 'quantity': 1},
          ],
        },
      ),
      isNull,
    );
    expect(
      menu.bindAction(
        actionId: 'add_items',
        payload: {
          'items': [
            {'itemCode': 'x' * 129, 'quantity': 1},
          ],
        },
      ),
      isNull,
    );
    expect(invalidDetail.canSubmitActions, isFalse);
    expect(invalidDetail.actionableActions, isEmpty);
    expect(
      invalidDetail.authorizesAction(
        const KfcGenUiAction(
          attachmentId: 'att_detail',
          actionId: 'add_item',
          payload: {'itemCode': 'sku', 'quantity': 100},
        ),
      ),
      isFalse,
    );
  });

  test('opaque provider ids share the backend exact-value bounds', () {
    KfcGenUiAttachment paymentWithId(String methodId) => KfcGenUiAttachment(
      id: 'opaque_payment',
      lifecycleStage: 'payment_method',
      widgetKind: KfcGenUiWidgetKind.paymentMethodPicker,
      status: KfcGenUiStatus.active,
      title: 'Thanh toán',
      data: {
        'paymentMethodCollection': _paymentMethodCollectionAuthority,
        'methods': [
          {
            'methodId': methodId,
            'displayName': 'Opaque method',
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

    for (final accepted in [
      'provider/α?${List.filled(512, '長').join()}#opaque',
      List.filled(2048, 'x').join(),
      List.filled(1024, '🧾').join(),
      'provider\u0085method',
      '\u180eprovider',
    ]) {
      expect(
        paymentWithId(accepted)
            .bindAction(
              actionId: 'select_payment_method',
              payload: {'methodId': accepted},
            )
            ?.payload,
        {'methodId': accepted},
      );
    }
    final protocolWhitespace = [
      '\u0009',
      '\u000a',
      '\u000d',
      '\u0020',
      '\u0085',
      '\u00a0',
      '\u1680',
      '\u2000',
      '\u200a',
      '\u2028',
      '\u2029',
      '\u202f',
      '\u205f',
      '\u3000',
      '\ufeff',
    ];
    for (final rejected in [
      ' leading-space',
      'trailing-space ',
      List.filled(2049, 'x').join(),
      '${List.filled(1024, '🧾').join()}x',
      String.fromCharCode(0xd800),
      String.fromCharCode(0xdc00),
      'provider-${String.fromCharCode(0xd800)}-method',
      'provider-${String.fromCharCode(0xdc00)}-method',
      for (final space in protocolWhitespace) '$space${'provider'}',
      for (final space in protocolWhitespace) '${'provider'}$space',
    ]) {
      expect(
        paymentWithId(rejected).bindAction(
          actionId: 'select_payment_method',
          payload: {'methodId': rejected},
        ),
        isNull,
      );
    }
  });

  test('payment actions require one exact collection authority tuple', () {
    for (final authority in <Object?>[
      null,
      const {
        'collectionKey': 'payment:all',
        'collectionRevision': 'collection-revision',
      },
      const {
        'collectionKey': 'payment:all',
        'collectionRevision': 'collection-revision',
        'providerRevision': 'provider-revision',
        'extra': 'not-authority',
      },
      const {
        'collectionKey': ' payment:all',
        'collectionRevision': 'collection-revision',
        'providerRevision': 'provider-revision',
      },
    ]) {
      final data = <String, Object?>{
        'methods': const [
          {
            'methodId': 'provider/opaque',
            'displayName': 'Opaque method',
            'supported': true,
            'supportStatus': 'listed_supported',
          },
        ],
      };
      if (authority != null) {
        data['paymentMethodCollection'] = authority;
      }
      final payment = KfcGenUiAttachment(
        id: 'payment_collection_authority',
        lifecycleStage: 'payment_method',
        widgetKind: KfcGenUiWidgetKind.paymentMethodPicker,
        status: KfcGenUiStatus.active,
        title: 'Thanh toán',
        data: data,
        actions: const [
          KfcGenUiActionSpec(
            id: 'select_payment_method',
            label: 'Chọn phương thức',
          ),
        ],
      );

      expect(payment.canSubmitActions, isFalse);
      expect(
        payment.bindAction(
          actionId: 'select_payment_method',
          payload: const {'methodId': 'provider/opaque'},
        ),
        isNull,
      );
    }
  });

  test('dynamic actions require exact unique attachment data membership', () {
    const menu = KfcGenUiAttachment(
      id: 'menu_membership',
      lifecycleStage: 'menu',
      widgetKind: KfcGenUiWidgetKind.smartMenuPicker,
      status: KfcGenUiStatus.active,
      title: 'Chọn món',
      data: {
        'items': [
          {'code': 'sku_1', 'name': 'Món một'},
        ],
      },
      actions: [KfcGenUiActionSpec(id: 'add_items', label: 'Xác nhận')],
    );
    const duplicateCart = KfcGenUiAttachment(
      id: 'duplicate_cart',
      lifecycleStage: 'cart',
      widgetKind: KfcGenUiWidgetKind.cartBuilder,
      status: KfcGenUiStatus.active,
      title: 'Giỏ hàng',
      data: {
        'cart': {
          'items': [
            {'itemCode': 'sku_1', 'name': 'Món một', 'quantity': 1},
            {'itemCode': 'sku_1', 'name': 'Món trùng', 'quantity': 1},
          ],
        },
      },
      actions: [KfcGenUiActionSpec(id: 'remove_item', label: 'Xóa')],
    );
    const payment = KfcGenUiAttachment(
      id: 'payment_membership',
      lifecycleStage: 'payment_method',
      widgetKind: KfcGenUiWidgetKind.paymentMethodPicker,
      status: KfcGenUiStatus.active,
      title: 'Thanh toán',
      data: {
        'paymentMethodCollection': _paymentMethodCollectionAuthority,
        'methods': [
          {
            'methodId': 'cod',
            'displayName': 'COD',
            'supported': true,
            'supportStatus': 'listed_supported',
          },
          {
            'methodId': 'unsupported',
            'displayName': 'Không hỗ trợ',
            'supported': false,
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
    const duplicatePayment = KfcGenUiAttachment(
      id: 'duplicate_payment',
      lifecycleStage: 'payment_method',
      widgetKind: KfcGenUiWidgetKind.paymentMethodPicker,
      status: KfcGenUiStatus.active,
      title: 'Thanh toán',
      data: {
        'paymentMethodCollection': _paymentMethodCollectionAuthority,
        'methods': [
          {
            'methodId': 'cod',
            'displayName': 'COD',
            'supported': true,
            'supportStatus': 'listed_supported',
          },
          {
            'methodId': 'cod',
            'displayName': 'COD trùng',
            'supported': true,
            'supportStatus': 'listed_supported',
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
    const detail = KfcGenUiAttachment(
      id: 'detail_membership',
      lifecycleStage: 'menu',
      widgetKind: KfcGenUiWidgetKind.productDetailCard,
      status: KfcGenUiStatus.active,
      title: 'Chi tiết',
      data: {
        'item': {'code': 'sku_1', 'name': 'Món một'},
        'items': [
          {'code': 'sku_1', 'name': 'Món một'},
        ],
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'add_item',
          label: 'Thêm',
          payload: {'itemCode': 'sku_1'},
        ),
      ],
    );

    expect(
      menu.bindAction(
        actionId: 'add_items',
        payload: {
          'items': [
            {'itemCode': 'unknown', 'quantity': 1},
          ],
        },
      ),
      isNull,
    );
    expect(duplicateCart.canSubmitActions, isFalse);
    expect(duplicatePayment.canSubmitActions, isFalse);
    expect(
      payment.bindAction(
        actionId: 'select_payment_method',
        payload: {'methodId': 'unknown'},
      ),
      isNull,
    );
    expect(
      payment.bindAction(
        actionId: 'select_payment_method',
        payload: {'methodId': 'unsupported'},
      ),
      isNull,
    );
    expect(detail.canSubmitActions, isFalse);
    expect(detail.actionableActions, isEmpty);
  });

  test(
    'action manifests close unknown, wrong-widget, and unbound modifier ids',
    () {
      const wrongWidget = KfcGenUiAttachment(
        id: 'wrong_widget',
        lifecycleStage: 'menu',
        widgetKind: KfcGenUiWidgetKind.smartMenuPicker,
        status: KfcGenUiStatus.active,
        title: 'Chọn món',
        data: {
          'items': [
            {'code': 'sku_1', 'name': 'Món một'},
          ],
        },
        actions: [KfcGenUiActionSpec(id: 'confirm_order', label: 'Sai bề mặt')],
      );
      const unknown = KfcGenUiAttachment(
        id: 'unknown_action',
        lifecycleStage: 'checkout',
        widgetKind: KfcGenUiWidgetKind.orderReviewConfirm,
        status: KfcGenUiStatus.active,
        title: 'Xác nhận',
        actions: [
          KfcGenUiActionSpec(id: 'future_unknown_action', label: 'Không rõ'),
        ],
      );
      const unboundModifier = KfcGenUiAttachment(
        id: 'unbound_modifier',
        lifecycleStage: 'modifier',
        widgetKind: KfcGenUiWidgetKind.modifierPicker,
        status: KfcGenUiStatus.active,
        title: 'Tùy chỉnh',
        data: {
          'modifierTree': {
            'itemCode': 'sku_1',
            'modifierGroups': [
              {
                'groupId': 'flavor',
                'options': [
                  {'modifierId': 'spicy', 'name': 'Cay'},
                ],
              },
            ],
          },
        },
        actions: [
          KfcGenUiActionSpec(
            id: 'customize_item:flavor:spicy',
            label: 'Cay',
            value: 'Lựa chọn khác',
            payload: {
              'itemCode': 'sku_1',
              'groupId': 'flavor',
              'modifierId': 'spicy',
            },
          ),
        ],
      );

      for (final attachment in [wrongWidget, unknown, unboundModifier]) {
        expect(attachment.canSubmitActions, isFalse);
        expect(attachment.actionableActions, isEmpty);
      }
    },
  );

  test(
    'production menu authority enforces eligibility and data.items source',
    () {
      const authority = KfcGenUiAuthority(
        schemaVersion: 'kfc-genui-v1',
        sessionId: 'kfc:customer_1',
        customerId: 'customer_1',
        verifiedRevision:
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        actionLifecycle: 'one_shot',
        issuedAt: '2026-07-19T00:00:00.000Z',
        expiresAt: '2099-07-21T00:00:00.000Z',
      );
      const menu = KfcGenUiAttachment(
        id: 'production_menu',
        lifecycleStage: 'menu',
        widgetKind: KfcGenUiWidgetKind.smartMenuPicker,
        status: KfcGenUiStatus.active,
        title: 'Chọn món',
        expiresAt: '2099-07-21T00:00:00.000Z',
        authority: authority,
        data: {
          'items': [
            {'code': 'available', 'name': 'Có thể chọn', 'available': true},
            {'code': 'missing_flag', 'name': 'Thiếu cờ'},
            {'code': 'unavailable', 'name': 'Hết món', 'available': false},
            {
              'code': 'customizable',
              'name': 'Cần tùy chỉnh',
              'available': true,
              'isCustomize': true,
            },
            {
              'code': 'has_modifiers',
              'name': 'Có modifier',
              'available': true,
              'hasModifiers': true,
            },
          ],
        },
        actions: [KfcGenUiActionSpec(id: 'add_items', label: 'Xác nhận')],
      );
      const detailWithoutItems = KfcGenUiAttachment(
        id: 'detail_without_items',
        lifecycleStage: 'menu',
        widgetKind: KfcGenUiWidgetKind.productDetailCard,
        status: KfcGenUiStatus.active,
        title: 'Chi tiết',
        expiresAt: '2099-07-21T00:00:00.000Z',
        authority: authority,
        data: {
          'item': {
            'code': 'available',
            'name': 'Có thể chọn',
            'available': true,
          },
        },
        actions: [
          KfcGenUiActionSpec(
            id: 'add_item',
            label: 'Thêm',
            value: 'Có thể chọn',
            payload: {'itemCode': 'available', 'quantity': 1},
          ),
        ],
      );

      expect(
        menu.bindAction(
          actionId: 'add_items',
          payload: {
            'items': [
              {'itemCode': 'available', 'quantity': 1},
            ],
          },
        ),
        isNotNull,
      );
      for (final itemCode in [
        'missing_flag',
        'unavailable',
        'customizable',
        'has_modifiers',
      ]) {
        expect(
          menu.bindAction(
            actionId: 'add_items',
            payload: {
              'items': [
                {'itemCode': itemCode, 'quantity': 1},
              ],
            },
          ),
          isNull,
          reason: itemCode,
        );
      }
      expect(detailWithoutItems.canSubmitActions, isFalse);
    },
  );

  test('preserves valid action authority and rejects malformed encoding', () {
    final valid = KfcGenUiAttachment.fromJson({
      'id': 'att_authority',
      'lifecycleStage': 'checkout',
      'widgetKind': 'orderReviewConfirm',
      'status': 'active',
      'title': 'Xác nhận đơn',
      'expiresAt': '2099-07-21T00:00:00.000Z',
      'data': <String, Object?>{},
      'actions': [
        {'id': 'confirm_order', 'label': 'Xác nhận'},
      ],
      'authority': {
        'schemaVersion': 'kfc-genui-v1',
        'sessionId': 'kfc:customer_1',
        'customerId': 'customer_1',
        'verifiedRevision':
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'actionLifecycle': 'one_shot',
        'issuedAt': '2026-07-19T00:00:00.000Z',
        'expiresAt': '2099-07-21T00:00:00.000Z',
      },
    });
    final malformed = KfcGenUiAttachment.fromJson({
      'id': 'att_bad_authority',
      'lifecycleStage': 'checkout',
      'widgetKind': 'orderReviewConfirm',
      'status': 'active',
      'title': 'Xác nhận đơn',
      'expiresAt': '2099-07-21T00:00:00.000Z',
      'data': <String, Object?>{},
      'actions': [
        {'id': 'confirm_order', 'label': 'Xác nhận'},
      ],
      'authority': {
        'schemaVersion': 'unexpected',
        'sessionId': 'kfc:customer_1',
      },
    });

    expect(valid.canSubmitActions, isTrue);
    expect(
      valid.authority?.verifiedRevision,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(valid.toJson()['authority'], isA<Map<String, Object?>>());
    expect(
      valid.authorityMatches(
        sessionId: 'kfc:customer_1',
        customerId: 'customer_1',
      ),
      isTrue,
    );
    expect(
      valid.authorityMatches(
        sessionId: 'kfc:another_customer',
        customerId: 'another_customer',
      ),
      isFalse,
    );
    expect(malformed.hasValidAuthorityEncoding, isFalse);
    expect(malformed.canSubmitActions, isFalse);
  });

  test('wire actions require authority unless fixture decoding opts in', () {
    final wire = {
      'id': 'att_missing_authority',
      'lifecycleStage': 'checkout',
      'widgetKind': 'orderReviewConfirm',
      'status': 'active',
      'title': 'Xác nhận đơn',
      'data': <String, Object?>{},
      'actions': [
        {'id': 'confirm_order', 'label': 'Xác nhận'},
      ],
    };

    expect(KfcGenUiAttachment.fromJson(wire).canSubmitActions, isFalse);
    expect(
      KfcGenUiAttachment.fromJson(
        wire,
        allowLegacyActionAuthority: true,
      ).canSubmitActions,
      isTrue,
    );
  });

  test('strict authority rejects altered fields and future issuance', () {
    const digest =
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    final base = <String, Object?>{
      'schemaVersion': 'kfc-genui-v1',
      'sessionId': 'kfc:customer_1',
      'customerId': 'customer_1',
      'verifiedRevision': digest,
      'actionLifecycle': 'one_shot',
      'issuedAt': '2026-07-19T00:00:00.000Z',
      'expiresAt': '2099-07-21T00:00:00.000Z',
    };

    for (final invalidAuthority in [
      {...base, 'unexpected': true},
      {...base, 'verifiedRevision': 'not-a-digest'},
      {...base, 'sessionId': ' kfc:customer_1'},
    ]) {
      final attachment = KfcGenUiAttachment.fromJson(
        _wireAttachment(authority: invalidAuthority),
      );
      expect(attachment.hasValidAuthorityEncoding, isFalse);
      expect(attachment.canSubmitActions, isFalse);
    }

    final futureIssued = KfcGenUiAttachment.fromJson(
      _wireAttachment(
        authority: {
          ...base,
          'issuedAt': '2099-07-20T00:00:00.000Z',
          'expiresAt': '2100-07-21T00:00:00.000Z',
        },
        expiresAt: '2100-07-21T00:00:00.000Z',
      ),
    );
    expect(futureIssued.hasValidAuthorityEncoding, isTrue);
    expect(futureIssued.canSubmitActions, isFalse);
  });

  test('duplicate wire action ids close the whole attachment', () {
    const digest =
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    final attachment = KfcGenUiAttachment.fromJson(
      _wireAttachment(
        authority: const {
          'schemaVersion': 'kfc-genui-v1',
          'sessionId': 'kfc:customer_1',
          'customerId': 'customer_1',
          'verifiedRevision': digest,
          'actionLifecycle': 'one_shot',
          'issuedAt': '2026-07-19T00:00:00.000Z',
          'expiresAt': '2099-07-21T00:00:00.000Z',
        },
        actions: const [
          {'id': 'confirm_order', 'label': 'Xác nhận một'},
          {'id': 'confirm_order', 'label': 'Xác nhận hai'},
          {'id': 'edit_cart', 'label': 'Sửa giỏ'},
        ],
      ),
    );

    expect(attachment.hasValidActionEncoding, isFalse);
    expect(attachment.canSubmitActions, isFalse);
    expect(attachment.actionableActions, isEmpty);
  });

  test('expired attachment action window fails closed locally', () {
    const attachment = KfcGenUiAttachment(
      id: 'att_expired',
      lifecycleStage: 'checkout',
      widgetKind: KfcGenUiWidgetKind.orderReviewConfirm,
      status: KfcGenUiStatus.active,
      title: 'Xác nhận đơn',
      expiresAt: '2000-01-01T00:00:00.000Z',
      actions: [KfcGenUiActionSpec(id: 'confirm_order', label: 'Xác nhận')],
    );

    expect(attachment.canSubmitActions, isFalse);
  });

  test('malformed action entries fail the whole attachment closed', () {
    for (final actions in [
      [
        {'id': 'confirm_order', 'label': 'Xác nhận', 'payload': 'bad'},
      ],
      [
        {'id': 'confirm_order', 'label': 'Xác nhận', 'intent': 'unexpected'},
      ],
      [
        {'id': 'confirm_order', 'label': 'Xác nhận', 'destructive': 'false'},
      ],
      [
        {'id': 'confirm_order', 'label': 'Xác nhận', 'unexpected': true},
      ],
      [
        {'id': 'confirm_order', 'label': 'Xác nhận'},
        'not-an-action',
      ],
    ]) {
      final attachment = KfcGenUiAttachment.fromJson({
        'id': 'att_bad_actions',
        'lifecycleStage': 'checkout',
        'widgetKind': 'orderReviewConfirm',
        'status': 'active',
        'title': 'Xác nhận đơn',
        'data': <String, Object?>{},
        'actions': actions,
      });

      expect(attachment.hasValidActionEncoding, isFalse);
      expect(attachment.actions, isEmpty);
      expect(attachment.canSubmitActions, isFalse);
    }
  });

  test('wire action and attachment identifiers enforce route bounds', () {
    final overlongAttachment = KfcGenUiAttachment.fromJson(
      _wireAttachment(id: 'a' * 257),
      allowLegacyActionAuthority: true,
    );
    final overlongAction = KfcGenUiAttachment.fromJson(
      _wireAttachment(
        actions: [
          {'id': 'a' * 257, 'label': 'Xác nhận'},
        ],
      ),
      allowLegacyActionAuthority: true,
    );
    final overlongValue = KfcGenUiAttachment.fromJson(
      _wireAttachment(
        actions: [
          {'id': 'confirm_order', 'label': 'Xác nhận', 'value': 'v' * 1001},
        ],
      ),
      allowLegacyActionAuthority: true,
    );

    for (final attachment in [
      overlongAttachment,
      overlongAction,
      overlongValue,
    ]) {
      expect(attachment.hasValidActionEncoding, isFalse);
      expect(attachment.canSubmitActions, isFalse);
      expect(attachment.actionableActions, isEmpty);
    }
  });

  test('serializes GenUI actions for the backend endpoint', () {
    const action = KfcGenUiAction(
      attachmentId: 'fixture_review',
      actionId: 'confirm_order',
      value: 'confirmed',
    );

    expect(action.toJson(), {
      'attachmentId': 'fixture_review',
      'actionId': 'confirm_order',
      'value': 'confirmed',
    });
  });

  test('payment status fixture does not expose track order action', () {
    final attachment = kfcGenUiFixture(KfcGenUiWidgetKind.paymentOrderStatus);

    expect(
      attachment.actions.map((action) => action.id),
      isNot(contains('track_order')),
    );
  });

  test(
    'order tracking fixture exposes track order action after payment success',
    () {
      final attachment = kfcGenUiFixture(
        KfcGenUiWidgetKind.orderTrackingStatus,
      );

      expect(attachment.widgetKind, KfcGenUiWidgetKind.orderTrackingStatus);
      expect(
        attachment.actions.map((action) => action.id),
        contains('track_order'),
      );
    },
  );

  test('handoff reasons parse backend enum values into Vietnamese labels', () {
    final reason = KfcGenUiHandoffReason.fromJson('customer_requested_human');

    expect(reason, KfcGenUiHandoffReason.customerRequestedHuman);
    expect(reason.labelVi, 'Khách yêu cầu gặp nhân viên');
  });

  test('order and payment statuses parse backend enum values into labels', () {
    expect(KfcGenUiOrderStatus.fromJson('preparing').labelVi, 'Đang chuẩn bị');
    expect(KfcGenUiPaymentStatus.fromJson('paid').labelVi, 'Đã thanh toán');
  });

  test('unknown enum display values do not expose raw snake case', () {
    expect(
      kfcGenUiHandoffReasonLabel('new_backend_reason'),
      'Lý do cần nhân viên hỗ trợ',
    );
    expect(kfcGenUiOrderStatusLabel('waiting_for_store'), 'Đang cập nhật');
    expect(kfcGenUiPaymentStatusLabel('manual_review'), 'Đang cập nhật');
  });
}

Map<String, Object?> _wireAttachment({
  String id = 'att_wire',
  Map<String, Object?>? authority,
  String expiresAt = '2099-07-21T00:00:00.000Z',
  List<Object?> actions = const [
    {'id': 'confirm_order', 'label': 'Xác nhận'},
  ],
}) {
  return {
    'id': id,
    'lifecycleStage': 'checkout',
    'widgetKind': 'orderReviewConfirm',
    'status': 'active',
    'title': 'Xác nhận đơn',
    'expiresAt': expiresAt,
    'data': <String, Object?>{},
    'actions': actions,
    'authority': ?authority,
  };
}
