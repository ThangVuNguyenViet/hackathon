import 'dart:async';

import 'package:flutter/material.dart' show Tooltip;
import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../../../app/theme/kfc_ops_tokens.dart';
import '../../domain/chat_session.dart';
import '../../testing/live_monitor_keys.dart';

class SessionCard extends StatefulWidget {
  const SessionCard({
    super.key,
    required this.session,
    required this.onOpenSession,
    required this.onJoinHuman,
    required this.onResumeAi,
  });

  final ChatSession session;
  final VoidCallback onOpenSession;
  final FutureOr<void> Function() onJoinHuman;
  final FutureOr<void> Function() onResumeAi;

  @override
  State<SessionCard> createState() => _SessionCardState();
}

class _SessionCardState extends State<SessionCard> {
  bool _showHoverActions = false;
  bool _showFocusActions = false;
  bool _takeoverActionInProgress = false;

  bool get _showTakeoverAction =>
      _showHoverActions || _showFocusActions || _takeoverActionInProgress;

  Future<void> _runTakeoverAction(FutureOr<void> Function() action) async {
    if (_takeoverActionInProgress) return;
    setState(() => _takeoverActionInProgress = true);
    try {
      await action();
    } finally {
      if (mounted) setState(() => _takeoverActionInProgress = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    final borderColor = switch (session.severity) {
      SessionSeverity.critical => KfcOpsTokens.critical,
      SessionSeverity.warning => KfcOpsTokens.warning,
      SessionSeverity.normal => KfcOpsTokens.secondaryContainer,
    };
    final borderWidth = session.severity == SessionSeverity.normal ? 1.0 : 2.0;

    return MouseRegion(
      opaque: true,
      onEnter: (_) {
        if (_showHoverActions) return;
        setState(() => _showHoverActions = true);
      },
      onExit: (_) {
        if (!_showHoverActions) return;
        setState(() => _showHoverActions = false);
      },
      child: Focus(
        onFocusChange: (value) {
          if (_showFocusActions == value) return;
          setState(() => _showFocusActions = value);
        },
        child: Stack(
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                color: KfcOpsTokens.surfaceContainerLowest,
                border: Border.all(color: borderColor, width: borderWidth),
                borderRadius: const BorderRadius.all(KfcOpsTokens.radiusLg),
                boxShadow: session.severity == SessionSeverity.normal
                    ? null
                    : const [
                        BoxShadow(
                          color: Color(0x0A191C1D),
                          blurRadius: 10,
                          offset: Offset(0, 2),
                        ),
                      ],
              ),
              child: Padding(
                padding: EdgeInsets.all(KfcOpsTokens.spacingMd + borderWidth),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _CardHeader(session: session),
                    const SizedBox(
                      height: KfcOpsTokens.spacingSm + KfcOpsTokens.spacingXs,
                    ),
                    _TranscriptPreview(session: session),
                    const Spacer(),
                    _MetadataRows(session: session),
                    const SizedBox(height: KfcOpsTokens.spacingSm),
                    Row(
                      children: [
                        Flexible(
                          child: Align(
                            alignment: Alignment.centerLeft,
                            child: _StatusBadge(status: session.status),
                          ),
                        ),
                        const SizedBox(width: KfcOpsTokens.spacingSm),
                        _OpenChatButton(
                          key: LiveMonitorKeys.sessionOpenChatButton(
                            session.id,
                          ),
                          deeplink: session.deeplink,
                          onPressed: widget.onOpenSession,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            _TakeoverActionOverlay(
              session: session,
              visible: _showTakeoverAction,
              actionInProgress: _takeoverActionInProgress,
              onJoinHuman: () {
                unawaited(_runTakeoverAction(widget.onJoinHuman));
              },
              onResumeAi: () {
                unawaited(_runTakeoverAction(widget.onResumeAi));
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _TakeoverActionOverlay extends StatelessWidget {
  const _TakeoverActionOverlay({
    required this.session,
    required this.visible,
    required this.actionInProgress,
    required this.onJoinHuman,
    required this.onResumeAi,
  });

  final ChatSession session;
  final bool visible;
  final bool actionInProgress;
  final VoidCallback onJoinHuman;
  final VoidCallback onResumeAi;

  @override
  Widget build(BuildContext context) {
    if (session.channel == ChatChannel.kfc) return const SizedBox.shrink();
    final action = switch (session.status) {
      SessionStatus.humanJoined => ShadButton.outline(
        key: LiveMonitorKeys.sessionResumeAiButton(session.id),
        size: ShadButtonSize.sm,
        height: 30,
        gap: 4,
        leading: const Icon(LucideIcons.bot, size: 14),
        onPressed: actionInProgress ? null : onResumeAi,
        child: Text(actionInProgress ? 'Resuming…' : 'Resume AI'),
      ),
      _ => ShadButton(
        key: LiveMonitorKeys.sessionJoinHumanButton(session.id),
        size: ShadButtonSize.sm,
        height: 30,
        backgroundColor: KfcOpsTokens.critical,
        hoverBackgroundColor: KfcOpsTokens.primary,
        foregroundColor: KfcOpsTokens.onPrimary,
        leading: const Icon(LucideIcons.userPlus, size: 14),
        onPressed: actionInProgress ? null : onJoinHuman,
        child: Text(actionInProgress ? 'Joining…' : 'Join'),
      ),
    };

    return Positioned(
      top: 8,
      right: 8,
      child: IgnorePointer(
        ignoring: !visible,
        child: ExcludeSemantics(
          excluding: !visible,
          child: ExcludeFocus(
            excluding: !visible,
            child: AnimatedOpacity(
              opacity: visible ? 1 : 0,
              duration: const Duration(milliseconds: 140),
              curve: Curves.easeOut,
              child: action,
            ),
          ),
        ),
      ),
    );
  }
}

class _OpenChatButton extends StatelessWidget {
  const _OpenChatButton({
    super.key,
    required this.deeplink,
    required this.onPressed,
  });

  final ChatDeeplink deeplink;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final enabled = deeplink.status == DeeplinkStatus.available;
    final button = Semantics(
      button: true,
      enabled: enabled,
      label: enabled ? 'Open chat' : 'Chat link unavailable',
      child: MouseRegion(
        cursor: enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: enabled ? onPressed : null,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: KfcOpsTokens.surfaceContainerLowest,
              border: Border.all(color: KfcOpsTokens.secondaryContainer),
              borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
            ),
            child: SizedBox(
              width: 96,
              height: 32,
              child: Center(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        LucideIcons.externalLink,
                        size: 14,
                        color: enabled
                            ? KfcOpsTokens.onSurface
                            : KfcOpsTokens.secondary,
                      ),
                      const SizedBox(width: KfcOpsTokens.spacingXs),
                      Text(
                        'Open chat',
                        style: TextStyle(
                          color: enabled
                              ? KfcOpsTokens.onSurface
                              : KfcOpsTokens.secondary,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          height: 14 / 11,
                          letterSpacing: 0,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    if (enabled) return button;
    return Tooltip(
      message: deeplink.reason ?? 'Chat link unavailable',
      child: button,
    );
  }
}

class _CardHeader extends StatelessWidget {
  const _CardHeader({required this.session});

  final ChatSession session;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(
                child: Text(
                  session.customerName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: KfcOpsTokens.onSurface,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    height: 16 / 12,
                    letterSpacing: 0,
                  ),
                ),
              ),
              const SizedBox(width: KfcOpsTokens.spacingXs),
              _ChannelBadge(channel: session.channel),
            ],
          ),
        ),
        const SizedBox(width: KfcOpsTokens.spacingSm),
        Text(
          session.lastActivityLabel,
          style: const TextStyle(
            color: KfcOpsTokens.secondary,
            fontSize: 11,
            fontWeight: FontWeight.w500,
            height: 14 / 11,
            letterSpacing: 0,
          ),
        ),
      ],
    );
  }
}

class _TranscriptPreview extends StatelessWidget {
  const _TranscriptPreview({required this.session});

  final ChatSession session;

  @override
  Widget build(BuildContext context) {
    final turns = session.turns;
    final maxPreviewTurns = session.status == SessionStatus.humanJoined ? 3 : 5;
    final previewTurns = turns.length <= maxPreviewTurns
        ? turns
        : turns.sublist(turns.length - maxPreviewTurns);
    final compact = previewTurns.length > 4;
    final transcript = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final turn in previewTurns) ...[
          _TranscriptTurn(turn: turn, compact: compact),
          if (turn != previewTurns.last)
            const SizedBox(height: KfcOpsTokens.spacingXs),
        ],
      ],
    );

    return DecoratedBox(
      decoration: BoxDecoration(
        color: session.orderState == OrderState.collectingInfo
            ? KfcOpsTokens.surface
            : KfcOpsTokens.surfaceContainerLow,
        border: const Border(
          left: BorderSide(color: KfcOpsTokens.secondaryContainer, width: 2),
        ),
        borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
      ),
      child: Padding(
        padding: const EdgeInsets.all(KfcOpsTokens.spacingSm),
        child: transcript,
      ),
    );
  }
}

class _TranscriptTurn extends StatelessWidget {
  const _TranscriptTurn({required this.turn, this.compact = false});

  final ChatTurn turn;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final isCustomer = turn.speaker == 'User';
    final background = isCustomer
        ? KfcOpsTokens.onPrimaryContainer
        : KfcOpsTokens.surfaceContainerLowest;
    final borderColor = isCustomer
        ? KfcOpsTokens.outlineVariant
        : KfcOpsTokens.secondaryContainer;

    return LayoutBuilder(
      builder: (context, constraints) {
        final maxBubbleWidth = constraints.hasBoundedWidth
            ? constraints.maxWidth * (compact ? 0.94 : 0.86)
            : double.infinity;

        return Align(
          alignment: isCustomer ? Alignment.centerRight : Alignment.centerLeft,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: maxBubbleWidth),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: background,
                border: Border.all(color: borderColor),
                borderRadius: BorderRadius.only(
                  topLeft: KfcOpsTokens.radiusMd,
                  topRight: KfcOpsTokens.radiusMd,
                  bottomLeft: isCustomer
                      ? KfcOpsTokens.radiusMd
                      : KfcOpsTokens.radiusSm,
                  bottomRight: isCustomer
                      ? KfcOpsTokens.radiusSm
                      : KfcOpsTokens.radiusMd,
                ),
              ),
              child: Padding(
                padding: EdgeInsets.symmetric(
                  horizontal: KfcOpsTokens.spacingSm,
                  vertical: compact ? 3 : KfcOpsTokens.spacingXs,
                ),
                child: Text(
                  turn.message,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  textAlign: isCustomer ? TextAlign.right : TextAlign.left,
                  textWidthBasis: TextWidthBasis.longestLine,
                  style: const TextStyle(
                    color: KfcOpsTokens.onSurface,
                    fontSize: 11,
                    fontStyle: FontStyle.italic,
                    fontWeight: FontWeight.w400,
                    height: 14 / 11,
                    letterSpacing: 0,
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _MetadataRows extends StatelessWidget {
  const _MetadataRows({required this.session});

  final ChatSession session;

  static const _lowConfidenceThreshold = 70;

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    if (session.orderLabel.isNotEmpty) {
      rows.add(
        _MetadataRow(
          label: '${session.contextLabel}:',
          value: session.orderLabel,
          valueColor: KfcOpsTokens.onSurface,
        ),
      );
    }
    if (session.confidencePercent != null) {
      if (rows.isNotEmpty) {
        rows.add(const SizedBox(height: KfcOpsTokens.spacingXs));
      }
      rows.add(
        _MetadataRow(
          label: 'Confidence:',
          value: '${session.confidencePercent}%',
          valueColor: _confidenceColor(session.confidencePercent),
        ),
      );
    }
    final commerceRows = <String, String?>{
      'Commerce:': session.commerceOrderId,
      'OMS:': session.omsOrderId,
      'POS:': session.posTicketId,
      'Status:': session.commerceStatus,
    };
    for (final entry in commerceRows.entries) {
      if (entry.value == null || entry.value!.isEmpty) continue;
      if (rows.isNotEmpty) {
        rows.add(const SizedBox(height: KfcOpsTokens.spacingXs));
      }
      rows.add(
        _MetadataRow(
          label: entry.key,
          value: entry.value!,
          valueColor: KfcOpsTokens.onSurface,
        ),
      );
    }
    if (rows.isEmpty) return const SizedBox.shrink();

    return Column(children: rows);
  }

  Color _confidenceColor(int? confidence) {
    if (confidence == null) return KfcOpsTokens.secondary;
    if (confidence < _lowConfidenceThreshold) return KfcOpsTokens.critical;
    return KfcOpsTokens.onSurface;
  }
}

class _MetadataRow extends StatelessWidget {
  const _MetadataRow({
    required this.label,
    required this.value,
    required this.valueColor,
  });

  final String label;
  final String value;
  final Color valueColor;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          label,
          style: const TextStyle(
            color: KfcOpsTokens.secondary,
            fontSize: 11,
            fontWeight: FontWeight.w500,
            height: 14 / 11,
            letterSpacing: 0,
          ),
        ),
        const SizedBox(width: KfcOpsTokens.spacingSm),
        Expanded(
          child: Align(
            alignment: Alignment.centerRight,
            child: Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.end,
              style: TextStyle(
                color: valueColor,
                fontSize: 11,
                fontWeight: FontWeight.w700,
                height: 14 / 11,
                letterSpacing: 0,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ChannelBadge extends StatelessWidget {
  const _ChannelBadge({required this.channel});

  final ChatChannel channel;

  @override
  Widget build(BuildContext context) {
    final (color, background) = switch (channel) {
      ChatChannel.messenger => (
        KfcOpsTokens.messenger,
        const Color(0x1A0084FF),
      ),
      ChatChannel.zalo => (KfcOpsTokens.zalo, const Color(0x1A0068FF)),
      ChatChannel.kfc => (KfcOpsTokens.primary, const Color(0x1AE4002B)),
    };

    return _Badge(
      label: channel.label,
      color: background,
      foreground: color,
      fontWeight: FontWeight.w700,
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});

  final SessionStatus status;

  @override
  Widget build(BuildContext context) {
    final (background, foreground, weight) = switch (status) {
      SessionStatus.aiHandling => (
        KfcOpsTokens.surfaceContainerHigh,
        KfcOpsTokens.onSurfaceVariant,
        FontWeight.w500,
      ),
      SessionStatus.needsHuman => (
        KfcOpsTokens.criticalContainer,
        KfcOpsTokens.critical,
        FontWeight.w700,
      ),
      SessionStatus.humanJoined => (
        KfcOpsTokens.successContainer,
        KfcOpsTokens.success,
        FontWeight.w500,
      ),
      SessionStatus.resolved => (
        KfcOpsTokens.successContainer,
        KfcOpsTokens.success,
        FontWeight.w500,
      ),
    };

    return _Badge(
      label: status.label,
      color: background,
      foreground: foreground,
      fontWeight: weight,
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({
    required this.label,
    required this.color,
    required this.foreground,
    required this.fontWeight,
  });

  final String label;
  final Color color;
  final Color foreground;
  final FontWeight fontWeight;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color,
        borderRadius: const BorderRadius.all(Radius.circular(999)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        child: Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: foreground,
            fontSize: 11,
            fontWeight: fontWeight,
            height: 14 / 11,
            letterSpacing: 0,
          ),
        ),
      ),
    );
  }
}
