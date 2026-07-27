import 'package:cue/cue.dart';
import 'package:flutter/widgets.dart';

import '../../../app/theme/kfc_ops_tokens.dart';
import '../domain/customer_run_models.dart';
import '../domain/kfc_genui_models.dart';
import '../testing/customer_chat_keys.dart';
import 'genui/kfc_genui_renderer.dart';

class CustomerResponseBlock extends StatelessWidget {
  const CustomerResponseBlock({
    super.key,
    required this.draft,
    required this.onAction,
    this.handoffStatus,
  });

  final ActiveAssistantDraft draft;
  final ValueChanged<KfcGenUiAction> onAction;
  final String? handoffStatus;

  @override
  Widget build(BuildContext context) {
    final CueMotion motion = MediaQuery.disableAnimationsOf(context)
        ? CueMotion.none
        : .smooth();
    final visibleDraft = !draft.materialized;
    final status = _statusLabel(draft);
    return Semantics(
      liveRegion: true,
      label: [
        status,
        if (visibleDraft && draft.text.isNotEmpty) draft.text,
      ].whereType<String>().join('. '),
      child: Cue.onMount(
        motion: motion,
        acts: [.fadeIn(), .slideY(from: 0.04)],
        child: Align(
          key: CustomerChatKeys.responseBlock,
          alignment: Alignment.centerLeft,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 700),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: KfcOpsTokens.surfaceContainerLowest,
                    border: Border.all(color: KfcOpsTokens.secondaryContainer),
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(8),
                      topRight: Radius.circular(8),
                      bottomLeft: Radius.circular(2),
                      bottomRight: Radius.circular(8),
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: KfcOpsTokens.spacingMd,
                      vertical: KfcOpsTokens.spacingSm,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (status case final label?)
                          Text(
                            label,
                            key: CustomerChatKeys.progressLabel,
                            style: const TextStyle(
                              color: KfcOpsTokens.secondary,
                              fontSize: 12,
                              height: 16 / 12,
                            ),
                          )
                        else
                          const _ClaimFreeDots(),
                        if (visibleDraft && draft.text.isNotEmpty) ...[
                          const SizedBox(height: KfcOpsTokens.spacingSm),
                          Text(
                            draft.text,
                            style: const TextStyle(
                              color: KfcOpsTokens.onSurface,
                              fontSize: 14,
                              height: 20 / 14,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                if (visibleDraft && draft.genUi != null) ...[
                  const SizedBox(height: KfcOpsTokens.spacingSm),
                  KfcGenUiRenderer(
                    attachment: draft.genUi!,
                    onAction: onAction,
                    handoffStatus: handoffStatus,
                    authorityMatches:
                        draft.genUi?.widgetKind !=
                            KfcGenUiWidgetKind.recommendationOffer ||
                        isValidRecommendationAuthorityId(draft.assistantTurnId),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ClaimFreeDots extends StatelessWidget {
  const _ClaimFreeDots();

  @override
  Widget build(BuildContext context) {
    return const Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _Dot(opacity: 0.45),
        SizedBox(width: 4),
        _Dot(opacity: 0.7),
        SizedBox(width: 4),
        _Dot(opacity: 1),
      ],
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot({required this.opacity});
  final double opacity;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: opacity,
      child: const DecoratedBox(
        decoration: BoxDecoration(
          color: KfcOpsTokens.secondary,
          shape: BoxShape.circle,
        ),
        child: SizedBox.square(dimension: 5),
      ),
    );
  }
}

String? _statusLabel(ActiveAssistantDraft draft) {
  if (draft.isStopping) return 'Đang dừng…';
  if (draft.connection == CustomerRunConnectionState.reconnecting) {
    return 'Đang kết nối lại…';
  }
  return switch (draft.terminal) {
    CustomerRunTerminal.cancelled => 'Đã dừng theo yêu cầu.',
    CustomerRunTerminal.failed => 'Không thể hoàn tất yêu cầu lúc này.',
    CustomerRunTerminal.completed when draft.materialized => null,
    _ => draft.progressLabel,
  };
}
