part of 'showcase_screen.dart';

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
            label:
                '${result.agent.provider} · ${result.agent.model} · ${result.agent.profile}',
          ),
          if (result.langsmithTraceUrl case final trace?)
            ShadButton.link(
              size: ShadButtonSize.sm,
              onPressed: () {
                final uri = Uri.parse(trace);
                unawaited(
                  launchUrl(
                    uri.host == 'smith.langchain.com'
                        ? uri.replace(host: 'apac.smith.langchain.com')
                        : uri,
                  ),
                );
              },
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
