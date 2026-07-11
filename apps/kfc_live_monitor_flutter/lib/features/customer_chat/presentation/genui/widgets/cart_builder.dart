import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import '../../../testing/customer_chat_keys.dart';
import 'genui_widget_chrome.dart';
import 'quantity_stepper.dart';
import 'verified_remote_media.dart';

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
        for (final (index, item) in items.indexed) ...[
          _CartItemRow(attachment: attachment, item: item, onAction: onAction),
          if (index < items.length - 1)
            const SizedBox(
              height: 1,
              child: ColoredBox(color: KfcOpsTokens.secondaryContainer),
            ),
        ],
        const SizedBox(height: KfcOpsTokens.spacingSm),
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
                  height: 40,
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
    final itemCode = genUiText(item['itemCode']);
    final imageUrl = genUiText(item['imageUrl'], fallback: '');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final mediaAndDetails = Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              VerifiedRemoteMedia(
                imageKey: CustomerChatKeys.genUiCartImage(
                  attachment.id,
                  itemCode,
                ),
                imageUrl: imageUrl,
                semanticLabel:
                    'Hình món ${genUiText(item['name'], fallback: 'KFC')}',
                width: 72,
                height: 72,
              ),
              if (imageUrl.isNotEmpty) const SizedBox(width: 12),
              Expanded(child: _CartItemDetails(item: item)),
            ],
          );
          final controls = Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              GenUiQuantityStepper(
                quantity: quantity,
                decreaseKey: CustomerChatKeys.genUiCartQuantityDecrease(
                  attachment.id,
                  itemCode,
                ),
                valueKey: CustomerChatKeys.genUiCartQuantity(
                  attachment.id,
                  itemCode,
                ),
                increaseKey: CustomerChatKeys.genUiCartQuantityIncrease(
                  attachment.id,
                  itemCode,
                ),
                onDecrease: quantity <= 1 ? null : () => _update(quantity - 1),
                onIncrease: () => _update(quantity + 1),
              ),
              const SizedBox(width: KfcOpsTokens.spacingSm),
              SizedBox(
                width: 32,
                height: 32,
                child: ShadIconButton.ghost(
                  key: CustomerChatKeys.genUiCartRemove(
                    attachment.id,
                    itemCode,
                  ),
                  width: 32,
                  height: 32,
                  iconSize: 15,
                  padding: EdgeInsets.zero,
                  foregroundColor: KfcOpsTokens.critical,
                  onPressed: _remove,
                  icon: const Icon(LucideIcons.trash2),
                ),
              ),
            ],
          );

          if (constraints.maxWidth < 340) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                mediaAndDetails,
                const SizedBox(height: KfcOpsTokens.spacingSm),
                Align(alignment: Alignment.centerRight, child: controls),
              ],
            );
          }
          return Row(
            children: [
              Expanded(child: mediaAndDetails),
              const SizedBox(width: KfcOpsTokens.spacingSm),
              controls,
            ],
          );
        },
      ),
    );
  }

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

class _CartItemDetails extends StatelessWidget {
  const _CartItemDetails({required this.item});

  final Map<String, Object?> item;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          genUiText(item['name']),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: KfcOpsTokens.onSurface,
            fontSize: 13,
            fontWeight: FontWeight.w700,
            height: 18 / 13,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          moneyVnd(item['unitPriceVnd']),
          style: const TextStyle(
            color: KfcOpsTokens.onSurface,
            fontSize: 12,
            fontWeight: FontWeight.w800,
            height: 16 / 12,
          ),
        ),
      ],
    );
  }
}
