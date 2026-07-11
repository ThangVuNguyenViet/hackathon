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
    final options = _trustedModifierOptions(
      widget.attachment.data,
      widget.attachment.actions,
    );
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
        for (final option in options)
          Padding(
            key: optionIdCounts[_optionId(option)] == 1
                ? CustomerChatKeys.genUiModifierOption(
                    widget.attachment.id,
                    _optionId(option),
                  )
                : null,
            padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
            child: SizedBox(
              width: double.infinity,
              child: ShadButton.raw(
                key: CustomerChatKeys.genUiModifierOption(
                  widget.attachment.id,
                  decisionText(option['_groupId']),
                  _optionId(option),
                ),
                variant: _selectedIdentity == _identity(option)
                    ? ShadButtonVariant.primary
                    : ShadButtonVariant.outline,
                backgroundColor: _selectedIdentity == _identity(option)
                    ? KfcOpsTokens.primary
                    : KfcOpsTokens.surfaceContainerLowest,
                foregroundColor: _selectedIdentity == _identity(option)
                    ? KfcOpsTokens.onPrimary
                    : KfcOpsTokens.onSurface,
                hoverBackgroundColor: KfcOpsTokens.surfaceContainerLow,
                hoverForegroundColor: KfcOpsTokens.onSurface,
                height: 40,
                onPressed: () => _selectOption(option),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    decisionText(option['name'], fallback: 'Lựa chọn'),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  void _selectOption(Map<String, Object?> option) {
    setState(() => _selectedIdentity = _identity(option));
    final action = widget.attachment.actions
        .cast<KfcGenUiActionSpec?>()
        .firstWhere(
          (candidate) =>
              candidate != null &&
              candidate.id.startsWith('customize_item:') &&
              decisionText(candidate.payload['modifierId']) ==
                  _optionId(option) &&
              decisionText(candidate.payload['groupId']) ==
                  decisionText(option['_groupId']),
          orElse: () => null,
        );
    if (action != null) {
      widget.onAction(
        KfcGenUiAction.fromSpec(attachment: widget.attachment, spec: action),
      );
    }
  }
}

List<Map<String, Object?>> _modifierOptions(Map<String, Object?> data) {
  final direct = decisionList(data['options']);
  if (direct.isNotEmpty) return direct;
  final tree = decisionMap(data['modifierTree']);
  final groups = tree.isNotEmpty
      ? decisionList(tree['modifierGroups'])
      : decisionList(data['modifierGroups']);
  return [
    for (final group in groups)
      for (final option in decisionList(group['options']))
        {...option, '_groupId': group['groupId']},
  ];
}

List<Map<String, Object?>> _trustedModifierOptions(
  Map<String, Object?> data,
  List<KfcGenUiActionSpec> actions,
) {
  final trustedIdentities = <(String, String)>{
    for (final action in actions)
      if (action.id.startsWith('customize_item:'))
        (
          decisionText(action.payload['groupId']),
          decisionText(action.payload['modifierId']),
        ),
  };
  return _modifierOptions(data)
      .where(
        (option) => trustedIdentities.contains((
          decisionText(option['_groupId']),
          _optionId(option),
        )),
      )
      .toList(growable: false);
}

String _optionId(Map<String, Object?> option) => decisionText(
  option['id'] ??
      option['code'] ??
      option['optionCode'] ??
      option['modifierId'],
  fallback: decisionText(option['name']),
);
(String, String) _identity(Map<String, Object?> option) =>
    (decisionText(option['_groupId']), _optionId(option));
