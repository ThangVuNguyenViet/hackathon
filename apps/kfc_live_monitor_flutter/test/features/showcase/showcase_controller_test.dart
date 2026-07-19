import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kfc_live_monitor/features/showcase/showcase_controller.dart';
import 'package:kfc_live_monitor/features/showcase/showcase_models.dart';
import 'package:kfc_live_monitor/features/showcase/showcase_repository.dart';

void main() {
  test(
    'replay sends fixed turns sequentially and completes one result',
    () async {
      final startedBodies = <Map<String, Object?>>[];
      final requestedRuns = <String>[];
      var completed = false;
      var runNumber = 0;
      final client = MockClient((request) async {
        if (request.method == 'GET' &&
            request.url.path == '/showcase/scenarios') {
          return http.Response(jsonEncode(_catalogJson), 200);
        }
        if (request.method == 'POST' && request.url.path == '/chat/kfc/runs') {
          final body = jsonDecode(request.body) as Map<String, Object?>;
          startedBodies.add(body);
          runNumber += 1;
          return http.Response(
            jsonEncode({
              'schemaVersion': 1,
              'runId': 'run_$runNumber',
              'status': 'accepted',
              'nextSequence': 1,
              'replayed': false,
            }),
            202,
          );
        }
        if (request.method == 'GET' && request.url.path.endsWith('/events')) {
          final runId = request.url.pathSegments[3];
          requestedRuns.add(runId);
          final answer = runId == 'run_1'
              ? 'First real answer'
              : 'Second real answer';
          return http.Response(
            _eventStream(runId, answer),
            200,
            headers: {'content-type': 'text/event-stream; charset=utf-8'},
          );
        }
        if (request.method == 'POST' &&
            request.url.path == '/showcase/results') {
          completed = true;
          return http.Response(jsonEncode(_resultJson), 201);
        }
        return http.Response('not found', 404);
      });
      final controller = ShowcaseController(
        ShowcaseRepository(baseUrl: 'http://showcase.test', client: client),
      );
      addTearDown(controller.dispose);

      final catalog = await controller.catalog.toFuture();
      final result = await controller.replay.run(
        ShowcaseReplayRequest(catalog.scenarios.single, ShowcaseMode.text),
      );

      expect(requestedRuns, ['run_1', 'run_2']);
      expect(
        startedBodies.map(
          (body) => (body['input'] as Map<String, Object?>)['text'],
        ),
        ['Show me a meal', 'Add fries'],
      );
      for (final body in startedBodies) {
        expect(body['metadata'], {
          'showcaseScenarioId': 'meal-builder',
          'showcaseResponseMode': 'text',
        });
      }
      expect(completed, isTrue);
      expect(result.sessionId, startsWith('kfc:showcase_meal_builder_text_'));
      expect(
        controller.activeAttempt.value!.messages.map((entry) => entry.text),
        [
          'Show me a meal',
          'First real answer',
          'Add fries',
          'Second real answer',
        ],
      );
    },
  );
}

const _catalogJson = {
  'scenarios': [
    {
      'id': 'meal-builder',
      'title': 'Build a meal',
      'goal': 'Prove a multi-turn order flow.',
      'useCases': ['menu', 'cart'],
      'acceptanceCriteria': ['Uses the sandbox catalog', 'Keeps turn context'],
      'turns': [
        {
          'index': 0,
          'text': 'Show me a meal',
          'useCases': ['menu'],
        },
        {
          'index': 1,
          'text': 'Add fries',
          'useCases': ['cart'],
        },
      ],
      'results': <String, Object?>{},
    },
  ],
};

final _resultJson = {
  'scenarioId': 'meal-builder',
  'mode': 'text',
  'sessionId': 'kfc:showcase_meal_builder_text_saved',
  'generatedAt': '2026-07-15T04:00:00.000Z',
  'releaseSha': '1234567890abcdef',
  'agent': {
    'provider': 'google',
    'model': 'gemini-3.1-flash-lite',
    'profile': 'google-gemini-3.1-flash-lite-thinking-low',
  },
  'langsmithTraceUrl': 'https://smith.langchain.com/o/example',
  'transcript': [
    {'role': 'user', 'text': 'Show me a meal'},
    {'role': 'assistant', 'text': 'First real answer'},
    {'role': 'user', 'text': 'Add fries'},
    {'role': 'assistant', 'text': 'Second real answer'},
  ],
};

String _eventStream(String runId, String answer) {
  Map<String, Object?> event(
    int sequence,
    String type,
    Map<String, Object?> payload,
  ) => {
    'schemaVersion': 1,
    'eventId': '${runId}_$sequence',
    'runId': runId,
    'sequence': sequence,
    'type': type,
    'occurredAt': '2026-07-15T04:00:00.000Z',
    'payload': payload,
  };
  return [
    event(1, 'text_delta', {'delta': answer}),
    event(2, 'run_completed', {'responseText': answer}),
  ].map((value) => 'data: ${jsonEncode(value)}\n\n').join();
}
