import 'dart:async';

import 'package:state_beacon/state_beacon.dart';

import '../data/customer_chat_repository.dart';
import '../domain/customer_confirmation_models.dart';
import '../domain/customer_run_models.dart';
import '../domain/kfc_genui_models.dart';
import 'customer_chat_state.dart';
import 'mutation_beacon.dart';

class CustomerChatController extends BeaconController {
  CustomerChatController({
    CustomerChatRepository repository = const FixtureCustomerChatRepository(),
    CustomerChatState? initialState,
    Duration handoffPollInterval = const Duration(seconds: 3),
    List<Duration> reconnectDelays = const [
      Duration(milliseconds: 250),
      Duration(milliseconds: 500),
      Duration(seconds: 1),
      Duration(seconds: 2),
    ],
  }) : _repository = repository,
       _handoffPollInterval = handoffPollInterval,
       _reconnectDelays = reconnectDelays {
    final resolvedState = initialState ?? CustomerChatState.initial();
    state.value = resolvedState;
    _modeStates[resolvedState.responseMode] = resolvedState;
  }

  final CustomerChatRepository _repository;
  final Duration _handoffPollInterval;
  final List<Duration> _reconnectDelays;
  StreamSubscription<CustomerRunEventEnvelope>? _runSubscription;
  Future<void>? _activeRunCompletion;
  Timer? _handoffTimer;
  final Map<CustomerChatResponseMode, CustomerChatState> _modeStates = {};
  final Map<String, Set<String>> _seenRemoteTurnsBySession = {};
  final Map<String, String> _lastRemoteTurnIdBySession = {};
  var _disposed = false;
  var _messageSequence = 0;

  late final state = B.writable(CustomerChatState.initial());
  late final _submissionMutation = B.mutation<void, _CustomerChatSubmission>(
    _submit,
    name: 'customerChatSubmissionMutation',
  );
  late final _stopMutation = B.mutation<void, Object?>(
    _stopActiveRun,
    name: 'customerChatStopMutation',
  );

  void updateDraft(String value) {
    state.value = state.value.copyWith(draftText: value, clearError: true);
  }

  void setResponseMode(CustomerChatResponseMode mode) {
    if (state.value.isSending || state.value.responseMode == mode) return;
    final current = state.value;
    _modeStates[current.responseMode] = current;
    _handoffTimer?.cancel();
    _handoffTimer = null;
    state.value = _modeStates.putIfAbsent(
      mode,
      () => CustomerChatState.initial(
        customerId: current.customerId,
        responseMode: mode,
      ),
    );
    if (state.value.handoffStatus != null) _startHandoffPolling();
  }

  Future<void> sendDraft() {
    final text = state.value.draftText.trim();
    if (text.isEmpty || !_canSubmit) return Future.value();
    return _runSubmission(_CustomerChatSubmission.text(text));
  }

  Future<void> sendQuickPrompt(String text) {
    if (!_canSubmit) return Future.value();
    return _runSubmission(_CustomerChatSubmission.text(text));
  }

  Future<void> submitAction(KfcGenUiAction action) {
    final attachment = state.value.actionAttachment(action.attachmentId);
    if (!_canSubmit ||
        attachment?.authorityMatches(
              sessionId: state.value.sessionId,
              customerId: state.value.customerId,
            ) !=
            true ||
        attachment?.authorizesAction(action) != true) {
      return Future.value();
    }
    if (attachment!.authority?.actionLifecycle == 'one_shot') {
      _markAttachmentAnswered(attachment.id);
    }
    return _runSubmission(_CustomerChatSubmission.action(action));
  }

  void _markAttachmentAnswered(String attachmentId) {
    state.value = state.value.copyWith(
      messages: [
        for (final message in state.value.messages)
          if (message.genUi case final attachment?
              when attachment.id == attachmentId)
            CustomerChatMessage(
              id: message.id,
              role: message.role,
              text: message.text,
              genUi: KfcGenUiAttachment(
                id: attachment.id,
                lifecycleStage: attachment.lifecycleStage,
                widgetKind: attachment.widgetKind,
                status: KfcGenUiStatus.answered,
                title: attachment.title,
                summary: attachment.summary,
                data: attachment.data,
                actions: attachment.actions,
                selectedAction: attachment.selectedAction,
                expiresAt: attachment.expiresAt,
                authority: attachment.authority,
                hasValidAuthorityEncoding: attachment.hasValidAuthorityEncoding,
                hasValidActionEncoding: attachment.hasValidActionEncoding,
                interactionFinality: attachment.interactionFinality,
              ),
            )
          else
            message,
      ],
    );
  }

  Future<void> stopActiveRun() {
    if (_stopMutation.isLoading) return Future.value();
    return _stopMutation.run(null);
  }

  Future<void> approvePendingConfirmation() =>
      _resumePendingConfirmation(CustomerConfirmationDecision.approve);

  Future<void> rejectPendingConfirmation() =>
      _resumePendingConfirmation(CustomerConfirmationDecision.reject);

  bool get _canSubmit =>
      !state.value.isSending &&
      state.value.pendingApproval == null &&
      !_submissionMutation.isLoading;

  Future<void> _resumePendingConfirmation(
    CustomerConfirmationDecision decision,
  ) async {
    final pause = state.value.pendingApproval;
    if (pause == null || state.value.isResumingApproval) return;
    if (!pause.expiresAt.isAfter(DateTime.now().toUtc())) {
      state.value = state.value.copyWith(
        clearPendingApproval: true,
        errorMessage: 'Xác nhận đã hết hạn. Vui lòng yêu cầu KFC kiểm tra lại.',
      );
      return;
    }
    state.value = state.value.copyWith(
      isResumingApproval: true,
      clearError: true,
    );
    try {
      final result = await _repository.resumeConfirmation(
        requestId: pause.requestId,
        approvalCapability: pause.approvalCapability,
        decision: decision,
      );
      if (_disposed ||
          state.value.pendingApproval?.requestId != pause.requestId ||
          state.value.pendingApproval?.approvalCapability !=
              pause.approvalCapability) {
        return;
      }
      final messages = result.responseText.isEmpty
          ? state.value.messages
          : [
              ...state.value.messages,
              _message(CustomerChatRole.assistant, result.responseText),
            ];
      state.value = state.value.copyWith(
        messages: messages,
        pendingApproval: result.nextApproval,
        clearPendingApproval: result.nextApproval == null,
        isResumingApproval: false,
        clearError: true,
      );
    } catch (error) {
      if (_disposed) return;
      final invalidates =
          error is CustomerConfirmationResumeException &&
          error.invalidatesCapability;
      state.value = state.value.copyWith(
        clearPendingApproval: invalidates,
        isResumingApproval: false,
        errorMessage: invalidates
            ? 'Xác nhận không còn hiệu lực. Vui lòng yêu cầu KFC kiểm tra lại.'
            : 'Chưa thể gửi xác nhận lúc này. Vui lòng thử lại.',
      );
    }
  }

  Future<void> _runSubmission(_CustomerChatSubmission submission) async {
    await _submissionMutation.run(submission);
    await _activeRunCompletion;
  }

  Future<void> _submit(_CustomerChatSubmission submission) async {
    _activeRunCompletion = null;
    await _startCustomerRun(text: submission.text, action: submission.action);
  }

  Future<void> _stopActiveRun(Object? _) async {
    final draft = state.value.activeDraft;
    if (draft == null || draft.isTerminal || !draft.cancellable) return;
    state.value = state.value.copyWith(
      activeDraft: draft.copyWith(isStopping: true, cancellable: false),
      clearError: true,
    );
    try {
      await _repository.cancelRun(draft.runId);
    } catch (_) {
      if (_disposed) return;
      state.value = state.value.copyWith(
        activeDraft: draft,
        errorMessage: 'Chưa thể dừng lúc này. KFC vẫn đang xử lý an toàn.',
      );
    }
  }

  Future<void> _startCustomerRun({String? text, KfcGenUiAction? action}) async {
    final customerText = text ?? _customerTextForAction(action!);
    final customerMessage = _message(CustomerChatRole.customer, customerText);
    state.value = state.value.copyWith(
      messages: [...state.value.messages, customerMessage],
      draftText: '',
      clearActiveDraft: true,
      clearPendingApproval: true,
      clearError: true,
    );
    try {
      final accepted = await _repository.startRun(
        sessionId: state.value.sessionId,
        customerId: state.value.customerId,
        clientMessageId: customerMessage.id,
        text: text,
        action: action,
        metadata: text == null
            ? null
            : {'showcaseResponseMode': state.value.responseMode.name},
      );
      if (_disposed) return;
      state.value = state.value.copyWith(
        activeDraft: ActiveAssistantDraft.accepted(runId: accepted.runId),
      );
      final completion = _watchAcceptedRun(accepted.runId);
      _activeRunCompletion = completion;
      unawaited(completion);
    } catch (_) {
      _showConnectionFailure();
    }
  }

  Future<void> _watchAcceptedRun(String runId) async {
    var reconnectAttempt = 0;
    while (!_disposed) {
      final draft = state.value.activeDraft;
      if (draft == null || draft.runId != runId || draft.isTerminal) return;
      if (reconnectAttempt > 0) {
        state.value = state.value.copyWith(
          activeDraft: draft.copyWith(
            connection: CustomerRunConnectionState.reconnecting,
          ),
        );
      }
      try {
        await _consumeConnection(runId, draft.lastSequence);
        final current = state.value.activeDraft;
        if (current == null || current.runId != runId || current.isTerminal) {
          return;
        }
      } catch (_) {
        if (_disposed) return;
      }
      final current = state.value.activeDraft;
      if (current == null || current.runId != runId || current.isTerminal) {
        return;
      }
      final delay =
          _reconnectDelays[reconnectAttempt.clamp(
            0,
            _reconnectDelays.length - 1,
          )];
      reconnectAttempt += 1;
      await Future<void>.delayed(delay);
    }
  }

  Future<void> _consumeConnection(String runId, int afterSequence) async {
    final completer = Completer<void>();
    late final StreamSubscription<CustomerRunEventEnvelope> subscription;
    subscription = _repository
        .watchRun(runId, afterSequence)
        .listen(
          (event) {
            try {
              _applyRunEvent(event);
            } on CustomerRunSequenceGap {
              unawaited(subscription.cancel());
              if (!completer.isCompleted) {
                completer.completeError(
                  const FormatException('run sequence gap'),
                );
              }
            }
          },
          onError: (Object error, StackTrace stackTrace) {
            if (!completer.isCompleted) {
              completer.completeError(error, stackTrace);
            }
          },
          onDone: () {
            if (!completer.isCompleted) completer.complete();
          },
          cancelOnError: true,
        );
    _runSubscription = subscription;
    try {
      await completer.future;
    } finally {
      if (identical(_runSubscription, subscription)) _runSubscription = null;
      await subscription.cancel();
    }
  }

  void _applyRunEvent(CustomerRunEventEnvelope event) {
    if (_disposed) return;
    final draft = state.value.activeDraft;
    if (draft == null || draft.runId != event.runId) return;
    final reduced = draft.reduce(event);
    if (identical(reduced, draft)) return;
    state.value = state.value.copyWith(activeDraft: reduced, clearError: true);
    if (reduced.isTerminal && !reduced.materialized) {
      _materializeTerminal(reduced);
    }
  }

  void _materializeTerminal(ActiveAssistantDraft draft) {
    final isHumanOwnedSupersession =
        draft.terminal == CustomerRunTerminal.superseded &&
        draft.agentMode == CustomerRunAgentMode.humanPaused;
    final hasVisibleResponse =
        !isHumanOwnedSupersession &&
        (draft.text.isNotEmpty || draft.genUi != null);
    final messages = hasVisibleResponse
        ? [
            ...state.value.messages,
            _message(
              CustomerChatRole.assistant,
              draft.text,
              genUi: draft.genUi,
            ),
          ]
        : state.value.messages;
    state.value = state.value.copyWith(
      messages: messages,
      activeDraft: draft.copyWith(materialized: true),
      clearPendingApproval: true,
      isResumingApproval: false,
      errorMessage: switch (draft.terminal) {
        CustomerRunTerminal.cancelled =>
          draft.terminalMessage ?? 'Đã dừng theo yêu cầu.',
        CustomerRunTerminal.failed =>
          draft.terminalMessage ?? 'Không thể hoàn tất yêu cầu lúc này.',
        _ => null,
      },
      clearError:
          draft.terminal == CustomerRunTerminal.completed ||
          isHumanOwnedSupersession,
      handoffStatus: isHumanOwnedSupersession ? 'joined' : null,
    );
    if (isHumanOwnedSupersession) _startHandoffPolling();
    if (draft.genUi?.widgetKind == KfcGenUiWidgetKind.supportHandoff) {
      state.value = state.value.copyWith(
        handoffStatus:
            draft.genUi?.data['handoffStatus']?.toString() ?? 'queued',
      );
      if (state.value.handoffStatus == 'queued') _startHandoffPolling();
    }
  }

  void _showConnectionFailure() {
    if (_disposed) return;
    state.value = state.value.copyWith(
      clearActiveDraft: true,
      errorMessage: 'Không thể kết nối với KFC lúc này. Vui lòng thử lại.',
    );
  }

  void _startHandoffPolling() {
    _handoffTimer ??= Timer.periodic(
      _handoffPollInterval,
      (_) => _pollHandoff(),
    );
    unawaited(_pollHandoff());
  }

  Future<void> _pollHandoff() async {
    final sessionId = state.value.sessionId;
    try {
      final updates = await _repository.getSessionUpdates(
        sessionId: sessionId,
        afterTurnId: _lastRemoteTurnIdBySession[sessionId],
      );
      if (_disposed || state.value.sessionId != sessionId) return;
      if (updates.turns.isNotEmpty) {
        _lastRemoteTurnIdBySession[sessionId] = updates.turns.last.id;
      }
      final seenRemoteTurns = _seenRemoteTurnsBySession.putIfAbsent(
        sessionId,
        () => <String>{},
      );
      final newMessages = updates.turns
          .where(
            (turn) =>
                turn.isHumanAgent &&
                turn.role == 'assistant' &&
                seenRemoteTurns.add(turn.id),
          )
          .map(
            (turn) => CustomerChatMessage(
              id: turn.id,
              role: CustomerChatRole.assistant,
              text: turn.text,
            ),
          )
          .toList(growable: false);
      final effectiveHandoffStatus =
          updates.handoffStatus ??
          (updates.agentMode == 'human_paused' ? 'joined' : null);
      state.value = state.value.copyWith(
        messages: newMessages.isEmpty
            ? null
            : [...state.value.messages, ...newMessages],
        handoffStatus: effectiveHandoffStatus,
        clearHandoffStatus: effectiveHandoffStatus == null,
      );
      if (effectiveHandoffStatus == null) {
        _handoffTimer?.cancel();
        _handoffTimer = null;
      }
    } catch (_) {
      // Best effort after a customer-visible handoff has already been established.
    }
  }

  @override
  void dispose() {
    _disposed = true;
    unawaited(_runSubscription?.cancel());
    _handoffTimer?.cancel();
    super.dispose();
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
      'add_items' => _addItemsCustomerText(action),
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
      'open_payment' =>
        _paymentMethodDisplayName(action.value) == null
            ? 'Tiếp tục thanh toán'
            : 'Tiếp tục thanh toán bằng ${_paymentMethodDisplayName(action.value)}',
      'change_payment_method' => 'Đổi phương thức thanh toán',
      'select_payment_method' =>
        'Chọn ${action.value ?? 'phương thức thanh toán'}',
      'track_order' => 'Theo dõi đơn ${action.value ?? ''}'.trim(),
      'request_human' => 'Cho tôi gặp nhân viên ngay',
      'send_issue_summary' => 'Gửi tóm tắt lỗi cho nhân viên',
      _ => action.value ?? action.actionId,
    };
  }

  String? _paymentMethodDisplayName(String? methodId) {
    if (methodId == null || methodId.isEmpty) return null;
    for (final message in state.value.messages.reversed) {
      final methods = message.genUi?.data['methods'];
      if (methods is! List) continue;
      for (final method in methods) {
        if (method is! Map || method['methodId'] != methodId) continue;
        final displayName = method['displayName'];
        if (displayName is String && displayName.trim().isNotEmpty) {
          return displayName.trim();
        }
      }
    }
    return null;
  }

  String _addItemsCustomerText(KfcGenUiAction action) {
    const fallback = 'Xác nhận các món đã chọn';
    final catalogItems = state.value
        .actionAttachment(action.attachmentId)
        ?.data['items'];
    final selectedItems = action.payload['items'];
    if (catalogItems is! List ||
        selectedItems is! List ||
        selectedItems.isEmpty) {
      return fallback;
    }

    final namesByCode = <String, String>{};
    final duplicateCodes = <String>{};
    for (final rawItem in catalogItems) {
      if (rawItem is! Map) continue;
      final code = rawItem['code'];
      final name = rawItem['name'];
      if (code is! String ||
          code.isEmpty ||
          name is! String ||
          name.trim().isEmpty) {
        continue;
      }
      if (namesByCode.containsKey(code)) duplicateCodes.add(code);
      namesByCode[code] = name.trim();
    }
    for (final code in duplicateCodes) {
      namesByCode.remove(code);
    }

    final selections = <String>[];
    for (final rawSelection in selectedItems) {
      if (rawSelection is! Map) return fallback;
      final itemCode = rawSelection['itemCode'];
      final rawQuantity = rawSelection['quantity'];
      final quantity = rawQuantity is num && rawQuantity.isFinite
          ? rawQuantity.toInt()
          : null;
      final name = itemCode is String ? namesByCode[itemCode] : null;
      if (name == null ||
          quantity == null ||
          quantity < 1 ||
          quantity > 99 ||
          rawQuantity != quantity) {
        return fallback;
      }
      selections.add('$quantity × $name');
    }
    return selections.isEmpty
        ? fallback
        : 'Thêm vào giỏ: ${selections.join(', ')}';
  }
}

class _CustomerChatSubmission {
  const _CustomerChatSubmission.text(this.text) : action = null;
  const _CustomerChatSubmission.action(this.action) : text = null;

  final String? text;
  final KfcGenUiAction? action;
}
