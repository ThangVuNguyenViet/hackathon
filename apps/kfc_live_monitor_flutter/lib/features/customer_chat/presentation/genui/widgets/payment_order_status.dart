import 'package:flutter/widgets.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import 'genui_widget_chrome.dart';

class PaymentOrderStatus extends StatelessWidget {
  const PaymentOrderStatus({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  Widget build(BuildContext context) {
    final order = genUiMap(attachment.data['order']);
    final payment = genUiMap(attachment.data['paymentAttempt']);
    final paymentStatusEvidence = genUiMap(
      attachment.data['paymentStatusEvidence'],
    );
    final currentCheck = genUiMap(paymentStatusEvidence['currentCheck']);
    final currentCheckFailed =
        currentCheck['executionOutcome'] == 'error' &&
        (currentCheck['errorCode'] == 'payment_failed' ||
            currentCheck['errorCode'] == 'payment_status_check_failed');
    final cart = genUiMap(order['cart']);
    final amount =
        _positiveAmount(order['amountVnd']) ??
        _positiveAmount(payment['amountVnd']) ??
        _positiveAmount(cart['totalVnd']);
    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: onAction,
      accentColor: KfcOpsTokens.info,
      children: [
        GenUiMetricRow(
          label: 'Mã đơn',
          value: genUiText(
            order['orderCode'] ?? order['id'],
            fallback: 'Đang tạo',
          ),
        ),
        GenUiMetricRow(
          label: 'Trạng thái đơn',
          value: genUiText(
            kfcGenUiOrderStatusLabel(order['status']),
            fallback: 'Chưa có trạng thái',
          ),
        ),
        GenUiMetricRow(
          label: 'Thanh toán',
          value: genUiText(
            kfcGenUiPaymentStatusLabel(payment['status']),
            fallback: 'Chưa có trạng thái',
          ),
          valueColor: KfcOpsTokens.warningText,
        ),
        if (currentCheckFailed)
          const GenUiMetricRow(
            label: 'Lần kiểm tra gần nhất',
            value: 'Không xác minh được trạng thái thanh toán',
            valueColor: KfcOpsTokens.critical,
          ),
        if (amount case final amount?)
          GenUiMetricRow(
            label: 'Số tiền',
            value: moneyVnd(amount),
            valueColor: KfcOpsTokens.primary,
          ),
      ],
    );
  }

  num? _positiveAmount(Object? value) {
    return switch (value) {
      final num amount when amount > 0 => amount,
      _ => null,
    };
  }
}
