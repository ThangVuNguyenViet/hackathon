import 'package:flutter/widgets.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import 'genui_widget_chrome.dart';

class OrderReviewConfirm extends StatelessWidget {
  const OrderReviewConfirm({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  Widget build(BuildContext context) {
    final cart = genUiMap(attachment.data['cart']);
    final fulfillment = genUiMap(attachment.data['fulfillment']);
    final items = genUiList(cart['items']);
    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: onAction,
      accentColor: KfcOpsTokens.warning,
      children: [
        for (final item in items)
          GenUiMetricRow(
            label: '${item['quantity'] ?? 1}x ${genUiText(item['name'])}',
            value: moneyVnd(item['unitPriceVnd']),
          ),
        const SizedBox(height: KfcOpsTokens.spacingSm),
        DecoratedBox(
          decoration: BoxDecoration(
            color: KfcOpsTokens.onPrimaryContainer,
            border: Border.all(color: KfcOpsTokens.outlineVariant),
            borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
          ),
          child: Padding(
            padding: const EdgeInsets.all(KfcOpsTokens.spacingSm),
            child: Column(
              children: [
                GenUiMetricRow(
                  label: 'Cửa hàng',
                  value: genUiText(fulfillment['storeName'], fallback: '-'),
                ),
                GenUiMetricRow(
                  label: 'Thời gian dự kiến',
                  value:
                      '${genUiText(fulfillment['etaMinutes'], fallback: '--')} phút',
                ),
                GenUiMetricRow(
                  label: 'Tổng thanh toán',
                  value: moneyVnd(cart['totalVnd']),
                  valueColor: KfcOpsTokens.primary,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
