import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/genui/kfc_genui_renderer.dart';

import '../../test_app.dart';

const _attachmentId = 'full_menu_fixture';

void main() {
  testWidgets(
    'full menu switches horizontally scrollable tabs and retains quantities across tabs',
    (tester) async {
      final actions = <KfcGenUiAction>[];
      await _pumpFullMenu(tester, _fullMenuAttachment(), actions.add);

      expect(find.byKey(const Key('kfcGenUi_fullMenuBrowser')), findsOneWidget);
      expect(
        find.byKey(const Key('kfcGenUiFullMenuCategoryTabs_$_attachmentId')),
        findsOneWidget,
      );
      expect(
        tester
            .widget<ListView>(
              find.byKey(
                const Key('kfcGenUiFullMenuCategoryTabs_$_attachmentId'),
              ),
            )
            .scrollDirection,
        Axis.horizontal,
      );
      expect(find.text('Combo 1'), findsOneWidget);
      expect(find.text('Nước 1'), findsNothing);

      await tester.tap(
        find.byKey(
          const Key('kfcGenUiMenuQuantityIncrease_${_attachmentId}_combo_1'),
        ),
      );
      await tester.pump();
      await tester.tap(
        find.byKey(const Key('kfcGenUiMenuCategory_${_attachmentId}_drinks')),
      );
      await tester.pump();

      expect(find.text('Combo 1'), findsNothing);
      expect(find.text('Nước 1'), findsOneWidget);
      await tester.tap(
        find.byKey(
          const Key('kfcGenUiMenuQuantityIncrease_${_attachmentId}_drink_1'),
        ),
      );
      await tester.pump();
      expect(find.text('2/5 món khác nhau đã chọn'), findsOneWidget);
      expect(find.text('Tạm tính 119.000đ'), findsOneWidget);

      await tester.tap(
        find.byKey(const Key('kfcGenUiMenuCategory_${_attachmentId}_combo')),
      );
      await tester.pump();
      expect(
        find.byKey(const Key('kfcGenUiMenuQuantity_${_attachmentId}_combo_1')),
        findsOneWidget,
      );
      expect(find.text('1'), findsOneWidget);
    },
  );

  testWidgets(
    'full menu caps five distinct items and emits exact add-items payload',
    (tester) async {
      final actions = <KfcGenUiAction>[];
      await _pumpFullMenu(tester, _fullMenuAttachment(), actions.add);

      for (final code in ['combo_1', 'combo_2', 'combo_3']) {
        await tester.tap(
          find.byKey(
            Key('kfcGenUiMenuQuantityIncrease_${_attachmentId}_$code'),
          ),
        );
        await tester.pump();
      }
      await tester.tap(
        find.byKey(const Key('kfcGenUiMenuCategory_${_attachmentId}_drinks')),
      );
      await tester.pump();
      for (final code in ['drink_1', 'drink_2']) {
        await tester.tap(
          find.byKey(
            Key('kfcGenUiMenuQuantityIncrease_${_attachmentId}_$code'),
          ),
        );
        await tester.pump();
      }

      expect(find.text('5/5 món khác nhau đã chọn'), findsOneWidget);
      final sixthIncrease = tester.widget<ShadIconButton>(
        find.descendant(
          of: find.byKey(
            const Key('kfcGenUiMenuQuantityIncrease_${_attachmentId}_drink_3'),
          ),
          matching: find.byType(ShadIconButton),
        ),
      );
      expect(sixthIncrease.onPressed, isNull);

      await tester.tap(
        find.byKey(const Key('kfcGenUiAction_${_attachmentId}_add_items')),
      );
      await tester.pump();

      expect(actions.single.actionId, 'add_items');
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

  testWidgets('full menu uses a bounded lazy item list', (tester) async {
    final items = [
      for (var index = 1; index <= 40; index += 1)
        {
          'code': 'item_$index',
          'name': 'Món $index',
          'categoryId': 'all-items',
          'category': 'Tất cả',
          'priceVnd': 10000 + index,
        },
    ];
    await _pumpFullMenu(
      tester,
      _fullMenuAttachment(
        items: items,
        categories: const [
          {'categoryId': 'all-items', 'label': 'Tất cả'},
        ],
      ),
      (_) {},
    );

    final list = find.byKey(
      const Key('kfcGenUiFullMenuItemList_$_attachmentId'),
    );
    expect(list, findsOneWidget);
    expect(tester.getSize(list).height, lessThanOrEqualTo(430));
    expect(find.text('Món 1'), findsOneWidget);
    expect(find.text('Món 40'), findsNothing);

    await tester.scrollUntilVisible(
      find.text('Món 40'),
      400,
      scrollable: find.descendant(of: list, matching: find.byType(Scrollable)),
    );
    expect(find.text('Món 40'), findsOneWidget);
  });

  testWidgets(
    'full menu displays complete collection count and is read-only after answer',
    (tester) async {
      final actions = <KfcGenUiAction>[];
      final readOnly = _fullMenuAttachment(status: 'answered');
      await _pumpFullMenu(tester, readOnly, actions.add);

      expect(find.text('Đầy đủ 6 món'), findsOneWidget);
      final increase = tester.widget<ShadIconButton>(
        find.descendant(
          of: find.byKey(
            const Key('kfcGenUiMenuQuantityIncrease_${_attachmentId}_combo_1'),
          ),
          matching: find.byType(ShadIconButton),
        ),
      );
      expect(increase.onPressed, isNull);
      final confirm = tester.widget<ShadButton>(
        find.byKey(const Key('kfcGenUiAction_${_attachmentId}_add_items')),
      );
      expect(confirm.onPressed, isNull);
      expect(actions, isEmpty);
    },
  );
}

Future<void> _pumpFullMenu(
  WidgetTester tester,
  KfcGenUiAttachment attachment,
  ValueChanged<KfcGenUiAction> onAction,
) async {
  tester.view.physicalSize = const Size(800, 1200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    TestApp(
      child: KfcGenUiRenderer(attachment: attachment, onAction: onAction),
    ),
  );
}

KfcGenUiAttachment _fullMenuAttachment({
  List<Map<String, Object?>>? items,
  List<Map<String, Object?>>? categories,
  String status = 'active',
  List<Map<String, Object?>> actions = const [
    {'id': 'add_items', 'label': 'Xác nhận món', 'intent': 'primary'},
  ],
}) {
  final menuItems =
      items ??
      const [
        {
          'code': 'combo_1',
          'name': 'Combo 1',
          'categoryId': 'combo',
          'category': 'Combo',
          'priceVnd': 99000,
        },
        {
          'code': 'combo_2',
          'name': 'Combo 2',
          'categoryId': 'combo',
          'category': 'Combo',
          'priceVnd': 109000,
        },
        {
          'code': 'combo_3',
          'name': 'Combo 3',
          'categoryId': 'combo',
          'category': 'Combo',
          'priceVnd': 119000,
        },
        {
          'code': 'drink_1',
          'name': 'Nước 1',
          'categoryId': 'drinks',
          'category': 'Nước uống',
          'priceVnd': 20000,
        },
        {
          'code': 'drink_2',
          'name': 'Nước 2',
          'categoryId': 'drinks',
          'category': 'Nước uống',
          'priceVnd': 22000,
        },
        {
          'code': 'drink_3',
          'name': 'Nước 3',
          'categoryId': 'drinks',
          'category': 'Nước uống',
          'priceVnd': 24000,
        },
      ];
  final menuCategories =
      categories ??
      const [
        {'categoryId': 'combo', 'label': 'Combo'},
        {'categoryId': 'drinks', 'label': 'Nước uống'},
      ];
  return KfcGenUiAttachment.fromJson({
    'id': _attachmentId,
    'lifecycleStage': 'menu',
    'widgetKind': 'fullMenuBrowser',
    'status': status,
    'title': 'Toàn bộ thực đơn',
    'data': {
      'items': menuItems,
      'categories': menuCategories,
      'selectionLimit': 5,
      'total': menuItems.length,
      'returned': menuItems.length,
      'complete': true,
      'collection': {
        'key': 'all',
        'revision': 'menu-r1',
        'providerRevision': 'provider-r1',
        'total': menuItems.length,
        'returned': menuItems.length,
        'complete': true,
        'scope': {'scope': 'all'},
      },
    },
    'actions': actions,
  }, allowLegacyActionAuthority: true);
}
