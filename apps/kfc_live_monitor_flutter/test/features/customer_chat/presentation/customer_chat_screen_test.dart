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

  testWidgets('new assistant GenUI response scrolls into the rendered chat', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(920, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final controller = CustomerChatController(
      repository: const _LongMenuThenCartRepository(),
    );
    await tester.pumpWidget(
      TestApp(child: CustomerChatScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(CustomerChatKeys.messageInput),
      'Gợi ý combo KFC cho bữa trưa.',
    );
    await tester.tap(find.byKey(CustomerChatKeys.sendButton));
    await tester.pumpAndSettle();

    expect(
      controller.state.value.messages.map((message) => message.text),
      containsAllInOrder([
        'Gợi ý combo KFC cho bữa trưa.',
        'Mình gợi ý vài món phù hợp.',
      ]),
    );
    expect(
      find.byKey(CustomerChatKeys.genUi(KfcGenUiWidgetKind.smartMenuPicker)),
      findsWidgets,
    );

    await tester.enterText(
      find.byKey(CustomerChatKeys.messageInput),
      'Thêm Combo Hợp Gu 99K vào giỏ.',
    );
    await tester.tap(find.byKey(CustomerChatKeys.sendButton));
    await tester.pumpAndSettle();

    expect(
      controller.state.value.messages.map((message) => message.text),
      containsAllInOrder([
        'Gợi ý combo KFC cho bữa trưa.',
        'Mình gợi ý vài món phù hợp.',
        'Thêm Combo Hợp Gu 99K vào giỏ.',
        'Mình đã cập nhật giỏ hàng.',
      ]),
    );
    expect(
      find.byKey(CustomerChatKeys.genUi(KfcGenUiWidgetKind.cartBuilder)),
      findsOneWidget,
    );
  });
}

class _LongMenuThenCartRepository implements CustomerChatRepository {
  const _LongMenuThenCartRepository();

  @override
  Future<CustomerChatSessionUpdates> getSessionUpdates({
    required String sessionId,
    String? afterTurnId,
  }) async =>
      const CustomerChatSessionUpdates(agentMode: 'ai_active', turns: []);

  @override
  Future<CustomerChatResponse> sendMessage({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required String text,
  }) async {
    if (text.toLowerCase().contains('thêm')) {
      return CustomerChatResponse(
        responseText: 'Mình đã cập nhật giỏ hàng.',
        genUi: kfcGenUiFixture(KfcGenUiWidgetKind.cartBuilder),
      );
    }
    return CustomerChatResponse(
      responseText: 'Mình gợi ý vài món phù hợp.',
      genUi: KfcGenUiAttachment(
        id: 'long_menu',
        lifecycleStage: 'menu',
        widgetKind: KfcGenUiWidgetKind.smartMenuPicker,
        status: KfcGenUiStatus.active,
        title: 'Gợi ý món phù hợp',
        data: {
          'items': [
            for (var index = 0; index < 30; index += 1)
              {
                'name': 'Combo thử nghiệm ${index + 1}',
                'priceVnd': 99000 + index,
              },
          ],
        },
      ),
    );
  }

  @override
  Future<CustomerChatResponse> submitGenUiAction({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required KfcGenUiAction action,
  }) async {
    throw UnimplementedError();
  }
}
