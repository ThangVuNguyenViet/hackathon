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
  (String, String)? _selectedIdentity;

  @override
  Widget build(BuildContext context) {
    final groups = _trustedModifierGroups(
      widget.attachment.data,
      widget.attachment.actionableActions,
    );
    final options = [for (final group in groups) ...group.options];
    final optionIdCounts = <String, int>{};
    for (final option in options) {
      optionIdCounts.update(
        _optionId(option),
        (count) => count + 1,
        ifAbsent: () => 1,
      );
    }
    final tree = decisionMap(widget.attachment.data['modifierTree']);
    final parentMedia =
        decisionMedia(widget.attachment.data['parentMedia']) ??
        decisionMedia(widget.attachment.data['item']) ??
        (options.isEmpty ? null : decisionMedia(options.first));
    final selected = options.cast<Map<String, Object?>?>().firstWhere(
      (option) => option != null && _identity(option) == _selectedIdentity,
      orElse: () => null,
    );
    final media = decisionMedia(selected) ?? parentMedia;
    final productName = decisionText(
      widget.attachment.data['productName'],
      fallback: decisionText(tree['name'], fallback: widget.attachment.title),
    );

    return GenUiWidgetChrome(
      attachment: widget.attachment,
      onAction: widget.onAction,
      showActions: false,
      children: [
        DecisionHeroMedia(
          media: media,
          imageKey: CustomerChatKeys.genUiDecisionImage(
            widget.attachment.id,
            media?.mediaKey ?? 'none',
          ),
        ),
        Text(productName, style: decisionTitleStyle),
        const SizedBox(height: KfcOpsTokens.spacingSm),
        for (final (index, group) in groups.indexed) ...[
          Text(
            group.name,
            style: const TextStyle(
              color: KfcOpsTokens.onSurface,
              fontSize: 13,
              fontWeight: FontWeight.w700,
              height: 18 / 13,
            ),
          ),
          const SizedBox(height: KfcOpsTokens.spacingSm),
          Wrap(
            spacing: KfcOpsTokens.spacingSm,
            runSpacing: KfcOpsTokens.spacingSm,
            children: [
              for (final option in group.options)
                _optionButton(option, optionIdCounts),
            ],
          ),
          if (index < groups.length - 1)
            const SizedBox(height: KfcOpsTokens.spacingMd),
        ],
      ],
    );
  }

  Widget _optionButton(
    Map<String, Object?> option,
    Map<String, int> optionIdCounts,
  ) {
    final selected = _selectedIdentity == _identity(option);
    final detail = _optionDetail(option);
    return KeyedSubtree(
      key: optionIdCounts[_optionId(option)] == 1
          ? CustomerChatKeys.genUiModifierOption(
              widget.attachment.id,
              _optionId(option),
            )
          : null,
      child: ShadButton.raw(
        key: CustomerChatKeys.genUiModifierOption(
          widget.attachment.id,
          decisionText(option['_groupId']),
          _optionId(option),
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
        onPressed: () => _selectOption(option),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(
                decisionText(option['name'], fallback: 'Lựa chọn'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (detail.isNotEmpty) ...[
              const SizedBox(width: 4),
              Text(
                detail,
                style: TextStyle(
                  color: selected
                      ? KfcOpsTokens.onPrimary
                      : KfcOpsTokens.secondary,
                  fontSize: 10,
                  height: 14 / 10,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  void _selectOption(Map<String, Object?> option) {
    setState(() => _selectedIdentity = _identity(option));
    final action = _exactModifierAction(
      widget.attachment.data,
      option,
      widget.attachment.actionableActions,
    );
    if (action != null) {
      widget.onAction(
        KfcGenUiAction.fromSpec(attachment: widget.attachment, spec: action),
      );
    }
  }
}

typedef _ModifierGroup = ({
  String groupId,
  String name,
  List<Map<String, Object?>> options,
});

List<_ModifierGroup> _modifierGroups(Map<String, Object?> data) {
  final direct = decisionList(data['options']);
  if (direct.isNotEmpty) {
    final grouped = <String, List<Map<String, Object?>>>{};
    for (final option in direct) {
      final groupId = decisionText(option['groupId']);
      grouped.putIfAbsent(groupId, () => []).add({
        ...option,
        '_groupId': groupId,
      });
    }
    return [
      for (final entry in grouped.entries)
        (
          groupId: entry.key,
          name: decisionText(
            entry.value.first['groupName'],
            fallback: 'Lựa chọn',
          ),
          options: entry.value,
        ),
    ];
  }
  final tree = decisionMap(data['modifierTree']);
  final rawGroups = tree.isNotEmpty
      ? decisionList(tree['modifierGroups'])
      : decisionList(data['modifierGroups']);
  final groups = <_ModifierGroup>[];
  void visit(List<Map<String, Object?>> values) {
    for (final group in values) {
      final groupId = decisionText(group['groupId']);
      final options = [
        for (final option in decisionList(group['options']))
          {...option, '_groupId': groupId},
      ];
      groups.add((
        groupId: groupId,
        name: decisionText(group['name'], fallback: 'Lựa chọn'),
        options: options,
      ));
      for (final option in options) {
        visit(decisionList(option['modifierGroups']));
      }
    }
  }

  visit(rawGroups);
  return groups;
}

List<_ModifierGroup> _trustedModifierGroups(
  Map<String, Object?> data,
  List<KfcGenUiActionSpec> actions,
) {
  final groups = _modifierGroups(data);
  final options = [for (final group in groups) ...group.options];
  final identityCounts = <(String, String), int>{};
  for (final option in options) {
    identityCounts.update(
      _identity(option),
      (count) => count + 1,
      ifAbsent: () => 1,
    );
  }
  return [
    for (final group in groups)
      if (group.options
              .where(
                (option) =>
                    identityCounts[_identity(option)] == 1 &&
                    _exactModifierAction(data, option, actions) != null,
              )
              .toList(growable: false)
          case final trusted when trusted.isNotEmpty)
        (groupId: group.groupId, name: group.name, options: trusted),
  ];
}

String _optionDetail(Map<String, Object?> option) {
  final details = <String>[];
  final priceDelta = option['priceDeltaVnd'];
  if (priceDelta is num && priceDelta > 0) {
    details.add('+${moneyVnd(priceDelta)}');
  }
  return details.join(' · ');
}

KfcGenUiActionSpec? _exactModifierAction(
  Map<String, Object?> data,
  Map<String, Object?> option,
  List<KfcGenUiActionSpec> actions,
) {
  final tree = decisionMap(data['modifierTree']);
  final itemCode = decisionText(
    option['itemCode'] ?? tree['itemCode'] ?? data['itemCode'],
  );
  final groupId = decisionText(option['_groupId'] ?? option['groupId']);
  final modifierId = _optionId(option);
  final optionName = decisionText(option['name']);
  if (!_isBoundModifierIdentifier(itemCode) ||
      !_isBoundModifierIdentifier(groupId) ||
      !_isBoundModifierIdentifier(modifierId) ||
      optionName.isEmpty) {
    return null;
  }
  final actionId =
      'customize_item:${Uri.encodeComponent(groupId)}:${Uri.encodeComponent(modifierId)}';
  if (actionId.length > 256) return null;
  final matches = actions
      .where((action) {
        final payload = action.payload;
        return action.id == actionId &&
            action.label == optionName &&
            action.value == optionName &&
            payload.length == 3 &&
            decisionText(payload['itemCode']) == itemCode &&
            decisionText(payload['groupId']) == groupId &&
            decisionText(payload['modifierId']) == modifierId;
      })
      .toList(growable: false);
  return matches.length == 1 ? matches.single : null;
}

bool _isBoundModifierIdentifier(String value) {
  return value.isNotEmpty && value == value.trim() && value.length <= 128;
}

String _optionId(Map<String, Object?> option) => decisionText(
  option['id'] ??
      option['code'] ??
      option['optionCode'] ??
      option['modifierId'],
);
(String, String) _identity(Map<String, Object?> option) =>
    (decisionText(option['_groupId']), _optionId(option));
