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
    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: onAction,
      accentColor: KfcOpsTokens.info,
      children: [
        GenUiMetricRow(
          label: 'Mã đơn',
          value: genUiText(order['orderCode'] ?? order['id'], fallback: 'Đang tạo'),
        ),
        GenUiMetricRow(
          label: 'Trạng thái đơn',
          value: genUiText(order['status'], fallback: 'Chưa có trạng thái'),
        ),
        GenUiMetricRow(
          label: 'Thanh toán',
          value: genUiText(payment['status'], fallback: 'Chưa có trạng thái'),
          valueColor: KfcOpsTokens.warningText,
        ),
        GenUiMetricRow(
          label: 'Số tiền',
          value: moneyVnd(payment['amountVnd']),
          valueColor: KfcOpsTokens.primary,
        ),
      ],
    );
  }
}
