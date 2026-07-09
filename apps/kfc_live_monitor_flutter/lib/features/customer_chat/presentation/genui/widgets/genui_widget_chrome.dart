import 'package:flutter/widgets.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import '../../../testing/customer_chat_keys.dart';

class GenUiWidgetChrome extends StatelessWidget {
  const GenUiWidgetChrome({
    super.key,
    required this.attachment,
    required this.children,
    required this.onAction,
    this.accentColor = KfcOpsTokens.primary,
  });

  final KfcGenUiAttachment attachment;
  final List<Widget> children;
  final ValueChanged<KfcGenUiAction> onAction;
  final Color accentColor;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      key: CustomerChatKeys.genUi(attachment.widgetKind),
      decoration: BoxDecoration(
        color: KfcOpsTokens.surfaceContainerLowest,
        border: Border.all(color: KfcOpsTokens.secondaryContainer),
        borderRadius: const BorderRadius.all(KfcOpsTokens.radiusLg),
      ),
      child: Padding(
        padding: const EdgeInsets.all(KfcOpsTokens.spacingMd),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: accentColor,
                    borderRadius: const BorderRadius.all(KfcOpsTokens.radiusSm),
                  ),
                  child: const SizedBox(width: 5, height: 34),
                ),
                const SizedBox(width: KfcOpsTokens.spacingSm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        attachment.title,
                        style: const TextStyle(
                          color: KfcOpsTokens.onSurface,
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          height: 20 / 15,
                          letterSpacing: 0,
                        ),
                      ),
                      if (attachment.summary case final summary?)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(
                            summary,
                            style: const TextStyle(
                              color: KfcOpsTokens.secondary,
                              fontSize: 12,
                              height: 16 / 12,
                              letterSpacing: 0,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: KfcOpsTokens.spacingMd),
            ...children,
            if (attachment.actions.isNotEmpty) ...[
              const SizedBox(height: KfcOpsTokens.spacingMd),
              Wrap(
                spacing: KfcOpsTokens.spacingSm,
                runSpacing: KfcOpsTokens.spacingSm,
                children: [
                  for (final action in attachment.actions)
                    GenUiActionButton(
                      attachment: attachment,
                      action: action,
                      onPressed: () => onAction(
                        KfcGenUiAction.fromSpec(
                          attachment: attachment,
                          spec: action,
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class GenUiActionButton extends StatelessWidget {
  const GenUiActionButton({
    super.key,
    required this.attachment,
    required this.action,
    required this.onPressed,
  });

  final KfcGenUiAttachment attachment;
  final KfcGenUiActionSpec action;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final isPrimary = action.id == 'confirm_order' || action.id == 'add_item';
    final background = action.destructive
        ? KfcOpsTokens.criticalContainer
        : isPrimary
        ? KfcOpsTokens.primary
        : KfcOpsTokens.surfaceContainerLowest;
    final foreground = isPrimary
        ? KfcOpsTokens.onPrimary
        : action.destructive
        ? KfcOpsTokens.critical
        : KfcOpsTokens.onSurface;
    return Semantics(
      button: true,
      label: action.label,
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        child: GestureDetector(
          key: CustomerChatKeys.genUiAction(attachment.id, action.id),
          behavior: HitTestBehavior.opaque,
          onTap: onPressed,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: background,
              border: Border.all(
                color: isPrimary
                    ? KfcOpsTokens.primary
                    : KfcOpsTokens.secondaryContainer,
              ),
              borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: KfcOpsTokens.spacingMd,
                vertical: KfcOpsTokens.spacingSm,
              ),
              child: Text(
                action.label,
                style: TextStyle(
                  color: foreground,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  height: 16 / 12,
                  letterSpacing: 0,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class GenUiMetricRow extends StatelessWidget {
  const GenUiMetricRow({
    super.key,
    required this.label,
    required this.value,
    this.valueColor = KfcOpsTokens.onSurface,
  });

  final String label;
  final String value;
  final Color valueColor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: KfcOpsTokens.secondary,
                fontSize: 12,
                height: 16 / 12,
                letterSpacing: 0,
              ),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              color: valueColor,
              fontSize: 12,
              fontWeight: FontWeight.w700,
              height: 16 / 12,
              letterSpacing: 0,
            ),
          ),
        ],
      ),
    );
  }
}

List<Map<String, Object?>> genUiList(Object? value) {
  if (value is List) {
    return value
        .whereType<Map>()
        .map((item) => Map<String, Object?>.from(item))
        .toList(growable: false);
  }
  return const <Map<String, Object?>>[];
}

Map<String, Object?> genUiMap(Object? value) {
  if (value is Map<String, Object?>) return value;
  if (value is Map) return Map<String, Object?>.from(value);
  return const <String, Object?>{};
}

String genUiText(Object? value, {String fallback = '-'}) {
  final text = value?.toString() ?? '';
  return text.isEmpty ? fallback : text;
}

String moneyVnd(Object? value) {
  final number = value is num
      ? value.round()
      : int.tryParse(value?.toString() ?? '') ?? 0;
  if (number <= 0) return '0đ';
  final raw = number.toString();
  final buffer = StringBuffer();
  for (var index = 0; index < raw.length; index += 1) {
    final reverseIndex = raw.length - index;
    buffer.write(raw[index]);
    if (reverseIndex > 1 && reverseIndex % 3 == 1) buffer.write('.');
  }
  return '$bufferđ';
}
