import '../domain/customer_confirmation_models.dart';
import '../domain/kfc_genui_models.dart';
import '../domain/customer_run_models.dart';
import 'customer_chat_identity.dart';

class CustomerChatState {
  const CustomerChatState({
    required this.sessionId,
    required this.customerId,
    this.messages = const <CustomerChatMessage>[],
    this.draftText = '',
    this.activeDraft,
    this.pendingApproval,
    this.isResumingApproval = false,
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
  final ActiveAssistantDraft? activeDraft;
  final CustomerApprovalPause? pendingApproval;
  final bool isResumingApproval;
  bool get isSending =>
      (activeDraft != null && !activeDraft!.isTerminal) ||
      pendingApproval != null ||
      isResumingApproval;
  final String? errorMessage;
  final String? handoffStatus;

  KfcGenUiAttachment? get activeGenUi {
    for (final message in messages.reversed) {
      final genUi = message.genUi;
      if (genUi?.canSubmitActions == true) return genUi;
    }
    return null;
  }

  KfcGenUiAttachment? actionAttachment(String attachmentId) {
    final draftAttachment = activeDraft?.genUi;
    if (draftAttachment?.id == attachmentId) return draftAttachment;
    for (final message in messages.reversed) {
      if (message.genUi?.id == attachmentId) return message.genUi;
    }
    return null;
  }

  CustomerChatState copyWith({
    List<CustomerChatMessage>? messages,
    String? draftText,
    ActiveAssistantDraft? activeDraft,
    bool clearActiveDraft = false,
    CustomerApprovalPause? pendingApproval,
    bool clearPendingApproval = false,
    bool? isResumingApproval,
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
      activeDraft: clearActiveDraft ? null : (activeDraft ?? this.activeDraft),
      pendingApproval: clearPendingApproval
          ? null
          : (pendingApproval ?? this.pendingApproval),
      isResumingApproval: isResumingApproval ?? this.isResumingApproval,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      handoffStatus: clearHandoffStatus
          ? null
          : (handoffStatus ?? this.handoffStatus),
    );
  }
}
