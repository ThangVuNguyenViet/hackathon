import 'package:flutter/widgets.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import 'genui_widget_chrome.dart';

class OrderTrackingStatus extends StatelessWidget {
  const OrderTrackingStatus({
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
    final fulfillment = genUiMap(attachment.data['fulfillment']);
    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: onAction,
      accentColor: KfcOpsTokens.success,
      children: [
        GenUiMetricRow(
          label: 'Mã đơn',
          value: genUiText(order['orderCode'], fallback: 'Chưa có mã'),
        ),
        GenUiMetricRow(
          label: 'Thanh toán',
          value: genUiText(payment['status'], fallback: 'paid'),
          valueColor: KfcOpsTokens.success,
        ),
        GenUiMetricRow(
          label: 'Trạng thái đơn',
          value: genUiText(order['status'], fallback: 'preparing'),
        ),
        GenUiMetricRow(
          label: 'Dự kiến giao',
          value: '${genUiText(fulfillment['etaMinutes'], fallback: '28')} phút',
          valueColor: KfcOpsTokens.success,
        ),
      ],
    );
  }
}
