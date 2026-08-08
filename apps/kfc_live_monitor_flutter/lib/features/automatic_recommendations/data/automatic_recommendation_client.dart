import 'dart:convert';

import 'package:http/http.dart' as http;

import '../domain/automatic_recommendation_contract.dart';

typedef AutomaticRecommendationClock = DateTime Function();

class AutomaticRecommendationHttpException implements Exception {
  const AutomaticRecommendationHttpException({
    required this.statusCode,
    required this.code,
    required this.message,
    required this.retryable,
  });

  final int statusCode;
  final String code;
  final String message;
  final bool retryable;

  @override
  String toString() =>
      'AutomaticRecommendationHttpException($statusCode, $code): $message';
}

class AutomaticRecommendationTransportException implements Exception {
  const AutomaticRecommendationTransportException(this.message, [this.cause]);

  final String message;
  final Object? cause;

  @override
  String toString() => 'AutomaticRecommendationTransportException: $message';
}

/// The only Flutter boundary for automatic recommendations.
///
/// Requests, responses, and evidence events are validated against the shared
/// Dart contract before they cross the network. There is deliberately no
/// fixture, cached, or alternate recommender path in this client.
class AutomaticRecommendationClient {
  AutomaticRecommendationClient({
    required Uri baseUri,
    http.Client? httpClient,
    AutomaticRecommendationClock? clock,
  }) : _baseUri = baseUri,
       _httpClient = httpClient ?? http.Client(),
       _clock = clock ?? DateTime.now;

  final Uri _baseUri;
  final http.Client _httpClient;
  final AutomaticRecommendationClock _clock;

  Future<AutomaticRecommendationResponsePayload> decide({
    required AutomaticRecommendationType type,
    required Object request,
  }) async {
    final parsedRequest = AutomaticRecommendationRequestPayload.parse(
      type,
      request,
    );
    final body = await _sendJson(
      method: 'POST',
      uri: _baseUri.resolve(automaticRecommendationOperationPaths[type]!),
      body: parsedRequest.toJson(),
      expectedStatusCodes: const {200},
    );
    final response = AutomaticRecommendationResponsePayload.parse(body);
    return validateAutomaticRecommendationBinding(
      type,
      parsedRequest.toJson(),
      response.toJson(),
    );
  }

  Future<void> recordImpression({
    required String recommendationId,
    required Object impression,
  }) async {
    final parsed = AutomaticRecommendationImpressionPayload.parse(impression);
    await _sendJson(
      method: 'POST',
      uri: _eventUri(recommendationId, 'impressions'),
      body: parsed.toJson(),
      expectedStatusCodes: const {204},
    );
  }

  Future<void> recordOutcome({
    required String recommendationId,
    required Object outcome,
  }) async {
    final parsed = AutomaticRecommendationOutcomePayload.parse(outcome);
    await _sendJson(
      method: 'POST',
      uri: _eventUri(recommendationId, 'outcomes'),
      body: parsed.toJson(),
      expectedStatusCodes: const {204},
    );
  }

  Future<AutomaticRecommendationInspectionPayload> inspect({
    required String recommendationId,
    int limit = 25,
    String? cursor,
  }) async {
    if (limit < 1 || limit > 100) {
      throw ArgumentError.value(limit, 'limit', 'must be between 1 and 100');
    }
    final query = <String, String>{'limit': '$limit'};
    if (cursor != null) query['cursor'] = cursor;
    final uri = _baseUri
        .resolve('/v1/admin/recommendations/$recommendationId/inspection')
        .replace(queryParameters: query);
    final body = await _sendJson(
      method: 'GET',
      uri: uri,
      expectedStatusCodes: const {200},
    );
    return AutomaticRecommendationInspectionPayload.parse(body);
  }

  Future<Map<String, dynamic>> readiness() async {
    final body = await _sendJson(
      method: 'GET',
      uri: _baseUri.resolve('/ready'),
      expectedStatusCodes: const {200, 503},
      allowExpectedErrorStatus: true,
    );
    return Map<String, dynamic>.from(body as Map);
  }

  Future<void> close() async {
    _httpClient.close();
  }

  Uri _eventUri(String recommendationId, String suffix) {
    final encodedId = Uri.encodeComponent(recommendationId);
    return _baseUri.resolve('/v1/recommendations/$encodedId/$suffix');
  }

  Future<Object?> _sendJson({
    required String method,
    required Uri uri,
    Object? body,
    required Set<int> expectedStatusCodes,
    bool allowExpectedErrorStatus = false,
  }) async {
    late final http.Response response;
    try {
      response = switch (method) {
        'GET' => await _httpClient.get(uri, headers: _headers),
        'POST' => await _httpClient.post(
          uri,
          headers: _headers,
          body: jsonEncode(body),
        ),
        _ => throw ArgumentError.value(method, 'method'),
      };
    } on AutomaticRecommendationTransportException {
      rethrow;
    } on Object catch (error) {
      throw AutomaticRecommendationTransportException(
        'automatic recommendation request failed',
        error,
      );
    }

    final decoded = _decodeBody(response);
    if (!expectedStatusCodes.contains(response.statusCode) &&
        !(allowExpectedErrorStatus &&
            expectedStatusCodes.contains(response.statusCode))) {
      throw _httpException(response.statusCode, decoded);
    }
    if (response.statusCode == 204) return null;
    return decoded;
  }

  Object? _decodeBody(http.Response response) {
    if (response.body.trim().isEmpty) return null;
    try {
      return jsonDecode(response.body);
    } on Object catch (error) {
      throw AutomaticRecommendationTransportException(
        'automatic recommendation response was not JSON',
        error,
      );
    }
  }

  AutomaticRecommendationHttpException _httpException(
    int statusCode,
    Object? decoded,
  ) {
    if (decoded is Map<String, dynamic>) {
      try {
        final problem = AutomaticRecommendationProblemPayload.parse(
          decoded,
        ).toJson();
        return AutomaticRecommendationHttpException(
          statusCode: statusCode,
          code: problem['code'] as String,
          message: problem['title'] as String,
          retryable: problem['retryable'] as bool,
        );
      } on Object {
        // Non-contract error bodies are converted to a typed transport error
        // below rather than being accepted as recommendation data.
      }
    }
    return AutomaticRecommendationHttpException(
      statusCode: statusCode,
      code: statusCode == 503
          ? 'recommendation_infrastructure_unavailable'
          : 'http_error',
      message: 'Automatic recommendation HTTP request failed',
      retryable: statusCode == 503,
    );
  }

  Map<String, String> get _headers => const {
    'accept': 'application/json',
    'content-type': 'application/json',
  };

  // Kept on the client so callers can use one deterministic clock when
  // constructing evidence payloads alongside a response.
  DateTime get now => _clock();
}
