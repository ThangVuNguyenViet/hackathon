part of 'showcase_screen.dart';

class _KitchenHeader extends StatelessWidget {
  const _KitchenHeader();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: _paperRaised,
        border: Border(bottom: BorderSide(color: _rule)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        child: Row(
          children: [
            const _KfcMark(),
            const SizedBox(width: 14),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'KFC TEST KITCHEN',
                    style: TextStyle(
                      fontSize: 19,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 1.1,
                      height: 1.1,
                    ),
                  ),
                  SizedBox(height: 3),
                  Text(
                    'Accepted scenarios · replayed against the deployed sandbox',
                    style: TextStyle(color: _mutedInk, fontSize: 12),
                  ),
                ],
              ),
            ),
            const _LiveAiBadge(),
          ],
        ),
      ),
    );
  }
}

class _KfcMark extends StatelessWidget {
  const _KfcMark();

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(color: _kfcRed),
    child: const SizedBox(
      width: 48,
      height: 48,
      child: Center(
        child: Text(
          'KFC',
          style: TextStyle(
            color: Color(0xFFFFFFFF),
            fontWeight: FontWeight.w900,
            fontSize: 14,
          ),
        ),
      ),
    ),
  );
}

class _LiveAiBadge extends StatelessWidget {
  const _LiveAiBadge();

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Real AI replay available',
    child: DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xFFFFF1F2),
        border: Border.all(color: const Color(0xFFE7A7B1)),
        borderRadius: BorderRadius.circular(999),
      ),
      child: const Padding(
        padding: EdgeInsets.symmetric(horizontal: 11, vertical: 7),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(color: _kfcRed, shape: BoxShape.circle),
              child: SizedBox.square(dimension: 7),
            ),
            SizedBox(width: 7),
            Text(
              'REAL AI',
              style: TextStyle(
                color: _kfcRed,
                fontSize: 11,
                fontWeight: FontWeight.w800,
                letterSpacing: .7,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _ShowcaseWorkspace extends StatelessWidget {
  const _ShowcaseWorkspace({
    required this.catalog,
    required this.scenario,
    required this.mode,
    required this.attempt,
    required this.showLastComplete,
    required this.replaying,
    required this.onSelectScenario,
    required this.onSelectMode,
    required this.onToggleLastComplete,
    required this.onReplay,
  });

  final ShowcaseCatalog catalog;
  final ShowcaseScenario scenario;
  final ShowcaseMode mode;
  final ShowcaseAttempt? attempt;
  final bool showLastComplete;
  final bool replaying;
  final ValueChanged<String> onSelectScenario;
  final ValueChanged<ShowcaseMode> onSelectMode;
  final VoidCallback onToggleLastComplete;
  final VoidCallback onReplay;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final desktop = constraints.maxWidth >= 980;
        final rail = _ScenarioRail(
          scenarios: catalog.scenarios,
          selectedId: scenario.id,
          horizontal: !desktop,
          onSelect: onSelectScenario,
        );
        final content = _ScenarioContent(
          scenario: scenario,
          mode: mode,
          attempt: attempt,
          showLastComplete: showLastComplete,
          replaying: replaying,
          onSelectMode: onSelectMode,
          onToggleLastComplete: onToggleLastComplete,
          onReplay: onReplay,
        );
        if (!desktop) {
          return Column(
            children: [
              SizedBox(height: 118, child: rail),
              Expanded(child: content),
            ],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(width: 278, child: rail),
            Expanded(child: content),
          ],
        );
      },
    );
  }
}

class _ScenarioRail extends StatelessWidget {
  const _ScenarioRail({
    required this.scenarios,
    required this.selectedId,
    required this.horizontal,
    required this.onSelect,
  });

  final List<ShowcaseScenario> scenarios;
  final String selectedId;
  final bool horizontal;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Color(0xFFECE4D8),
        border: Border(
          right: BorderSide(color: _rule),
          bottom: BorderSide(color: _rule),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!horizontal) ...[
              const Text(
                'SCENARIO BOARD',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.2,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '${scenarios.length} accepted recipes',
                style: const TextStyle(color: _mutedInk, fontSize: 12),
              ),
              const SizedBox(height: 14),
            ],
            Expanded(
              child: ListView.separated(
                scrollDirection: horizontal ? Axis.horizontal : Axis.vertical,
                itemCount: scenarios.length,
                separatorBuilder: (_, _) => SizedBox(
                  width: horizontal ? 8 : 0,
                  height: horizontal ? 0 : 8,
                ),
                itemBuilder: (context, index) {
                  final value = scenarios[index];
                  return SizedBox(
                    width: horizontal ? 230 : null,
                    child: _ScenarioTicket(
                      index: index,
                      scenario: value,
                      selected: value.id == selectedId,
                      onTap: () => onSelect(value.id),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ScenarioTicket extends StatelessWidget {
  const _ScenarioTicket({
    required this.index,
    required this.scenario,
    required this.selected,
    required this.onTap,
  });

  final int index;
  final ShowcaseScenario scenario;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    selected: selected,
    label: 'Scenario ${index + 1}: ${scenario.title}',
    child: GestureDetector(
      onTap: onTap,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: selected ? _paperRaised : const Color(0xFFF3ECE2),
          border: Border.all(
            color: selected ? _kfcRed : _rule,
            width: selected ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(3),
          boxShadow: selected
              ? const [
                  BoxShadow(
                    color: Color(0x1A4C241D),
                    offset: Offset(2, 3),
                    blurRadius: 0,
                  ),
                ]
              : null,
        ),
        child: Padding(
          padding: const EdgeInsets.all(11),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${index + 1}'.padLeft(2, '0'),
                style: TextStyle(
                  color: selected ? _kfcRed : _mutedInk,
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      scenario.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        height: 1.25,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      '${scenario.turns.length} fixed turns',
                      style: const TextStyle(color: _mutedInk, fontSize: 11),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _ScenarioContent extends StatelessWidget {
  const _ScenarioContent({
    required this.scenario,
    required this.mode,
    required this.attempt,
    required this.showLastComplete,
    required this.replaying,
    required this.onSelectMode,
    required this.onToggleLastComplete,
    required this.onReplay,
  });

  final ShowcaseScenario scenario;
  final ShowcaseMode mode;
  final ShowcaseAttempt? attempt;
  final bool showLastComplete;
  final bool replaying;
  final ValueChanged<ShowcaseMode> onSelectMode;
  final VoidCallback onToggleLastComplete;
  final VoidCallback onReplay;

  @override
  Widget build(BuildContext context) {
    final retained = scenario.results[mode];
    final ShowcaseAttempt? matchingAttempt =
        attempt?.scenarioId == scenario.id && attempt?.mode == mode
        ? attempt
        : null;
    final showingAttempt = matchingAttempt != null && !showLastComplete;
    final replayError = showingAttempt ? matchingAttempt.error : null;
    final transcript = showingAttempt
        ? matchingAttempt.messages
        : retained?.transcript ?? const [];

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1120),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                alignment: WrapAlignment.spaceBetween,
                crossAxisAlignment: WrapCrossAlignment.end,
                spacing: 24,
                runSpacing: 16,
                children: [
                  SizedBox(
                    width: 620,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          scenario.title,
                          style: const TextStyle(
                            fontSize: 30,
                            fontWeight: FontWeight.w900,
                            height: 1.08,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          scenario.goal,
                          style: const TextStyle(
                            color: _mutedInk,
                            fontSize: 14,
                          ),
                        ),
                      ],
                    ),
                  ),
                  _ReplayControls(
                    mode: mode,
                    replaying: replaying,
                    onSelectMode: onSelectMode,
                    onReplay: onReplay,
                  ),
                ],
              ),
              const SizedBox(height: 22),
              if (matchingAttempt != null && retained != null) ...[
                _ViewSwitch(
                  showingLastComplete: showLastComplete,
                  onToggle: onToggleLastComplete,
                ),
                const SizedBox(height: 12),
              ],
              if (replayError case final error?) ...[
                _ReplayError(error: error),
                const SizedBox(height: 12),
              ],
              LayoutBuilder(
                builder: (context, constraints) {
                  final wide = constraints.maxWidth >= 850;
                  final chat = _TranscriptCard(
                    entries: transcript,
                    activeDraft: showingAttempt ? matchingAttempt.draft : null,
                    mode: mode,
                    isLiveAttempt: showingAttempt,
                    hasRetainedResult: retained != null,
                  );
                  final criteria = _CriteriaCard(scenario: scenario);
                  if (!wide) {
                    return Column(
                      children: [chat, const SizedBox(height: 16), criteria],
                    );
                  }
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(flex: 7, child: chat),
                      const SizedBox(width: 16),
                      Expanded(flex: 3, child: criteria),
                    ],
                  );
                },
              ),
              if (!showingAttempt && retained != null) ...[
                const SizedBox(height: 14),
                _EvidenceStrip(result: retained),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ReplayControls extends StatelessWidget {
  const _ReplayControls({
    required this.mode,
    required this.replaying,
    required this.onSelectMode,
    required this.onReplay,
  });
  final ShowcaseMode mode;
  final bool replaying;
  final ValueChanged<ShowcaseMode> onSelectMode;
  final VoidCallback onReplay;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.end,
    children: [
      DecoratedBox(
        decoration: BoxDecoration(
          color: const Color(0xFFE9E0D4),
          borderRadius: BorderRadius.circular(4),
        ),
        child: Padding(
          padding: const EdgeInsets.all(3),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final value in ShowcaseMode.values)
                _ModeTab(
                  value: value,
                  selected: value == mode,
                  onTap: () => onSelectMode(value),
                ),
            ],
          ),
        ),
      ),
      const SizedBox(height: 9),
      Semantics(
        button: true,
        label: replaying
            ? 'Replay in progress'
            : 'Replay scenario with real AI',
        child: ShadButton(
          onPressed: replaying ? null : onReplay,
          leading: replaying
              ? const SizedBox.square(
                  dimension: 15,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Color(0xFFFFFFFF),
                  ),
                )
              : const Icon(LucideIcons.refreshCw, size: 16),
          child: Text(
            replaying ? 'Replaying fixed turns…' : 'Replay with real AI',
          ),
        ),
      ),
    ],
  );
}

class _ModeTab extends StatelessWidget {
  const _ModeTab({
    required this.value,
    required this.selected,
    required this.onTap,
  });
  final ShowcaseMode value;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap,
    child: Semantics(
      button: true,
      selected: selected,
      label: '${value.label} mode',
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: selected ? _paperRaised : const Color(0x00000000),
          borderRadius: BorderRadius.circular(3),
          boxShadow: selected
              ? const [BoxShadow(color: Color(0x18000000), blurRadius: 3)]
              : null,
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
          child: Text(
            value.label,
            style: TextStyle(
              color: selected ? _ink : _mutedInk,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ),
    ),
  );
}

class _ViewSwitch extends StatelessWidget {
  const _ViewSwitch({
    required this.showingLastComplete,
    required this.onToggle,
  });
  final bool showingLastComplete;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(
        showingLastComplete ? LucideIcons.archive : LucideIcons.radio,
        size: 14,
        color: _kfcRed,
      ),
      const SizedBox(width: 7),
      Text(
        showingLastComplete
            ? 'Showing last complete result'
            : 'Showing live replay',
        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
      ),
      const Spacer(),
      ShadButton.outline(
        size: ShadButtonSize.sm,
        onPressed: onToggle,
        child: Text(
          showingLastComplete ? 'Return to live replay' : 'View last complete',
        ),
      ),
    ],
  );
}
