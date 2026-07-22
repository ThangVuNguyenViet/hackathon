import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_run_sse.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/customer_run_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';

void main() {
  test('parses typed progress, text, GenUI, and terminal envelopes', () {
    final progress = CustomerRunEventEnvelope.fromJson({
      'schemaVersion': 1,
      'eventId': 'e1',
      'runId': 'r1',
      'sequence': 1,
      'type': 'progress_updated',
      'occurredAt': '2026-07-11T00:00:00.000Z',
      'payload': {
        'code': 'planning',
        'label': 'Đang hiểu yêu cầu của bạn',
        'cancellable': true,
      },
    });
    expect(progress.data, isA<CustomerRunProgressData>());
    expect(
      (progress.data as CustomerRunProgressData).label,
      'Đang hiểu yêu cầu của bạn',
    );

    final delta = CustomerRunEventEnvelope.fromJson({
      'schemaVersion': 1,
      'eventId': 'e2',
      'runId': 'r1',
      'sequence': 2,
      'type': 'text_delta',
      'occurredAt': '2026-07-11T00:00:01.000Z',
      'payload': {'delta': 'Xin chào'},
    });
    expect((delta.data as CustomerRunTextDeltaData).delta, 'Xin chào');
  });

  test('SSE parser preserves fragmented multibyte UTF-8 frames', () async {
    final event = jsonEncode({
      'schemaVersion': 1,
      'eventId': 'e1',
      'runId': 'r1',
      'sequence': 1,
      'type': 'text_delta',
      'occurredAt': '2026-07-11T00:00:00.000Z',
      'payload': {'delta': 'Gà 🍗 rất ngon'},
    });
    final bytes = utf8.encode('id: 1\nevent: text_delta\ndata: $event\n\n');
    final stream = Stream<List<int>>.fromIterable([
      bytes.sublist(0, bytes.length - 5),
      bytes.sublist(bytes.length - 5, bytes.length - 2),
      bytes.sublist(bytes.length - 2),
    ]);
    final parsed = await decodeCustomerRunSse(stream).toList();
    expect(parsed, hasLength(1));
    expect(
      (parsed.single.data as CustomerRunTextDeltaData).delta,
      'Gà 🍗 rất ngon',
    );
  });

  test(
    'draft reducer suppresses duplicates, detects gaps, and replaces GenUI atomically',
    () {
      var draft = ActiveAssistantDraft.accepted(runId: 'r1');
      final first = _event(1, 'text_delta', {'delta': 'Xin'});
      draft = draft.reduce(first);
      expect(draft.text, 'Xin');
      expect(identical(draft.reduce(first), draft), isTrue);
      expect(
        () => draft.reduce(_event(3, 'text_delta', {'delta': ' lỗi'})),
        throwsA(isA<CustomerRunSequenceGap>()),
      );

      final snapshot = {
        'id': 'card_1',
        'lifecycleStage': 'cart',
        'widgetKind': 'cartBuilder',
        'status': 'active',
        'title': 'Giỏ hàng',
        'data': <String, Object?>{},
        'actions': <Object?>[],
      };
      draft = draft.reduce(
        _event(2, 'genui_revision', {'revision': 1, 'snapshot': snapshot}),
      );
      expect(draft.genUi?.id, 'card_1');
      expect(
        draft.genUi?.interactionFinality,
        KfcGenUiInteractionFinality.provisional,
      );
      expect(draft.genUi?.canSubmitActions, isFalse);
      expect(draft.text, 'Xin');
    },
  );

  test('only final snapshots retain action authority', () {
    final snapshot = _actionableCartSnapshot();
    var draft = ActiveAssistantDraft.accepted(
      runId: 'r1',
    ).reduce(_event(1, 'genui_revision', {'snapshot': snapshot}));
    expect(draft.genUi?.canSubmitActions, isFalse);

    draft = draft.reduce(_event(2, 'genui_snapshot', {'snapshot': snapshot}));
    expect(draft.genUi?.canSubmitActions, isTrue);
  });

  for (final terminalType in ['run_failed', 'run_cancelled']) {
    test('$terminalType revokes retained snapshot action authority', () {
      final snapshot = _actionableCartSnapshot();
      var draft = ActiveAssistantDraft.accepted(
        runId: 'r1',
      ).reduce(_event(1, 'genui_snapshot', {'snapshot': snapshot}));
      expect(draft.genUi?.canSubmitActions, isTrue);

      draft = draft.reduce(
        _event(2, terminalType, {
          'status': terminalType == 'run_failed' ? 'failed' : 'cancelled',
          'message': 'Không thể hoàn tất.',
        }),
      );
      expect(
        draft.genUi?.interactionFinality,
        KfcGenUiInteractionFinality.retainedAfterTerminalFailure,
      );
      expect(draft.genUi?.canSubmitActions, isFalse);

      final afterTerminal = draft.reduce(
        _event(3, 'genui_snapshot', {'snapshot': snapshot}),
      );
      expect(identical(afterTerminal, draft), isTrue);
      expect(
        afterTerminal.genUi?.interactionFinality,
        KfcGenUiInteractionFinality.retainedAfterTerminalFailure,
      );
      expect(afterTerminal.genUi?.canSubmitActions, isFalse);
    });
  }

  test('terminal reduction retains partial text and completes only once', () {
    var draft = ActiveAssistantDraft.accepted(
      runId: 'r1',
    ).reduce(_event(1, 'text_delta', {'delta': 'Một phần'}));
    draft = draft.reduce(
      _event(2, 'run_failed', {
        'status': 'failed',
        'message': 'Không thể hoàn tất yêu cầu lúc này.',
      }),
    );
    expect(draft.text, 'Một phần');
    expect(draft.terminal, CustomerRunTerminal.failed);
    expect(
      identical(
        draft.reduce(_event(2, 'run_failed', {'status': 'failed'})),
        draft,
      ),
      isTrue,
    );
  });

  test('generic run_superseded retains an in-flight presentation', () {
    var draft = ActiveAssistantDraft.accepted(
      runId: 'r1',
    ).reduce(_event(1, 'text_delta', {'delta': 'Một phần'}));
    final event = _event(2, 'run_superseded', {'status': 'superseded'});

    final data = event.data as CustomerRunSupersededData;
    expect(data.status, CustomerRunStatus.superseded);
    expect(data.suppressed, isFalse);
    expect(data.agentMode, isNull);
    expect(data.isHumanPaused, isFalse);

    draft = draft.reduce(event);
    expect(draft.terminal, CustomerRunTerminal.superseded);
    expect(draft.text, 'Một phần');
    expect(draft.agentMode, isNull);
    expect(draft.terminalMessage, isNull);
  });

  test('run_superseded is a typed non-error human-owned terminal outcome', () {
    var draft = ActiveAssistantDraft.accepted(
      runId: 'r1',
    ).reduce(_event(1, 'text_delta', {'delta': 'unpublished model draft'}));
    final event = _event(2, 'run_superseded', {
      'status': 'superseded',
      'suppressed': true,
      'agentMode': 'human_paused',
    });

    final data = event.data as CustomerRunSupersededData;
    expect(data.status, CustomerRunStatus.superseded);
    expect(data.suppressed, isTrue);
    expect(data.agentMode, CustomerRunAgentMode.humanPaused);
    expect(data.isHumanPaused, isTrue);

    draft = draft.reduce(event);
    expect(draft.terminal, CustomerRunTerminal.superseded);
    expect(draft.agentMode, CustomerRunAgentMode.humanPaused);
    expect(draft.connection, CustomerRunConnectionState.closed);
    expect(draft.text, isEmpty);
    expect(draft.genUi, isNull);
    expect(draft.terminalMessage, isNull);
  });

  test('run_superseded rejects unsafe or untyped payloads', () {
    final invalidPayloads = <Map<String, Object?>>[
      {'status': 'completed', 'suppressed': true, 'agentMode': 'human_paused'},
      {
        'status': 'superseded',
        'suppressed': false,
        'agentMode': 'human_paused',
      },
      {'status': 'superseded', 'suppressed': true, 'agentMode': 'ai_active'},
      {
        'status': 'superseded',
        'suppressed': true,
        'agentMode': 'human_paused',
        'responseText': 'must not be accepted',
      },
    ];

    for (final payload in invalidPayloads) {
      expect(
        () => _event(1, 'run_superseded', payload),
        throwsA(isA<FormatException>()),
        reason: '$payload',
      );
    }
  });

  test(
    'start and terminal responses reject unknown or mismatched statuses',
    () {
      expect(
        () => CustomerRunStartResponse.fromJson({
          'schemaVersion': 1,
          'runId': 'r1',
          'status': 'human_owned',
          'nextSequence': 1,
          'replayed': false,
        }),
        throwsA(isA<FormatException>()),
      );
      expect(
        () => _event(1, 'run_failed', {'status': 'completed'}),
        throwsA(isA<FormatException>()),
      );
    },
  );

  test(
    'unauthenticated completed run keeps its durable pointer non-actionable',
    () {
      const requestId = '00000000-0000-4000-8000-000000000123';
      final draft = ActiveAssistantDraft.accepted(runId: 'r1')
          .reduce(_event(1, 'text_delta', {'delta': 'Cần xác nhận.'}))
          .reduce(
            _event(2, 'run_completed', {
              'status': 'completed',
              'responseText': 'Cần xác nhận.',
              'approvalPause': {
                'capability': 'placeOrder',
                'requestId': requestId,
                'expiresAt': '2026-07-20T00:10:00.000Z',
              },
            }),
          );

      expect(draft.terminal, CustomerRunTerminal.completed);
      expect(draft.approvalPausePointer?.capability, 'placeOrder');
      expect(draft.approvalPausePointer?.requestId, requestId);
      expect(
        draft.approvalPausePointer?.expiresAt,
        DateTime.utc(2026, 7, 20, 0, 10),
      );
      expect(draft.text, 'Cần xác nhận.');
    },
  );

  test('streamed approval pointer rejects tokens and unknown fields', () {
    const pointer = {
      'capability': 'placeOrder',
      'requestId': '00000000-0000-4000-8000-000000000123',
      'expiresAt': '2026-07-20T00:10:00.000Z',
    };
    for (final forbiddenField in ['approvalCapability', 'token', 'extra']) {
      expect(
        () => _event(1, 'run_completed', {
          'status': 'completed',
          'approvalPause': {...pointer, forbiddenField: 'private-value'},
        }),
        throwsA(isA<FormatException>()),
        reason: forbiddenField,
      );
    }
  });
}

Map<String, Object?> _actionableCartSnapshot() {
  return {
    'id': 'card_1',
    'lifecycleStage': 'cart',
    'widgetKind': 'cartBuilder',
    'status': 'active',
    'title': 'Giỏ hàng',
    'expiresAt': '2099-07-21T00:00:00.000Z',
    'data': <String, Object?>{},
    'actions': [
      {'id': 'edit_cart', 'label': 'Sửa giỏ'},
    ],
    'authority': const {
      'schemaVersion': 'kfc-genui-v1',
      'sessionId': 'kfc:customer_1',
      'customerId': 'customer_1',
      'verifiedRevision':
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'actionLifecycle': 'one_shot',
      'issuedAt': '2026-07-19T00:00:00.000Z',
      'expiresAt': '2099-07-21T00:00:00.000Z',
    },
  };
}

CustomerRunEventEnvelope _event(
  int sequence,
  String type,
  Map<String, Object?> payload,
) {
  return CustomerRunEventEnvelope.fromJson({
    'schemaVersion': 1,
    'eventId': 'e$sequence',
    'runId': 'r1',
    'sequence': sequence,
    'type': type,
    'occurredAt': '2026-07-11T00:00:00.000Z',
    'payload': payload,
  });
}
