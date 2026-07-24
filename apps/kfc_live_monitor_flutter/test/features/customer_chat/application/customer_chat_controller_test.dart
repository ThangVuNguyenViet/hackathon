import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_controller.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_state.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/customer_confirmation_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_agent_model_candidate.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/customer_run_models.dart';

void main() {
  test('default customer chat states use KFC source session ids', () {
    final first = CustomerChatState.initial();
    final second = CustomerChatState.initial();

    expect(first.customerId, startsWith('anon_customer_'));
    expect(first.sessionId, 'kfc:${first.customerId}');
    expect(second.customerId, startsWith('anon_customer_'));
    expect(second.sessionId, 'kfc:${second.customerId}');
    expect(second.sessionId, isNot(first.sessionId));
    expect(second.customerId, isNot(first.customerId));
    expect(first.selectedModel, KfcAgentModelCandidate.openAi);
  });

  test(
    'switching models affects the next run and preserves shared transcript provenance',
    () async {
      final repository = _RecordingStartRepository();
      final controller = CustomerChatController(repository: repository);

      await controller.sendQuickPrompt('Gợi ý combo');
      controller.selectModel(KfcAgentModelCandidate.qwen);
      await controller.sendQuickPrompt('Thêm món vào giỏ');

      expect(repository.candidateIds, [
        KfcAgentModelCandidate.openAi.wireName,
        KfcAgentModelCandidate.qwen.wireName,
      ]);
      expect(
        controller.state.value.messages.where(
          (message) => message.role == CustomerChatRole.customer,
        ),
        hasLength(2),
      );
      expect(
        controller.state.value.messages
            .where(
              (message) =>
                  message.role == CustomerChatRole.assistant &&
                  message.id != 'welcome',
            )
            .map((message) => message.modelCandidate),
        [KfcAgentModelCandidate.openAi, KfcAgentModelCandidate.qwen],
      );
    },
  );

  test('cannot change the captured model while a run is active', () {
    final controller = CustomerChatController(
      initialState: CustomerChatState(
        sessionId: 'kfc:customer-1',
        customerId: 'customer-1',
        activeDraft: ActiveAssistantDraft.accepted(
          runId: 'run-1',
          modelCandidate: KfcAgentModelCandidate.openAi,
        ),
      ),
    );

    controller.selectModel(KfcAgentModelCandidate.miniMax);

    expect(controller.state.value.selectedModel, KfcAgentModelCandidate.openAi);
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

  test(
    'message identities do not collide after a controller restart',
    () async {
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
    },
  );

  test('accepts a second submission after the prior run terminates', () async {
    final controller = CustomerChatController(
      repository: const FixtureCustomerChatRepository(
        eventDelay: Duration.zero,
      ),
    );
    controller.updateDraft('Gợi ý combo');
    await controller.sendDraft();
    controller.updateDraft('Thêm món vào giỏ');
    await controller.sendDraft();
    expect(
      controller.state.value.messages.where(
        (message) => message.role == CustomerChatRole.customer,
      ),
      hasLength(2),
    );
  });

  test(
    'human-paused supersession keeps the customer turn without an assistant bubble',
    () async {
      final controller = CustomerChatController(
        repository: const _HumanPausedRepository(),
        handoffPollInterval: const Duration(hours: 1),
      );

      await controller.sendQuickPrompt('Tôi vẫn cần nhân viên kiểm tra đơn.');

      final state = controller.state.value;
      expect(state.activeDraft?.terminal, CustomerRunTerminal.superseded);
      expect(state.activeDraft?.agentMode, CustomerRunAgentMode.humanPaused);
      expect(state.errorMessage, isNull);
      expect(state.handoffStatus, 'joined');
      expect(
        state.messages
            .where((message) => message.role == CustomerChatRole.customer)
            .map((message) => message.text),
        ['Tôi vẫn cần nhân viên kiểm tra đơn.'],
      );
      expect(
        state.messages.where(
          (message) =>
              message.role == CustomerChatRole.assistant &&
              message.id != 'welcome',
        ),
        isEmpty,
      );
      controller.dispose();
    },
  );

  test(
    'generic newer-turn supersession stays non-error without entering handoff',
    () async {
      final repository = _GenericSupersededRepository();
      final controller = CustomerChatController(repository: repository);

      await controller.sendQuickPrompt('Yêu cầu cũ');

      final state = controller.state.value;
      expect(state.activeDraft?.terminal, CustomerRunTerminal.superseded);
      expect(state.activeDraft?.agentMode, isNull);
      expect(state.errorMessage, isNull);
      expect(state.handoffStatus, isNull);
      expect(repository.sessionUpdateCalls, 0);
      expect(state.messages.last.role, CustomerChatRole.assistant);
      expect(state.messages.last.text, 'Một phần');
      controller.dispose();
    },
  );

  test('confirm_order action advances to payment status widget', () async {
    final controller = CustomerChatController(
      repository: const FixtureCustomerChatRepository(),
      initialState: CustomerChatState(
        sessionId: 'kfc:fixture',
        customerId: 'fixture',
        messages: [
          CustomerChatMessage(
            id: 'review_turn',
            role: CustomerChatRole.assistant,
            text: 'Xác nhận đơn',
            genUi: kfcGenUiFixture(KfcGenUiWidgetKind.orderReviewConfirm),
          ),
        ],
      ),
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

  test(
    'rejects an action that is not authorized by a retained attachment',
    () async {
      final controller = CustomerChatController(
        repository: const FixtureCustomerChatRepository(),
      );

      await controller.submitAction(
        const KfcGenUiAction(
          attachmentId: 'missing_attachment',
          actionId: 'confirm_order',
          value: 'confirmed',
        ),
      );

      expect(
        controller.state.value.messages.where(
          (message) => message.role == CustomerChatRole.customer,
        ),
        isEmpty,
      );
    },
  );

  test(
    'rejects an exact retained action when authority identity mismatches state',
    () async {
      final repository = _RecordingStartRepository();
      const attachment = KfcGenUiAttachment(
        id: 'identity_bound',
        lifecycleStage: 'checkout',
        widgetKind: KfcGenUiWidgetKind.orderReviewConfirm,
        status: KfcGenUiStatus.active,
        title: 'Xác nhận đơn',
        expiresAt: '2099-07-21T00:00:00.000Z',
        authority: KfcGenUiAuthority(
          schemaVersion: 'kfc-genui-v1',
          sessionId: 'kfc:other_customer',
          customerId: 'other_customer',
          verifiedRevision:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          actionLifecycle: 'one_shot',
          issuedAt: '2026-07-19T00:00:00.000Z',
          expiresAt: '2099-07-21T00:00:00.000Z',
        ),
        actions: [
          KfcGenUiActionSpec(
            id: 'confirm_order',
            label: 'Xác nhận',
            value: 'confirmed',
          ),
        ],
      );
      final controller = CustomerChatController(
        repository: repository,
        initialState: const CustomerChatState(
          sessionId: 'kfc:expected_customer',
          customerId: 'expected_customer',
          messages: [
            CustomerChatMessage(
              id: 'identity_message',
              role: CustomerChatRole.assistant,
              text: 'Xác nhận đơn',
              genUi: attachment,
            ),
          ],
        ),
      );

      await controller.submitAction(
        const KfcGenUiAction(
          attachmentId: 'identity_bound',
          actionId: 'confirm_order',
          value: 'confirmed',
        ),
      );

      expect(repository.startCount, 0);
      expect(
        controller.state.value.messages.where(
          (message) => message.role == CustomerChatRole.customer,
        ),
        isEmpty,
      );
    },
  );

  test(
    'controller rejects forged dynamic ids, ambiguity, support, and quantity',
    () async {
      final cases = <({KfcGenUiAttachment attachment, KfcGenUiAction action})>[
        (
          attachment: const KfcGenUiAttachment(
            id: 'menu_unknown',
            lifecycleStage: 'menu',
            widgetKind: KfcGenUiWidgetKind.smartMenuPicker,
            status: KfcGenUiStatus.active,
            title: 'Chọn món',
            data: {
              'items': [
                {'code': 'sku_1', 'name': 'Món một'},
              ],
            },
            actions: [KfcGenUiActionSpec(id: 'add_items', label: 'Xác nhận')],
          ),
          action: const KfcGenUiAction(
            attachmentId: 'menu_unknown',
            actionId: 'add_items',
            payload: {
              'items': [
                {'itemCode': 'unknown', 'quantity': 1},
              ],
            },
          ),
        ),
        (
          attachment: const KfcGenUiAttachment(
            id: 'cart_unknown',
            lifecycleStage: 'cart',
            widgetKind: KfcGenUiWidgetKind.cartBuilder,
            status: KfcGenUiStatus.active,
            title: 'Giỏ hàng',
            data: {
              'cart': {
                'items': [
                  {'itemCode': 'sku_1', 'name': 'Món một', 'quantity': 1},
                ],
              },
            },
            actions: [KfcGenUiActionSpec(id: 'remove_item', label: 'Xóa')],
          ),
          action: const KfcGenUiAction(
            attachmentId: 'cart_unknown',
            actionId: 'remove_item',
            payload: {'itemCode': 'unknown'},
          ),
        ),
        (
          attachment: const KfcGenUiAttachment(
            id: 'cart_duplicate',
            lifecycleStage: 'cart',
            widgetKind: KfcGenUiWidgetKind.cartBuilder,
            status: KfcGenUiStatus.active,
            title: 'Giỏ hàng',
            data: {
              'cart': {
                'items': [
                  {'itemCode': 'sku_1', 'name': 'Món một', 'quantity': 1},
                  {'itemCode': 'sku_1', 'name': 'Món trùng', 'quantity': 1},
                ],
              },
            },
            actions: [KfcGenUiActionSpec(id: 'remove_item', label: 'Xóa')],
          ),
          action: const KfcGenUiAction(
            attachmentId: 'cart_duplicate',
            actionId: 'remove_item',
            payload: {'itemCode': 'sku_1'},
          ),
        ),
        (
          attachment: const KfcGenUiAttachment(
            id: 'cart_quantity',
            lifecycleStage: 'cart',
            widgetKind: KfcGenUiWidgetKind.cartBuilder,
            status: KfcGenUiStatus.active,
            title: 'Giỏ hàng',
            data: {
              'cart': {
                'items': [
                  {'itemCode': 'sku_1', 'name': 'Món một', 'quantity': 99},
                ],
              },
            },
            actions: [
              KfcGenUiActionSpec(
                id: 'update_item_quantity',
                label: 'Đổi số lượng',
              ),
            ],
          ),
          action: const KfcGenUiAction(
            attachmentId: 'cart_quantity',
            actionId: 'update_item_quantity',
            payload: {'itemCode': 'sku_1', 'quantity': 100},
          ),
        ),
        (
          attachment: const KfcGenUiAttachment(
            id: 'modifier_cross_row',
            lifecycleStage: 'modifier',
            widgetKind: KfcGenUiWidgetKind.modifierPicker,
            status: KfcGenUiStatus.active,
            title: 'Tùy chỉnh',
            data: {
              'modifierTree': {
                'itemCode': 'sku_1',
                'modifierGroups': [
                  {
                    'groupId': 'flavor',
                    'options': [
                      {'modifierId': 'spicy', 'name': 'Cay'},
                    ],
                  },
                ],
              },
            },
            actions: [
              KfcGenUiActionSpec(
                id: 'customize_item:flavor:spicy',
                label: 'Cay',
                value: 'Lựa chọn khác',
                payload: {
                  'itemCode': 'sku_1',
                  'groupId': 'flavor',
                  'modifierId': 'spicy',
                },
              ),
            ],
          ),
          action: const KfcGenUiAction(
            attachmentId: 'modifier_cross_row',
            actionId: 'customize_item:flavor:spicy',
            value: 'Lựa chọn khác',
            payload: {
              'itemCode': 'sku_1',
              'groupId': 'flavor',
              'modifierId': 'spicy',
            },
          ),
        ),
        (
          attachment: const KfcGenUiAttachment(
            id: 'payment_duplicate',
            lifecycleStage: 'payment_method',
            widgetKind: KfcGenUiWidgetKind.paymentMethodPicker,
            status: KfcGenUiStatus.active,
            title: 'Thanh toán',
            data: {
              'methods': [
                {'methodId': 'cod', 'displayName': 'COD', 'supported': true},
                {
                  'methodId': 'cod',
                  'displayName': 'COD trùng',
                  'supported': true,
                },
              ],
            },
            actions: [
              KfcGenUiActionSpec(
                id: 'select_payment_method',
                label: 'Chọn phương thức',
              ),
            ],
          ),
          action: const KfcGenUiAction(
            attachmentId: 'payment_duplicate',
            actionId: 'select_payment_method',
            payload: {'methodId': 'cod'},
          ),
        ),
        (
          attachment: const KfcGenUiAttachment(
            id: 'payment_unsupported',
            lifecycleStage: 'payment_method',
            widgetKind: KfcGenUiWidgetKind.paymentMethodPicker,
            status: KfcGenUiStatus.active,
            title: 'Thanh toán',
            data: {
              'methods': [
                {
                  'methodId': 'unsupported',
                  'displayName': 'Không hỗ trợ',
                  'supported': false,
                },
              ],
            },
            actions: [
              KfcGenUiActionSpec(
                id: 'select_payment_method',
                label: 'Chọn phương thức',
              ),
            ],
          ),
          action: const KfcGenUiAction(
            attachmentId: 'payment_unsupported',
            actionId: 'select_payment_method',
            payload: {'methodId': 'unsupported'},
          ),
        ),
        (
          attachment: const KfcGenUiAttachment(
            id: 'payment_unknown',
            lifecycleStage: 'payment_method',
            widgetKind: KfcGenUiWidgetKind.paymentMethodPicker,
            status: KfcGenUiStatus.active,
            title: 'Thanh toán',
            data: {
              'methods': [
                {'methodId': 'cod', 'displayName': 'COD', 'supported': true},
              ],
            },
            actions: [
              KfcGenUiActionSpec(
                id: 'select_payment_method',
                label: 'Chọn phương thức',
              ),
            ],
          ),
          action: const KfcGenUiAction(
            attachmentId: 'payment_unknown',
            actionId: 'select_payment_method',
            payload: {'methodId': 'unknown'},
          ),
        ),
      ];

      for (final testCase in cases) {
        final repository = _RecordingStartRepository();
        final controller = CustomerChatController(
          repository: repository,
          initialState: CustomerChatState(
            sessionId: 'kfc:fixture',
            customerId: 'fixture',
            messages: [
              CustomerChatMessage(
                id: 'message_${testCase.attachment.id}',
                role: CustomerChatRole.assistant,
                text: 'Tương tác',
                genUi: testCase.attachment,
              ),
            ],
          ),
        );

        await controller.submitAction(testCase.action);

        expect(repository.startCount, 0, reason: testCase.attachment.id);
        expect(
          controller.state.value.messages.where(
            (message) => message.role == CustomerChatRole.customer,
          ),
          isEmpty,
          reason: testCase.attachment.id,
        );
      }
    },
  );

  test(
    'handoff polling appends human replies once and uses a turn cursor',
    () async {
      final repository = _HandoffRepository(
        updates: const CustomerChatSessionUpdates(
          agentMode: 'human_paused',
          handoffStatus: 'joined',
          assignedAgentId: 'agent_1',
          turns: [
            CustomerChatRemoteTurn(
              id: 'human_turn_1',
              role: 'assistant',
              text: 'Em đang kiểm tra đơn cho anh/chị.',
              isHumanAgent: true,
            ),
          ],
        ),
      );
      final controller = CustomerChatController(
        repository: repository,
        handoffPollInterval: const Duration(milliseconds: 5),
      );

      controller.updateDraft('Cho tôi gặp nhân viên');
      await controller.sendDraft();
      await Future<void>.delayed(const Duration(milliseconds: 20));

      expect(controller.state.value.handoffStatus, 'joined');
      expect(
        controller.state.value.messages.where(
          (message) => message.id == 'human_turn_1',
        ),
        hasLength(1),
      );
      expect(repository.afterTurnIds.last, 'human_turn_1');
      controller.dispose();
    },
  );

  test('handoff polling stops and clears status when AI resumes', () async {
    final repository = _HandoffRepository(
      updates: const CustomerChatSessionUpdates(
        agentMode: 'ai_active',
        turns: [],
      ),
    );
    final controller = CustomerChatController(
      repository: repository,
      handoffPollInterval: const Duration(milliseconds: 5),
    );

    controller.updateDraft('Cho tôi gặp nhân viên');
    await controller.sendDraft();
    await Future<void>.delayed(const Duration(milliseconds: 20));
    final pollCount = repository.pollCount;

    expect(controller.state.value.handoffStatus, isNull);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(repository.pollCount, pollCount);
    controller.dispose();
  });

  test(
    'reconnects the same run from the last contiguous sequence after a gap',
    () async {
      final repository = _GapRepository();
      final controller = CustomerChatController(
        repository: repository,
        reconnectDelays: const [Duration.zero],
      );

      await controller.sendQuickPrompt('Gợi ý combo');

      expect(repository.startCount, 1);
      expect(repository.afterSequences, [0, 1]);
      expect(controller.state.value.messages.last.text, 'Xin chào');
      expect(
        controller.state.value.activeDraft?.terminal,
        CustomerRunTerminal.completed,
      );
    },
  );

  test('Stop retains partial text and reaches cancelled', () async {
    final repository = _StopRepository();
    final controller = CustomerChatController(repository: repository);
    final sending = controller.sendQuickPrompt('Gợi ý combo');
    while (controller.state.value.activeDraft?.cancellable != true) {
      await Future<void>.delayed(Duration.zero);
    }

    await controller.stopActiveRun();
    await sending;

    expect(repository.cancelCount, 1);
    expect(
      controller.state.value.activeDraft?.terminal,
      CustomerRunTerminal.cancelled,
    );
    expect(controller.state.value.messages.last.text, 'Một phần');
    expect(controller.state.value.errorMessage, 'Đã dừng theo yêu cầu.');
  });

  test(
    'streamed approval pointer never becomes an actionable pending approval',
    () async {
      final repository = _ApprovalPointerRepository();
      final controller = CustomerChatController(repository: repository);

      await controller.sendQuickPrompt('Đặt đơn');

      expect(controller.state.value.pendingApproval, isNull);
      expect(
        controller.state.value.activeDraft?.approvalPausePointer?.capability,
        'placeOrder',
      );
      expect(
        controller.state.value.activeDraft?.approvalPausePointer?.requestId,
        _ApprovalPointerRepository.requestId,
      );

      await controller.approvePendingConfirmation();
      expect(repository.resumeCount, 0);
      expect(controller.state.value.pendingApproval, isNull);
    },
  );

  test('resumes sequential approvals with each exact one-shot token', () async {
    const firstRequestId = '00000000-0000-4000-8000-000000000123';
    const nextRequestId = '00000000-0000-4000-8000-000000000124';
    final repository = _ApprovalRepository([
      CustomerConfirmationResumeResult(
        actionOutcome: CustomerConfirmationActionOutcome.succeeded,
        continuation: CustomerConfirmationContinuation.approvalRequired,
        requestId: nextRequestId,
        responseText: 'Đơn đã tạo; cần xác nhận thanh toán.',
        nextApproval: CustomerApprovalPause(
          capability: 'createPaymentLink',
          requestId: nextRequestId,
          approvalCapability: 'signed.next-token',
          expiresAt: DateTime.utc(2099, 7, 20),
        ),
      ),
      const CustomerConfirmationResumeResult(
        actionOutcome: CustomerConfirmationActionOutcome.failed,
        continuation: CustomerConfirmationContinuation.turnCompleted,
        requestId: nextRequestId,
        responseText: 'Đã dừng bước thanh toán.',
      ),
    ]);
    final controller = CustomerChatController(
      repository: repository,
      initialState: CustomerChatState(
        sessionId: 'kfc:customer-1',
        customerId: 'customer-1',
        pendingApproval: CustomerApprovalPause(
          capability: 'placeOrder',
          requestId: firstRequestId,
          approvalCapability: 'signed.first-token',
          expiresAt: DateTime.utc(2099, 7, 20),
        ),
      ),
    );

    await controller.approvePendingConfirmation();
    expect(controller.state.value.pendingApproval?.requestId, nextRequestId);
    expect(
      controller.state.value.pendingApproval?.approvalCapability,
      'signed.next-token',
    );
    await controller.rejectPendingConfirmation();

    expect(repository.calls, [
      (
        requestId: firstRequestId,
        approvalCapability: 'signed.first-token',
        decision: CustomerConfirmationDecision.approve,
      ),
      (
        requestId: nextRequestId,
        approvalCapability: 'signed.next-token',
        decision: CustomerConfirmationDecision.reject,
      ),
    ]);
    expect(controller.state.value.pendingApproval, isNull);
    expect(controller.state.value.isResumingApproval, isFalse);
    expect(
      controller.state.value.messages.map((message) => message.text),
      containsAllInOrder([
        'Đơn đã tạo; cần xác nhận thanh toán.',
        'Đã dừng bước thanh toán.',
      ]),
    );
  });
}

class _ApprovalRepository extends FixtureCustomerChatRepository {
  _ApprovalRepository(this.results) : super(eventDelay: Duration.zero);

  final List<CustomerConfirmationResumeResult> results;
  final calls =
      <
        ({
          String requestId,
          String approvalCapability,
          CustomerConfirmationDecision decision,
        })
      >[];

  @override
  Future<CustomerConfirmationResumeResult> resumeConfirmation({
    required String requestId,
    required String approvalCapability,
    required CustomerConfirmationDecision decision,
  }) async {
    calls.add((
      requestId: requestId,
      approvalCapability: approvalCapability,
      decision: decision,
    ));
    return results.removeAt(0);
  }
}

class _ApprovalPointerRepository extends FixtureCustomerChatRepository {
  _ApprovalPointerRepository() : super(eventDelay: Duration.zero);

  static const requestId = '00000000-0000-4000-8000-000000000123';
  var resumeCount = 0;

  @override
  Future<CustomerRunStartResponse> startRun({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    String? text,
    KfcGenUiAction? action,
    Map<String, Object?>? metadata,
    String? candidateId,
  }) async => const CustomerRunStartResponse(
    schemaVersion: 1,
    runId: 'approval_pointer_run',
    status: CustomerRunStatus.accepted,
    nextSequence: 1,
    replayed: false,
  );

  @override
  Stream<CustomerRunEventEnvelope> watchRun(
    String runId,
    int afterSequence,
  ) async* {
    yield _runEvent(runId, 1, 'run_accepted', {'status': 'accepted'});
    yield _runEvent(runId, 2, 'text_delta', {'delta': 'Cần xác nhận.'});
    yield _runEvent(runId, 3, 'run_completed', {
      'status': 'completed',
      'responseText': 'Cần xác nhận.',
      'approvalPause': {
        'capability': 'placeOrder',
        'requestId': requestId,
        'expiresAt': '2099-07-20T00:10:00.000Z',
      },
    });
  }

  @override
  Future<CustomerConfirmationResumeResult> resumeConfirmation({
    required String requestId,
    required String approvalCapability,
    required CustomerConfirmationDecision decision,
  }) async {
    resumeCount += 1;
    throw StateError('streamed pointer must not authorize approval');
  }
}

class _RecordingStartRepository extends FixtureCustomerChatRepository {
  _RecordingStartRepository() : super(eventDelay: Duration.zero);

  var startCount = 0;
  final candidateIds = <String?>[];

  @override
  Future<CustomerRunStartResponse> startRun({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    String? text,
    KfcGenUiAction? action,
    Map<String, Object?>? metadata,
    String? candidateId,
  }) async {
    startCount += 1;
    candidateIds.add(candidateId);
    return const CustomerRunStartResponse(
      schemaVersion: 1,
      runId: 'unexpected_run',
      status: CustomerRunStatus.accepted,
      nextSequence: 1,
      replayed: false,
    );
  }
}

class _HumanPausedRepository extends FixtureCustomerChatRepository {
  const _HumanPausedRepository() : super(eventDelay: Duration.zero);

  @override
  Future<CustomerRunStartResponse> startRun({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    String? text,
    KfcGenUiAction? action,
    Map<String, Object?>? metadata,
    String? candidateId,
  }) async => const CustomerRunStartResponse(
    schemaVersion: 1,
    runId: 'human_paused_run',
    status: CustomerRunStatus.superseded,
    nextSequence: 3,
    replayed: true,
  );

  @override
  Stream<CustomerRunEventEnvelope> watchRun(
    String runId,
    int afterSequence,
  ) async* {
    yield _runEvent(runId, 1, 'run_accepted', {'status': 'accepted'});
    yield _runEvent(runId, 2, 'run_superseded', {
      'status': 'superseded',
      'suppressed': true,
      'agentMode': 'human_paused',
    });
  }

  @override
  Future<CustomerChatSessionUpdates> getSessionUpdates({
    required String sessionId,
    String? afterTurnId,
  }) async {
    return const CustomerChatSessionUpdates(
      agentMode: 'human_paused',
      turns: [],
    );
  }
}

class _GenericSupersededRepository extends FixtureCustomerChatRepository {
  _GenericSupersededRepository() : super(eventDelay: Duration.zero);

  var sessionUpdateCalls = 0;

  @override
  Future<CustomerRunStartResponse> startRun({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    String? text,
    KfcGenUiAction? action,
    Map<String, Object?>? metadata,
    String? candidateId,
  }) async => const CustomerRunStartResponse(
    schemaVersion: 1,
    runId: 'generic_superseded_run',
    status: CustomerRunStatus.superseded,
    nextSequence: 4,
    replayed: true,
  );

  @override
  Stream<CustomerRunEventEnvelope> watchRun(
    String runId,
    int afterSequence,
  ) async* {
    yield _runEvent(runId, 1, 'run_accepted', {'status': 'accepted'});
    yield _runEvent(runId, 2, 'text_delta', {'delta': 'Một phần'});
    yield _runEvent(runId, 3, 'run_superseded', {'status': 'superseded'});
  }

  @override
  Future<CustomerChatSessionUpdates> getSessionUpdates({
    required String sessionId,
    String? afterTurnId,
  }) async {
    sessionUpdateCalls += 1;
    return const CustomerChatSessionUpdates(agentMode: 'ai_active', turns: []);
  }
}

class _GapRepository extends FixtureCustomerChatRepository {
  _GapRepository() : super(eventDelay: Duration.zero);
  int startCount = 0;
  final afterSequences = <int>[];

  @override
  Future<CustomerRunStartResponse> startRun({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    String? text,
    KfcGenUiAction? action,
    Map<String, Object?>? metadata,
    String? candidateId,
  }) async {
    startCount += 1;
    return const CustomerRunStartResponse(
      schemaVersion: 1,
      runId: 'gap_run',
      status: CustomerRunStatus.accepted,
      nextSequence: 1,
      replayed: false,
    );
  }

  @override
  Stream<CustomerRunEventEnvelope> watchRun(
    String runId,
    int afterSequence,
  ) async* {
    afterSequences.add(afterSequence);
    if (afterSequence == 0) {
      yield _runEvent(runId, 1, 'run_accepted', {'status': 'accepted'});
      yield _runEvent(runId, 3, 'text_delta', {'delta': 'chào'});
      return;
    }
    yield _runEvent(runId, 2, 'text_delta', {'delta': 'Xin '});
    yield _runEvent(runId, 3, 'text_delta', {'delta': 'chào'});
    yield _runEvent(runId, 4, 'run_completed', {
      'status': 'completed',
      'responseText': 'Xin chào',
    });
  }
}

class _StopRepository extends FixtureCustomerChatRepository {
  _StopRepository() : super(eventDelay: Duration.zero);
  final _cancelled = Completer<void>();
  int cancelCount = 0;

  @override
  Future<CustomerRunStartResponse> startRun({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    String? text,
    KfcGenUiAction? action,
    Map<String, Object?>? metadata,
    String? candidateId,
  }) async => const CustomerRunStartResponse(
    schemaVersion: 1,
    runId: 'stop_run',
    status: CustomerRunStatus.accepted,
    nextSequence: 1,
    replayed: false,
  );

  @override
  Stream<CustomerRunEventEnvelope> watchRun(
    String runId,
    int afterSequence,
  ) async* {
    yield _runEvent(runId, 1, 'run_accepted', {'status': 'accepted'});
    yield _runEvent(runId, 2, 'progress_updated', {
      'code': 'planning',
      'label': 'Đang hiểu yêu cầu của bạn',
      'cancellable': true,
    });
    yield _runEvent(runId, 3, 'text_delta', {'delta': 'Một phần'});
    await _cancelled.future;
    yield _runEvent(runId, 4, 'cancellation_requested', {
      'status': 'cancelling',
    });
    yield _runEvent(runId, 5, 'run_cancelled', {
      'status': 'cancelled',
      'message': 'Đã dừng theo yêu cầu.',
    });
  }

  @override
  Future<CustomerRunCancelResponse> cancelRun(String runId) async {
    cancelCount += 1;
    if (!_cancelled.isCompleted) _cancelled.complete();
    return CustomerRunCancelResponse(
      runId: runId,
      status: CustomerRunStatus.cancelling,
    );
  }
}

CustomerRunEventEnvelope _runEvent(
  String runId,
  int sequence,
  String type,
  Map<String, Object?> payload,
) => CustomerRunEventEnvelope.fromJson({
  'schemaVersion': 1,
  'eventId': 'e$sequence',
  'runId': runId,
  'sequence': sequence,
  'type': type,
  'occurredAt': '2026-07-11T00:00:00.000Z',
  'payload': payload,
});

class _HandoffRepository extends FixtureCustomerChatRepository {
  _HandoffRepository({required this.updates})
    : super(eventDelay: Duration.zero);

  final CustomerChatSessionUpdates updates;
  final afterTurnIds = <String?>[];
  var pollCount = 0;

  @override
  Future<CustomerChatResponse> sendMessage({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required String text,
  }) async => CustomerChatResponse(
    responseText: 'Đang kết nối nhân viên.',
    genUi: const KfcGenUiAttachment(
      id: 'handoff_1',
      lifecycleStage: 'support',
      widgetKind: KfcGenUiWidgetKind.supportHandoff,
      status: KfcGenUiStatus.active,
      title: 'Nhân viên hỗ trợ',
      data: {'handoffStatus': 'queued'},
    ),
  );

  @override
  Future<CustomerChatSessionUpdates> getSessionUpdates({
    required String sessionId,
    String? afterTurnId,
  }) async {
    pollCount += 1;
    afterTurnIds.add(afterTurnId);
    return updates;
  }

  @override
  Future<CustomerChatResponse> submitGenUiAction({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required KfcGenUiAction action,
  }) => throw UnimplementedError();
}
