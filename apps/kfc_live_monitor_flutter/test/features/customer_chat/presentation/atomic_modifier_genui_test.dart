import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/genui/kfc_genui_renderer.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';

import '../../test_app.dart';

void main() {
  testWidgets(
    'modifier choices stay local and defaults plus nested choices apply once',
    (tester) async {
      final actions = <KfcGenUiAction>[];
      const attachment = _atomicModifierAttachment;
      await tester.pumpWidget(
        TestApp(
          child: SingleChildScrollView(
            child: KfcGenUiRenderer(
              attachment: attachment,
              onAction: actions.add,
            ),
          ),
        ),
      );

      await tester.tap(
        find.byKey(
          CustomerChatKeys.genUiModifierOption(attachment.id, 'sauce', 'chili'),
        ),
      );
      await tester.pump();
      expect(actions, isEmpty);
      expect(find.text('Độ cay'), findsOneWidget);

      await tester.tap(
        find.byKey(
          CustomerChatKeys.genUiModifierOption(attachment.id, 'spice', 'mild'),
        ),
      );
      await tester.pump();
      expect(actions, isEmpty);

      await tester.tap(
        find.byKey(
          CustomerChatKeys.genUiAction(attachment.id, 'apply_modifiers'),
        ),
      );

      expect(actions, hasLength(1));
      expect(actions.single.actionId, 'apply_modifiers');
      expect(actions.single.payload, {
        'itemCode': 'combo',
        'selections': [
          {'groupId': 'main', 'modifierId': 'burger'},
          {'groupId': 'sauce', 'modifierId': 'chili'},
          {'groupId': 'spice', 'modifierId': 'mild'},
        ],
      });
    },
  );

  test(
    'atomic modifier authority rejects duplicate and unbound selections',
    () {
      expect(
        _atomicModifierAttachment.bindAction(
          actionId: 'apply_modifiers',
          payload: const {
            'itemCode': 'combo',
            'selections': [
              {'groupId': 'main', 'modifierId': 'burger'},
              {'groupId': 'main', 'modifierId': 'burger'},
            ],
          },
        ),
        isNull,
      );
      expect(
        _atomicModifierAttachment.bindAction(
          actionId: 'apply_modifiers',
          payload: const {
            'itemCode': 'combo',
            'selections': [
              {'groupId': 'main', 'modifierId': 'not-in-tree'},
            ],
          },
        ),
        isNull,
      );
    },
  );

  testWidgets('answered modifier collapses to verified nested option names', (
    tester,
  ) async {
    final answered = KfcGenUiAttachment(
      id: _atomicModifierAttachment.id,
      lifecycleStage: _atomicModifierAttachment.lifecycleStage,
      widgetKind: KfcGenUiWidgetKind.modifierPicker,
      status: KfcGenUiStatus.answered,
      title: _atomicModifierAttachment.title,
      data: {
        ..._atomicModifierAttachment.data,
        '_completedAction': {
          'actionId': 'apply_modifiers',
          'payload': {
            'itemCode': 'combo',
            'selections': [
              {'groupId': 'main', 'modifierId': 'burger'},
              {'groupId': 'spice', 'modifierId': 'mild'},
            ],
          },
        },
      },
      actions: _atomicModifierAttachment.actions,
      selectedAction: 'apply_modifiers',
    );

    await tester.pumpWidget(
      TestApp(
        child: KfcGenUiRenderer(attachment: answered, onAction: (_) {}),
      ),
    );

    expect(find.text('Đã hoàn tất · Áp dụng'), findsOneWidget);
    expect(find.text('Burger, Không cay'), findsOneWidget);
    expect(
      find.byKey(CustomerChatKeys.genUiAction(answered.id, 'apply_modifiers')),
      findsNothing,
    );
  });
}

const _atomicModifierAttachment = KfcGenUiAttachment(
  id: 'atomic-modifier',
  lifecycleStage: 'modifier',
  widgetKind: KfcGenUiWidgetKind.modifierPicker,
  status: KfcGenUiStatus.active,
  title: 'Tùy chỉnh',
  data: {
    'modifierTree': {
      'itemCode': 'combo',
      'name': 'Combo',
      'modifierGroups': [
        {
          'groupId': 'main',
          'name': 'Món chính',
          'min': 1,
          'max': 1,
          'options': [
            {
              'modifierId': 'burger',
              'name': 'Burger',
              'default': true,
              'modifierGroups': [
                {
                  'groupId': 'spice',
                  'name': 'Độ cay',
                  'min': 1,
                  'max': 1,
                  'options': [
                    {'modifierId': 'spicy', 'name': 'Cay'},
                    {'modifierId': 'mild', 'name': 'Không cay'},
                  ],
                },
              ],
            },
          ],
        },
        {
          'groupId': 'sauce',
          'name': 'Sốt',
          'min': 1,
          'max': 1,
          'options': [
            {'modifierId': 'mayo', 'name': 'Mayo', 'default': true},
            {'modifierId': 'chili', 'name': 'Tương ớt'},
          ],
        },
      ],
    },
  },
  actions: [
    KfcGenUiActionSpec(
      id: 'apply_modifiers',
      label: 'Áp dụng',
      intent: KfcGenUiActionIntent.primary,
    ),
  ],
);
