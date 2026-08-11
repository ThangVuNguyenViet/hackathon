import 'dart:async';

import 'package:flutter/material.dart' hide Badge;
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:state_beacon/state_beacon.dart';

import '../../../app/theme/kfc_ops_tokens.dart';
import '../application/automatic_recommendation_kiosk_controller.dart';
import '../domain/automatic_recommendation_contract.dart';

class AutomaticRecommendationKioskScreen extends StatefulWidget {
  const AutomaticRecommendationKioskScreen({
    super.key,
    required this.controller,
  });

  final AutomaticRecommendationKioskController controller;

  @override
  State<AutomaticRecommendationKioskScreen> createState() =>
      _AutomaticRecommendationKioskScreenState();
}

class _AutomaticRecommendationKioskScreenState
    extends State<AutomaticRecommendationKioskScreen> {
  String? _actionError;

  @override
  void initState() {
    super.initState();
    if (widget.controller.context != null) {
      unawaited(
        widget.controller.load(AutomaticRecommendationType.localFavorite),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.controller.state.watch(context);
    return DefaultTextStyle(
      style: const TextStyle(
        fontFamily: KfcOpsTokens.fontFamily,
        color: KfcOpsTokens.onSurface,
      ),
      child: ColoredBox(
        color: KfcOpsTokens.surface,
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) {
              final compact = constraints.maxWidth < 1100;
              final content = compact
                  ? _CompactWorkbench(
                      state: state,
                      controller: widget.controller,
                      actionError: _actionError,
                      onActionError: _setActionError,
                    )
                  : _DesktopWorkbench(
                      state: state,
                      controller: widget.controller,
                      actionError: _actionError,
                      onActionError: _setActionError,
                    );
              return SingleChildScrollView(
                padding: const EdgeInsets.all(KfcOpsTokens.gutter),
                child: content,
              );
            },
          ),
        ),
      ),
    );
  }

  void _setActionError(String? message) {
    if (!mounted) return;
    setState(() => _actionError = message);
  }
}

class _DesktopWorkbench extends StatelessWidget {
  const _DesktopWorkbench({
    required this.state,
    required this.controller,
    required this.actionError,
    required this.onActionError,
  });

  final KioskState state;
  final AutomaticRecommendationKioskController controller;
  final String? actionError;
  final ValueChanged<String?> onActionError;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _KioskHeader(),
        const SizedBox(height: KfcOpsTokens.spacingMd),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 280,
              child: _ContextPanel(state: state, controller: controller),
            ),
            const SizedBox(width: KfcOpsTokens.spacingMd),
            Expanded(
              child: _RecommendationPanel(
                state: state,
                controller: controller,
                actionError: actionError,
                onActionError: onActionError,
              ),
            ),
            const SizedBox(width: KfcOpsTokens.spacingMd),
            SizedBox(
              width: 300,
              child: _EvidencePanel(state: state, controller: controller),
            ),
          ],
        ),
      ],
    );
  }
}

class _CompactWorkbench extends StatelessWidget {
  const _CompactWorkbench({
    required this.state,
    required this.controller,
    required this.actionError,
    required this.onActionError,
  });

  final KioskState state;
  final AutomaticRecommendationKioskController controller;
  final String? actionError;
  final ValueChanged<String?> onActionError;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _KioskHeader(),
        const SizedBox(height: KfcOpsTokens.spacingMd),
        _ContextPanel(state: state, controller: controller),
        const SizedBox(height: KfcOpsTokens.spacingMd),
        _RecommendationPanel(
          state: state,
          controller: controller,
          actionError: actionError,
          onActionError: onActionError,
        ),
        const SizedBox(height: KfcOpsTokens.spacingMd),
        _EvidencePanel(state: state, controller: controller),
      ],
    );
  }
}

class _KioskHeader extends StatelessWidget {
  const _KioskHeader();

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: KfcOpsTokens.spacingSm,
      runSpacing: KfcOpsTokens.spacingSm,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        DecoratedBox(
          decoration: const BoxDecoration(
            color: KfcOpsTokens.primary,
            borderRadius: BorderRadius.all(KfcOpsTokens.radiusMd),
          ),
          child: const Padding(
            padding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            child: Text(
              'KFC',
              style: TextStyle(
                color: KfcOpsTokens.onPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
        const SizedBox(width: KfcOpsTokens.spacingSm),
        const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Automatic recommendation kiosk',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            ),
            Text(
              'Strict client · durable evidence · no fallback',
              style: TextStyle(
                color: KfcOpsTokens.onSurfaceVariant,
                fontSize: 12,
              ),
            ),
          ],
        ),
        const _StatusPill(
          label: 'SYNTHETIC SANDBOX',
          color: KfcOpsTokens.warning,
        ),
      ],
    );
  }
}

class _ContextPanel extends StatelessWidget {
  const _ContextPanel({required this.state, required this.controller});

  final KioskState state;
  final AutomaticRecommendationKioskController controller;

  @override
  Widget build(BuildContext context) {
    final requestContext = controller.context;
    return _Panel(
      title: '01 · Context',
      subtitle: 'Select the decision operation',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (requestContext == null)
            const _InlineNotice(
              message:
                  'Configure KFC_KIOSK_CONTEXT_JSON before launching this kiosk.',
              color: KfcOpsTokens.warningText,
            ),
          if (requestContext != null) ...[
            _ContextValue(label: 'STORE', value: requestContext.storeId),
            _ContextValue(
              label: 'FULFILMENT',
              value: requestContext.fulfilmentMode.toUpperCase(),
            ),
            _ContextValue(label: 'LOCALE', value: requestContext.locale),
            const SizedBox(height: KfcOpsTokens.spacingMd),
            for (final type in AutomaticRecommendationType.values)
              Padding(
                padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
                child: _TypeButton(
                  type: type,
                  selected: state.selectedType == type,
                  loading: state.isLoading && state.selectedType == type,
                  enabled: requestContext.canRequest(type),
                  onPressed: () => unawaited(controller.load(type)),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _RecommendationPanel extends StatelessWidget {
  const _RecommendationPanel({
    required this.state,
    required this.controller,
    required this.actionError,
    required this.onActionError,
  });

  final KioskState state;
  final AutomaticRecommendationKioskController controller;
  final String? actionError;
  final ValueChanged<String?> onActionError;

  @override
  Widget build(BuildContext context) {
    final response = state.response?.toJson();
    final proposals = response?['proposals'] as List? ?? const [];
    return _Panel(
      title: '02 · Recommendations',
      subtitle: _statusLabel(state),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (state.isLoading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (state.errorMessage != null)
            _EmptyState(
              title: 'Serving unavailable',
              message: state.errorMessage!,
              color: KfcOpsTokens.critical,
            )
          else if (response == null)
            const _EmptyState(
              title: 'Waiting for context',
              message: 'A validated request is required before serving.',
              color: KfcOpsTokens.secondary,
            )
          else if (proposals.isEmpty)
            _EmptyState(
              title: response['status'] == 'paused'
                  ? 'Serving paused'
                  : 'No recommendation',
              message: '${response['emptyReason']}',
              color: response['status'] == 'paused'
                  ? KfcOpsTokens.warningText
                  : KfcOpsTokens.secondary,
            )
          else
            for (var index = 0; index < proposals.length; index++)
              Padding(
                padding: EdgeInsets.only(
                  bottom: index == proposals.length - 1
                      ? 0
                      : KfcOpsTokens.spacingSm,
                ),
                child: _ProposalCard(
                  proposal: Map<String, dynamic>.from(proposals[index] as Map),
                  position: index + 1,
                  selected:
                      state.selectedActionId ==
                      (proposals[index] as Map)['actionId'],
                  onSelect: () => _record(
                    () => controller.selectAction(index),
                    onActionError,
                  ),
                  onDismiss: () => _record(
                    () => controller.dismissAction(index),
                    onActionError,
                  ),
                ),
              ),
          if (actionError != null) ...[
            const SizedBox(height: KfcOpsTokens.spacingMd),
            _InlineNotice(message: actionError!, color: KfcOpsTokens.critical),
          ],
        ],
      ),
    );
  }

  Future<void> _record(
    Future<void> Function() operation,
    ValueChanged<String?> onActionError,
  ) async {
    onActionError(null);
    try {
      await operation();
    } on Object catch (error) {
      onActionError(
        error.toString().replaceFirst('KioskActionException: ', ''),
      );
    }
  }
}

class _EvidencePanel extends StatelessWidget {
  const _EvidencePanel({required this.state, required this.controller});

  final KioskState state;
  final AutomaticRecommendationKioskController controller;

  @override
  Widget build(BuildContext context) {
    final response = state.response?.toJson();
    final inspection = state.inspection?.toJson();
    return _Panel(
      title: '03 · Evidence',
      subtitle: 'Request, model, and durable commit',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _EvidenceRow(
            label: 'STATUS',
            value: _statusLabel(state),
            color: _statusColor(state),
          ),
          if (response != null) ...[
            _EvidenceRow(
              label: 'RECOMMENDATION',
              value: '${response['recommendationId']}',
            ),
            _EvidenceRow(label: 'EXPIRES', value: '${response['expiresAt']}'),
            _EvidenceRow(
              label: 'MODEL',
              value: response['model'] == null ? 'none' : 'bound',
            ),
          ],
          if (state.evidenceMessage != null) ...[
            const SizedBox(height: KfcOpsTokens.spacingSm),
            _InlineNotice(
              message: state.evidenceMessage!,
              color: state.evidenceMessage!.contains('failed')
                  ? KfcOpsTokens.critical
                  : KfcOpsTokens.success,
            ),
          ],
          const SizedBox(height: KfcOpsTokens.spacingMd),
          ShadButton.outline(
            width: double.infinity,
            size: ShadButtonSize.sm,
            onPressed: response == null ? null : () => unawaited(_inspect()),
            child: const Text('Inspect durable evidence'),
          ),
          if (inspection != null) ...[
            const SizedBox(height: KfcOpsTokens.spacingMd),
            _InspectionSummary(inspection: inspection),
          ],
        ],
      ),
    );
  }

  Future<void> _inspect() async {
    try {
      await controller.inspectEvidence();
    } on Object {
      // The controller projects the typed failure into evidenceMessage.
    }
  }
}

class _ProposalCard extends StatelessWidget {
  const _ProposalCard({
    required this.proposal,
    required this.position,
    required this.selected,
    required this.onSelect,
    required this.onDismiss,
  });

  final Map<String, dynamic> proposal;
  final int position;
  final bool selected;
  final VoidCallback onSelect;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final display = Map<String, dynamic>.from(proposal['display'] as Map);
    final action = Map<String, dynamic>.from(proposal['action'] as Map);
    final price = Map<String, dynamic>.from(display['priceImpact'] as Map);
    final amount = (price['amount'] as num).toInt();
    return DecoratedBox(
      decoration: BoxDecoration(
        color: selected
            ? KfcOpsTokens.successContainer
            : KfcOpsTokens.surfaceContainerLowest,
        border: Border.all(
          color: selected ? KfcOpsTokens.success : KfcOpsTokens.outlineVariant,
        ),
        borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
      ),
      child: Padding(
        padding: const EdgeInsets.all(KfcOpsTokens.spacingMd),
        child: Row(
          children: [
            _PositionBadge(position: position),
            const SizedBox(width: KfcOpsTokens.spacingSm),
            if (display['imageUrl'] != null)
              ClipRRect(
                borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
                child: Image.network(
                  display['imageUrl'] as String,
                  width: 56,
                  height: 56,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => const _ImagePlaceholder(),
                ),
              )
            else
              const _ImagePlaceholder(),
            const SizedBox(width: KfcOpsTokens.spacingSm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${display['name']}',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${action['type']} · ${action['quantity']} unit · $amount VND',
                    style: const TextStyle(
                      color: KfcOpsTokens.onSurfaceVariant,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    (proposal['reasonCodes'] as List).join(' · '),
                    style: const TextStyle(
                      color: KfcOpsTokens.info,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: KfcOpsTokens.spacingSm),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                ShadButton(
                  size: ShadButtonSize.sm,
                  onPressed: selected ? null : onSelect,
                  child: Text(selected ? 'Recorded' : 'Select'),
                ),
                const SizedBox(height: 4),
                ShadButton.ghost(
                  size: ShadButtonSize.sm,
                  onPressed: selected ? null : onDismiss,
                  child: const Text('Dismiss'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({
    required this.title,
    required this.subtitle,
    required this.child,
  });

  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: KfcOpsTokens.surfaceContainerLow,
        border: Border.all(color: KfcOpsTokens.outlineVariant),
        borderRadius: const BorderRadius.all(KfcOpsTokens.radiusLg),
      ),
      child: Padding(
        padding: const EdgeInsets.all(KfcOpsTokens.spacingMd),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: const TextStyle(
                color: KfcOpsTokens.onSurfaceVariant,
                fontSize: 12,
              ),
            ),
            const SizedBox(height: KfcOpsTokens.spacingMd),
            child,
          ],
        ),
      ),
    );
  }
}

class _TypeButton extends StatelessWidget {
  const _TypeButton({
    required this.type,
    required this.selected,
    required this.loading,
    required this.enabled,
    required this.onPressed,
  });

  final AutomaticRecommendationType type;
  final bool selected;
  final bool loading;
  final bool enabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final label = switch (type) {
      AutomaticRecommendationType.localFavorite => 'Local favorite',
      AutomaticRecommendationType.forYou => 'For you',
      AutomaticRecommendationType.modifierUpsell => 'Modifier upsell',
      AutomaticRecommendationType.smartCrossSell => 'Smart cross-sell',
    };
    return ShadButton.raw(
      width: double.infinity,
      height: 40,
      variant: selected ? ShadButtonVariant.primary : ShadButtonVariant.outline,
      onPressed: enabled ? onPressed : null,
      child: Align(
        alignment: Alignment.centerLeft,
        child: Text(loading ? 'Loading…' : label),
      ),
    );
  }
}

class _ContextValue extends StatelessWidget {
  const _ContextValue({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: KfcOpsTokens.onSurfaceVariant,
              fontSize: 10,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
            ),
          ),
          Text(value, overflow: TextOverflow.ellipsis),
        ],
      ),
    );
  }
}

class _EvidenceRow extends StatelessWidget {
  const _EvidenceRow({required this.label, required this.value, this.color});

  final String label;
  final String value;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: KfcOpsTokens.spacingSm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 80,
            child: Text(
              label,
              style: const TextStyle(
                color: KfcOpsTokens.onSurfaceVariant,
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: color, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

class _InspectionSummary extends StatelessWidget {
  const _InspectionSummary({required this.inspection});

  final Map<String, dynamic> inspection;

  @override
  Widget build(BuildContext context) {
    final persistence = Map<String, dynamic>.from(
      inspection['persistenceEvidence'] as Map,
    );
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: KfcOpsTokens.infoContainer,
        borderRadius: BorderRadius.all(KfcOpsTokens.radiusMd),
      ),
      child: Padding(
        padding: const EdgeInsets.all(KfcOpsTokens.spacingSm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Inspection loaded',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            Text(
              'Candidates: ${(inspection['candidateEvidence'] as List).length}',
            ),
            Text('Events committed: ${persistence['eventCount']}'),
            Text('Request digest: ${inspection['requestDigest']}'),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.title,
    required this.message,
    required this.color,
  });

  final String title;
  final String message;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
      ),
      child: Padding(
        padding: const EdgeInsets.all(KfcOpsTokens.spacingLg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: TextStyle(color: color, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: KfcOpsTokens.spacingXs),
            Text(message),
          ],
        ),
      ),
    );
  }
}

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({required this.message, required this.color});

  final String message;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        border: Border.all(color: color.withValues(alpha: 0.35)),
        borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
      ),
      child: Padding(
        padding: const EdgeInsets.all(KfcOpsTokens.spacingSm),
        child: Text(message, style: TextStyle(color: color, fontSize: 12)),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.16),
        borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        child: Text(
          label,
          style: TextStyle(
            color: color,
            fontSize: 10,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.5,
          ),
        ),
      ),
    );
  }
}

class _PositionBadge extends StatelessWidget {
  const _PositionBadge({required this.position});

  final int position;

  @override
  Widget build(BuildContext context) {
    return CircleAvatar(
      radius: 13,
      backgroundColor: KfcOpsTokens.primary,
      child: Text(
        '$position',
        style: const TextStyle(color: KfcOpsTokens.onPrimary, fontSize: 12),
      ),
    );
  }
}

class _ImagePlaceholder extends StatelessWidget {
  const _ImagePlaceholder();

  @override
  Widget build(BuildContext context) {
    return const DecoratedBox(
      decoration: BoxDecoration(
        color: KfcOpsTokens.surfaceContainer,
        borderRadius: BorderRadius.all(KfcOpsTokens.radiusMd),
      ),
      child: SizedBox(
        width: 56,
        height: 56,
        child: Icon(LucideIcons.utensils, color: KfcOpsTokens.secondary),
      ),
    );
  }
}

String _statusLabel(KioskState state) => switch (state.status) {
  KioskLoadStatus.configurationMissing => 'CONFIGURATION REQUIRED',
  KioskLoadStatus.idle => 'READY',
  KioskLoadStatus.loading => 'REQUEST IN FLIGHT',
  KioskLoadStatus.recommended => 'RECOMMENDED',
  KioskLoadStatus.empty => 'EMPTY',
  KioskLoadStatus.paused => 'PAUSED',
  KioskLoadStatus.error => 'UNAVAILABLE',
};

Color _statusColor(KioskState state) => switch (state.status) {
  KioskLoadStatus.recommended => KfcOpsTokens.success,
  KioskLoadStatus.empty || KioskLoadStatus.idle => KfcOpsTokens.secondary,
  KioskLoadStatus.loading => KfcOpsTokens.info,
  KioskLoadStatus.paused => KfcOpsTokens.warningText,
  KioskLoadStatus.configurationMissing ||
  KioskLoadStatus.error => KfcOpsTokens.critical,
};
