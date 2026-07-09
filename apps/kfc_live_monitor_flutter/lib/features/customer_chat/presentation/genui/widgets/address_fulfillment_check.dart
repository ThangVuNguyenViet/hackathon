import 'package:flutter/widgets.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import 'genui_widget_chrome.dart';

class AddressFulfillmentCheck extends StatelessWidget {
  const AddressFulfillmentCheck({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  Widget build(BuildContext context) {
    final fulfillment = genUiMap(attachment.data['fulfillment']);
    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: onAction,
      accentColor: KfcOpsTokens.success,
      children: [
        Text(
          genUiText(attachment.data['address'], fallback: 'Chưa có địa chỉ'),
          style: const TextStyle(
            color: KfcOpsTokens.onSurface,
            fontSize: 13,
            fontWeight: FontWeight.w600,
            height: 18 / 13,
            letterSpacing: 0,
          ),
        ),
        const SizedBox(height: KfcOpsTokens.spacingSm),
        GenUiMetricRow(
          label: 'Cửa hàng',
          value: genUiText(fulfillment['storeName'], fallback: 'Đang chọn'),
        ),
        GenUiMetricRow(
          label: 'ETA',
          value: '${genUiText(fulfillment['etaMinutes'], fallback: '--')} phút',
          valueColor: KfcOpsTokens.success,
        ),
        GenUiMetricRow(
          label: 'Phí giao hàng',
          value: moneyVnd(fulfillment['feeVnd']),
        ),
      ],
    );
  }
}
