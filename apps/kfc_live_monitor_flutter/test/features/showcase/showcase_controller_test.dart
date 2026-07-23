import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kfc_live_monitor/features/showcase/showcase_controller.dart';
import 'package:kfc_live_monitor/features/showcase/showcase_models.dart';
import 'package:kfc_live_monitor/features/showcase/showcase_repository.dart';

void main() {
  test('catalog is a read-only narrative and evidence surface', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      return http.Response(jsonEncode(_catalogJson), 200);
    });
    final controller = ShowcaseController(
      ShowcaseRepository(baseUrl: 'http://showcase.test', client: client),
    );
    addTearDown(controller.dispose);

    final catalog = await controller.catalog.toFuture();
    controller.selectMode(ShowcaseMode.text);

    expect(catalog.scenarios.single.preconditions, [
      'A fresh customer session',
    ]);
    expect(controller.selectedMode.value, ShowcaseMode.text);
    expect(requests, hasLength(1));
    expect(requests.single.method, 'GET');
    expect(requests.single.url.path, '/showcase/scenarios');
  });
}

const _catalogJson = {
  'scenarios': [
    {
      'id': 'meal-builder',
      'title': 'Build a meal',
      'goal': 'Explore a multi-turn order flow.',
      'preconditions': ['A fresh customer session'],
      'useCases': ['menu', 'cart'],
      'risks': ['May use an ungrounded catalog', 'May lose turn context'],
      'turns': [
        {
          'index': 1,
          'text': 'Show me a meal',
          'useCases': ['menu'],
        },
      ],
      'results': <String, Object?>{},
    },
  ],
};
