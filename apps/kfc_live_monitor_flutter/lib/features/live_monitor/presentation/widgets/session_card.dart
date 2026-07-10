import 'package:flutter/material.dart' show Tooltip;
import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../../../app/theme/kfc_ops_tokens.dart';
import '../../domain/chat_session.dart';
import '../../testing/live_monitor_keys.dart';

class SessionCard extends StatelessWidget {
  const SessionCard({
    super.key,
    required this.session,
    required this.onOpenSession,
    required this.onJoinHuman,
    required this.onSendHumanMessage,
    required this.onResumeAi,
  });

  final ChatSession session;
  final VoidCallback onOpenSession;
  final VoidCallback onJoinHuman;
  final ValueChanged<String> onSendHumanMessage;
  final VoidCallback onResumeAi;

  @override
  Widget build(BuildContext context) {
    final borderColor = switch (session.severity) {
      SessionSeverity.critical => KfcOpsTokens.critical,
      SessionSeverity.warning => KfcOpsTokens.warning,
      SessionSeverity.normal => KfcOpsTokens.secondaryContainer,
    };
    final borderWidth = session.severity == SessionSeverity.normal ? 1.0 : 2.0;

    return DecoratedBox(
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
                  key: LiveMonitorKeys.sessionOpenChatButton(session.id),
                  deeplink: session.deeplink,
                  onPressed: onOpenSession,
                ),
              ],
            ),
            _TakeoverControls(
              session: session,
              onJoinHuman: onJoinHuman,
              onSendHumanMessage: onSendHumanMessage,
              onResumeAi: onResumeAi,
            ),
          ],
        ),
      ),
    );
  }
}

class _TakeoverControls extends StatefulWidget {
  const _TakeoverControls({
    required this.session,
    required this.onJoinHuman,
    required this.onSendHumanMessage,
    required this.onResumeAi,
  });

  final ChatSession session;
  final VoidCallback onJoinHuman;
  final ValueChanged<String> onSendHumanMessage;
  final VoidCallback onResumeAi;

  @override
  State<_TakeoverControls> createState() => _TakeoverControlsState();
}

class _TakeoverControlsState extends State<_TakeoverControls> {
  late final TextEditingController _replyController;
  late final FocusNode _replyFocusNode;

  @override
  void initState() {
    super.initState();
    _replyController = TextEditingController();
    _replyFocusNode = FocusNode();
    _replyController.addListener(_onReplyChanged);
  }

  @override
  void dispose() {
    _replyController.removeListener(_onReplyChanged);
    _replyController.dispose();
    _replyFocusNode.dispose();
    super.dispose();
  }

  void _onReplyChanged() {
    setState(() {});
  }

  void _sendReply() {
    final text = _replyController.text.trim();
    if (text.isEmpty) return;
    widget.onSendHumanMessage(text);
    _replyController.clear();
  }

  @override
  Widget build(BuildContext context) {
    return switch (widget.session.status) {
      SessionStatus.needsHuman => Padding(
        padding: const EdgeInsets.only(top: KfcOpsTokens.spacingSm),
        child: _ControlRail(
          color: KfcOpsTokens.critical,
          child: Align(
            alignment: Alignment.centerLeft,
            child: ShadButton(
              key: LiveMonitorKeys.sessionJoinHumanButton(widget.session.id),
              size: ShadButtonSize.sm,
              height: 30,
              backgroundColor: KfcOpsTokens.critical,
              hoverBackgroundColor: KfcOpsTokens.primary,
              foregroundColor: KfcOpsTokens.onPrimary,
              leading: const Icon(LucideIcons.userPlus, size: 14),
              onPressed: widget.onJoinHuman,
              child: const Text('Join'),
            ),
          ),
        ),
      ),
      SessionStatus.humanJoined => Padding(
        padding: const EdgeInsets.only(top: KfcOpsTokens.spacingSm),
        child: _ControlRail(
          color: KfcOpsTokens.success,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                height: 32,
                child: Row(
                  children: [
                    Expanded(
                      child: _HumanReplyInput(
                        sessionId: widget.session.id,
                        controller: _replyController,
                        focusNode: _replyFocusNode,
                      ),
                    ),
                    const SizedBox(width: KfcOpsTokens.spacingXs),
                    ShadButton(
                      key: LiveMonitorKeys.sessionSendHumanReplyButton(
                        widget.session.id,
                      ),
                      size: ShadButtonSize.sm,
                      height: 30,
                      gap: 4,
                      leading: const Icon(LucideIcons.send, size: 14),
                      onPressed: _sendReply,
                      child: const Text('Send'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: KfcOpsTokens.spacingXs),
              ShadButton.outline(
                key: LiveMonitorKeys.sessionResumeAiButton(widget.session.id),
                size: ShadButtonSize.sm,
                height: 30,
                gap: 4,
                leading: const Icon(LucideIcons.bot, size: 14),
                onPressed: widget.onResumeAi,
                child: const Text('Resume AI'),
              ),
            ],
          ),
        ),
      ),
      _ => const SizedBox.shrink(),
    };
  }
}

class _HumanReplyInput extends StatelessWidget {
  const _HumanReplyInput({
    required this.sessionId,
    required this.controller,
    required this.focusNode,
  });

  final String sessionId;
  final TextEditingController controller;
  final FocusNode focusNode;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: KfcOpsTokens.surfaceContainerLowest,
        border: Border.all(color: KfcOpsTokens.secondaryContainer),
        borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: KfcOpsTokens.spacingSm,
          vertical: KfcOpsTokens.spacingXs,
        ),
        child: Stack(
          alignment: Alignment.centerLeft,
          children: [
            if (controller.text.isEmpty)
              const Text(
                'Human reply',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: KfcOpsTokens.secondary,
                  fontSize: 12,
                  height: 16 / 12,
                  letterSpacing: 0,
                ),
              ),
            EditableText(
              key: LiveMonitorKeys.sessionHumanReplyInput(sessionId),
              controller: controller,
              focusNode: focusNode,
              cursorColor: KfcOpsTokens.primary,
              backgroundCursorColor: KfcOpsTokens.secondary,
              maxLines: 1,
              style: const TextStyle(
                color: KfcOpsTokens.onSurface,
                fontSize: 12,
                height: 16 / 12,
                letterSpacing: 0,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ControlRail extends StatelessWidget {
  const _ControlRail({required this.color, required this.child});

  final Color color;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(left: BorderSide(color: color, width: 3)),
      ),
      child: Padding(
        padding: const EdgeInsets.only(left: KfcOpsTokens.spacingSm),
        child: child,
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
    return Column(
      children: [
        _MetadataRow(
          label: '${session.contextLabel}:',
          value: session.orderLabel,
          valueColor: KfcOpsTokens.onSurface,
        ),
        const SizedBox(height: KfcOpsTokens.spacingXs),
        _MetadataRow(
          label: 'Confidence:',
          value: '${session.confidencePercent}%',
          valueColor: _confidenceColor(session.confidencePercent),
        ),
      ],
    );
  }

  Color _confidenceColor(int confidence) {
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
    final color = channel == ChatChannel.messenger
        ? KfcOpsTokens.messenger
        : KfcOpsTokens.zalo;
    final background = channel == ChatChannel.messenger
        ? const Color(0x1A0084FF)
        : const Color(0x1A0068FF);

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
