import 'dart:convert';

import 'package:http/http.dart' as http;

import '../customer_chat/data/customer_chat_repository.dart';
import '../customer_chat/domain/customer_run_models.dart';
import 'showcase_models.dart';

class ShowcaseRepository {
  factory ShowcaseRepository({required String baseUrl, http.Client? client}) {
    final sharedClient = client ?? http.Client();
    return ShowcaseRepository._(baseUrl, sharedClient);
  }

  ShowcaseRepository._(String baseUrl, http.Client client)
    : _baseUri = Uri.parse(baseUrl),
      _client = client,
      _runs = BackendCustomerChatRepository(baseUrl: baseUrl, client: client);

  final Uri _baseUri;
  final http.Client _client;
  final BackendCustomerChatRepository _runs;

  Future<ShowcaseCatalog> loadCatalog() async =>
      ShowcaseCatalog.fromJson(await _request('/showcase/scenarios'));

  Future<CustomerRunStartResponse> startTurn({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required String text,
    required String scenarioId,
    required ShowcaseMode mode,
  }) => _runs.startRun(
    sessionId: sessionId,
    customerId: customerId,
    clientMessageId: clientMessageId,
    text: text,
    metadata: {
      'showcaseScenarioId': scenarioId,
      'showcaseResponseMode': mode.value,
    },
  );

  Stream<CustomerRunEventEnvelope> watchTurn(String runId, int after) =>
      _runs.watchRun(runId, after);

  Future<ShowcaseResult> complete({
    required String scenarioId,
    required ShowcaseMode mode,
    required String sessionId,
  }) async => ShowcaseResult.fromJson(
    await _request(
      '/showcase/results',
      body: {
        'scenarioId': scenarioId,
        'mode': mode.value,
        'sessionId': sessionId,
      },
    ),
  );

  Future<Map<String, Object?>> _request(
    String path, {
    Map<String, Object?>? body,
  }) async {
    final response = body == null
        ? await _client.get(_baseUri.resolve(path))
        : await _client.post(
            _baseUri.resolve(path),
            headers: const {'content-type': 'application/json'},
            body: jsonEncode(body),
          );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('$path failed: ${response.statusCode} ${response.body}');
    }
    return jsonDecode(response.body) as Map<String, Object?>;
  }
}
