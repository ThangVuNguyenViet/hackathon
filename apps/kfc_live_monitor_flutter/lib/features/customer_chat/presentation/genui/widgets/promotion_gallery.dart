import 'package:flutter/widgets.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import '../../../testing/customer_chat_keys.dart';
import 'decision_widget_support.dart';
import 'genui_widget_chrome.dart';

class PromotionGallery extends StatelessWidget {
  const PromotionGallery({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  Widget build(BuildContext context) {
    final promotions = _promotions(attachment.data).take(5);
    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: onAction,
      children: [
        for (final promotion in promotions)
          Padding(
            padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: KfcOpsTokens.surfaceContainerLowest,
                border: Border.all(color: KfcOpsTokens.secondaryContainer),
                borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
              ),
              child: Padding(
                padding: const EdgeInsets.all(KfcOpsTokens.spacingSm),
                child: _PromotionCard(
                  attachmentId: attachment.id,
                  promotion: promotion,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

List<Map<String, Object?>> _promotions(Map<String, Object?> data) {
  final promotions = decisionList(data['promotions']);
  if (promotions.isNotEmpty) return promotions;
  final offers = decisionList(data['offers']);
  if (offers.isNotEmpty) return offers;
  final evidence = decisionList(data['contentEvidence']);
  return evidence.isNotEmpty ? evidence : decisionList(data['items']);
}

class _PromotionCard extends StatelessWidget {
  const _PromotionCard({required this.attachmentId, required this.promotion});

  final String attachmentId;
  final Map<String, Object?> promotion;

  @override
  Widget build(BuildContext context) {
    final media = decisionMedia(promotion);
    final title = decisionText(
      promotion['title'] ??
          promotion['offerName'] ??
          promotion['campaign'] ??
          promotion['name'],
      fallback: 'Khuyến mãi KFC',
    );
    final start = decisionText(promotion['startDate']);
    final end = decisionText(promotion['endDate']);
    final validity = decisionText(
      promotion['validity'],
      fallback: start.isNotEmpty && end.isNotEmpty ? '$start – $end' : '',
    );
    final eligibility = decisionText(
      promotion['eligibility'] ?? promotion['summary'] ?? promotion['snippet'],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DecisionHeroMedia(
          media: media,
          imageKey: CustomerChatKeys.genUiDecisionImage(
            attachmentId,
            media?.mediaKey ?? title,
          ),
        ),
        Text(title, style: decisionTitleStyle),
        if (validity.isNotEmpty) ...[
          const SizedBox(height: KfcOpsTokens.spacingSm),
          Text(validity, style: decisionBodyStyle),
        ],
        if (eligibility.isNotEmpty) ...[
          const SizedBox(height: KfcOpsTokens.spacingSm),
          Text(eligibility, style: decisionBodyStyle),
        ],
      ],
    );
  }
}
