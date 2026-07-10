import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import '../../../testing/customer_chat_keys.dart';
import 'genui_widget_chrome.dart';

const _maxVisibleMenuItems = 5;

class SmartMenuPicker extends StatefulWidget {
  const SmartMenuPicker({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  State<SmartMenuPicker> createState() => _SmartMenuPickerState();
}

class _SmartMenuPickerState extends State<SmartMenuPicker> {
  final Map<String, int> _quantities = {};

  @override
  Widget build(BuildContext context) {
    final items = genUiList(
      widget.attachment.data['items'],
    ).take(_maxVisibleMenuItems).toList(growable: false);
    final hiddenCount =
        genUiList(widget.attachment.data['items']).length - items.length;

    return GenUiWidgetChrome(
      attachment: widget.attachment,
      onAction: widget.onAction,
      showActions: false,
      accentColor: KfcOpsTokens.primary,
      children: [
        if (items.isEmpty)
          const Text(
            'Chưa có món phù hợp để hiển thị.',
            style: TextStyle(
              color: KfcOpsTokens.secondary,
              fontSize: 12,
              height: 16 / 12,
              letterSpacing: 0,
            ),
          )
        else
          for (final item in items)
            Padding(
              padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
              child: _MenuChoiceRow(
                attachment: widget.attachment,
                item: item,
                quantity: _quantityFor(item),
                onDecrease: () => _changeQuantity(item, -1),
                onIncrease: () => _changeQuantity(item, 1),
                onAdd: () => widget.onAction(_actionFor(item)),
              ),
            ),
        if (hiddenCount > 0)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              'Còn $hiddenCount món khác. Hãy nhắn thêm tiêu chí để lọc nhanh hơn.',
              style: const TextStyle(
                color: KfcOpsTokens.secondary,
                fontSize: 12,
                height: 16 / 12,
                letterSpacing: 0,
              ),
            ),
          ),
      ],
    );
  }

  int _quantityFor(Map<String, Object?> item) {
    return _quantities[_itemCode(item)] ?? 1;
  }

  void _changeQuantity(Map<String, Object?> item, int delta) {
    final code = _itemCode(item);
    final next = (_quantities[code] ?? 1) + delta;
    setState(() {
      _quantities[code] = next.clamp(1, 99);
    });
  }

  KfcGenUiAction _actionFor(Map<String, Object?> item) {
    final code = _itemCode(item);
    final name = genUiText(item['name'], fallback: 'món này');
    final quantity = _quantities[code] ?? 1;
    return KfcGenUiAction(
      attachmentId: widget.attachment.id,
      actionId: 'add_item',
      value: name,
      payload: {'itemCode': code, 'quantity': quantity},
    );
  }
}

class _MenuChoiceRow extends StatelessWidget {
  const _MenuChoiceRow({
    required this.attachment,
    required this.item,
    required this.quantity,
    required this.onDecrease,
    required this.onIncrease,
    required this.onAdd,
  });

  final KfcGenUiAttachment attachment;
  final Map<String, Object?> item;
  final int quantity;
  final VoidCallback onDecrease;
  final VoidCallback onIncrease;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final code = _itemCode(item);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: KfcOpsTokens.surfaceContainerLow,
        borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
      ),
      child: Padding(
        padding: const EdgeInsets.all(KfcOpsTokens.spacingSm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        genUiText(item['name']),
                        style: const TextStyle(
                          color: KfcOpsTokens.onSurface,
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          height: 18 / 13,
                          letterSpacing: 0,
                        ),
                      ),
                      if (genUiText(item['description'], fallback: '')
                          case final description when description.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(
                            description,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: KfcOpsTokens.secondary,
                              fontSize: 11,
                              height: 15 / 11,
                              letterSpacing: 0,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: KfcOpsTokens.spacingSm),
                Text(
                  moneyVnd(item['priceVnd']),
                  style: const TextStyle(
                    color: KfcOpsTokens.onSurface,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    height: 16 / 12,
                    letterSpacing: 0,
                  ),
                ),
              ],
            ),
            const SizedBox(height: KfcOpsTokens.spacingSm),
            Row(
              children: [
                _QuantityButton(
                  key: CustomerChatKeys.genUiMenuQuantityDecrease(
                    attachment.id,
                    code,
                  ),
                  icon: LucideIcons.minus,
                  onPressed: quantity <= 1 ? null : onDecrease,
                ),
                Container(
                  key: CustomerChatKeys.genUiMenuQuantity(attachment.id, code),
                  width: 34,
                  height: 28,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: KfcOpsTokens.surfaceContainerLowest,
                    border: Border.all(color: KfcOpsTokens.secondaryContainer),
                  ),
                  child: Text(
                    '$quantity',
                    style: const TextStyle(
                      color: KfcOpsTokens.onSurface,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      height: 16 / 12,
                      letterSpacing: 0,
                    ),
                  ),
                ),
                _QuantityButton(
                  key: CustomerChatKeys.genUiMenuQuantityIncrease(
                    attachment.id,
                    code,
                  ),
                  icon: LucideIcons.plus,
                  onPressed: onIncrease,
                ),
                const Spacer(),
                ShadButton.raw(
                  key: CustomerChatKeys.genUiMenuAddItem(attachment.id, code),
                  variant: ShadButtonVariant.primary,
                  size: ShadButtonSize.sm,
                  height: 30,
                  padding: const EdgeInsets.symmetric(
                    horizontal: KfcOpsTokens.spacingMd,
                    vertical: KfcOpsTokens.spacingSm,
                  ),
                  backgroundColor: KfcOpsTokens.primary,
                  hoverBackgroundColor: KfcOpsTokens.primary,
                  foregroundColor: KfcOpsTokens.onPrimary,
                  hoverForegroundColor: KfcOpsTokens.onPrimary,
                  onPressed: onAdd,
                  child: const Text(
                    'Thêm',
                    style: TextStyle(
                      color: KfcOpsTokens.onPrimary,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      height: 16 / 12,
                      letterSpacing: 0,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _QuantityButton extends StatelessWidget {
  const _QuantityButton({
    super.key,
    required this.icon,
    required this.onPressed,
  });

  final IconData icon;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return ShadIconButton.outline(
      width: 28,
      height: 28,
      iconSize: 14,
      padding: EdgeInsets.zero,
      backgroundColor: KfcOpsTokens.surfaceContainerLowest,
      hoverBackgroundColor: KfcOpsTokens.surfaceContainerLow,
      foregroundColor: KfcOpsTokens.onSurface,
      onPressed: onPressed,
      icon: Icon(icon),
    );
  }
}

String _itemCode(Map<String, Object?> item) {
  final code = genUiText(item['code'], fallback: '');
  if (code.isNotEmpty) return code;
  return genUiText(item['name'], fallback: 'item');
}
