import 'package:flutter/widgets.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import 'genui_widget_chrome.dart';

class CartBuilder extends StatelessWidget {
  const CartBuilder({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  Widget build(BuildContext context) {
    final cart = genUiMap(attachment.data['cart']);
    final items = genUiList(cart['items']);
    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: onAction,
      accentColor: KfcOpsTokens.info,
      children: [
        for (final item in items)
          Padding(
            padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
            child: Row(
              children: [
                DecoratedBox(
                  decoration: const BoxDecoration(
                    color: KfcOpsTokens.primary,
                    borderRadius: BorderRadius.all(KfcOpsTokens.radiusSm),
                  ),
                  child: SizedBox(
                    width: 30,
                    height: 30,
                    child: Center(
                      child: Text(
                        '${item['quantity'] ?? 1}x',
                        style: const TextStyle(
                          color: KfcOpsTokens.onPrimary,
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: KfcOpsTokens.spacingSm),
                Expanded(
                  child: Text(
                    genUiText(item['name']),
                    style: const TextStyle(
                      color: KfcOpsTokens.onSurface,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      height: 18 / 13,
                      letterSpacing: 0,
                    ),
                  ),
                ),
                Text(
                  moneyVnd(item['unitPriceVnd']),
                  style: const TextStyle(
                    color: KfcOpsTokens.secondary,
                    fontSize: 12,
                    height: 16 / 12,
                    letterSpacing: 0,
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: KfcOpsTokens.spacingXs),
        GenUiMetricRow(label: 'Tạm tính', value: moneyVnd(cart['subtotalVnd'])),
        GenUiMetricRow(
          label: 'Phí giao hàng',
          value: moneyVnd(cart['deliveryFeeVnd']),
        ),
        GenUiMetricRow(
          label: 'Tổng',
          value: moneyVnd(cart['totalVnd']),
          valueColor: KfcOpsTokens.primary,
        ),
      ],
    );
  }
}
