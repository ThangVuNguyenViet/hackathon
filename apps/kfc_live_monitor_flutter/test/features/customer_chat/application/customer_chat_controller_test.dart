import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_controller.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_state.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
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
  }) async {
    startCount += 1;
    return const CustomerRunStartResponse(
      schemaVersion: 1,
      runId: 'gap_run',
      status: 'accepted',
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
  }) async => const CustomerRunStartResponse(
    schemaVersion: 1,
    runId: 'stop_run',
    status: 'accepted',
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
    return CustomerRunCancelResponse(runId: runId, status: 'cancelling');
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
