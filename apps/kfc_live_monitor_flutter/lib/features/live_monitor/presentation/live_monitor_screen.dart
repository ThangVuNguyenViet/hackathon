import 'dart:async';

import 'package:flutter/material.dart' show Tooltip;
import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:state_beacon/state_beacon.dart';

import '../../../app/theme/kfc_ops_tokens.dart';
import '../application/live_monitor_controller.dart';
import '../data/live_monitor_repository.dart';
import '../domain/chat_session.dart';
import '../testing/live_monitor_keys.dart';
import 'widgets/filter_bar.dart';
import 'widgets/session_card.dart';

class LiveMonitorScreen extends StatefulWidget {
  const LiveMonitorScreen({super.key, required this.controller});

  final LiveMonitorController controller;

  @override
  State<LiveMonitorScreen> createState() => _LiveMonitorScreenState();
}

class _LiveMonitorScreenState extends State<LiveMonitorScreen> {
  @override
  void initState() {
    super.initState();
    unawaited(widget.controller.refresh());
  }

  @override
  Widget build(BuildContext context) {
    widget.controller.state.watch(context);
    final monitorState = widget.controller.monitorState.watch(context);
    final sessions = widget.controller.visibleSessions.watch(context);

    return DefaultTextStyle(
      style: const TextStyle(
        fontFamily: KfcOpsTokens.fontFamily,
        color: KfcOpsTokens.onSurface,
        letterSpacing: 0,
      ),
      child: ColoredBox(
        color: KfcOpsTokens.surface,
        child: SafeArea(
          child: SingleChildScrollView(
            child: Padding(
              padding: const EdgeInsets.only(bottom: KfcOpsTokens.gutter),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _OperationsHeader(readiness: monitorState.readiness),
                  Padding(
                    padding: const EdgeInsets.all(KfcOpsTokens.gutter),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        FilterBar(
                          activeCount: sessions.length,
                          filters: monitorState.filters,
                          controller: widget.controller,
                        ),
                        if (monitorState.readiness.message case final message?
                            when message.isNotEmpty) ...[
                          const SizedBox(height: KfcOpsTokens.spacingMd),
                          _ReadinessMessage(readiness: monitorState.readiness),
                        ],
                        const SizedBox(height: KfcOpsTokens.gutter),
                        _SessionGrid(
                          sessions: sessions,
                          onOpenSession: widget.controller.openSession,
                          onJoinHuman: widget.controller.joinHuman,
                          onSendHumanMessage:
                              widget.controller.sendHumanMessage,
                          onResumeAi: widget.controller.resumeAi,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _OperationsHeader extends StatelessWidget {
  const _OperationsHeader({required this.readiness});

  final LiveMonitorReadiness readiness;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: KfcOpsTokens.surface,
        border: Border(
          bottom: BorderSide(color: KfcOpsTokens.secondaryContainer),
        ),
      ),
      child: SizedBox(
        height: 64,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: KfcOpsTokens.marginDesktop,
          ),
          child: Row(
            children: [
              const Expanded(
                child: Text(
                  'KFC Vietnam Operations',
                  key: LiveMonitorKeys.operationsHeader,
                  style: TextStyle(
                    color: KfcOpsTokens.primary,
                    fontSize: 24,
                    fontWeight: FontWeight.w900,
                    height: 32 / 24,
                    letterSpacing: 0,
                  ),
                ),
              ),
              const _HeaderIcon(icon: LucideIcons.bell),
              const SizedBox(width: KfcOpsTokens.spacingSm),
              const _HeaderIcon(icon: LucideIcons.user),
              const SizedBox(width: KfcOpsTokens.spacingSm),
              const _HeaderIcon(icon: LucideIcons.settings),
              const SizedBox(width: KfcOpsTokens.spacingMd),
              _ReadinessPill(readiness: readiness),
            ],
          ),
        ),
      ),
    );
  }
}

class _HeaderIcon extends StatelessWidget {
  const _HeaderIcon({required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: SizedBox.square(
        dimension: 32,
        child: Center(
          child: Icon(icon, size: 18, color: KfcOpsTokens.secondary),
        ),
      ),
    );
  }
}

class _ReadinessPill extends StatelessWidget {
  const _ReadinessPill({required this.readiness});

  final LiveMonitorReadiness readiness;

  @override
  Widget build(BuildContext context) {
    final pill = DecoratedBox(
      decoration: BoxDecoration(
        color: KfcOpsTokens.surfaceContainerLow,
        border: Border.all(color: KfcOpsTokens.secondaryContainer),
        borderRadius: const BorderRadius.all(Radius.circular(999)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: KfcOpsTokens.spacingSm,
          vertical: KfcOpsTokens.spacingXs,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                color: _readinessColor(readiness.status),
                shape: BoxShape.circle,
              ),
              child: const SizedBox.square(dimension: 8),
            ),
            const SizedBox(width: KfcOpsTokens.spacingSm),
            Text(
              readiness.label,
              style: const TextStyle(
                color: KfcOpsTokens.onSurface,
                fontSize: 12,
                fontWeight: FontWeight.w600,
                height: 16 / 12,
                letterSpacing: 0,
              ),
            ),
          ],
        ),
      ),
    );
    final message = readiness.message;
    if (message == null || message.isEmpty) return pill;
    return Tooltip(message: message, child: pill);
  }

  Color _readinessColor(LiveMonitorReadinessStatus status) => switch (status) {
    LiveMonitorReadinessStatus.online => KfcOpsTokens.success,
    LiveMonitorReadinessStatus.configMissing => KfcOpsTokens.warning,
    LiveMonitorReadinessStatus.offline => KfcOpsTokens.critical,
  };
}

class _ReadinessMessage extends StatelessWidget {
  const _ReadinessMessage({required this.readiness});

  final LiveMonitorReadiness readiness;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: KfcOpsTokens.surfaceContainerLow,
        border: Border.all(color: _borderColor(readiness.status)),
        borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: KfcOpsTokens.spacingMd,
          vertical: KfcOpsTokens.spacingSm,
        ),
        child: Row(
          children: [
            Icon(
              _icon(readiness.status),
              color: _borderColor(readiness.status),
              size: 16,
            ),
            const SizedBox(width: KfcOpsTokens.spacingSm),
            Expanded(
              child: Text(
                readiness.message ?? readiness.label,
                style: const TextStyle(
                  color: KfcOpsTokens.onSurface,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  height: 18 / 13,
                  letterSpacing: 0,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  IconData _icon(LiveMonitorReadinessStatus status) => switch (status) {
    LiveMonitorReadinessStatus.online => LucideIcons.circleCheck,
    LiveMonitorReadinessStatus.configMissing => LucideIcons.triangleAlert,
    LiveMonitorReadinessStatus.offline => LucideIcons.circleX,
  };

  Color _borderColor(LiveMonitorReadinessStatus status) => switch (status) {
    LiveMonitorReadinessStatus.online => KfcOpsTokens.success,
    LiveMonitorReadinessStatus.configMissing => KfcOpsTokens.warning,
    LiveMonitorReadinessStatus.offline => KfcOpsTokens.critical,
  };
}

class _SessionGrid extends StatelessWidget {
  const _SessionGrid({
    required this.sessions,
    required this.onOpenSession,
    required this.onJoinHuman,
    required this.onSendHumanMessage,
    required this.onResumeAi,
  });

  final List<ChatSession> sessions;
  final void Function(String sessionId) onOpenSession;
  final void Function(String sessionId) onJoinHuman;
  final void Function(String sessionId, String text) onSendHumanMessage;
  final void Function(String sessionId) onResumeAi;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = _columnCountForWidth(constraints.maxWidth);
        return GridView.builder(
          key: LiveMonitorKeys.monitorGrid,
          itemCount: sessions.length,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            crossAxisSpacing: KfcOpsTokens.gutter,
            mainAxisSpacing: KfcOpsTokens.gutter,
            mainAxisExtent: columns == 4 ? 348 : 372,
          ),
          itemBuilder: (context, index) {
            final session = sessions[index];
            return SessionCard(
              key: LiveMonitorKeys.sessionCard(session.id),
              session: session,
              onOpenSession: () => onOpenSession(session.id),
              onJoinHuman: () => onJoinHuman(session.id),
              onSendHumanMessage: (text) =>
                  onSendHumanMessage(session.id, text),
              onResumeAi: () => onResumeAi(session.id),
            );
          },
        );
      },
    );
  }

  int _columnCountForWidth(double width) {
    if (width >= 1120) return 4;
    if (width >= 760) return 2;
    return 1;
  }
}
