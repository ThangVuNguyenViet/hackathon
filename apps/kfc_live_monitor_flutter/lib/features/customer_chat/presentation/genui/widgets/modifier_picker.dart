import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import '../../../testing/customer_chat_keys.dart';
import 'decision_widget_support.dart';
import 'genui_widget_chrome.dart';

class ModifierPicker extends StatefulWidget {
  const ModifierPicker({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  State<ModifierPicker> createState() => _ModifierPickerState();
}

class _ModifierPickerState extends State<ModifierPicker> {
  late Map<String, String> _selections;

  @override
  void initState() {
    super.initState();
    _selections = _initialSelections();
  }

  @override
  void didUpdateWidget(ModifierPicker oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.attachment.id != widget.attachment.id ||
        oldWidget.attachment.data != widget.attachment.data) {
      _selections = _initialSelections();
    }
  }

  Map<String, String> _initialSelections() {
    final tree = decisionMap(widget.attachment.data['modifierTree']);
    final selections = <String, String>{};
    void selectDefaults(List<Map<String, Object?>> groups) {
      for (final group in groups) {
        final groupId = decisionText(group['groupId']);
        final options = decisionList(group['options']);
        final defaults = options
            .where((option) => option['default'] == true)
            .toList(growable: false);
        final selected = defaults.length == 1
            ? defaults.single
            : options.length == 1 && (group['min'] as num? ?? 0) > 0
            ? options.single
            : null;
        if (groupId.isEmpty || selected == null) continue;
        selections[groupId] = _optionId(selected);
        selectDefaults(decisionList(selected['modifierGroups']));
      }
    }

    selectDefaults(decisionList(tree['modifierGroups']));
    return selections;
  }

  @override
  Widget build(BuildContext context) {
    final tree = decisionMap(widget.attachment.data['modifierTree']);
    final groups = _activeGroups(tree);
    final parentMedia =
        decisionMedia(widget.attachment.data['parentMedia']) ??
        decisionMedia(widget.attachment.data['item']);
    final productName = decisionText(
      widget.attachment.data['productName'],
      fallback: decisionText(tree['name'], fallback: widget.attachment.title),
    );
    final applyActions = widget.attachment.actionableActions
        .where((action) => action.id == 'apply_modifiers')
        .toList(growable: false);

    return GenUiWidgetChrome(
      attachment: widget.attachment,
      onAction: widget.onAction,
      showActions: false,
      children: [
        DecisionHeroMedia(
          media: parentMedia,
          imageKey: CustomerChatKeys.genUiDecisionImage(
            widget.attachment.id,
            parentMedia?.mediaKey ?? 'none',
          ),
        ),
        Text(productName, style: decisionTitleStyle),
        const SizedBox(height: KfcOpsTokens.spacingSm),
        for (final group in groups) ...[
          Text(
            decisionText(group['name'], fallback: 'Lựa chọn'),
            style: const TextStyle(
              color: KfcOpsTokens.onSurface,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: KfcOpsTokens.spacingSm),
          for (final option in decisionList(group['options']))
            _ModifierOptionButton(
              attachmentId: widget.attachment.id,
              groupId: decisionText(group['groupId']),
              option: option,
              selected:
                  _selections[decisionText(group['groupId'])] ==
                  _optionId(option),
              onPressed: () {
                setState(() {
                  _selections[decisionText(group['groupId'])] = _optionId(
                    option,
                  );
                  _normalizeSelections(tree);
                });
              },
            ),
        ],
        if (applyActions.length == 1) ...[
          const SizedBox(height: KfcOpsTokens.spacingSm),
          GenUiActionButton(
            attachment: widget.attachment,
            action: applyActions.single,
            onPressed: _apply,
            enabled: _requiredGroupsSatisfied(groups),
          ),
        ],
      ],
    );
  }

  void _apply() {
    final tree = decisionMap(widget.attachment.data['modifierTree']);
    final groups = _activeGroups(tree);
    if (!_requiredGroupsSatisfied(groups)) return;
    final activeGroupIds = groups
        .map((group) => decisionText(group['groupId']))
        .toSet();
    final bound = widget.attachment.bindAction(
      actionId: 'apply_modifiers',
      payload: {
        'itemCode': decisionText(tree['itemCode']),
        'selections': [
          for (final selection in _selections.entries)
            if (activeGroupIds.contains(selection.key))
              {'groupId': selection.key, 'modifierId': selection.value},
        ],
      },
    );
    if (bound != null) widget.onAction(bound);
  }

  List<Map<String, Object?>> _activeGroups(Map<String, Object?> tree) {
    final active = <Map<String, Object?>>[];
    void visit(List<Map<String, Object?>> groups) {
      for (final group in groups) {
        active.add(group);
        final groupId = decisionText(group['groupId']);
        final selectedId = _selections[groupId];
        if (selectedId == null) continue;
        final selected = decisionList(group['options'])
            .cast<Map<String, Object?>?>()
            .firstWhere(
              (option) => option != null && _optionId(option) == selectedId,
              orElse: () => null,
            );
        if (selected != null) {
          visit(decisionList(selected['modifierGroups']));
        }
      }
    }

    visit(decisionList(tree['modifierGroups']));
    return active;
  }

  void _normalizeSelections(Map<String, Object?> tree) {
    var changed = true;
    while (changed) {
      changed = false;
      final active = _activeGroups(tree);
      final activeGroupIds = active
          .map((group) => decisionText(group['groupId']))
          .toSet();
      final beforePrune = _selections.length;
      _selections.removeWhere(
        (groupId, _) => !activeGroupIds.contains(groupId),
      );
      changed = beforePrune != _selections.length;
      for (final group in active) {
        final groupId = decisionText(group['groupId']);
        if (_selections.containsKey(groupId)) continue;
        final options = decisionList(group['options']);
        final defaults = options
            .where((option) => option['default'] == true)
            .toList(growable: false);
        final selected = defaults.length == 1
            ? defaults.single
            : options.length == 1 && (group['min'] as num? ?? 0) > 0
            ? options.single
            : null;
        if (selected != null) {
          _selections[groupId] = _optionId(selected);
          changed = true;
        }
      }
    }
  }

  bool _requiredGroupsSatisfied(List<Map<String, Object?>> groups) {
    return groups.every((group) {
      if ((group['min'] as num? ?? 0) <= 0) return true;
      final groupId = decisionText(group['groupId']);
      final selectedId = _selections[groupId];
      return selectedId != null &&
          decisionList(
            group['options'],
          ).any((option) => _optionId(option) == selectedId);
    });
  }
}

class _ModifierOptionButton extends StatelessWidget {
  const _ModifierOptionButton({
    required this.attachmentId,
    required this.groupId,
    required this.option,
    required this.selected,
    required this.onPressed,
  });

  final String attachmentId;
  final String groupId;
  final Map<String, Object?> option;
  final bool selected;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final optionId = _optionId(option);
    return Padding(
      padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
      child: SizedBox(
        width: double.infinity,
        child: ShadButton.raw(
          key: CustomerChatKeys.genUiModifierOption(
            attachmentId,
            groupId,
            optionId,
          ),
          variant: selected
              ? ShadButtonVariant.primary
              : ShadButtonVariant.outline,
          backgroundColor: selected
              ? KfcOpsTokens.primary
              : KfcOpsTokens.surfaceContainerLowest,
          foregroundColor: selected
              ? KfcOpsTokens.onPrimary
              : KfcOpsTokens.onSurface,
          hoverBackgroundColor: KfcOpsTokens.surfaceContainerLow,
          hoverForegroundColor: KfcOpsTokens.onSurface,
          height: 40,
          onPressed: onPressed,
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text(decisionText(option['name'], fallback: 'Lựa chọn')),
          ),
        ),
      ),
    );
  }
}

String _optionId(Map<String, Object?> option) => decisionText(
  option['modifierId'] ??
      option['id'] ??
      option['code'] ??
      option['optionCode'],
);
