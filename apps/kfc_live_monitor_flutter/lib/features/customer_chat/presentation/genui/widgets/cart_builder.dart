import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import '../../../testing/customer_chat_keys.dart';
import 'genui_widget_chrome.dart';
import 'quantity_stepper.dart';
import 'verified_remote_media.dart';

class CartBuilder extends StatefulWidget {
  const CartBuilder({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  State<CartBuilder> createState() => _CartBuilderState();
}

class _CartBuilderState extends State<CartBuilder> {
  late Map<String, int> _quantities;
  late Set<String> _validInitialQuantities;

  @override
  void initState() {
    super.initState();
    _resetDraft();
  }

  @override
  void didUpdateWidget(CartBuilder oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.attachment.id != widget.attachment.id ||
        oldWidget.attachment.data != widget.attachment.data) {
      _resetDraft();
    }
  }

  void _resetDraft() {
    final cart = genUiMap(widget.attachment.data['cart']);
    final items = genUiList(cart['items']);
    _quantities = {
      for (final item in items)
        if (_itemCode(item).isNotEmpty)
          _itemCode(item): ((item['quantity'] as num?) ?? 0).toInt(),
    };
    _validInitialQuantities = {
      for (final item in items)
        if (item['quantity'] case final num quantity
            when quantity.isFinite &&
                quantity == quantity.toInt() &&
                quantity >= 1 &&
                quantity <= 99)
          _itemCode(item),
    };
  }

  @override
  Widget build(BuildContext context) {
    final cart = genUiMap(widget.attachment.data['cart']);
    final items = genUiList(cart['items']);
    final itemCodeCounts = <String, int>{};
    for (final item in items) {
      final itemCode = genUiText(item['itemCode'], fallback: '').trim();
      if (itemCode.isNotEmpty) {
        itemCodeCounts.update(
          itemCode,
          (count) => count + 1,
          ifAbsent: () => 1,
        );
      }
    }
    final visibleItems = items
        .where((item) => (_quantities[_itemCode(item)] ?? 0) > 0)
        .toList(growable: false);
    final subtotalVnd = items.fold<int>(0, (total, item) {
      final unitPrice = (item['unitPriceVnd'] as num?)?.toInt() ?? 0;
      return total + unitPrice * (_quantities[_itemCode(item)] ?? 0);
    });
    return GenUiWidgetChrome(
      attachment: widget.attachment,
      onAction: widget.onAction,
      showActions: false,
      accentColor: KfcOpsTokens.info,
      children: [
        for (final (index, item) in visibleItems.indexed) ...[
          _CartItemRow(
            attachment: widget.attachment,
            item: item,
            quantity: _quantities[_itemCode(item)] ?? 0,
            hasUniqueItemCode:
                itemCodeCounts[genUiText(
                  item['itemCode'],
                  fallback: '',
                ).trim()] ==
                1,
            hasValidInitialQuantity: _validInitialQuantities.contains(
              _itemCode(item),
            ),
            canEditDraft: _cartCommands.isNotEmpty,
            onQuantityChanged: (quantity) {
              setState(() => _quantities[_itemCode(item)] = quantity);
            },
          ),
          if (index < visibleItems.length - 1)
            const SizedBox(
              height: 1,
              child: ColoredBox(color: KfcOpsTokens.secondaryContainer),
            ),
        ],
        if (visibleItems.isEmpty)
          const Text(
            'Giỏ hàng đang trống.',
            style: TextStyle(color: KfcOpsTokens.secondary),
          ),
        const SizedBox(height: KfcOpsTokens.spacingSm),
        GenUiMetricRow(label: 'Tạm tính dự kiến', value: moneyVnd(subtotalVnd)),
        GenUiMetricRow(
          label: 'Phí giao hàng',
          value: moneyVnd(cart['deliveryFeeVnd']),
        ),
        if (_cartCommands.isNotEmpty) ...[
          const SizedBox(height: KfcOpsTokens.spacingMd),
          Wrap(
            spacing: KfcOpsTokens.spacingSm,
            runSpacing: KfcOpsTokens.spacingSm,
            children: [
              for (final action in _cartCommands)
                GenUiActionButton(
                  attachment: widget.attachment,
                  action: action,
                  height: 40,
                  onPressed: () => _submit(action),
                ),
            ],
          ),
        ],
      ],
    );
  }

  List<KfcGenUiActionSpec> get _cartCommands => widget
      .attachment
      .actionableActions
      .where(
        (action) =>
            action.id == 'update_cart' ||
            action.id == 'continue_to_fulfillment',
      )
      .toList(growable: false);

  void _submit(KfcGenUiActionSpec action) {
    final bound = widget.attachment.bindAction(
      actionId: action.id,
      payload: {
        'items': [
          for (final entry in _quantities.entries)
            {'itemCode': entry.key, 'quantity': entry.value},
        ],
      },
    );
    if (bound != null) widget.onAction(bound);
  }
}

class _CartItemRow extends StatelessWidget {
  const _CartItemRow({
    required this.attachment,
    required this.item,
    required this.quantity,
    required this.hasUniqueItemCode,
    required this.hasValidInitialQuantity,
    required this.canEditDraft,
    required this.onQuantityChanged,
  });

  final KfcGenUiAttachment attachment;
  final Map<String, Object?> item;
  final int quantity;
  final bool hasUniqueItemCode;
  final bool hasValidInitialQuantity;
  final bool canEditDraft;
  final ValueChanged<int> onQuantityChanged;

  @override
  Widget build(BuildContext context) {
    final itemCode = genUiText(item['itemCode'], fallback: '').trim();
    final canEdit =
        hasUniqueItemCode &&
        hasValidInitialQuantity &&
        canEditDraft &&
        itemCode.isNotEmpty &&
        quantity >= 1 &&
        quantity <= 99;
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
                onDecrease: canEdit
                    ? () => onQuantityChanged(quantity - 1)
                    : null,
                onIncrease: canEdit && quantity < 99
                    ? () => onQuantityChanged(quantity + 1)
                    : null,
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
                  enabled: canEdit,
                  onPressed: canEdit ? () => onQuantityChanged(0) : null,
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
}

String _itemCode(Map<String, Object?> item) =>
    genUiText(item['itemCode'], fallback: '').trim();

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
