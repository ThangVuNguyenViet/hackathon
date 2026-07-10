import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../../../../app/theme/kfc_ops_tokens.dart';
import '../../application/live_monitor_controller.dart';
import '../../application/live_monitor_filters.dart';
import '../../domain/chat_session.dart';
import '../../testing/live_monitor_keys.dart';

class FilterBar extends StatelessWidget {
  const FilterBar({
    super.key,
    required this.activeCount,
    required this.filters,
    required this.controller,
  });

  final int activeCount;
  final LiveMonitorFilters filters;
  final LiveMonitorController controller;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: KfcOpsTokens.surfaceContainerLowest,
        border: Border.all(color: KfcOpsTokens.secondaryContainer),
        borderRadius: const BorderRadius.all(KfcOpsTokens.radiusLg),
      ),
      child: Padding(
        padding: const EdgeInsets.all(KfcOpsTokens.spacingMd),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final controls = _filterControls();
            final trailing = _trailingControls();

            if (constraints.maxWidth < 760) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  controls,
                  const SizedBox(height: KfcOpsTokens.spacingSm),
                  trailing,
                ],
              );
            }

            return Row(
              children: [
                Expanded(child: controls),
                const SizedBox(width: KfcOpsTokens.spacingMd),
                trailing,
              ],
            );
          },
        ),
      ),
    );
  }

  Wrap _filterControls() {
    return Wrap(
      spacing: KfcOpsTokens.spacingSm,
      runSpacing: KfcOpsTokens.spacingSm,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        _CompactSelect(
          key: LiveMonitorKeys.channelFilter,
          label: 'Channel:',
          value: _channelValue(filters.channel),
          options: const [
            _SelectOption('all', 'All'),
            _SelectOption('messenger', 'Messenger'),
            _SelectOption('zalo', 'Zalo'),
          ],
          width: 136,
          onChanged: (value) => controller.setChannelFilter(switch (value) {
            'messenger' => ChatChannel.messenger,
            'zalo' => ChatChannel.zalo,
            _ => null,
          }),
        ),
        _CompactSelect(
          key: LiveMonitorKeys.severityFilter,
          label: 'Severity:',
          value: _severityValue(filters.severity),
          options: const [
            _SelectOption('all', 'All'),
            _SelectOption('normal', 'Normal'),
            _SelectOption('warning', 'Warning'),
            _SelectOption('critical', 'Critical'),
          ],
          width: 128,
          onChanged: (value) => controller.setSeverityFilter(switch (value) {
            'normal' => SessionSeverity.normal,
            'warning' => SessionSeverity.warning,
            'critical' => SessionSeverity.critical,
            _ => null,
          }),
        ),
        _CompactSelect(
          key: LiveMonitorKeys.statusFilter,
          label: 'Status:',
          value: _statusValue(filters.status),
          options: const [
            _SelectOption('all', 'All'),
            _SelectOption('aiHandling', 'AI handling'),
            _SelectOption('needsHuman', 'Needs human'),
            _SelectOption('humanJoined', 'Joined'),
            _SelectOption('resolved', 'Resolved'),
          ],
          width: 134,
          onChanged: (value) => controller.setStatusFilter(switch (value) {
            'aiHandling' => SessionStatus.aiHandling,
            'needsHuman' => SessionStatus.needsHuman,
            'humanJoined' => SessionStatus.humanJoined,
            'resolved' => SessionStatus.resolved,
            _ => null,
          }),
        ),
        _CompactSelect(
          key: LiveMonitorKeys.assignedFilter,
          label: 'Assigned:',
          value: _assignedValue(filters.assignedToMe),
          options: const [
            _SelectOption('all', 'All'),
            _SelectOption('unassigned', 'Unassigned'),
            _SelectOption('me', 'Me'),
          ],
          width: 144,
          onChanged: (value) => controller.setAssignedFilter(switch (value) {
            'me' => true,
            'unassigned' => false,
            _ => null,
          }),
        ),
        _CompactSelect(
          key: LiveMonitorKeys.orderFilter,
          label: 'Context:',
          value: _orderValue(filters.orderState),
          options: const [
            _SelectOption('all', 'All'),
            _SelectOption('collectingInfo', 'Collecting'),
            _SelectOption('cartReady', 'Cart ready'),
            _SelectOption('paymentIssue', 'Payment issue'),
            _SelectOption('omsPending', 'Pending'),
            _SelectOption('confirmed', 'Confirmed'),
          ],
          width: 136,
          onChanged: (value) => controller.setOrderStateFilter(switch (value) {
            'collectingInfo' => OrderState.collectingInfo,
            'cartReady' => OrderState.cartReady,
            'paymentIssue' => OrderState.paymentIssue,
            'omsPending' => OrderState.omsPending,
            'confirmed' => OrderState.confirmed,
            _ => null,
          }),
        ),
      ],
    );
  }

  Wrap _trailingControls() {
    return Wrap(
      spacing: KfcOpsTokens.spacingMd,
      runSpacing: KfcOpsTokens.spacingSm,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        SizedBox(
          width: 156,
          child: Row(
            key: LiveMonitorKeys.sortMode,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Sort:',
                style: TextStyle(
                  color: KfcOpsTokens.secondary,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  height: 16 / 12,
                  letterSpacing: 0,
                ),
              ),
              const SizedBox(width: KfcOpsTokens.spacingXs),
              Expanded(
                child: _BareSelect(
                  value: _sortValue(filters.sortMode),
                  options: const [
                    _SelectOption('criticalFirst', 'Critical first'),
                    _SelectOption('newestActivity', 'Newest activity'),
                  ],
                  onChanged: (value) => controller.setSortMode(
                    value == 'newestActivity'
                        ? SortMode.newestActivity
                        : SortMode.criticalFirst,
                  ),
                ),
              ),
            ],
          ),
        ),
        _ActiveSessionsPill(activeCount: activeCount),
      ],
    );
  }

  String _assignedValue(bool? value) {
    if (value == true) return 'me';
    if (value == false) return 'unassigned';
    return 'all';
  }

  String _channelValue(ChatChannel? value) => switch (value) {
    ChatChannel.messenger => 'messenger',
    ChatChannel.zalo => 'zalo',
    null => 'all',
  };

  String _orderValue(OrderState? value) => switch (value) {
    OrderState.collectingInfo => 'collectingInfo',
    OrderState.cartReady => 'cartReady',
    OrderState.paymentIssue => 'paymentIssue',
    OrderState.omsPending => 'omsPending',
    OrderState.confirmed => 'confirmed',
    null => 'all',
  };

  String _severityValue(SessionSeverity? value) => switch (value) {
    SessionSeverity.normal => 'normal',
    SessionSeverity.warning => 'warning',
    SessionSeverity.critical => 'critical',
    null => 'all',
  };

  String _sortValue(SortMode value) => switch (value) {
    SortMode.newestActivity => 'newestActivity',
    _ => 'criticalFirst',
  };

  String _statusValue(SessionStatus? value) => switch (value) {
    SessionStatus.aiHandling => 'aiHandling',
    SessionStatus.needsHuman => 'needsHuman',
    SessionStatus.humanJoined => 'humanJoined',
    SessionStatus.resolved => 'resolved',
    null => 'all',
  };
}

class _CompactSelect extends StatelessWidget {
  const _CompactSelect({
    super.key,
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
    required this.width,
  });

  final String label;
  final String value;
  final List<_SelectOption> options;
  final ValueChanged<String> onChanged;
  final double width;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: KfcOpsTokens.surfaceContainerLow,
        border: Border.all(color: KfcOpsTokens.secondaryContainer),
        borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
      ),
      child: SizedBox(
        width: width,
        height: 28,
        child: Padding(
          padding: const EdgeInsets.only(left: KfcOpsTokens.spacingSm),
          child: Row(
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
              const SizedBox(width: KfcOpsTokens.spacingXs),
              Expanded(
                child: _BareSelect(
                  value: value,
                  options: options,
                  onChanged: onChanged,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BareSelect extends StatelessWidget {
  const _BareSelect({
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final String value;
  final List<_SelectOption> options;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.centerLeft,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                _labelForValue(value),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: KfcOpsTokens.onSurface,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  height: 16 / 12,
                  letterSpacing: 0,
                ),
              ),
            ),
            const Icon(
              LucideIcons.chevronDown,
              size: 14,
              color: KfcOpsTokens.secondary,
            ),
          ],
        ),
        Positioned.fill(
          child: Opacity(
            opacity: 0.01,
            child: ShadSelect<String>(
              initialValue: value,
              minWidth: 40,
              maxWidth: 128,
              maxHeight: 240,
              decoration: ShadDecoration.none,
              padding: EdgeInsets.zero,
              trailing: const SizedBox.shrink(),
              options: options
                  .map(
                    (option) => ShadOption<String>(
                      value: option.value,
                      child: Text(option.label),
                    ),
                  )
                  .toList(),
              selectedOptionBuilder: (context, selectedValue) {
                return const SizedBox.shrink();
              },
              onChanged: (selectedValue) {
                if (selectedValue != null) onChanged(selectedValue);
              },
            ),
          ),
        ),
      ],
    );
  }

  String _labelForValue(String selectedValue) {
    return options
        .firstWhere(
          (option) => option.value == selectedValue,
          orElse: () => options.first,
        )
        .label;
  }
}

class _ActiveSessionsPill extends StatelessWidget {
  const _ActiveSessionsPill({required this.activeCount});

  final int activeCount;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      key: LiveMonitorKeys.activeSessionsBadge,
      decoration: const BoxDecoration(
        color: KfcOpsTokens.primaryContainer,
        borderRadius: BorderRadius.all(Radius.circular(999)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: KfcOpsTokens.spacingSm,
          vertical: KfcOpsTokens.spacingXs,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const DecoratedBox(
              decoration: BoxDecoration(
                color: KfcOpsTokens.onPrimaryContainer,
                shape: BoxShape.circle,
              ),
              child: SizedBox.square(dimension: 6),
            ),
            const SizedBox(width: KfcOpsTokens.spacingXs),
            Text(
              'Active Sessions: $activeCount',
              style: const TextStyle(
                color: KfcOpsTokens.onPrimaryContainer,
                fontSize: 11,
                fontWeight: FontWeight.w700,
                height: 14 / 11,
                letterSpacing: 0,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SelectOption {
  const _SelectOption(this.value, this.label);

  final String value;
  final String label;
}
