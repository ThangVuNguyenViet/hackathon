import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kfc_live_monitor/app/theme/kfc_ops_theme.dart';
import 'package:kfc_live_monitor/features/showcase/showcase_controller.dart';
import 'package:kfc_live_monitor/features/showcase/showcase_repository.dart';
import 'package:kfc_live_monitor/features/showcase/showcase_screen.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

void main() {
  testWidgets('renders the retained real result and acceptance card', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1280, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = ShowcaseController(
      ShowcaseRepository(
        baseUrl: 'http://showcase.test',
        client: MockClient(
          (_) async => http.Response(jsonEncode(_catalogWithResult), 200),
        ),
      ),
    );
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      ShadApp(
        theme: buildKfcOpsTheme(),
        home: ShowcaseScreen(controller: controller),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('KFC TEST KITCHEN'), findsOneWidget);
    expect(find.text('Build a meal'), findsWidgets);
    expect(find.text('First real answer'), findsOneWidget);
    expect(find.text('ACCEPTANCE CARD'), findsOneWidget);
    expect(find.text('Replay with real AI'), findsOneWidget);
    expect(
      find.text(
        'google · gemini-3.1-flash-lite · google-gemini-3.1-flash-lite-thinking-low',
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}

const _catalogWithResult = {
  'scenarios': [
    {
      'id': 'meal-builder',
      'title': 'Build a meal',
      'goal': 'Prove a multi-turn order flow.',
      'useCases': ['menu', 'cart'],
      'acceptanceCriteria': ['Uses the sandbox catalog'],
      'turns': [
        {
          'index': 1,
          'text': 'Show me a meal',
          'useCases': ['menu'],
        },
      ],
      'results': {
        'genui': {
          'scenarioId': 'meal-builder',
          'mode': 'genui',
          'sessionId': 'kfc:showcase_saved',
          'generatedAt': '2026-07-15T04:00:00.000Z',
          'releaseSha': '1234567890abcdef',
          'agent': {
            'provider': 'google',
            'model': 'gemini-3.1-flash-lite',
            'profile': 'google-gemini-3.1-flash-lite-thinking-low',
          },
          'langsmithTraceUrl': null,
          'transcript': [
            {'role': 'user', 'text': 'Show me a meal'},
            {'role': 'assistant', 'text': 'First real answer'},
          ],
        },
      },
    },
  ],
};
