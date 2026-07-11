import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_run_sse.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/customer_run_models.dart';

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
      expect(draft.text, 'Xin');
    },
  );

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
