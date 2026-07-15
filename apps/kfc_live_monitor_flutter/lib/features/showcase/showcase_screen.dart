import 'dart:async';

import 'package:flutter/material.dart' show CircularProgressIndicator, Divider;
import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:state_beacon/state_beacon.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme/kfc_ops_tokens.dart';
import '../customer_chat/application/mutation_beacon.dart';
import '../customer_chat/domain/customer_run_models.dart';
import '../customer_chat/presentation/genui/kfc_genui_renderer.dart';
import 'showcase_controller.dart';
import 'showcase_models.dart';

const _paper = Color(0xFFF4EFE5);
const _paperRaised = Color(0xFFFFFCF6);
const _ink = Color(0xFF211D19);
const _mutedInk = Color(0xFF71685F);
const _rule = Color(0xFFD9CFC1);
const _kfcRed = Color(0xFFC8102E);

class ShowcaseScreen extends StatelessWidget {
  const ShowcaseScreen({super.key, required this.controller});

  final ShowcaseController controller;

  @override
  Widget build(BuildContext context) {
    final catalogState = controller.catalog.watch(context);
    final catalog = catalogState.lastData;
    final selectedScenario = controller.selectedScenario.watch(context);
    final selectedMode = controller.selectedMode.watch(context);
    final attempt = controller.activeAttempt.watch(context);
    final showLastComplete = controller.showLastComplete.watch(context);
    final replayState = controller.replay.watch(context);

    return DefaultTextStyle(
      style: const TextStyle(
        fontFamily: KfcOpsTokens.fontFamily,
        color: _ink,
        fontSize: 14,
        height: 1.45,
      ),
      child: ColoredBox(
        color: _paper,
        child: SafeArea(
          child: Column(
            children: [
              const _KitchenHeader(),
              Expanded(
                child: switch ((catalog, selectedScenario)) {
                  (null, _) when catalogState.isLoading =>
                    const _LoadingState(),
                  (null, _) when catalogState.isError => _LoadError(
                    onRetry: controller.catalog.reset,
                  ),
                  (final ShowcaseCatalog value, null)
                      when value.scenarios.isEmpty =>
                    const _EmptyState(),
                  (
                    final ShowcaseCatalog value,
                    final ShowcaseScenario scenario,
                  ) =>
                    _ShowcaseWorkspace(
                      catalog: value,
                      scenario: scenario,
                      mode: selectedMode,
                      attempt: attempt,
                      showLastComplete: showLastComplete,
                      replaying: replayState.isLoading,
                      onSelectScenario: controller.selectScenario,
                      onSelectMode: controller.selectMode,
                      onToggleLastComplete: controller.toggleLastComplete,
                      onReplay: () => unawaited(
                        controller.replay.run(
                          ShowcaseReplayRequest(scenario, selectedMode),
                        ),
                      ),
                    ),
                  _ => const _EmptyState(),
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

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

class _TranscriptCard extends StatelessWidget {
  const _TranscriptCard({
    required this.entries,
    required this.activeDraft,
    required this.mode,
    required this.isLiveAttempt,
    required this.hasRetainedResult,
  });
  final List<ShowcaseTranscriptEntry> entries;
  final ActiveAssistantDraft? activeDraft;
  final ShowcaseMode mode;
  final bool isLiveAttempt;
  final bool hasRetainedResult;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: _paperRaised,
      border: Border.all(color: _rule),
      borderRadius: BorderRadius.circular(4),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DecoratedBox(
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: _rule)),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                const Text(
                  'CONVERSATION',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.1,
                  ),
                ),
                const Spacer(),
                Text(
                  mode.label,
                  style: const TextStyle(
                    color: _mutedInk,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ),
        if (entries.isEmpty && activeDraft == null)
          Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              children: [
                const Icon(LucideIcons.receiptText, color: _mutedInk, size: 30),
                const SizedBox(height: 10),
                Text(
                  hasRetainedResult
                      ? 'Select the saved result or start a new replay.'
                      : 'No complete result yet. Replay this recipe to create one.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: _mutedInk),
                ),
              ],
            ),
          )
        else
          Semantics(
            liveRegion: isLiveAttempt,
            label: isLiveAttempt
                ? 'Live replay transcript'
                : 'Saved replay transcript',
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final entry in entries) _TranscriptMessage(entry: entry),
                  if (activeDraft != null)
                    _TranscriptMessage(
                      entry: ShowcaseTranscriptEntry(
                        role: 'assistant',
                        text: activeDraft!.text,
                        genUi: activeDraft!.genUi,
                      ),
                      streaming: true,
                    ),
                ],
              ),
            ),
          ),
      ],
    ),
  );
}

class _TranscriptMessage extends StatelessWidget {
  const _TranscriptMessage({required this.entry, this.streaming = false});
  final ShowcaseTranscriptEntry entry;
  final bool streaming;

  @override
  Widget build(BuildContext context) {
    final user = entry.role == 'user';
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Align(
        alignment: user ? Alignment.centerRight : Alignment.centerLeft,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 620),
          child: Column(
            crossAxisAlignment: user
                ? CrossAxisAlignment.end
                : CrossAxisAlignment.start,
            children: [
              Text(
                user
                    ? 'FIXED USER TURN'
                    : streaming
                    ? 'AI · RESPONDING'
                    : 'AI RESPONSE',
                style: TextStyle(
                  color: user ? _kfcRed : _mutedInk,
                  fontSize: 9,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .9,
                ),
              ),
              const SizedBox(height: 5),
              if (entry.text.isNotEmpty)
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: user
                        ? const Color(0xFFFFE9EC)
                        : const Color(0xFFF1EBE2),
                    border: Border.all(
                      color: user ? const Color(0xFFEAB3BC) : _rule,
                    ),
                    borderRadius: BorderRadius.circular(5),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 13,
                      vertical: 10,
                    ),
                    child: Text(entry.text),
                  ),
                ),
              if (entry.genUi case final attachment?) ...[
                if (entry.text.isNotEmpty) const SizedBox(height: 8),
                IgnorePointer(
                  child: KfcGenUiRenderer(
                    attachment: attachment,
                    onAction: (_) {},
                  ),
                ),
              ],
              if (streaming) ...[
                const SizedBox(height: 6),
                const Text(
                  'Waiting for this turn to complete…',
                  style: TextStyle(color: _mutedInk, fontSize: 11),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _CriteriaCard extends StatelessWidget {
  const _CriteriaCard({required this.scenario});
  final ShowcaseScenario scenario;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: const Color(0xFFFFF8E9),
      border: Border.all(color: const Color(0xFFD8C5A1)),
      borderRadius: BorderRadius.circular(4),
    ),
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(LucideIcons.clipboardCheck, size: 16, color: _kfcRed),
              SizedBox(width: 8),
              Expanded(
                child: Text(
                  'ACCEPTANCE CARD',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          for (final (index, criterion) in scenario.acceptanceCriteria.indexed)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${index + 1}.',
                    style: const TextStyle(
                      color: _kfcRed,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      criterion,
                      style: const TextStyle(fontSize: 12, height: 1.4),
                    ),
                  ),
                ],
              ),
            ),
          if (scenario.useCases.isNotEmpty) ...[
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 4),
              child: Divider(color: _rule, height: 1),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final useCase in scenario.useCases)
                  _UseCaseChip(label: useCase),
              ],
            ),
          ],
          const SizedBox(height: 12),
          const Text(
            'Curated in LangSmith · read-only here',
            style: TextStyle(color: _mutedInk, fontSize: 10),
          ),
        ],
      ),
    ),
  );
}

class _UseCaseChip extends StatelessWidget {
  const _UseCaseChip({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: const Color(0xFFF2E5CA),
      borderRadius: BorderRadius.circular(999),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Text(
        label,
        style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w700),
      ),
    ),
  );
}

class _EvidenceStrip extends StatelessWidget {
  const _EvidenceStrip({required this.result});
  final ShowcaseResult result;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: const Color(0xFFEAE3D8),
      border: Border.all(color: _rule),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Wrap(
        spacing: 18,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          const Text(
            'PROVENANCE',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w900,
              letterSpacing: .9,
            ),
          ),
          _EvidenceItem(
            icon: LucideIcons.clock3,
            label: _formatTimestamp(result.generatedAt),
          ),
          _EvidenceItem(
            icon: LucideIcons.panelsTopLeft,
            label: result.mode.label,
          ),
          _EvidenceItem(
            icon: LucideIcons.gitCommitHorizontal,
            label: _shortSha(result.releaseSha),
          ),
          _EvidenceItem(
            icon: LucideIcons.brainCircuit,
            label: '${result.plannerModel} / ${result.responseModel}',
          ),
          if (result.langsmithTraceUrl case final trace?)
            ShadButton.link(
              size: ShadButtonSize.sm,
              onPressed: () => unawaited(launchUrl(Uri.parse(trace))),
              trailing: const Icon(LucideIcons.externalLink, size: 13),
              child: const Text('LangSmith trace'),
            ),
        ],
      ),
    ),
  );
}

class _EvidenceItem extends StatelessWidget {
  const _EvidenceItem({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 13, color: _mutedInk),
      const SizedBox(width: 5),
      Text(
        label,
        style: const TextStyle(
          color: _mutedInk,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    ],
  );
}

class _ReplayError extends StatelessWidget {
  const _ReplayError({required this.error});
  final String error;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: const Color(0xFFFFE7E8),
      border: Border.all(color: const Color(0xFFDC8D99)),
    ),
    child: Padding(
      padding: const EdgeInsets.all(12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(LucideIcons.triangleAlert, size: 17, color: _kfcRed),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              'Live replay stopped: $error\nThe last complete result is still preserved.',
              style: const TextStyle(fontSize: 12),
            ),
          ),
        ],
      ),
    ),
  );
}

class _LoadingState extends StatelessWidget {
  const _LoadingState();
  @override
  Widget build(BuildContext context) => const Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        CircularProgressIndicator(color: _kfcRed),
        SizedBox(height: 14),
        Text('Opening the scenario board…', style: TextStyle(color: _mutedInk)),
      ],
    ),
  );
}

class _LoadError extends StatelessWidget {
  const _LoadError({required this.onRetry});
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(LucideIcons.cloudOff, size: 36, color: _kfcRed),
        const SizedBox(height: 12),
        const Text(
          'The scenario board could not be loaded.',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        ShadButton.outline(onPressed: onRetry, child: const Text('Try again')),
      ],
    ),
  );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();
  @override
  Widget build(BuildContext context) => const Center(
    child: Text(
      'No accepted showcase scenarios are available yet.',
      style: TextStyle(color: _mutedInk),
    ),
  );
}

String _shortSha(String value) =>
    value.length <= 8 ? value : value.substring(0, 8);

String _formatTimestamp(DateTime value) {
  final local = value.toLocal();
  String two(int number) => number.toString().padLeft(2, '0');
  return '${local.year}-${two(local.month)}-${two(local.day)} ${two(local.hour)}:${two(local.minute)}';
}
