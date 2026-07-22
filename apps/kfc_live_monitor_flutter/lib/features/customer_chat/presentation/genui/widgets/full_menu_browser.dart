import 'dart:math' as math;

import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import '../../../testing/customer_chat_keys.dart';
import 'genui_widget_chrome.dart';
import 'menu_choice_primitives.dart';

class FullMenuBrowser extends StatefulWidget {
  const FullMenuBrowser({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  State<FullMenuBrowser> createState() => _FullMenuBrowserState();
}

class _FullMenuBrowserState extends State<FullMenuBrowser> {
  final MenuSelection _selection = MenuSelection();
  final ScrollController _itemScrollController = ScrollController();
  String? _selectedCategoryId;

  @override
  void dispose() {
    _itemScrollController.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant FullMenuBrowser oldWidget) {
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
    final categories = menuCategories(widget.attachment.data['categories']);
    final activeCategoryId = categories.isEmpty
        ? null
        : categories.any(
            (category) => category.categoryId == _selectedCategoryId,
          )
        ? _selectedCategoryId
        : categories.first.categoryId;
    final visibleItems = activeCategoryId == null
        ? allItems
        : allItems
              .where((item) => item['categoryId'] == activeCategoryId)
              .toList(growable: false);
    final codeCounts = menuItemCodeCounts(allItems);
    final selectedItems = _selection.selectedItems(
      allItems,
      requireExplicitAvailability: widget.attachment.authority != null,
    );
    final hasAddItemsAuthority = widget.attachment.actionableActions.any(
      (action) => action.id == 'add_items',
    );
    final addItemsAction = selectedItems.isEmpty
        ? null
        : widget.attachment.bindAction(
            actionId: 'add_items',
            payload: {'items': selectedItems},
          );
    final collectionLabel = _completeCollectionLabel(widget.attachment.data);

    return GenUiWidgetChrome(
      attachment: widget.attachment,
      onAction: widget.onAction,
      showActions: false,
      accentColor: KfcOpsTokens.primary,
      children: [
        if (collectionLabel != null)
          Padding(
            padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
            child: Text(
              collectionLabel,
              style: const TextStyle(
                color: KfcOpsTokens.secondary,
                fontSize: 11,
                fontWeight: FontWeight.w700,
                height: 15 / 11,
              ),
            ),
          ),
        if (categories.length > 1)
          Padding(
            padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
            child: SizedBox(
              height: 38,
              child: ListView.separated(
                key: CustomerChatKeys.genUiFullMenuCategoryTabs(
                  widget.attachment.id,
                ),
                scrollDirection: Axis.horizontal,
                itemCount: categories.length,
                separatorBuilder: (_, _) =>
                    const SizedBox(width: KfcOpsTokens.spacingSm),
                itemBuilder: (context, index) {
                  final category = categories[index];
                  return ShadButton.raw(
                    key: CustomerChatKeys.genUiMenuCategory(
                      widget.attachment.id,
                      category.categoryId,
                    ),
                    variant: category.categoryId == activeCategoryId
                        ? ShadButtonVariant.primary
                        : ShadButtonVariant.outline,
                    height: 36,
                    onPressed: () => _selectCategory(category.categoryId),
                    child: Text(category.label),
                  );
                },
              ),
            ),
          ),
        if (visibleItems.isEmpty)
          const Text(
            'Chưa có món phù hợp để hiển thị.',
            style: TextStyle(
              color: KfcOpsTokens.secondary,
              fontSize: 12,
              height: 16 / 12,
            ),
          )
        else
          SizedBox(
            height: math.min(420, math.max(96, visibleItems.length * 94)),
            child: ListView.separated(
              key: CustomerChatKeys.genUiFullMenuItemList(widget.attachment.id),
              controller: _itemScrollController,
              itemCount: visibleItems.length,
              separatorBuilder: (_, _) => const SizedBox(
                height: 1,
                child: ColoredBox(color: KfcOpsTokens.secondaryContainer),
              ),
              itemBuilder: (context, index) {
                final item = visibleItems[index];
                return _choiceRow(
                  item,
                  codeCounts,
                  hasAddItemsAuthority: hasAddItemsAuthority,
                  selectedDistinct: selectedItems.length,
                );
              },
            ),
          ),
        if (allItems.isNotEmpty)
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
    Map<String, int> codeCounts, {
    required bool hasAddItemsAuthority,
    required int selectedDistinct,
  }) {
    final quantity = _selection.quantityFor(item);
    final selectable = isSelectableMenuItem(
      item,
      requireExplicitAvailability: widget.attachment.authority != null,
    );
    final unique = codeCounts[menuItemCode(item)] == 1;
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

  void _selectCategory(String categoryId) {
    if (_itemScrollController.hasClients) {
      _itemScrollController.jumpTo(0);
    }
    setState(() => _selectedCategoryId = categoryId);
  }
}

String? _completeCollectionLabel(Map<String, Object?> data) {
  final total = data['total'];
  final returned = data['returned'];
  final collection = genUiMap(data['collection']);
  final scope = genUiMap(collection['scope']);
  if (total is! int ||
      total < 0 ||
      returned != total ||
      data['complete'] != true ||
      collection['total'] != total ||
      collection['returned'] != total ||
      collection['complete'] != true ||
      scope['scope'] != 'all') {
    return null;
  }
  return 'Đầy đủ $total món';
}
