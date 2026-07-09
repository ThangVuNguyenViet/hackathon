import 'package:flutter_test/flutter_test.dart';
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
}
