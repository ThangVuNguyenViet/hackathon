import 'package:state_beacon/state_beacon.dart';

import '../data/customer_chat_repository.dart';
import '../domain/kfc_genui_models.dart';
import 'customer_chat_state.dart';

class CustomerChatController extends BeaconController {
  CustomerChatController({
    CustomerChatRepository repository = const FixtureCustomerChatRepository(),
    CustomerChatState? initialState,
  }) : _repository = repository {
    state.value = initialState ?? CustomerChatState.initial();
  }

  final CustomerChatRepository _repository;
  var _messageSequence = 0;

  late final state = B.writable(CustomerChatState.initial());

  void updateDraft(String value) {
    state.value = state.value.copyWith(draftText: value, clearError: true);
  }

  Future<void> sendDraft() async {
    final text = state.value.draftText.trim();
    if (text.isEmpty || state.value.isSending) return;
    await _sendCustomerText(text);
  }

  Future<void> sendQuickPrompt(String text) async {
    if (state.value.isSending) return;
    await _sendCustomerText(text);
  }

  Future<void> submitAction(KfcGenUiAction action) async {
    if (state.value.isSending) return;
    final actionMessage = _message(
      CustomerChatRole.customer,
      _customerTextForAction(action),
    );
    state.value = state.value.copyWith(
      messages: [...state.value.messages, actionMessage],
      isSending: true,
      draftText: '',
      clearError: true,
    );
    try {
      final response = await _repository.submitGenUiAction(
        sessionId: state.value.sessionId,
        customerId: state.value.customerId,
        action: action,
      );
      _appendAssistantResponse(response);
    } catch (error) {
      _fail(error);
    }
  }

  Future<void> _sendCustomerText(String text) async {
    final customerMessage = _message(CustomerChatRole.customer, text);
    state.value = state.value.copyWith(
      messages: [...state.value.messages, customerMessage],
      draftText: '',
      isSending: true,
      clearError: true,
    );
    try {
      final response = await _repository.sendMessage(
        sessionId: state.value.sessionId,
        customerId: state.value.customerId,
        text: text,
      );
      _appendAssistantResponse(response);
    } catch (error) {
      _fail(error);
    }
  }

  void _appendAssistantResponse(CustomerChatResponse response) {
    state.value = state.value.copyWith(
      messages: [
        ...state.value.messages,
        _message(
          CustomerChatRole.assistant,
          response.responseText,
          genUi: response.genUi,
        ),
      ],
      isSending: false,
      clearError: true,
    );
  }

  void _fail(Object error) {
    state.value = state.value.copyWith(
      isSending: false,
      errorMessage: error.toString(),
    );
  }

  CustomerChatMessage _message(
    CustomerChatRole role,
    String text, {
    KfcGenUiAttachment? genUi,
  }) {
    _messageSequence += 1;
    return CustomerChatMessage(
      id: 'customer_chat_msg_$_messageSequence',
      role: role,
      text: text,
      genUi: genUi,
    );
  }

  String _customerTextForAction(KfcGenUiAction action) {
    return switch (action.actionId) {
      'confirm_order' => 'Tôi xác nhận đặt đơn',
      'request_human' => 'Cho tôi gặp nhân viên',
      'retry_payment' => 'Gửi lại link thanh toán',
      'track_order' => 'Kiểm tra trạng thái đơn',
      'remove_item' => 'Bỏ ${action.value ?? 'món này'}',
      'update_quantity' => 'Cập nhật ${action.value ?? 'số lượng'}',
      'add_item' => 'Thêm ${action.value ?? 'món này'}',
      _ => action.value ?? action.actionId,
    };
  }
}
