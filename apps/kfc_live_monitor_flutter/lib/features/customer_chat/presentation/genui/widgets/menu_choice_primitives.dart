import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import '../../../testing/customer_chat_keys.dart';
import 'genui_widget_chrome.dart';
import 'quantity_stepper.dart';
import 'verified_remote_media.dart';

const maxDistinctMenuSelections = 5;

typedef MenuCategory = ({String categoryId, String label});

List<MenuCategory> menuCategories(Object? value) {
  if (value is! List) return const [];
  final categories = <MenuCategory>[];
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

class MenuSelection {
  final Map<String, int> _quantities = {};

  void clear() => _quantities.clear();

  int quantityFor(Map<String, Object?> item) {
    return _quantities[menuItemCode(item)] ?? 0;
  }

  int get distinctCount =>
      _quantities.values.where((quantity) => quantity > 0).length;

  bool changeQuantity(Map<String, Object?> item, int delta) {
    final code = menuItemCode(item);
    final current = _quantities[code] ?? 0;
    if (code.isEmpty ||
        (delta > 0 &&
            current == 0 &&
            distinctCount >= maxDistinctMenuSelections)) {
      return false;
    }
    final next = (current + delta).clamp(0, 99);
    if (next == current) return false;
    _quantities[code] = next;
    return true;
  }

  List<Map<String, Object?>> selectedItems(
    List<Map<String, Object?>> items, {
    required bool requireExplicitAvailability,
  }) {
    final codeCounts = menuItemCodeCounts(items);
    return [
      for (final item in items)
        if (menuItemCode(item).isNotEmpty &&
            isSelectableMenuItem(
              item,
              requireExplicitAvailability: requireExplicitAvailability,
            ) &&
            codeCounts[menuItemCode(item)] == 1 &&
            quantityFor(item) >= 1 &&
            quantityFor(item) <= 99)
          {'itemCode': menuItemCode(item), 'quantity': quantityFor(item)},
    ];
  }

  int selectedUnits(List<Map<String, Object?>> items) {
    return items.fold<int>(0, (total, item) => total + quantityFor(item));
  }

  int subtotalVnd(List<Map<String, Object?>> items) {
    return items.fold<int>(
      0,
      (total, item) =>
          total + quantityFor(item) * menuItemPriceVnd(item['priceVnd']),
    );
  }
}

Map<String, int> menuItemCodeCounts(List<Map<String, Object?>> items) {
  final counts = <String, int>{};
  for (final item in items) {
    final code = menuItemCode(item);
    if (code.isNotEmpty) {
      counts.update(code, (count) => count + 1, ifAbsent: () => 1);
    }
  }
  return counts;
}

int menuItemPriceVnd(Object? value) => switch (value) {
  int amount => amount,
  num amount => amount.toInt(),
  _ => int.tryParse('$value') ?? 0,
};

String menuItemCode(Map<String, Object?> item) {
  return genUiText(item['code'], fallback: '').trim();
}

bool isSelectableMenuItem(
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

class MenuChoiceRow extends StatelessWidget {
  const MenuChoiceRow({
    super.key,
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
    final code = menuItemCode(item);
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
}

class MenuSelectionFooter extends StatelessWidget {
  const MenuSelectionFooter({
    super.key,
    required this.attachment,
    required this.selectedDistinct,
    required this.selectedUnits,
    required this.subtotalVnd,
    required this.action,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final int selectedDistinct;
  final int selectedUnits;
  final int subtotalVnd;
  final KfcGenUiAction? action;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: KfcOpsTokens.spacingMd),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  label:
                      'Đã chọn $selectedDistinct trên $maxDistinctMenuSelections món khác nhau',
                  child: Text(
                    '$selectedDistinct/$maxDistinctMenuSelections món khác nhau đã chọn',
                    key: CustomerChatKeys.genUiMenuSelectionLimit(
                      attachment.id,
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
              key: CustomerChatKeys.genUiAction(attachment.id, 'add_items'),
              variant: ShadButtonVariant.primary,
              height: 40,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              backgroundColor: KfcOpsTokens.primary,
              foregroundColor: KfcOpsTokens.onPrimary,
              onPressed: action == null ? null : () => onAction(action!),
              child: const Text('Xác nhận món'),
            ),
          ),
        ],
      ),
    );
  }
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
