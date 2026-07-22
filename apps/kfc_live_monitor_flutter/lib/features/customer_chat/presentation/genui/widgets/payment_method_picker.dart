import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import 'genui_widget_chrome.dart';

class PaymentMethodPicker extends StatelessWidget {
  const PaymentMethodPicker({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  Widget build(BuildContext context) {
    final methods = genUiList(attachment.data['methods']);
    final methodIdCounts = <String, int>{};
    for (final method in methods) {
      final methodId = genUiText(method['methodId'], fallback: '');
      if (methodId.isNotEmpty) {
        methodIdCounts.update(
          methodId,
          (count) => count + 1,
          ifAbsent: () => 1,
        );
      }
    }
    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: onAction,
      showActions: false,
      accentColor: KfcOpsTokens.info,
      children: [
        for (final method in methods)
          Padding(
            padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
            child: Builder(
              builder: (context) {
                final methodId = genUiText(method['methodId'], fallback: '');
                final action =
                    method['supported'] == true &&
                        method['supportStatus'] == 'listed_supported' &&
                        methodIdCounts[methodId] == 1
                    ? attachment.bindAction(
                        actionId: 'select_payment_method',
                        payload: {'methodId': methodId},
                        verifiedValue: genUiText(
                          method['displayName'],
                          fallback: '',
                        ),
                      )
                    : null;
                return ShadButton.outline(
                  width: double.infinity,
                  height: 52,
                  mainAxisAlignment: MainAxisAlignment.start,
                  onPressed: action == null ? null : () => onAction(action),
                  leading: Icon(_iconFor(method['category']), size: 20),
                  trailing: action == null
                      ? null
                      : const Icon(LucideIcons.chevronRight, size: 18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        genUiText(method['displayName']),
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      Text(
                        method['supported'] == true &&
                                method['supportStatus'] == 'listed_supported'
                            ? 'Được hỗ trợ'
                            : genUiText(
                                method['reason'],
                                fallback: 'Chưa hỗ trợ trên website/app',
                              ),
                        style: const TextStyle(
                          fontSize: 11,
                          color: KfcOpsTokens.secondary,
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
      ],
    );
  }

  IconData _iconFor(Object? category) => switch (category) {
    'cash_on_delivery' => LucideIcons.banknote,
    'card' || 'bank_atm' => LucideIcons.creditCard,
    _ => LucideIcons.walletCards,
  };
}
