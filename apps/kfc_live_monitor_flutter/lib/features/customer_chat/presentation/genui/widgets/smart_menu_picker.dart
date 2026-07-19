import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import '../../../testing/customer_chat_keys.dart';
import 'genui_widget_chrome.dart';
import 'quantity_stepper.dart';
import 'verified_remote_media.dart';

const _maxDistinctMenuSelections = 5;

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
  String? _selectedCategory;

  @override
  Widget build(BuildContext context) {
    final allItems = genUiList(widget.attachment.data['items']);
    final categories = _categories(allItems);
    if (_selectedCategory != null && !categories.contains(_selectedCategory)) {
      _selectedCategory = null;
    }
    final activeCategory = categories.length > 1
        ? _selectedCategory ?? categories.first
        : null;
    final items = activeCategory == null
        ? allItems
        : allItems
              .where((item) => _category(item) == activeCategory)
              .toList(growable: false);
    final selectedItems = _selectedItems(allItems);
    final selectedDistinct = selectedItems.length;
    final selectedUnits = selectedItems.fold<int>(
      0,
      (total, item) => total + (item['quantity'] as int),
    );
    final subtotalVnd = allItems.fold<int>(
      0,
      (total, item) => total + _quantityFor(item) * _priceVnd(item['priceVnd']),
    );

    return GenUiWidgetChrome(
      attachment: widget.attachment,
      onAction: widget.onAction,
      showActions: false,
      accentColor: KfcOpsTokens.primary,
      children: [
        if (categories.length > 1)
          Padding(
            padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
            child: Wrap(
              spacing: KfcOpsTokens.spacingSm,
              runSpacing: KfcOpsTokens.spacingSm,
              children: [
                for (final category in categories)
                  ShadButton.raw(
                    key: CustomerChatKeys.genUiMenuCategory(
                      widget.attachment.id,
                      category,
                    ),
                    variant: category == activeCategory
                        ? ShadButtonVariant.primary
                        : ShadButtonVariant.outline,
                    height: 36,
                    onPressed: () =>
                        setState(() => _selectedCategory = category),
                    child: Text(category),
                  ),
              ],
            ),
          ),
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
          for (final (index, item) in items.indexed) ...[
            _MenuChoiceRow(
              attachment: widget.attachment,
              item: item,
              quantity: _quantityFor(item),
              onDecrease: () => _changeQuantity(item, -1),
              onIncrease: () => _changeQuantity(item, 1),
              canIncrease:
                  _quantityFor(item) > 0 ||
                  selectedDistinct < _maxDistinctMenuSelections,
            ),
            if (index < items.length - 1)
              const SizedBox(
                height: 1,
                child: ColoredBox(color: KfcOpsTokens.secondaryContainer),
              ),
          ],
        if (items.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: KfcOpsTokens.spacingMd),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Semantics(
                        label:
                            'Đã chọn $selectedDistinct trên $_maxDistinctMenuSelections món khác nhau',
                        child: Text(
                          '$selectedDistinct/$_maxDistinctMenuSelections món khác nhau đã chọn',
                          key: CustomerChatKeys.genUiMenuSelectionLimit(
                            widget.attachment.id,
                          ),
                          style: const TextStyle(
                            color: KfcOpsTokens.secondary,
                            fontSize: 11,
                            height: 15 / 11,
                          ),
                        ),
                      ),
                      Text(
                        '$selectedUnits món',
                        style: const TextStyle(
                          color: KfcOpsTokens.onSurface,
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          height: 18 / 13,
                        ),
                      ),
                      Text(
                        'Tạm tính ${moneyVnd(subtotalVnd)}',
                        style: const TextStyle(
                          color: KfcOpsTokens.secondary,
                          fontSize: 11,
                          height: 15 / 11,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: KfcOpsTokens.spacingSm),
                SizedBox(
                  width: 144,
                  height: 40,
                  child: ShadButton.raw(
                    key: CustomerChatKeys.genUiAction(
                      widget.attachment.id,
                      'add_items',
                    ),
                    variant: ShadButtonVariant.primary,
                    height: 40,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    backgroundColor: KfcOpsTokens.primary,
                    foregroundColor: KfcOpsTokens.onPrimary,
                    onPressed: selectedItems.isEmpty
                        ? null
                        : () => widget.onAction(
                            KfcGenUiAction(
                              attachmentId: widget.attachment.id,
                              actionId: 'add_items',
                              payload: {'items': selectedItems},
                            ),
                          ),
                    child: const Text('Xác nhận món'),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  int _quantityFor(Map<String, Object?> item) {
    return _quantities[_itemCode(item)] ?? 0;
  }

  void _changeQuantity(Map<String, Object?> item, int delta) {
    final code = _itemCode(item);
    if (delta > 0 &&
        (_quantities[code] ?? 0) == 0 &&
        _quantities.values.where((quantity) => quantity > 0).length >=
            _maxDistinctMenuSelections) {
      return;
    }
    final next = (_quantities[code] ?? 0) + delta;
    setState(() {
      _quantities[code] = next.clamp(0, 99);
    });
  }

  List<String> _categories(List<Map<String, Object?>> items) {
    final categories = <String>[];
    for (final item in items) {
      final category = _category(item);
      if (category == null) return const [];
      if (!categories.contains(category)) categories.add(category);
    }
    return categories;
  }

  String? _category(Map<String, Object?> item) {
    final category = genUiText(item['category'], fallback: '').trim();
    return category.isEmpty ? null : category;
  }

  List<Map<String, Object?>> _selectedItems(List<Map<String, Object?>> items) {
    return [
      for (final item in items)
        if (_quantityFor(item) > 0)
          {'itemCode': _itemCode(item), 'quantity': _quantityFor(item)},
    ];
  }
}

class _MenuChoiceRow extends StatelessWidget {
  const _MenuChoiceRow({
    required this.attachment,
    required this.item,
    required this.quantity,
    required this.onDecrease,
    required this.onIncrease,
    required this.canIncrease,
  });

  final KfcGenUiAttachment attachment;
  final Map<String, Object?> item;
  final int quantity;
  final VoidCallback onDecrease;
  final VoidCallback onIncrease;
  final bool canIncrease;

  @override
  Widget build(BuildContext context) {
    final code = _itemCode(item);
    return Padding(
      key: CustomerChatKeys.genUiMenuItem(attachment.id, code),
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          VerifiedRemoteMedia(
            imageKey: CustomerChatKeys.genUiMenuImage(attachment.id, code),
            imageUrl: genUiText(item['imageUrl'], fallback: ''),
            semanticLabel:
                'Hình món ${genUiText(item['name'], fallback: 'KFC')}',
            width: 72,
            height: 72,
          ),
          if (genUiText(item['imageUrl'], fallback: '').isNotEmpty)
            const SizedBox(width: 12),
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
                if (item['recommendedQuantity'] is num) ...[
                  const SizedBox(height: 4),
                  Text(
                    _compositionText(item),
                    style: const TextStyle(
                      color: KfcOpsTokens.info,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      height: 15 / 11,
                    ),
                  ),
                ],
                const SizedBox(height: 3),
                Text(
                  moneyVnd(item['priceVnd']),
                  style: const TextStyle(
                    color: KfcOpsTokens.onSurface,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    height: 16 / 12,
                    letterSpacing: 0,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: KfcOpsTokens.spacingSm),
          GenUiQuantityStepper(
            quantity: quantity,
            decreaseKey: CustomerChatKeys.genUiMenuQuantityDecrease(
              attachment.id,
              code,
            ),
            valueKey: CustomerChatKeys.genUiMenuQuantity(attachment.id, code),
            increaseKey: CustomerChatKeys.genUiMenuQuantityIncrease(
              attachment.id,
              code,
            ),
            onDecrease: quantity <= 0 ? null : onDecrease,
            onIncrease: canIncrease ? onIncrease : null,
          ),
        ],
      ),
    );
  }

  String _compositionText(Map<String, Object?> item) {
    final quantity = (item['recommendedQuantity'] as num).toInt();
    final total = moneyVnd(item['composedTotalVnd']);
    final delta = item['budgetDeltaVnd'];
    final budgetText = delta is num
        ? delta >= 0
              ? 'còn ${moneyVnd(delta)}'
              : 'vượt ${moneyVnd(delta.abs())}'
        : null;
    return 'Gợi ý $quantity phần · Tổng $total${budgetText == null ? '' : ' · $budgetText'}';
  }
}

int _priceVnd(Object? value) => switch (value) {
  int amount => amount,
  num amount => amount.toInt(),
  _ => int.tryParse('$value') ?? 0,
};

String _itemCode(Map<String, Object?> item) {
  final code = genUiText(item['code'], fallback: '');
  if (code.isNotEmpty) return code;
  return genUiText(item['name'], fallback: 'item');
}
