import 'dart:async';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_controller.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_state.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/customer_confirmation_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/customer_run_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/customer_chat_screen.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';

import '../../test_app.dart';

void main() {
  testWidgets('header switches subsequent responses between GenUI and text', (
    tester,
  ) async {
    final controller = CustomerChatController();
    await tester.pumpWidget(
      TestApp(child: CustomerChatScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(CustomerChatKeys.responseModeControl), findsOneWidget);
    expect(find.text('Generative UI'), findsOneWidget);
    expect(find.text('Text only'), findsOneWidget);
    expect(controller.state.value.responseMode, CustomerChatResponseMode.genui);

    await tester.tap(find.byKey(CustomerChatKeys.responseModeText));
    await tester.pump();

    expect(controller.state.value.responseMode, CustomerChatResponseMode.text);
  });

  testWidgets('header disables response mode changes while processing', (
    tester,
  ) async {
    final controller = CustomerChatController(
      initialState: CustomerChatState(
        sessionId: 'kfc:busy',
        customerId: 'busy',
        activeDraft: ActiveAssistantDraft.accepted(runId: 'busy-run'),
      ),
    );
    await tester.pumpWidget(
      TestApp(child: CustomerChatScreen(controller: controller)),
    );
    await tester.pump();

    expect(
      tester
          .widget<ShadButton>(find.byKey(CustomerChatKeys.responseModeGenUi))
          .enabled,
      isFalse,
    );
    expect(
      tester
          .widget<ShadButton>(find.byKey(CustomerChatKeys.responseModeText))
          .enabled,
      isFalse,
    );
  });

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
    expect(controller.state.value.draftText, 'Thêm Combo Hợp Gu 99K vào giỏ.');
    expect(controller.state.value.isSending, isFalse);
    expect(
      tester
          .widget<ShadIconButton>(find.byKey(CustomerChatKeys.sendButton))
          .enabled,
      isTrue,
    );
    unawaited(controller.sendDraft());
    for (
      var attempt = 0;
      attempt < 40 &&
          !controller.state.value.messages.any(
            (message) => message.text == 'Mình đã cập nhật giỏ hàng.',
          );
      attempt += 1
    ) {
      await tester.pump(const Duration(milliseconds: 25));
    }

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

  testWidgets('approval controls never render the signed capability', (
    tester,
  ) async {
    const signedCapability = 'signed.must-stay-in-memory';
    final controller = CustomerChatController(
      repository: const FixtureCustomerChatRepository(
        eventDelay: Duration.zero,
      ),
      initialState: CustomerChatState(
        sessionId: 'kfc:customer-1',
        customerId: 'customer-1',
        pendingApproval: CustomerApprovalPause(
          capability: 'placeOrder',
          requestId: '00000000-0000-4000-8000-000000000123',
          approvalCapability: signedCapability,
          expiresAt: DateTime.utc(2099, 7, 20),
        ),
      ),
    );
    await tester.pumpWidget(
      TestApp(child: CustomerChatScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(CustomerChatKeys.approvalCard), findsOneWidget);
    expect(find.text(signedCapability), findsNothing);
    await tester.tap(find.byKey(CustomerChatKeys.approvalRejectButton));
    await tester.pumpAndSettle();

    expect(controller.state.value.pendingApproval, isNull);
    expect(find.text(signedCapability), findsNothing);
  });

  testWidgets(
    'human-paused supersession renders the customer turn without a response block',
    (tester) async {
      const customerText = 'Tôi vẫn cần nhân viên kiểm tra đơn.';
      final controller = CustomerChatController(
        repository: const FixtureCustomerChatRepository(
          eventDelay: Duration.zero,
        ),
        initialState: const CustomerChatState(
          sessionId: 'kfc:customer-1',
          customerId: 'customer-1',
          messages: [
            CustomerChatMessage(
              id: 'customer-message',
              role: CustomerChatRole.customer,
              text: customerText,
            ),
          ],
          activeDraft: ActiveAssistantDraft(
            runId: 'superseded-run',
            lastSequence: 2,
            connection: CustomerRunConnectionState.closed,
            text: '',
            cancellable: false,
            terminal: CustomerRunTerminal.superseded,
            agentMode: CustomerRunAgentMode.humanPaused,
            materialized: true,
          ),
          handoffStatus: 'joined',
        ),
      );

      await tester.pumpWidget(
        TestApp(child: CustomerChatScreen(controller: controller)),
      );
      await tester.pumpAndSettle();

      expect(find.text(customerText), findsOneWidget);
      expect(find.byKey(CustomerChatKeys.responseBlock), findsNothing);
      expect(find.byKey(CustomerChatKeys.errorBanner), findsNothing);
    },
  );
}

class _LongMenuThenCartRepository extends FixtureCustomerChatRepository {
  const _LongMenuThenCartRepository() : super(eventDelay: Duration.zero);

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
