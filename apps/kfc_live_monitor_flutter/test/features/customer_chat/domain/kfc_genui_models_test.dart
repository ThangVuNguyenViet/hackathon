import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/customer_chat/data/customer_chat_repository.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';

void main() {
  test('parses a backend GenUI attachment', () {
    final attachment = KfcGenUiAttachment.fromJson({
      'id': 'att_1',
      'lifecycleStage': 'checkout',
      'widgetKind': 'orderReviewConfirm',
      'status': 'active',
      'title': 'Xác nhận đơn',
      'data': {
        'cart': {'totalVnd': 145000},
      },
      'actions': [
        {
          'id': 'confirm_order',
          'label': 'Xác nhận',
          'value': 'confirmed',
          'intent': 'primary',
        },
      ],
    });

    expect(attachment.widgetKind, KfcGenUiWidgetKind.orderReviewConfirm);
    expect(attachment.actions.single.id, 'confirm_order');
    expect(attachment.actions.single.intent, KfcGenUiActionIntent.primary);
  });

  test('defaults unknown or missing action intent to secondary', () {
    final missing = KfcGenUiActionSpec.fromJson({
      'id': 'customize_item',
      'label': 'Tùy chỉnh combo',
    });
    final unknown = KfcGenUiActionSpec.fromJson({
      'id': 'customize_item',
      'label': 'Tùy chỉnh combo',
      'intent': 'unexpected',
    });

    expect(missing.intent, KfcGenUiActionIntent.secondary);
    expect(unknown.intent, KfcGenUiActionIntent.secondary);
  });

  test('rejects unknown widget kinds', () {
    expect(
      () => KfcGenUiAttachment.fromJson({
        'id': 'att_bad',
        'lifecycleStage': 'bad',
        'widgetKind': 'unknown',
        'status': 'active',
        'title': 'Bad',
        'data': <String, Object?>{},
        'actions': const <Object?>[],
      }),
      throwsFormatException,
    );
  });

  test('serializes GenUI actions for the backend endpoint', () {
    const action = KfcGenUiAction(
      attachmentId: 'fixture_review',
      actionId: 'confirm_order',
      value: 'confirmed',
    );

    expect(action.toJson(), {
      'attachmentId': 'fixture_review',
      'actionId': 'confirm_order',
      'value': 'confirmed',
    });
  });

  test('payment status fixture does not expose track order action', () {
    final attachment = kfcGenUiFixture(KfcGenUiWidgetKind.paymentOrderStatus);

    expect(
      attachment.actions.map((action) => action.id),
      isNot(contains('track_order')),
    );
  });

  test(
    'order tracking fixture exposes track order action after payment success',
    () {
      final attachment = kfcGenUiFixture(
        KfcGenUiWidgetKind.orderTrackingStatus,
      );

      expect(attachment.widgetKind, KfcGenUiWidgetKind.orderTrackingStatus);
      expect(
        attachment.actions.map((action) => action.id),
        contains('track_order'),
      );
    },
  );

  test('handoff reasons parse backend enum values into Vietnamese labels', () {
    final reason = KfcGenUiHandoffReason.fromJson('customer_requested_human');

    expect(reason, KfcGenUiHandoffReason.customerRequestedHuman);
    expect(reason.labelVi, 'Khách yêu cầu gặp nhân viên');
  });

  test('order and payment statuses parse backend enum values into labels', () {
    expect(KfcGenUiOrderStatus.fromJson('preparing').labelVi, 'Đang chuẩn bị');
    expect(KfcGenUiPaymentStatus.fromJson('paid').labelVi, 'Đã thanh toán');
  });

  test('unknown enum display values do not expose raw snake case', () {
    expect(
      kfcGenUiHandoffReasonLabel('new_backend_reason'),
      'Lý do cần nhân viên hỗ trợ',
    );
    expect(kfcGenUiOrderStatusLabel('waiting_for_store'), 'Đang cập nhật');
    expect(kfcGenUiPaymentStatusLabel('manual_review'), 'Đang cập nhật');
  });
}
