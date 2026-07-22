import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/customer_confirmation_models.dart';

void main() {
  const requestId = '00000000-0000-4000-8000-000000000123';

  test('parses only the bounded public approval pause', () {
    final pause = CustomerApprovalPause.fromJson({
      'capability': 'placeOrder',
      'requestId': requestId,
      'approvalCapability': 'signed.one-shot-capability',
      'expiresAt': '2026-07-20T00:10:00.000Z',
    });

    expect(pause.capability, 'placeOrder');
    expect(pause.requestId, requestId);
    expect(pause.approvalCapability, 'signed.one-shot-capability');
    expect(pause.expiresAt.isUtc, isTrue);

    expect(
      () => CustomerApprovalPause.fromJson({
        'capability': 'placeOrder',
        'requestId': requestId,
        'approvalCapability': 'signed.one-shot-capability',
        'expiresAt': '2026-07-20T00:10:00.000Z',
        'checkpoint': {'threadId': 'private'},
      }),
      throwsFormatException,
    );
  });

  test('parses a sequential approval without exposing authority internals', () {
    final result = CustomerConfirmationResumeResult.fromJson({
      'status': 'completed',
      'result': {
        'actionOutcome': 'succeeded',
        'continuation': 'approval_required',
        'requestId': requestId,
        'responseText': 'Cần xác nhận bước tiếp theo.',
        'orderId': 'order-1',
        'capability': 'createPaymentLink',
        'approvalCapability': 'signed.next-capability',
        'expiresAt': '2026-07-20T00:12:00.000Z',
      },
    });

    expect(
      result.continuation,
      CustomerConfirmationContinuation.approvalRequired,
    );
    expect(result.nextApproval?.capability, 'createPaymentLink');
    expect(result.nextApproval?.approvalCapability, 'signed.next-capability');
  });

  test('rejects capability fields on a completed continuation', () {
    expect(
      () => CustomerConfirmationResumeResult.fromJson({
        'status': 'completed',
        'result': {
          'actionOutcome': 'succeeded',
          'continuation': 'turn_completed',
          'requestId': requestId,
          'responseText': 'Đã hoàn tất.',
          'approvalCapability': 'must-not-survive',
        },
      }),
      throwsFormatException,
    );
  });
}
