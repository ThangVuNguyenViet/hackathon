import 'package:flutter/widgets.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import '../../../testing/customer_chat_keys.dart';
import 'decision_widget_support.dart';
import 'genui_widget_chrome.dart';

class ProductDetailCard extends StatelessWidget {
  const ProductDetailCard({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  Widget build(BuildContext context) {
    final item = _detailItem(attachment.data);
    final media =
        decisionMedia(item) ?? decisionMedia(attachment.data['media']);
    final name = decisionText(item['name'], fallback: attachment.title);
    final description = decisionText(item['description']);

    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: onAction,
      children: [
        DecisionHeroMedia(
          media: media,
          imageKey: CustomerChatKeys.genUiDecisionImage(
            attachment.id,
            media?.mediaKey ?? 'none',
          ),
        ),
        Text(name, style: decisionTitleStyle),
        if (description.isNotEmpty) ...[
          const SizedBox(height: KfcOpsTokens.spacingSm),
          Text(description, style: decisionBodyStyle),
        ],
        const SizedBox(height: KfcOpsTokens.spacingSm),
        Text(
          moneyVnd(item['priceVnd']),
          style: const TextStyle(
            color: KfcOpsTokens.onSurface,
            fontSize: 15,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }
}

Map<String, Object?> _detailItem(Map<String, Object?> data) {
  final item = decisionMap(data['item']);
  if (item.isNotEmpty) return item;
  final detail = decisionMap(data['detail']);
  if (detail.isNotEmpty) return detail;
  final items = decisionList(data['items']);
  return items.isEmpty ? const <String, Object?>{} : items.first;
}
