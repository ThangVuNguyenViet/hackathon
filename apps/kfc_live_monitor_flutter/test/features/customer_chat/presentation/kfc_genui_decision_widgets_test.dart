import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/genui/kfc_genui_renderer.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';

import '../../test_app.dart';

void main() {
  test('parses the four focused decision widget kinds and verified media', () {
    for (final kind in [
      KfcGenUiWidgetKind.productDetailCard,
      KfcGenUiWidgetKind.modifierPicker,
      KfcGenUiWidgetKind.promotionGallery,
      KfcGenUiWidgetKind.allergenEvidence,
    ]) {
      expect(KfcGenUiWidgetKind.fromJson(kind.wireName), kind);
    }

    expect(KfcVerifiedMedia.tryFromJson(_media('valid')), isNotNull);
    final minimalOfficialMedia = Map<String, Object?>.from(_media('minimal'))
      ..remove('mimeType')
      ..remove('sizeBytes')
      ..remove('width')
      ..remove('height');
    expect(KfcVerifiedMedia.tryFromJson(minimalOfficialMedia), isNotNull);
    expect(
      KfcVerifiedMedia.tryFromJson({
        ..._media('invalid-host'),
        'url': 'https://example.com/not-kfc.jpg',
      }),
      isNull,
    );
    expect(
      KfcVerifiedMedia.tryFromJson({..._media('invalid-key'), 'mediaKey': ''}),
      isNull,
    );
  });

  testWidgets('product detail renders one hero and forwards CTA payload', (
    tester,
  ) async {
    final actions = <KfcGenUiAction>[];
    final fixture = kfcGenUiFixture(KfcGenUiWidgetKind.productDetailCard);
    await _pumpDecision(tester, fixture, actions.add);

    expect(find.text('Burger Phi-lê Gà Quay'), findsOneWidget);
    expect(find.text('56.000đ'), findsOneWidget);
    expect(find.byType(Image), findsOneWidget);

    await tester.tap(
      find.byKey(CustomerChatKeys.genUiAction(fixture.id, 'add_item')),
    );
    await tester.pump();

    expect(actions.single.actionId, 'add_item');
    expect(actions.single.payload, {'itemCode': 'burger-flava', 'quantity': 1});
  });

  testWidgets(
    'modifier hero changes only for verified option media and retains parent otherwise',
    (tester) async {
      final actions = <KfcGenUiAction>[];
      final fixture = kfcGenUiFixture(KfcGenUiWidgetKind.modifierPicker);
      await _pumpDecision(tester, fixture, actions.add);

      expect(_networkUrl(tester), contains('3-Fried-Chicken.jpg'));

      await tester.tap(
        find.byKey(
          CustomerChatKeys.genUiModifierOption(
            fixture.id,
            'flavor',
            'hot-spicy',
          ),
        ),
      );
      await tester.pump();
      expect(_networkUrl(tester), contains('3-Fried-Chicken.jpg'));
      expect(actions, isEmpty);
      expect(
        find.byKey(CustomerChatKeys.genUiAction(fixture.id, 'apply_modifiers')),
        findsOneWidget,
      );

      await tester.tap(
        find.byKey(
          CustomerChatKeys.genUiModifierOption(
            fixture.id,
            'flavor',
            'keep-current',
          ),
        ),
      );
      await tester.pump();
      expect(_networkUrl(tester), contains('3-Fried-Chicken.jpg'));
      expect(find.byType(Image), findsOneWidget);
      expect(actions, isEmpty);

      await tester.tap(
        find.byKey(CustomerChatKeys.genUiAction(fixture.id, 'apply_modifiers')),
      );
      expect(actions.single.actionId, 'apply_modifiers');
      expect(actions.single.payload, {
        'itemCode': 'three-chicken',
        'selections': [
          {'groupId': 'flavor', 'modifierId': 'keep-current'},
        ],
      });
    },
  );

  testWidgets(
    'modifier renders verified tree options and submits one atomic selection',
    (tester) async {
      final actions = <KfcGenUiAction>[];
      const fixture = KfcGenUiAttachment(
        id: 'trusted-modifier-options',
        lifecycleStage: 'modifier',
        widgetKind: KfcGenUiWidgetKind.modifierPicker,
        status: KfcGenUiStatus.active,
        title: 'Tùy chỉnh món',
        data: {
          'modifierTree': {
            'itemCode': '3001',
            'name': '3 Miếng Gà',
            'modifierGroups': [
              {
                'groupId': 'flavor',
                'options': [
                  {'modifierId': 'crispy', 'name': 'Gà Giòn Cay'},
                  {'modifierId': 'original', 'name': 'Gà Truyền Thống'},
                  {'modifierId': 'untrusted', 'name': 'Không được hiển thị'},
                ],
              },
            ],
          },
        },
        actions: [KfcGenUiActionSpec(id: 'apply_modifiers', label: 'Áp dụng')],
      );

      await _pumpDecision(tester, fixture, actions.add);

      expect(find.text('Gà Giòn Cay'), findsOneWidget);
      expect(find.text('Gà Truyền Thống'), findsOneWidget);
      expect(find.text('Không được hiển thị'), findsOneWidget);
      expect(
        find.byKey(
          CustomerChatKeys.genUiModifierOption(
            fixture.id,
            'flavor',
            'untrusted',
          ),
        ),
        findsOneWidget,
      );

      await tester.tap(
        find.byKey(
          CustomerChatKeys.genUiModifierOption(
            fixture.id,
            'flavor',
            'original',
          ),
        ),
      );
      await tester.pump();

      expect(actions, isEmpty);
      await tester.tap(
        find.byKey(CustomerChatKeys.genUiAction(fixture.id, 'apply_modifiers')),
      );
      expect(actions.single.actionId, 'apply_modifiers');
      expect(actions.single.payload, {
        'itemCode': '3001',
        'selections': [
          {'groupId': 'flavor', 'modifierId': 'original'},
        ],
      });
    },
  );

  testWidgets('promotion discovery caps cards and verified images at five', (
    tester,
  ) async {
    final promotions = [
      for (var index = 0; index < 7; index += 1)
        {
          'id': 'promo-$index',
          'title': 'Ưu đãi $index',
          'startDate': '2026-07-01',
          'endDate': '2026-07-31',
          'media': _media('promo-$index'),
        },
    ];
    final fixture = KfcGenUiAttachment(
      id: 'promotion-limit',
      lifecycleStage: 'promotion',
      widgetKind: KfcGenUiWidgetKind.promotionGallery,
      status: KfcGenUiStatus.active,
      title: 'Khuyến mãi',
      data: {'promotions': promotions},
    );
    await _pumpDecision(tester, fixture, (_) {});

    expect(find.text('Ưu đãi 4'), findsOneWidget);
    expect(find.text('Ưu đãi 5'), findsNothing);
    expect(find.byType(Image), findsNWidgets(5));
  });

  testWidgets(
    'unkeyed snapshot image collapses and allergen action remains exact',
    (tester) async {
      final actions = <KfcGenUiAction>[];
      const fixture = KfcGenUiAttachment(
        id: 'allergen-text-only',
        lifecycleStage: 'allergen',
        widgetKind: KfcGenUiWidgetKind.allergenEvidence,
        status: KfcGenUiStatus.active,
        title: 'Thông tin dị ứng',
        data: {
          'item': {
            'name': 'Burger KFC',
            'imageUrl':
                'https://static.kfcvietnam.com.vn/images/items/lg/Burger-Flava.jpg',
          },
          'evidence': {
            'snippet': 'Dựa trên bảng công bố chính thức của KFC.',
            'sourceUrl': 'https://www.kfcvietnam.com.vn/allergen-chart',
          },
        },
        actions: [
          KfcGenUiActionSpec(
            id: 'open_allergen_chart',
            label: 'Xem bảng dị ứng',
            value: 'https://www.kfcvietnam.com.vn/allergen-chart',
            payload: {
              'sourceUrl': 'https://www.kfcvietnam.com.vn/allergen-chart',
            },
          ),
        ],
      );
      await _pumpDecision(tester, fixture, actions.add);

      expect(find.byType(Image), findsNothing);
      expect(find.text('Burger KFC'), findsOneWidget);

      await tester.tap(
        find.byKey(
          CustomerChatKeys.genUiAction(fixture.id, 'open_allergen_chart'),
        ),
      );
      await tester.pump();
      expect(actions.single.payload, {
        'sourceUrl': 'https://www.kfcvietnam.com.vn/allergen-chart',
      });
    },
  );
}

Future<void> _pumpDecision(
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

String _networkUrl(WidgetTester tester) {
  final image = tester.widget<Image>(find.byType(Image));
  return (image.image as NetworkImage).url;
}

Map<String, Object?> _media(String id) => {
  'mediaKey': 'kfcvn:item-image:$id',
  'entityType': 'item_image',
  'entityId': id,
  'url': 'https://static.kfcvietnam.com.vn/$id.jpg',
  'altText': 'Ảnh KFC $id',
  'mimeType': 'image/jpeg',
  'sizeBytes': 1000,
  'width': 710,
  'height': 470,
};
