import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/genui/kfc_genui_renderer.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';

import '../../test_app.dart';

const officialImage =
    'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL';

void main() {
  test('verified media accepts only official HTTPS KFC image URLs', () {
    Map<String, Object?> media(String url) => {
      'mediaKey': 'kfcvn:item-image:20751',
      'entityType': 'item_image',
      'entityId': '20751',
      'url': url,
      'altText': 'Combo Hợp Gu',
    };

    expect(KfcVerifiedMedia.tryFromJson(media(officialImage)), isNotNull);
    expect(
      KfcVerifiedMedia.tryFromJson(
        media('http://static.kfcvietnam.com.vn/a.jpg'),
      ),
      isNull,
    );
    expect(
      KfcVerifiedMedia.tryFromJson(media('https://example.test/a.jpg')),
      isNull,
    );
  });

  testWidgets('smart menu renders trusted image and omits an off-host image', (
    tester,
  ) async {
    Future<void> pump(String url) => tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(
          attachment: KfcGenUiAttachment(
            id: 'menu_media',
            lifecycleStage: 'menu',
            widgetKind: KfcGenUiWidgetKind.smartMenuPicker,
            status: KfcGenUiStatus.active,
            title: 'Menu',
            data: {
              'items': [
                {
                  'code': '20751',
                  'name': 'Combo Hợp Gu',
                  'priceVnd': 99000,
                  'imageUrl': url,
                },
              ],
            },
          ),
          onAction: (_) {},
        ),
      ),
    );

    await pump(officialImage);
    expect(
      find.byKey(CustomerChatKeys.genUiMenuImage('menu_media', '20751')),
      findsOneWidget,
    );
    final imageRowSize = tester.getSize(
      find.byKey(CustomerChatKeys.genUiMenuItem('menu_media', '20751')),
    );
    expect(imageRowSize.height, lessThanOrEqualTo(92));
    expect(imageRowSize.height, greaterThanOrEqualTo(72));
    await pump('https://example.test/HOPGU.jpg');
    expect(
      find.byKey(CustomerChatKeys.genUiMenuImage('menu_media', '20751')),
      findsNothing,
    );
  });

  testWidgets(
    'modifier actions remain distinct when option IDs collide across groups',
    (tester) async {
      final actions = <KfcGenUiAction>[];
      const attachment = KfcGenUiAttachment(
        id: 'modifier_collision',
        lifecycleStage: 'modifier',
        widgetKind: KfcGenUiWidgetKind.modifierPicker,
        status: KfcGenUiStatus.active,
        title: 'Chọn tùy chọn',
        data: {
          'modifierTree': {
            'itemCode': 'combo_collision',
            'modifierGroups': [
              {
                'groupId': 'drink',
                'options': [
                  {'modifierId': 'large', 'name': 'Nước lớn'},
                ],
              },
              {
                'groupId': 'fries',
                'options': [
                  {'modifierId': 'large', 'name': 'Khoai lớn'},
                ],
              },
            ],
          },
        },
        actions: [
          KfcGenUiActionSpec(
            id: 'customize_item:drink:large',
            label: 'Nước lớn',
            value: 'Nước lớn',
            payload: {
              'itemCode': 'combo_collision',
              'groupId': 'drink',
              'modifierId': 'large',
            },
          ),
          KfcGenUiActionSpec(
            id: 'customize_item:fries:large',
            label: 'Khoai lớn',
            value: 'Khoai lớn',
            payload: {
              'itemCode': 'combo_collision',
              'groupId': 'fries',
              'modifierId': 'large',
            },
          ),
        ],
      );

      await tester.pumpWidget(
        TestApp(
          child: KfcGenUiRenderer(
            attachment: attachment,
            onAction: actions.add,
          ),
        ),
      );
      final drink = CustomerChatKeys.genUiModifierOption(
        'modifier_collision',
        'drink',
        'large',
      );
      final fries = CustomerChatKeys.genUiModifierOption(
        'modifier_collision',
        'fries',
        'large',
      );
      expect(drink, isNot(fries));
      await tester.tap(find.byKey(fries));
      await tester.pump();
      expect(actions.single.actionId, 'customize_item:fries:large');
      expect(actions.single.payload, {
        'itemCode': 'combo_collision',
        'groupId': 'fries',
        'modifierId': 'large',
      });
    },
  );
}
