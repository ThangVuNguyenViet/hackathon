import '../domain/kfc_genui_models.dart';
import 'customer_chat_identity.dart';

class CustomerChatState {
  const CustomerChatState({
    required this.sessionId,
    required this.customerId,
    this.messages = const <CustomerChatMessage>[],
    this.draftText = '',
    this.isSending = false,
    this.errorMessage,
    this.handoffStatus,
  });

  factory CustomerChatState.initial({String? sessionId, String? customerId}) {
    final identity = loadOrCreateKfcCustomerChatIdentity();
    final resolvedCustomerId = customerId ?? identity.customerId;
    return CustomerChatState(
      sessionId: sessionId ?? 'kfc:$resolvedCustomerId',
      customerId: resolvedCustomerId,
      messages: const [
        CustomerChatMessage(
          id: 'welcome',
          role: CustomerChatRole.assistant,
          text:
              'Xin chào, KFC có thể giúp bạn chọn món và đặt đơn ngay tại đây.',
        ),
      ],
    );
  }

  final String sessionId;
  final String customerId;
  final List<CustomerChatMessage> messages;
  final String draftText;
  final bool isSending;
  final String? errorMessage;
  final String? handoffStatus;

  KfcGenUiAttachment? get activeGenUi {
    for (final message in messages.reversed) {
      final genUi = message.genUi;
      if (genUi != null && genUi.status == KfcGenUiStatus.active) return genUi;
    }
    return null;
  }

  CustomerChatState copyWith({
    List<CustomerChatMessage>? messages,
    String? draftText,
    bool? isSending,
    String? errorMessage,
    bool clearError = false,
    String? handoffStatus,
    bool clearHandoffStatus = false,
  }) {
    return CustomerChatState(
      sessionId: sessionId,
      customerId: customerId,
      messages: messages ?? this.messages,
      draftText: draftText ?? this.draftText,
      isSending: isSending ?? this.isSending,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      handoffStatus: clearHandoffStatus
          ? null
          : (handoffStatus ?? this.handoffStatus),
    );
  }
}
