import 'dart:async';

import 'package:state_beacon/state_beacon.dart';

import '../customer_chat/domain/customer_run_models.dart';
import '../customer_chat/application/mutation_beacon.dart';
import 'showcase_models.dart';
import 'showcase_repository.dart';

class ShowcaseController extends BeaconController {
  ShowcaseController(this._repository);

  final ShowcaseRepository _repository;

  late final catalog = B.future(_loadCatalog);
  late final selectedScenarioId = B.writable<String?>(null);
  late final selectedMode = B.writable(ShowcaseMode.genui);
  late final activeAttempt = B.writable<ShowcaseAttempt?>(null);
  late final showLastComplete = B.writable(false);
  late final replay = B.mutation<ShowcaseResult, ShowcaseReplayRequest>(
    _replay,
  );

  late final selectedScenario = B.derived(() {
    final scenarios =
        catalog.value.lastData?.scenarios ?? const <ShowcaseScenario>[];
    if (scenarios.isEmpty) return null;
    final selectedId = selectedScenarioId.value;
    return scenarios.firstWhere(
      (scenario) => scenario.id == selectedId,
      orElse: () => scenarios.first,
    );
  });

  void selectScenario(String id) {
    selectedScenarioId.value = id;
    activeAttempt.value = null;
    showLastComplete.value = false;
  }

  void selectMode(ShowcaseMode mode) {
    selectedMode.value = mode;
    activeAttempt.value = null;
    showLastComplete.value = false;
  }

  void toggleLastComplete() {
    showLastComplete.value = !showLastComplete.value;
  }

  Future<ShowcaseCatalog> _loadCatalog() async {
    final value = await _repository.loadCatalog();
    selectedScenarioId.value ??= value.scenarios.isEmpty
        ? null
        : value.scenarios.first.id;
    return value;
  }

  Future<ShowcaseResult> _replay(ShowcaseReplayRequest request) async {
    final suffix = '${DateTime.now().microsecondsSinceEpoch}';
    final customerId =
        'showcase_${_safeId(request.scenario.id)}_${request.mode.value}_$suffix';
    final sessionId = 'kfc:$customerId';
    var attempt = ShowcaseAttempt(
      scenarioId: request.scenario.id,
      mode: request.mode,
      messages: const [],
    );
    activeAttempt.value = attempt;
    showLastComplete.value = false;
    try {
      for (final (index, turn) in request.scenario.turns.indexed) {
        attempt = attempt.copyWith(
          messages: [
            ...attempt.messages,
            ShowcaseTranscriptEntry(role: 'user', text: turn.text),
          ],
          clearDraft: true,
        );
        activeAttempt.value = attempt;
        final accepted = await _repository.startTurn(
          sessionId: sessionId,
          customerId: customerId,
          clientMessageId: '${customerId}_${index + 1}',
          text: turn.text,
          scenarioId: request.scenario.id,
          mode: request.mode,
        );
        var draft = ActiveAssistantDraft.accepted(runId: accepted.runId);
        attempt = attempt.copyWith(draft: draft);
        activeAttempt.value = attempt;
        for (
          var reconnect = 0;
          !draft.isTerminal && reconnect < 5;
          reconnect += 1
        ) {
          try {
            await for (final event in _repository.watchTurn(
              draft.runId,
              draft.lastSequence,
            )) {
              draft = draft.reduce(event);
              attempt = attempt.copyWith(draft: draft);
              activeAttempt.value = attempt;
            }
          } on Object {
            if (reconnect == 4) rethrow;
            await Future<void>.delayed(const Duration(milliseconds: 250));
          }
        }
        if (draft.terminal != CustomerRunTerminal.completed) {
          throw StateError(draft.terminalMessage ?? 'Replay turn failed');
        }
        attempt = attempt.copyWith(
          messages: [
            ...attempt.messages,
            ShowcaseTranscriptEntry(
              role: 'assistant',
              text: draft.text,
              genUi: draft.genUi,
            ),
          ],
          clearDraft: true,
        );
        activeAttempt.value = attempt;
      }
      final result = await _repository.complete(
        scenarioId: request.scenario.id,
        mode: request.mode,
        sessionId: sessionId,
      );
      catalog.reset();
      return result;
    } on Object catch (error) {
      activeAttempt.value = attempt.copyWith(
        clearDraft: true,
        error: error.toString(),
      );
      rethrow;
    }
  }
}

String _safeId(String value) {
  final sanitized = value
      .replaceAll(RegExp('[^a-zA-Z0-9]+'), '_')
      .replaceAll(RegExp('^_+|_+\$'), '');
  if (sanitized.isEmpty) return 'scenario';
  return sanitized.substring(0, sanitized.length.clamp(1, 48));
}
