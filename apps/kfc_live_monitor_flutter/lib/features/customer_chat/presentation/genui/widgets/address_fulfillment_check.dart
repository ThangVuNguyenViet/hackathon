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
    final rawAddress = attachment.data['address'];
    final address = genUiMap(rawAddress);
    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: onAction,
      accentColor: KfcOpsTokens.success,
      children: [
        Text(
          rawAddress is String && rawAddress.trim().isNotEmpty
              ? rawAddress
              : _addressText(address),
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

  String _addressText(Map<String, Object?> address) {
    final parts = [address['line1'], address['district'], address['city']]
        .map((part) => genUiText(part, fallback: ''))
        .where((part) => part.isNotEmpty)
        .toList(growable: false);
    return parts.isEmpty ? 'Chưa có địa chỉ' : parts.join(', ');
  }
}
