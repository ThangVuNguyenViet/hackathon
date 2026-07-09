import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_controller.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';

void main() {
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
