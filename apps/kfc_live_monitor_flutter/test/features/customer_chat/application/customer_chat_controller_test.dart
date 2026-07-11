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
}

class _HandoffRepository implements CustomerChatRepository {
  _HandoffRepository({required this.updates});

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
