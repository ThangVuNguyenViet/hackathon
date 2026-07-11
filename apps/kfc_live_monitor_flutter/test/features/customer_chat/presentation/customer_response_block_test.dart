import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/customer_run_models.dart';
import 'package:kfc_live_monitor/features/customer_chat/presentation/customer_response_block.dart';
import 'package:kfc_live_monitor/features/customer_chat/testing/customer_chat_keys.dart';

import '../../test_app.dart';

void main() {
  testWidgets('uses a one-shot entrance cue for streamed updates', (
    tester,
  ) async {
    final draft = ActiveAssistantDraft.accepted(
      runId: 'run_1',
    ).copyWith(lastSequence: 2, text: 'Mình đang cập nhật câu trả lời.');

    await tester.pumpWidget(
      TestApp(
        child: CustomerResponseBlock(draft: draft, onAction: (_) {}),
      ),
    );

    expect(
      find.byWidgetPredicate(
        (widget) => widget.runtimeType.toString() == 'OnMountCue',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget.runtimeType.toString() == 'OnChangeCue',
      ),
      findsNothing,
    );
  });

  for (final disableAnimations in [false, true]) {
    testWidgets(
      'renders customer-safe progress with ${disableAnimations ? 'reduced' : 'normal'} motion',
      (tester) async {
        final draft = ActiveAssistantDraft.accepted(runId: 'run_1').copyWith(
          lastSequence: 2,
          connection: CustomerRunConnectionState.connected,
          progressLabel: 'Đã kiểm tra thông tin cần thiết',
          text: 'Mình đã tìm thấy combo phù hợp.',
          cancellable: true,
        );
        await tester.pumpWidget(
          TestApp(
            child: MediaQuery(
              data: MediaQueryData(disableAnimations: disableAnimations),
              child: CustomerResponseBlock(draft: draft, onAction: (_) {}),
            ),
          ),
        );
        await tester.pump();

        expect(find.byKey(CustomerChatKeys.responseBlock), findsOneWidget);
        expect(find.text('Đã kiểm tra thông tin cần thiết'), findsOneWidget);
        expect(find.textContaining('tool'), findsNothing);
        expect(find.textContaining('planner'), findsNothing);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
