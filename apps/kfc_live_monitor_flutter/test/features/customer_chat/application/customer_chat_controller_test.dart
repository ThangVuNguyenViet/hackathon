import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_controller.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_state.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';

void main() {
  test('default customer chat states use KFC source session ids', () {
    final first = CustomerChatState.initial();
    final second = CustomerChatState.initial();

    expect(first.sessionId, second.sessionId);
    expect(first.customerId, second.customerId);
    expect(first.customerId, startsWith('anon_customer_'));
    expect(first.sessionId, 'kfc:${first.customerId}');
    expect(second.customerId, startsWith('anon_customer_'));
    expect(second.sessionId, 'kfc:${second.customerId}');
  });

  test('sendDraft appends customer and assistant GenUI turn', () async {
    final controller = CustomerChatController(
      repository: const FixtureCustomerChatRepository(),
    );

    controller.updateDraft('Gợi ý combo');
    await controller.sendDraft();

    final state = controller.state.value;
    expect(state.isSending, isFalse);
    expect(
      state.messages.map((message) => message.role),
      contains(CustomerChatRole.customer),
    );
    expect(state.activeGenUi?.widgetKind, KfcGenUiWidgetKind.smartMenuPicker);
  });

  test('message identities do not collide after a controller restart', () async {
    final first = CustomerChatController(
      repository: const FixtureCustomerChatRepository(),
    );
    final second = CustomerChatController(
      repository: const FixtureCustomerChatRepository(),
    );

    first.updateDraft('Gợi ý combo');
    await first.sendDraft();
    second.updateDraft('Gợi ý combo');
    await second.sendDraft();

    final firstCustomerMessage = first.state.value.messages.firstWhere(
      (message) => message.role == CustomerChatRole.customer,
    );
    final secondCustomerMessage = second.state.value.messages.firstWhere(
      (message) => message.role == CustomerChatRole.customer,
    );
    expect(firstCustomerMessage.id, isNot(secondCustomerMessage.id));
  });

  test('confirm_order action advances to payment status widget', () async {
    final controller = CustomerChatController(
      repository: const FixtureCustomerChatRepository(),
    );

    await controller.submitAction(
      const KfcGenUiAction(
        attachmentId: 'fixture_review',
        actionId: 'confirm_order',
        value: 'confirmed',
      ),
    );

    expect(
      controller.state.value.activeGenUi?.widgetKind,
      KfcGenUiWidgetKind.paymentOrderStatus,
    );
    expect(controller.state.value.messages.last.text, contains('Đơn'));
  });
}
