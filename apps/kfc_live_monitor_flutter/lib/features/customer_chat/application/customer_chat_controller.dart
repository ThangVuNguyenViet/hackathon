import 'dart:async';

import 'package:state_beacon/state_beacon.dart';

import '../data/customer_chat_repository.dart';
import '../domain/kfc_genui_models.dart';
import 'customer_chat_state.dart';

class CustomerChatController extends BeaconController {
  CustomerChatController({
    CustomerChatRepository repository = const FixtureCustomerChatRepository(),
    CustomerChatState? initialState,
    Duration handoffPollInterval = const Duration(seconds: 3),
  }) : _repository = repository {
    _handoffPollInterval = handoffPollInterval;
    state.value = initialState ?? CustomerChatState.initial();
  }

  final CustomerChatRepository _repository;
  late final Duration _handoffPollInterval;
  Timer? _handoffTimer;
  final Set<String> _seenRemoteTurns = {};
  String? _lastRemoteTurnId;
  var _disposed = false;
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
        clientMessageId: actionMessage.id,
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
        clientMessageId: customerMessage.id,
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
    if (response.genUi?.widgetKind == KfcGenUiWidgetKind.supportHandoff) {
      state.value = state.value.copyWith(
        handoffStatus:
            response.genUi?.data['handoffStatus']?.toString() ?? 'queued',
      );
      if (state.value.handoffStatus == 'queued') _startHandoffPolling();
    }
  }

  void _startHandoffPolling() {
    _handoffTimer ??= Timer.periodic(
      _handoffPollInterval,
      (_) => _pollHandoff(),
    );
    unawaited(_pollHandoff());
  }

  Future<void> _pollHandoff() async {
    try {
      final updates = await _repository.getSessionUpdates(
        sessionId: state.value.sessionId,
        afterTurnId: _lastRemoteTurnId,
      );
      if (_disposed) return;
      if (updates.turns.isNotEmpty) {
        _lastRemoteTurnId = updates.turns.last.id;
      }
      final newMessages = updates.turns
          .where(
            (turn) =>
                turn.isHumanAgent &&
                turn.role == 'assistant' &&
                _seenRemoteTurns.add(turn.id),
          )
          .map(
            (turn) => CustomerChatMessage(
              id: turn.id,
              role: CustomerChatRole.assistant,
              text: turn.text,
            ),
          )
          .toList(growable: false);
      state.value = state.value.copyWith(
        messages: newMessages.isEmpty
            ? null
            : [...state.value.messages, ...newMessages],
        handoffStatus: updates.handoffStatus,
        clearHandoffStatus: updates.handoffStatus == null,
      );
      if (updates.handoffStatus == null) {
        _handoffTimer?.cancel();
        _handoffTimer = null;
      }
    } catch (_) {
      // Polling is best-effort; normal send errors remain user-visible.
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _handoffTimer?.cancel();
    super.dispose();
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
      id: 'customer_chat_msg_${DateTime.now().microsecondsSinceEpoch}_$_messageSequence',
      role: role,
      text: text,
      genUi: genUi,
    );
  }

  String _customerTextForAction(KfcGenUiAction action) {
    final quantity = action.payload['quantity'];
    final quantityPrefix = quantity is num && quantity > 1
        ? '${quantity.round()} x '
        : '';
    return switch (action.actionId) {
      'add_item' => 'Thêm $quantityPrefix${action.value ?? 'món này'} vào giỏ',
      'customize_item' => 'Tùy chỉnh ${action.value ?? 'combo'}',
      'continue_to_fulfillment' => 'Tiếp tục giao hàng',
      'edit_cart' => 'Sửa giỏ hàng',
      'remove_item' => 'Xóa ${action.value ?? 'món này'}',
      'update_item_quantity' =>
        'Đổi số lượng ${action.value ?? 'món này'} thành ${quantity ?? 1}',
      'accept_fulfillment' => 'Giao đến địa chỉ này',
      'submit_address' => 'Tôi muốn đổi địa chỉ',
      'confirm_order' => 'Tôi đặt đơn này',
      'apply_voucher' => 'Áp mã giảm giá',
      'open_payment' => 'Thanh toán bằng ${action.value ?? 'MoMo'}',
      'change_payment_method' => 'Đổi phương thức thanh toán',
      'select_payment_method' =>
        'Chọn ${action.value ?? 'phương thức thanh toán'}',
      'track_order' => 'Theo dõi đơn ${action.value ?? ''}'.trim(),
      'request_human' => 'Cho tôi gặp nhân viên ngay',
      'send_issue_summary' => 'Gửi tóm tắt lỗi cho nhân viên',
      _ => action.value ?? action.actionId,
    };
  }
}
