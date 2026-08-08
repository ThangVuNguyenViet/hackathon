import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:kfc_live_monitor/features/automatic_recommendations/application/automatic_recommendation_kiosk_controller.dart';
import 'package:kfc_live_monitor/features/automatic_recommendations/data/automatic_recommendation_client.dart';
import 'package:kfc_live_monitor/features/automatic_recommendations/domain/automatic_recommendation_contract.dart';

void main() {
  Map<String, dynamic> request = {};
  Map<String, dynamic> response = {};
  Map<String, dynamic> inspection = {};

  setUpAll(() {
    final root = Directory.current.parent.parent.uri.resolve(
      'contracts/automatic-recommendations/v1/examples/',
    );
    Map<String, dynamic> load(String file) =>
        jsonDecode(File.fromUri(root.resolve(file)).readAsStringSync())
            as Map<String, dynamic>;
    request = load('local-favorite-request.json');
    response = load('recommended-response.json')
      ..['requestId'] =
          'request-${DateTime.utc(2026, 8, 8).microsecondsSinceEpoch}'
      ..['expiresAt'] = '2099-01-01T00:00:00Z';
    inspection = load('inspection-response.json');
  });

  test(
    'load persists an impression and selection through the strict client',
    () async {
      final server = _KioskHttpClient(
        responses: {
          '/v1/recommendations/local-favorites': _jsonResponse(200, response),
          '/v1/recommendations/recommendation-local-001/impressions':
              _jsonResponse(204, null),
          '/v1/recommendations/recommendation-local-001/outcomes':
              _jsonResponse(204, null),
        },
      );
      final controller = AutomaticRecommendationKioskController(
        client: AutomaticRecommendationClient(
          baseUri: Uri.parse('https://backend.example/'),
          httpClient: server,
        ),
        context: _contextFromRequest(request),
        clock: () => DateTime.utc(2026, 8, 8),
      );

      await controller.load(AutomaticRecommendationType.localFavorite);
      expect(controller.state.value.status, KioskLoadStatus.recommended);
      expect(
        controller.state.value.evidenceMessage,
        'Impression persisted to the evidence ledger.',
      );

      await controller.selectAction(0);

      expect(controller.state.value.selectedActionId, 'product:20732');
      expect(server.requests.map((request) => request.url.path), <String>[
        '/v1/recommendations/local-favorites',
        '/v1/recommendations/recommendation-local-001/impressions',
        '/v1/recommendations/recommendation-local-001/outcomes',
      ]);
      controller.dispose();
    },
  );

  test(
    'action validation rejects an expired response before posting evidence',
    () async {
      final expired = Map<String, dynamic>.from(response)
        ..['expiresAt'] = '2020-01-01T00:00:00Z';
      final server = _KioskHttpClient(
        responses: {
          '/v1/recommendations/local-favorites': _jsonResponse(200, expired),
          '/v1/recommendations/recommendation-local-001/impressions':
              _jsonResponse(204, null),
        },
      );
      final controller = AutomaticRecommendationKioskController(
        client: AutomaticRecommendationClient(
          baseUri: Uri.parse('https://backend.example/'),
          httpClient: server,
        ),
        context: _contextFromRequest(request),
        clock: () => DateTime.utc(2026, 8, 8),
      );

      await controller.load(AutomaticRecommendationType.localFavorite);
      await expectLater(
        controller.selectAction(0),
        throwsA(isA<KioskActionException>()),
      );
      expect(server.requests.map((request) => request.url.path), <String>[
        '/v1/recommendations/local-favorites',
        '/v1/recommendations/recommendation-local-001/impressions',
      ]);
      controller.dispose();
    },
  );

  test(
    'inspection is explicitly requested and projected as evidence',
    () async {
      final server = _KioskHttpClient(
        responses: {
          '/v1/admin/recommendations/recommendation-local-001/inspection':
              _jsonResponse(200, inspection),
        },
      );
      final controller = AutomaticRecommendationKioskController(
        client: AutomaticRecommendationClient(
          baseUri: Uri.parse('https://backend.example/'),
          httpClient: server,
        ),
        context: _contextFromRequest(request),
      );
      controller.state.value = KioskState(
        status: KioskLoadStatus.recommended,
        selectedType: AutomaticRecommendationType.localFavorite,
        response: AutomaticRecommendationResponsePayload.parse(response),
      );

      await controller.inspectEvidence();

      expect(controller.state.value.inspection?.toJson(), inspection);
      expect(
        controller.state.value.evidenceMessage,
        'Durable decision evidence loaded.',
      );
      controller.dispose();
    },
  );

  test(
    'missing context is configuration error, never an implicit fixture',
    () async {
      final controller = AutomaticRecommendationKioskController(
        client: AutomaticRecommendationClient(
          baseUri: Uri.parse('https://backend.example/'),
          httpClient: _KioskHttpClient(responses: const {}),
        ),
      );

      await controller.load(AutomaticRecommendationType.localFavorite);

      expect(
        controller.state.value.status,
        KioskLoadStatus.configurationMissing,
      );
      expect(controller.state.value.response, isNull);
      controller.dispose();
    },
  );
}

RecommendationKioskContext _contextFromRequest(Map<String, dynamic> request) =>
    RecommendationKioskContext(
      storeId: request['storeId'] as String,
      fulfilmentMode: request['fulfilmentMode'] as String,
      locale: request['locale'] as String,
      orderingJourneyRef: request['orderingJourneyRef'] as String,
      opportunityRef: request['opportunityRef'] as String,
      cart: Map<String, dynamic>.from(request['cart'] as Map),
    );

class _KioskHttpClient extends http.BaseClient {
  _KioskHttpClient({required this.responses});

  final Map<String, http.Response> responses;
  final requests = <http.BaseRequest>[];

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requests.add(request);
    final response = responses[request.url.path];
    if (response == null) {
      return http.StreamedResponse(const Stream.empty(), 404, request: request);
    }
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
