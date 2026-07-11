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
    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: onAction,
      showActions: false,
      accentColor: KfcOpsTokens.info,
      children: [
        for (final method in methods)
          Padding(
            padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
            child: ShadButton.outline(
              width: double.infinity,
              height: 52,
              mainAxisAlignment: MainAxisAlignment.start,
              onPressed: method['supported'] == true
                  ? () => _select(method)
                  : null,
              leading: Icon(_iconFor(method['category']), size: 20),
              trailing: method['supported'] == true
                  ? const Icon(LucideIcons.chevronRight, size: 18)
                  : null,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    genUiText(method['displayName']),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  Text(
                    method['supported'] == true
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

  void _select(Map<String, Object?> method) => onAction(
    KfcGenUiAction(
      attachmentId: attachment.id,
      actionId: 'select_payment_method',
      value: genUiText(method['displayName']),
      payload: {'methodId': genUiText(method['methodId'])},
    ),
  );
}
