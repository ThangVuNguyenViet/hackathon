import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:kfc_live_monitor/features/automatic_recommendations/data/automatic_recommendation_client.dart';
import 'package:kfc_live_monitor/features/automatic_recommendations/domain/automatic_recommendation_contract.dart';

void main() {
  late Map<String, dynamic> request;
  late Map<String, dynamic> response;
  late Map<String, dynamic> impression;
  late Map<String, dynamic> outcome;
  late Map<String, dynamic> inspection;

  setUpAll(() {
    final root = Directory.current.parent.parent.uri.resolve(
      'contracts/automatic-recommendations/v1/examples/',
    );
    Map<String, dynamic> load(String file) =>
        jsonDecode(File.fromUri(root.resolve(file)).readAsStringSync())
            as Map<String, dynamic>;
    request = load('local-favorite-request.json');
    response = load('recommended-response.json');
    impression = load('impression-request.json');
    outcome = load('outcome-request.json');
    inspection = load('inspection-response.json');
  });

  test(
    'decide validates the request, endpoint, and response binding',
    () async {
      final server = _FakeHttpClient((recorded) {
        expect(recorded.method, 'POST');
        expect(recorded.url.path, '/v1/recommendations/local-favorites');
        expect(recorded.bodyJson, request);
        return _jsonResponse(200, response);
      });
      final client = AutomaticRecommendationClient(
        baseUri: Uri.parse('https://backend.example/'),
        httpClient: server,
      );

      final result = await client.decide(
        type: AutomaticRecommendationType.localFavorite,
        request: request,
      );

      expect(result.toJson(), response);
      expect(server.requests, hasLength(1));
    },
  );

  test('a 503 remains a typed retryable failure with no fallback', () async {
    final client = AutomaticRecommendationClient(
      baseUri: Uri.parse('https://backend.example/'),
      httpClient: _FakeHttpClient(
        (_) => _jsonResponse(503, {
          'type': 'https://kfc.example/problems/unavailable',
          'title': 'Recommendation infrastructure unavailable',
          'status': 503,
          'code': 'recommendation_infrastructure_unavailable',
          'retryable': true,
        }),
      ),
    );

    await expectLater(
      client.decide(
        type: AutomaticRecommendationType.localFavorite,
        request: request,
      ),
      throwsA(
        isA<AutomaticRecommendationHttpException>()
            .having((error) => error.statusCode, 'status', 503)
            .having((error) => error.retryable, 'retryable', true),
      ),
    );
  });

  test(
    'events validate before posting and use recommendation-specific paths',
    () async {
      final server = _FakeHttpClient((request) => _jsonResponse(204, null));
      final client = AutomaticRecommendationClient(
        baseUri: Uri.parse('https://backend.example/'),
        httpClient: server,
      );

      await client.recordImpression(
        recommendationId: 'recommendation-local-001',
        impression: impression,
      );
      await client.recordOutcome(
        recommendationId: 'recommendation-local-001',
        outcome: outcome,
      );

      expect(server.requests.map((request) => request.url.path), <String>[
        '/v1/recommendations/recommendation-local-001/impressions',
        '/v1/recommendations/recommendation-local-001/outcomes',
      ]);
    },
  );

  test('inspection is parsed as evidence, not recommendation data', () async {
    final client = AutomaticRecommendationClient(
      baseUri: Uri.parse('https://backend.example/'),
      httpClient: _FakeHttpClient((request) {
        expect(request.method, 'GET');
        expect(request.url.queryParameters['limit'], '5');
        return _jsonResponse(200, inspection);
      }),
    );

    final result = await client.inspect(
      recommendationId: 'recommendation-local-001',
      limit: 5,
    );

    expect(result.toJson(), inspection);
  });

  test('binding mismatch is rejected before the kiosk can render it', () async {
    final invalid = Map<String, dynamic>.from(response)
      ..['requestId'] = 'request-other';
    final client = AutomaticRecommendationClient(
      baseUri: Uri.parse('https://backend.example/'),
      httpClient: _FakeHttpClient((_) => _jsonResponse(200, invalid)),
    );

    await expectLater(
      client.decide(
        type: AutomaticRecommendationType.localFavorite,
        request: request,
      ),
      throwsA(isA<AutomaticRecommendationContractException>()),
    );
  });
}

class _RecordedRequest {
  _RecordedRequest(this.method, this.url, this.body);

  final String method;
  final Uri url;
  final String body;

  Object? get bodyJson => jsonDecode(body);
}

class _FakeHttpClient extends http.BaseClient {
  _FakeHttpClient(this.handler);

  final http.Response Function(_RecordedRequest request) handler;
  final requests = <_RecordedRequest>[];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final body = utf8.decode(
      request is http.Request ? request.bodyBytes : const [],
    );
    final recorded = _RecordedRequest(request.method, request.url, body);
    requests.add(recorded);
    final response = handler(recorded);
    return http.StreamedResponse(
      Stream.value(utf8.encode(response.body)),
      response.statusCode,
      headers: response.headers,
      request: request,
    );
  }
}

http.Response _jsonResponse(int status, Object? value) => http.Response(
  value == null ? '' : jsonEncode(value),
  status,
  headers: const {'content-type': 'application/json'},
);
