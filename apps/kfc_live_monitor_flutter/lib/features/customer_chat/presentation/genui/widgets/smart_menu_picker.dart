import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import '../../../testing/customer_chat_keys.dart';
import 'genui_widget_chrome.dart';
import 'menu_choice_primitives.dart';

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
  final MenuSelection _selection = MenuSelection();
  String? _selectedCategoryId;

  @override
  void didUpdateWidget(covariant SmartMenuPicker oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.attachment.id != widget.attachment.id) {
      _selection.clear();
      _selectedCategoryId = null;
      return;
    }
    final categories = menuCategories(widget.attachment.data['categories']);
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
    final itemCodeCounts = menuItemCodeCounts(allItems);
    final hasAddItemsAuthority = widget.attachment.actionableActions.any(
      (action) => action.id == 'add_items',
    );
    final categories = menuCategories(widget.attachment.data['categories']);
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
    final selectedItems = _selection.selectedItems(
      allItems,
      requireExplicitAvailability: widget.attachment.authority != null,
    );
    final addItemsAction = selectedItems.isEmpty
        ? null
        : widget.attachment.bindAction(
            actionId: 'add_items',
            payload: {'items': selectedItems},
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
            _choiceRow(
              item,
              itemCodeCounts,
              hasAddItemsAuthority: hasAddItemsAuthority,
              selectedDistinct: selectedItems.length,
            ),
            if (index < items.length - 1)
              const SizedBox(
                height: 1,
                child: ColoredBox(color: KfcOpsTokens.secondaryContainer),
              ),
          ],
        if (items.isNotEmpty)
          MenuSelectionFooter(
            attachment: widget.attachment,
            selectedDistinct: selectedItems.length,
            selectedUnits: _selection.selectedUnits(allItems),
            subtotalVnd: _selection.subtotalVnd(allItems),
            action: addItemsAction,
            onAction: widget.onAction,
          ),
      ],
    );
  }

  Widget _choiceRow(
    Map<String, Object?> item,
    Map<String, int> itemCodeCounts, {
    required bool hasAddItemsAuthority,
    required int selectedDistinct,
  }) {
    final quantity = _selection.quantityFor(item);
    final selectable = isSelectableMenuItem(
      item,
      requireExplicitAvailability: widget.attachment.authority != null,
    );
    final unique = itemCodeCounts[menuItemCode(item)] == 1;
    return MenuChoiceRow(
      attachment: widget.attachment,
      item: item,
      quantity: quantity,
      onDecrease: () => _changeQuantity(item, -1),
      onIncrease: () => _changeQuantity(item, 1),
      canDecrease: hasAddItemsAuthority && selectable && unique && quantity > 0,
      canIncrease:
          hasAddItemsAuthority &&
          selectable &&
          unique &&
          quantity < 99 &&
          (quantity > 0 || selectedDistinct < maxDistinctMenuSelections),
    );
  }

  void _changeQuantity(Map<String, Object?> item, int delta) {
    if (_selection.changeQuantity(item, delta)) setState(() {});
  }
}
