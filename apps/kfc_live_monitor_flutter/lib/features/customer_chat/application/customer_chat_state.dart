import '../domain/kfc_genui_models.dart';

var _nextCustomerChatSequence = 0;

class CustomerChatState {
  const CustomerChatState({
    required this.sessionId,
    required this.customerId,
    this.messages = const <CustomerChatMessage>[],
    this.draftText = '',
    this.isSending = false,
    this.errorMessage,
  });

  factory CustomerChatState.initial({
    String? sessionId,
    String? customerId,
  }) {
    final seed =
        '${DateTime.now().microsecondsSinceEpoch}_${++_nextCustomerChatSequence}';
    return CustomerChatState(
      sessionId: sessionId ?? 'web:kfc-customer-$seed',
      customerId: customerId ?? 'web_customer_$seed',
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
  }) {
    return CustomerChatState(
      sessionId: sessionId,
      customerId: customerId,
      messages: messages ?? this.messages,
      draftText: draftText ?? this.draftText,
      isSending: isSending ?? this.isSending,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }
}
