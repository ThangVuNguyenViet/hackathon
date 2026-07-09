import 'package:flutter/widgets.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import 'genui_widget_chrome.dart';

class SmartMenuPicker extends StatelessWidget {
  const SmartMenuPicker({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  Widget build(BuildContext context) {
    final items = genUiList(attachment.data['items']);
    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: onAction,
      accentColor: KfcOpsTokens.primary,
      children: [
        for (final item in items)
          Padding(
            padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: KfcOpsTokens.surfaceContainerLow,
                borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
              ),
              child: Padding(
                padding: const EdgeInsets.all(KfcOpsTokens.spacingSm),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        genUiText(item['name']),
                        style: const TextStyle(
                          color: KfcOpsTokens.onSurface,
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          height: 18 / 13,
                          letterSpacing: 0,
                        ),
                      ),
                    ),
                    Text(
                      genUiText(item['tag'], fallback: ''),
                      style: const TextStyle(
                        color: KfcOpsTokens.primary,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        height: 14 / 11,
                        letterSpacing: 0,
                      ),
                    ),
                    const SizedBox(width: KfcOpsTokens.spacingSm),
                    Text(
                      moneyVnd(item['priceVnd']),
                      style: const TextStyle(
                        color: KfcOpsTokens.onSurface,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        height: 16 / 12,
                        letterSpacing: 0,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}
