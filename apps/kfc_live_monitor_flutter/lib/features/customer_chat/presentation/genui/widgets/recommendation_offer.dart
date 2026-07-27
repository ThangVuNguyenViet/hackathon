import 'package:flutter/widgets.dart';

import '../../../../../app/theme/kfc_ops_tokens.dart';
import '../../../domain/kfc_genui_models.dart';
import '../../../testing/customer_chat_keys.dart';
import 'genui_widget_chrome.dart';
import 'verified_remote_media.dart';

class RecommendationOffer extends StatefulWidget {
  const RecommendationOffer({
    super.key,
    required this.attachment,
    required this.onAction,
    this.onImpression,
    this.loadingActionId,
    this.authorityMatches = true,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;
  final VoidCallback? onImpression;
  final String? loadingActionId;
  final bool authorityMatches;

  @override
  State<RecommendationOffer> createState() => _RecommendationOfferState();
}

class _RecommendationOfferState extends State<RecommendationOffer> {
  String? _reportedAttachmentId;

  @override
  void initState() {
    super.initState();
    _scheduleImpression();
  }

  @override
  void didUpdateWidget(RecommendationOffer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.attachment.id != widget.attachment.id ||
        oldWidget.onImpression != widget.onImpression) {
      _scheduleImpression();
    }
  }

  void _scheduleImpression() {
    final attachment = widget.attachment;
    if (widget.onImpression == null ||
        _reportedAttachmentId == attachment.id ||
        attachment.status != KfcGenUiStatus.active ||
        attachment.interactionFinality !=
            KfcGenUiInteractionFinality.authoritative ||
        !widget.authorityMatches ||
        !attachment.canSubmitActions ||
        attachment.recommendationOfferData == null) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted ||
          widget.attachment.id != attachment.id ||
          _reportedAttachmentId == attachment.id) {
        return;
      }
      _reportedAttachmentId = attachment.id;
      widget.onImpression?.call();
    });
  }

  @override
  Widget build(BuildContext context) {
    final attachment = widget.attachment;
    final recommendation = attachment.recommendationOfferData;
    if (recommendation == null) {
      return GenUiWidgetChrome(
        attachment: attachment,
        onAction: widget.onAction,
        showActions: false,
        children: const [
          Text(
            'Chưa thể hiển thị gợi ý này.',
            style: TextStyle(color: KfcOpsTokens.secondary, fontSize: 12),
          ),
        ],
      );
    }
    final stateMessage = _recommendationStateMessage(
      attachment,
      authorityMatches: widget.authorityMatches,
    );
    final actionsById = <String, KfcGenUiActionSpec>{
      if (stateMessage == null)
        for (final action in attachment.actionableActions) action.id: action,
    };
    final dismissAction = actionsById['recommendation_dismiss'];

    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: widget.onAction,
      displaySummary: recommendation.reasonText.join(' · '),
      showActions: false,
      children: [
        if (stateMessage != null) ...[
          Text(
            stateMessage,
            key: CustomerChatKeys.genUiRecommendationState(attachment.id),
            style: const TextStyle(
              color: KfcOpsTokens.secondary,
              fontSize: 12,
              height: 16 / 12,
            ),
          ),
          const SizedBox(height: KfcOpsTokens.spacingSm),
        ],
        LayoutBuilder(
          builder: (context, constraints) {
            final width = recommendation.offers.length == 1
                ? constraints.maxWidth
                : (constraints.maxWidth - KfcOpsTokens.spacingSm) / 2;
            return Wrap(
              spacing: KfcOpsTokens.spacingSm,
              runSpacing: KfcOpsTokens.spacingSm,
              children: [
                for (final offer in recommendation.offers)
                  SizedBox(
                    width: width,
                    child: _RecommendationCard(
                      attachment: attachment,
                      offer: offer,
                      action: actionsById[offer.selectionActionId],
                      onAction: widget.onAction,
                      loadingActionId: widget.loadingActionId,
                    ),
                  ),
              ],
            );
          },
        ),
        if (dismissAction != null) ...[
          const SizedBox(height: KfcOpsTokens.spacingMd),
          GenUiActionButton(
            attachment: attachment,
            action: dismissAction,
            enabled: widget.loadingActionId == null,
            displayLabel: widget.loadingActionId == dismissAction.id
                ? 'Đang xử lý…'
                : null,
            onPressed: () => widget.onAction(
              KfcGenUiAction.fromSpec(
                attachment: attachment,
                spec: dismissAction,
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _RecommendationCard extends StatelessWidget {
  const _RecommendationCard({
    required this.attachment,
    required this.offer,
    required this.action,
    required this.onAction,
    required this.loadingActionId,
  });

  final KfcGenUiAttachment attachment;
  final KfcRecommendationOfferItem offer;
  final KfcGenUiActionSpec? action;
  final ValueChanged<KfcGenUiAction> onAction;
  final String? loadingActionId;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      key: CustomerChatKeys.genUiRecommendationItem(
        attachment.id,
        offer.recommendationActionId,
      ),
      decoration: BoxDecoration(
        color: KfcOpsTokens.surfaceContainerLow,
        borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
      ),
      child: Padding(
        padding: const EdgeInsets.all(KfcOpsTokens.spacingSm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (offer.imageUrl case final imageUrl?)
              Padding(
                padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
                child: VerifiedRemoteMedia(
                  imageKey: CustomerChatKeys.genUiRecommendationImage(
                    attachment.id,
                    offer.recommendationActionId,
                  ),
                  imageUrl: imageUrl,
                  semanticLabel: 'Hình ${offer.name}',
                  height: 108,
                ),
              ),
            Text(
              offer.name,
              style: const TextStyle(
                color: KfcOpsTokens.onSurface,
                fontSize: 13,
                fontWeight: FontWeight.w700,
                height: 17 / 13,
              ),
            ),
            const SizedBox(height: KfcOpsTokens.spacingXs),
            Text(
              moneyVnd(offer.price.amount),
              style: const TextStyle(
                color: KfcOpsTokens.onSurface,
                fontSize: 13,
                fontWeight: FontWeight.w800,
              ),
            ),
            if (action case final action?) ...[
              const SizedBox(height: KfcOpsTokens.spacingSm),
              GenUiActionButton(
                attachment: attachment,
                action: action,
                height: 36,
                enabled: loadingActionId == null,
                displayLabel: loadingActionId == action.id
                    ? 'Đang thêm…'
                    : null,
                onPressed: () => onAction(
                  KfcGenUiAction.fromSpec(attachment: attachment, spec: action),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

String? _recommendationStateMessage(
  KfcGenUiAttachment attachment, {
  required bool authorityMatches,
}) {
  return switch (attachment.status) {
    KfcGenUiStatus.answered => null,
    KfcGenUiStatus.expired => 'Gợi ý này đã hết hạn.',
    KfcGenUiStatus.blocked => 'Gợi ý này đang tạm khóa.',
    KfcGenUiStatus.active when !authorityMatches =>
      'Gợi ý này không còn khớp với phiên hiện tại.',
    KfcGenUiStatus.active
        when attachment.interactionFinality !=
            KfcGenUiInteractionFinality.authoritative =>
      'Gợi ý này không còn khớp với phiên hiện tại.',
    KfcGenUiStatus.active when !attachment.canSubmitActions =>
      _isPastRecommendationExpiry(attachment)
          ? 'Gợi ý này đã hết hạn.'
          : 'Gợi ý này đang tạm khóa.',
    KfcGenUiStatus.active => null,
  };
}

bool _isPastRecommendationExpiry(KfcGenUiAttachment attachment) {
  final expiry = DateTime.tryParse(attachment.expiresAt ?? '');
  return expiry != null && !expiry.isAfter(DateTime.now());
}
