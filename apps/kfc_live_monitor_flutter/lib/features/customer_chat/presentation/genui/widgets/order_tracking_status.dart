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
    final orderId = genUiText(order['orderCode'] ?? order['id']);
    final paymentStatus = _presentText(payment['status']);
    final orderStatus = _presentText(order['status']);
    final etaMinutes = _presentText(fulfillment['etaMinutes']);
    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: onAction,
      accentColor: KfcOpsTokens.success,
      children: [
        GenUiMetricRow(
          label: 'Mã đơn',
          value: orderId,
        ),
        if (paymentStatus != null)
          GenUiMetricRow(
            label: 'Thanh toán',
            value: paymentStatus,
            valueColor: KfcOpsTokens.success,
          ),
        if (orderStatus != null)
          GenUiMetricRow(label: 'Trạng thái đơn', value: orderStatus),
        if (etaMinutes != null)
          GenUiMetricRow(
            label: 'Dự kiến giao',
            value: '$etaMinutes phút',
            valueColor: KfcOpsTokens.success,
          ),
      ],
    );
  }

  String? _presentText(Object? value) {
    final text = value?.toString() ?? '';
    return text.isEmpty ? null : text;
  }
}
