import 'package:flutter/widgets.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import 'genui_widget_chrome.dart';

class SupportHandoff extends StatelessWidget {
  const SupportHandoff({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  Widget build(BuildContext context) {
    final reasons = attachment.data['reasons'] is List
        ? (attachment.data['reasons'] as List)
              .map((item) => item.toString())
              .toList()
        : const <String>[];
    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: onAction,
      accentColor: KfcOpsTokens.critical,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            color: KfcOpsTokens.criticalContainer,
            borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
          ),
          child: Padding(
            padding: const EdgeInsets.all(KfcOpsTokens.spacingSm),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Lý do ưu tiên',
                  style: TextStyle(
                    color: KfcOpsTokens.critical,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    height: 16 / 12,
                    letterSpacing: 0,
                  ),
                ),
                const SizedBox(height: KfcOpsTokens.spacingXs),
                for (final reason in reasons)
                  Text(
                    reason,
                    style: const TextStyle(
                      color: KfcOpsTokens.onSurface,
                      fontSize: 12,
                      height: 16 / 12,
                      letterSpacing: 0,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
