import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/application/customer_chat_controller.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/customer_run_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/customer_chat_screen.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';

import '../test/features/test_app.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const backendUrl = String.fromEnvironment(
    'KFC_BACKEND_URL',
    defaultValue: 'http://localhost:18090',
  );

  testWidgets(
    'real backend streams progress, text, GenUI, reconnect, and Stop',
    (tester) async {
      final repository = _RecordingDisconnectRepository(
        BackendCustomerChatRepository(baseUrl: backendUrl),
      );
      final controller = CustomerChatController(
        repository: repository,
        reconnectDelays: const [Duration(milliseconds: 50)],
      );
      await tester.pumpWidget(
        TestApp(child: CustomerChatScreen(controller: controller)),
      );

      await tester.enterText(
        find.byKey(CustomerChatKeys.messageInput),
        'Gợi ý combo KFC',
      );
      unawaited(controller.sendDraft());
      await _pumpUntil(
        tester,
        () => controller.state.value.activeDraft?.isTerminal == true,
      );

      expect(repository.startCount, 1);
      expect(repository.watchCount, greaterThanOrEqualTo(2));
      expect(repository.progressLabels.toSet().length, greaterThanOrEqualTo(2));
      expect(repository.textLengths.length, greaterThanOrEqualTo(2));
      expect(repository.genUiRevisionCount, greaterThanOrEqualTo(2));
      expect(controller.state.value.messages.last.text, isNotEmpty);

      final stopRepository = _AutoStopRepository(
        BackendCustomerChatRepository(baseUrl: backendUrl),
      );
      final stopId = DateTime.now().microsecondsSinceEpoch.toString();
      final acceptedStop = await stopRepository.startRun(
        sessionId: 'kfc:stream_stop_$stopId',
        customerId: 'stream_stop_$stopId',
        clientMessageId: 'stream_stop_message_$stopId',
        text: 'Gợi ý một đơn KFC khác cho bốn người.',
      );
      var stoppedDraft = ActiveAssistantDraft.accepted(
        runId: acceptedStop.runId,
      );
      for (
        var attempt = 0;
        attempt < 4 && !stoppedDraft.isTerminal;
        attempt++
      ) {
        await for (final event in stopRepository.watchRun(
          acceptedStop.runId,
          stoppedDraft.lastSequence,
        )) {
          stoppedDraft = stoppedDraft.reduce(event);
          if (stoppedDraft.isTerminal) break;
        }
      }
      expect(stopRepository.stopRequested, isTrue);
      expect(stoppedDraft.terminal, CustomerRunTerminal.cancelled);
    },
  );
}

class _AutoStopRepository implements CustomerChatRepository {
  _AutoStopRepository(this.delegate);
  final BackendCustomerChatRepository delegate;
  bool stopRequested = false;

  @override
  Future<CustomerRunStartResponse> startRun({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    String? text,
    KfcGenUiAction? action,
    Map<String, Object?>? metadata,
  }) => delegate.startRun(
    sessionId: sessionId,
    customerId: customerId,
    clientMessageId: clientMessageId,
    text: text,
    action: action,
    metadata: metadata,
  );

  @override
  Stream<CustomerRunEventEnvelope> watchRun(
    String runId,
    int afterSequence,
  ) async* {
    await for (final event in delegate.watchRun(runId, afterSequence)) {
      final data = event.data;
      if (!stopRequested &&
          data is CustomerRunProgressData &&
          data.cancellable) {
        stopRequested = true;
        await delegate.cancelRun(runId);
      }
      yield event;
    }
  }

  @override
  Future<CustomerRunCancelResponse> cancelRun(String runId) =>
      delegate.cancelRun(runId);
  @override
  Future<CustomerChatSessionUpdates> getSessionUpdates({
    required String sessionId,
    String? afterTurnId,
  }) => delegate.getSessionUpdates(
    sessionId: sessionId,
    afterTurnId: afterTurnId,
  );
  @override
  Future<CustomerChatResponse> sendMessage({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required String text,
  }) => delegate.sendMessage(
    sessionId: sessionId,
    customerId: customerId,
    clientMessageId: clientMessageId,
    text: text,
  );
  @override
  Future<CustomerChatResponse> submitGenUiAction({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required KfcGenUiAction action,
  }) => delegate.submitGenUiAction(
    sessionId: sessionId,
    customerId: customerId,
    clientMessageId: clientMessageId,
    action: action,
  );
}

Future<void> _pumpUntil(
  WidgetTester tester,
  bool Function() condition, {
  Duration timeout = const Duration(seconds: 90),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) {
      throw TimeoutException('Streaming condition timed out');
    }
    await tester.pump(const Duration(milliseconds: 50));
  }
}

class _RecordingDisconnectRepository implements CustomerChatRepository {
  _RecordingDisconnectRepository(this.delegate);
  final BackendCustomerChatRepository delegate;
  int startCount = 0;
  int watchCount = 0;
  int genUiRevisionCount = 0;
  final progressLabels = <String>[];
  final textLengths = <int>[];
  var _textLength = 0;
  var _disconnected = false;

  @override
  Future<CustomerRunStartResponse> startRun({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    String? text,
    KfcGenUiAction? action,
    Map<String, Object?>? metadata,
  }) {
    startCount += 1;
    return delegate.startRun(
      sessionId: sessionId,
      customerId: customerId,
      clientMessageId: clientMessageId,
      text: text,
      action: action,
      metadata: metadata,
    );
  }

  @override
  Stream<CustomerRunEventEnvelope> watchRun(
    String runId,
    int afterSequence,
  ) async* {
    watchCount += 1;
    var seen = 0;
    await for (final event in delegate.watchRun(runId, afterSequence)) {
      seen += 1;
      if (event.data case final CustomerRunProgressData progress) {
        progressLabels.add(progress.label);
      }
      if (event.data case final CustomerRunTextDeltaData delta) {
        _textLength += delta.delta.length;
        textLengths.add(_textLength);
      }
      if (event.type == CustomerRunEventType.genUiRevision) {
        genUiRevisionCount += 1;
      }
      yield event;
      if (!_disconnected && seen >= 3) {
        _disconnected = true;
        throw TimeoutException('forced demo disconnect');
      }
    }
  }

  @override
  Future<CustomerRunCancelResponse> cancelRun(String runId) =>
      delegate.cancelRun(runId);
  @override
  Future<CustomerChatSessionUpdates> getSessionUpdates({
    required String sessionId,
    String? afterTurnId,
  }) => delegate.getSessionUpdates(
    sessionId: sessionId,
    afterTurnId: afterTurnId,
  );
  @override
  Future<CustomerChatResponse> sendMessage({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required String text,
  }) => delegate.sendMessage(
    sessionId: sessionId,
    customerId: customerId,
    clientMessageId: clientMessageId,
    text: text,
  );
  @override
  Future<CustomerChatResponse> submitGenUiAction({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required KfcGenUiAction action,
  }) => delegate.submitGenUiAction(
    sessionId: sessionId,
    customerId: customerId,
    clientMessageId: clientMessageId,
    action: action,
  );
}
