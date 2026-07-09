import 'package:flutter_test/flutter_test.dart';
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
}
