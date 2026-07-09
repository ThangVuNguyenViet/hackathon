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
