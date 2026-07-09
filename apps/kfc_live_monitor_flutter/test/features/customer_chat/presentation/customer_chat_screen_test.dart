import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_controller.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/customer_chat_screen.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';

import '../../test_app.dart';

void main() {
  testWidgets('quick prompt renders customer chat GenUI', (tester) async {
    tester.view.physicalSize = const Size(920, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final controller = CustomerChatController(
      repository: const FixtureCustomerChatRepository(),
    );
    await tester.pumpWidget(
      TestApp(child: CustomerChatScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(CustomerChatKeys.quickPrompt('menu')));
    await tester.pumpAndSettle();

    expect(find.text('KFC Ordering Chat'), findsOneWidget);
    expect(
      find.byKey(CustomerChatKeys.genUi(KfcGenUiWidgetKind.smartMenuPicker)),
      findsOneWidget,
    );
  });
}
