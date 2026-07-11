import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import '../../../testing/customer_chat_keys.dart';
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
      showActions: false,
      accentColor: KfcOpsTokens.info,
      children: [
        for (final item in items)
          _CartItemRow(attachment: attachment, item: item, onAction: onAction),
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
        if (_cartCommands.isNotEmpty) ...[
          const SizedBox(height: KfcOpsTokens.spacingMd),
          Wrap(
            spacing: KfcOpsTokens.spacingSm,
            runSpacing: KfcOpsTokens.spacingSm,
            children: [
              for (final action in _cartCommands)
                GenUiActionButton(
                  attachment: attachment,
                  action: action,
                  onPressed: () => onAction(
                    KfcGenUiAction.fromSpec(
                      attachment: attachment,
                      spec: action,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ],
    );
  }

  List<KfcGenUiActionSpec> get _cartCommands => attachment.actions
      .where(
        (action) =>
            action.id == 'continue_to_fulfillment' || action.id == 'edit_cart',
      )
      .toList(growable: false);
}

class _CartItemRow extends StatelessWidget {
  const _CartItemRow({
    required this.attachment,
    required this.item,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final Map<String, Object?> item;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  Widget build(BuildContext context) {
    final quantity = (item['quantity'] as num? ?? 1).toInt();
    return Padding(
      padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
      child: DecoratedBox(
        decoration: const BoxDecoration(
          color: KfcOpsTokens.surfaceContainerLow,
          borderRadius: BorderRadius.all(KfcOpsTokens.radiusMd),
        ),
        child: Padding(
          padding: const EdgeInsets.all(KfcOpsTokens.spacingSm),
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      genUiText(item['name']),
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  Text(
                    moneyVnd(item['unitPriceVnd']),
                    style: const TextStyle(
                      color: KfcOpsTokens.secondary,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: KfcOpsTokens.spacingXs),
              Row(
                children: [
                  _quantityButton(
                    CustomerChatKeys.genUiCartQuantityDecrease(
                      attachment.id,
                      genUiText(item['itemCode']),
                    ),
                    LucideIcons.minus,
                    quantity <= 1 ? null : () => _update(quantity - 1),
                  ),
                  SizedBox(width: 44, child: Center(child: Text('$quantity'))),
                  _quantityButton(
                    CustomerChatKeys.genUiCartQuantityIncrease(
                      attachment.id,
                      genUiText(item['itemCode']),
                    ),
                    LucideIcons.plus,
                    () => _update(quantity + 1),
                  ),
                  const Spacer(),
                  ShadIconButton.ghost(
                    key: CustomerChatKeys.genUiCartRemove(
                      attachment.id,
                      genUiText(item['itemCode']),
                    ),
                    width: 44,
                    height: 44,
                    foregroundColor: KfcOpsTokens.critical,
                    onPressed: _remove,
                    icon: const Icon(LucideIcons.trash2),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _quantityButton(Key key, IconData icon, VoidCallback? onPressed) =>
      ShadIconButton.outline(
        key: key,
        width: 44,
        height: 44,
        onPressed: onPressed,
        icon: Icon(icon),
      );

  void _update(int quantity) => onAction(
    KfcGenUiAction(
      attachmentId: attachment.id,
      actionId: 'update_item_quantity',
      value: genUiText(item['name']),
      payload: {'itemCode': genUiText(item['itemCode']), 'quantity': quantity},
    ),
  );

  void _remove() => onAction(
    KfcGenUiAction(
      attachmentId: attachment.id,
      actionId: 'remove_item',
      value: genUiText(item['name']),
      payload: {'itemCode': genUiText(item['itemCode'])},
    ),
  );
}
