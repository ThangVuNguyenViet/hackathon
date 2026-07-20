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
  String? _selectedCategoryId;

  @override
  void didUpdateWidget(covariant SmartMenuPicker oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.attachment.id != widget.attachment.id) {
      _quantities.clear();
      _selectedCategoryId = null;
      return;
    }
    final categories = _menuCategories(widget.attachment.data['categories']);
    if (_selectedCategoryId != null &&
        !categories.any(
          (category) => category.categoryId == _selectedCategoryId,
        )) {
      _selectedCategoryId = null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final allItems = genUiList(widget.attachment.data['items']);
    final itemCodeCounts = <String, int>{};
    for (final item in allItems) {
      final code = _itemCode(item);
      if (code.isNotEmpty) {
        itemCodeCounts.update(code, (count) => count + 1, ifAbsent: () => 1);
      }
    }
    final hasAddItemsAuthority = widget.attachment.actionableActions.any(
      (action) => action.id == 'add_items',
    );
    final categories = _menuCategories(widget.attachment.data['categories']);
    final activeCategoryId = categories.isEmpty
        ? null
        : categories.any(
            (category) => category.categoryId == _selectedCategoryId,
          )
        ? _selectedCategoryId
        : categories.first.categoryId;
    final items = activeCategoryId == null
        ? allItems
        : allItems
              .where((item) => item['categoryId'] == activeCategoryId)
              .toList(growable: false);
    final selectedItems = _selectedItems(allItems, itemCodeCounts);
    final addItemsAction = selectedItems.isEmpty
        ? null
        : widget.attachment.bindAction(
            actionId: 'add_items',
            payload: {'items': selectedItems},
          );
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
                      category.categoryId,
                    ),
                    variant: category.categoryId == activeCategoryId
                        ? ShadButtonVariant.primary
                        : ShadButtonVariant.outline,
                    height: 36,
                    onPressed: () => setState(
                      () => _selectedCategoryId = category.categoryId,
                    ),
                    child: Text(category.label),
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
              canDecrease:
                  hasAddItemsAuthority &&
                  _isSelectableMenuItem(
                    item,
                    requireExplicitAvailability:
                        widget.attachment.authority != null,
                  ) &&
                  itemCodeCounts[_itemCode(item)] == 1 &&
                  _quantityFor(item) > 0,
              canIncrease:
                  hasAddItemsAuthority &&
                  _isSelectableMenuItem(
                    item,
                    requireExplicitAvailability:
                        widget.attachment.authority != null,
                  ) &&
                  itemCodeCounts[_itemCode(item)] == 1 &&
                  _quantityFor(item) < 99 &&
                  (_quantityFor(item) > 0 ||
                      selectedDistinct < _maxDistinctMenuSelections),
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
                    onPressed: addItemsAction == null
                        ? null
                        : () => widget.onAction(addItemsAction),
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

  List<Map<String, Object?>> _selectedItems(
    List<Map<String, Object?>> items,
    Map<String, int> itemCodeCounts,
  ) {
    return [
      for (final item in items)
        if (_itemCode(item).isNotEmpty &&
            _isSelectableMenuItem(
              item,
              requireExplicitAvailability: widget.attachment.authority != null,
            ) &&
            itemCodeCounts[_itemCode(item)] == 1 &&
            _quantityFor(item) >= 1 &&
            _quantityFor(item) <= 99)
          {'itemCode': _itemCode(item), 'quantity': _quantityFor(item)},
    ];
  }
}

typedef _MenuCategory = ({String categoryId, String label});

List<_MenuCategory> _menuCategories(Object? value) {
  if (value is! List) return const [];
  final categories = <_MenuCategory>[];
  final categoryIds = <String>{};
  for (final rawCategory in value) {
    if (rawCategory is! Map ||
        rawCategory.length != 2 ||
        !rawCategory.containsKey('categoryId') ||
        !rawCategory.containsKey('label')) {
      return const [];
    }
    final categoryId = rawCategory['categoryId'];
    final label = rawCategory['label'];
    if (categoryId is! String ||
        categoryId.isEmpty ||
        label is! String ||
        label.isEmpty ||
        !categoryIds.add(categoryId)) {
      return const [];
    }
    categories.add((categoryId: categoryId, label: label));
  }
  return categories;
}

class _MenuChoiceRow extends StatelessWidget {
  const _MenuChoiceRow({
    required this.attachment,
    required this.item,
    required this.quantity,
    required this.onDecrease,
    required this.onIncrease,
    required this.canDecrease,
    required this.canIncrease,
  });

  final KfcGenUiAttachment attachment;
  final Map<String, Object?> item;
  final int quantity;
  final VoidCallback onDecrease;
  final VoidCallback onIncrease;
  final bool canDecrease;
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
            onDecrease: canDecrease ? onDecrease : null,
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
  return genUiText(item['code'], fallback: '').trim();
}

bool _isSelectableMenuItem(
  Map<String, Object?> item, {
  required bool requireExplicitAvailability,
}) {
  final modifierGroups = item['modifierGroups'];
  final availabilityIsValid = requireExplicitAvailability
      ? item['available'] == true
      : item['available'] != false;
  return availabilityIsValid &&
      item['isCustomize'] != true &&
      item['hasModifiers'] != true &&
      (modifierGroups == null ||
          (modifierGroups is List && modifierGroups.isEmpty));
}
