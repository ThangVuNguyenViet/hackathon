import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:state_beacon/state_beacon.dart';

import '../../../app/theme/kfc_ops_tokens.dart';
import '../application/live_monitor_controller.dart';
import '../domain/chat_session.dart';
import '../testing/live_monitor_keys.dart';
import 'widgets/filter_bar.dart';
import 'widgets/session_card.dart';

class LiveMonitorScreen extends StatelessWidget {
  const LiveMonitorScreen({super.key, required this.controller});

  final LiveMonitorController controller;

  @override
  Widget build(BuildContext context) {
    final monitorState = controller.monitorState.watch(context);
    final sessions = controller.visibleSessions.watch(context);

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
                  const _OperationsHeader(),
                  Padding(
                    padding: const EdgeInsets.all(KfcOpsTokens.gutter),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        FilterBar(
                          activeCount: sessions.length,
                          filters: monitorState.filters,
                          controller: controller,
                        ),
                        const SizedBox(height: KfcOpsTokens.gutter),
                        _SessionGrid(
                          sessions: sessions,
                          onOpenSession: controller.openSession,
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
  const _OperationsHeader();

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
              _HeaderIconButton(icon: LucideIcons.bell, label: 'Alerts'),
              const SizedBox(width: KfcOpsTokens.spacingSm),
              _HeaderIconButton(icon: LucideIcons.user, label: 'Profile'),
              const SizedBox(width: KfcOpsTokens.spacingSm),
              _HeaderIconButton(icon: LucideIcons.settings, label: 'Settings'),
              const SizedBox(width: KfcOpsTokens.spacingMd),
              const _OnlinePill(),
            ],
          ),
        ),
      ),
    );
  }
}

class _HeaderIconButton extends StatelessWidget {
  const _HeaderIconButton({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () {},
          child: SizedBox.square(
            dimension: 32,
            child: Center(
              child: Icon(icon, size: 18, color: KfcOpsTokens.secondary),
            ),
          ),
        ),
      ),
    );
  }
}

class _OnlinePill extends StatelessWidget {
  const _OnlinePill();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: KfcOpsTokens.surfaceContainerLow,
        border: Border.all(color: KfcOpsTokens.secondaryContainer),
        borderRadius: const BorderRadius.all(Radius.circular(999)),
      ),
      child: const Padding(
        padding: EdgeInsets.symmetric(
          horizontal: KfcOpsTokens.spacingSm,
          vertical: KfcOpsTokens.spacingXs,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                color: KfcOpsTokens.success,
                shape: BoxShape.circle,
              ),
              child: SizedBox.square(dimension: 8),
            ),
            SizedBox(width: KfcOpsTokens.spacingSm),
            Text(
              'Online',
              style: TextStyle(
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
  }
}

class _SessionGrid extends StatelessWidget {
  const _SessionGrid({required this.sessions, required this.onOpenSession});

  final List<ChatSession> sessions;
  final void Function(String sessionId) onOpenSession;

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
            mainAxisExtent: columns == 4 ? 329 : 300,
          ),
          itemBuilder: (context, index) {
            final session = sessions[index];
            return SessionCard(
              key: LiveMonitorKeys.sessionCard(session.id),
              session: session,
              onOpenSession: () => onOpenSession(session.id),
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
