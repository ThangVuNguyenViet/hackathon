import 'package:flutter/widgets.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import '../../../testing/customer_chat_keys.dart';
import 'decision_widget_support.dart';
import 'genui_widget_chrome.dart';

class AllergenEvidence extends StatelessWidget {
  const AllergenEvidence({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  Widget build(BuildContext context) {
    final item = decisionMap(attachment.data['item']);
    final media = decisionMedia(attachment.data['media']);
    final name = decisionText(item['name'] ?? attachment.data['itemName']);
    final evidenceMap = decisionMap(attachment.data['evidence']);
    final evidence = decisionText(
      evidenceMap['snippet'] ??
          evidenceMap['summary'] ??
          (evidenceMap.isEmpty ? attachment.data['evidence'] : null) ??
          attachment.data['summary'] ??
          attachment.data['snippet'],
      fallback:
          'Thông tin dị ứng cần dựa trên bảng công bố chính thức của KFC.',
    );
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
        if (name.isNotEmpty) Text(name, style: decisionTitleStyle),
        if (name.isNotEmpty) const SizedBox(height: KfcOpsTokens.spacingSm),
        Text(evidence, style: decisionBodyStyle),
      ],
    );
  }
}
