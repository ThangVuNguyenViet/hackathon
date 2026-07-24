import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../domain/customer_confirmation_models.dart';
import '../domain/kfc_genui_models.dart';
import '../domain/customer_run_models.dart';
import 'customer_run_sse.dart';

part 'customer_chat_fixture_repository.dart';

abstract interface class CustomerChatRepository {
  Future<CustomerRunStartResponse> startRun({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    String? text,
    KfcGenUiAction? action,
    Map<String, Object?>? metadata,
    String? candidateId,
  });

  Stream<CustomerRunEventEnvelope> watchRun(String runId, int afterSequence);

  Future<CustomerRunCancelResponse> cancelRun(String runId);

  Future<CustomerConfirmationResumeResult> resumeConfirmation({
    required String requestId,
    required String approvalCapability,
    required CustomerConfirmationDecision decision,
  });

  // Manual emergency fallback; the Flutter demo controller never selects it.
  Future<CustomerChatResponse> sendMessage({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required String text,
  });

  Future<CustomerChatResponse> submitGenUiAction({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required KfcGenUiAction action,
  });

  Future<CustomerChatSessionUpdates> getSessionUpdates({
    required String sessionId,
    String? afterTurnId,
  });
}

class BackendCustomerChatRepository implements CustomerChatRepository {
  BackendCustomerChatRepository({
    required String baseUrl,
    http.Client? client,
    Duration retryDelay = const Duration(milliseconds: 500),
  }) : _baseUri = Uri.parse(baseUrl),
       _client = client ?? http.Client(),
       _retryDelay = retryDelay;

  final Uri _baseUri;
  final http.Client _client;
  final Duration _retryDelay;

  @override
  Future<CustomerRunStartResponse> startRun({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    String? text,
    KfcGenUiAction? action,
    Map<String, Object?>? metadata,
    String? candidateId,
  }) async {
    if ((text == null) == (action == null)) {
      throw ArgumentError('Exactly one customer run input is required');
    }
    final response = await _postJson('/chat/kfc/runs', {
      'schemaVersion': 1,
      'sessionId': sessionId,
      'customerId': customerId,
      'clientMessageId': clientMessageId,
      'candidateId': ?candidateId,
      'metadata': ?metadata,
      'input': text != null
          ? {'kind': 'text', 'text': text}
          : {'kind': 'genui_action', ...action!.toJson()},
    });
    return CustomerRunStartResponse.fromJson(response);
  }

  @override
  Stream<CustomerRunEventEnvelope> watchRun(
    String runId,
    int afterSequence,
  ) async* {
    final request = http.Request(
      'GET',
      _baseUri
          .resolve('/chat/kfc/runs/${Uri.encodeComponent(runId)}/events')
          .replace(queryParameters: {'after': '$afterSequence'}),
    );
    request.headers['accept'] = 'text/event-stream';
    final response = await _client.send(request);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final body = await response.stream.bytesToString();
      throw StateError('KFC run events failed: ${response.statusCode} $body');
    }
    yield* decodeCustomerRunSse(response.stream);
  }

  @override
  Future<CustomerRunCancelResponse> cancelRun(String runId) async {
    final response = await _postJson(
      '/chat/kfc/runs/${Uri.encodeComponent(runId)}/cancel',
      const <String, Object?>{},
    );
    return CustomerRunCancelResponse.fromJson(response);
  }

  @override
  Future<CustomerConfirmationResumeResult> resumeConfirmation({
    required String requestId,
    required String approvalCapability,
    required CustomerConfirmationDecision decision,
  }) async {
    final response = await _client.post(
      _baseUri.resolve('/chat/kfc/confirmations/resume'),
      headers: const {'content-type': 'application/json'},
      body: jsonEncode({
        'requestId': requestId,
        'decision': decision.wireName,
        'approvalCapability': approvalCapability,
      }),
    );
    final decoded = _decodeObject(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CustomerConfirmationResumeException(
        statusCode: response.statusCode,
        errorCode: decoded['errorCode'] is String
            ? decoded['errorCode']! as String
            : 'confirmation_resume_failed',
      );
    }
    return CustomerConfirmationResumeResult.fromJson(decoded);
  }

  @override
  Future<CustomerChatResponse> sendMessage({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required String text,
  }) async {
    return _post('/chat/kfc/message', {
      'sessionId': sessionId,
      'customerId': customerId,
      'clientMessageId': clientMessageId,
      'text': text,
    });
  }

  @override
  Future<CustomerChatResponse> submitGenUiAction({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required KfcGenUiAction action,
  }) async {
    return _post('/chat/kfc/genui-action', {
      'sessionId': sessionId,
      'customerId': customerId,
      'clientMessageId': clientMessageId,
      'action': action.toJson(),
    });
  }

  @override
  Future<CustomerChatSessionUpdates> getSessionUpdates({
    required String sessionId,
    String? afterTurnId,
  }) async {
    final uri = _baseUri
        .resolve('/chat/kfc/sessions/${Uri.encodeComponent(sessionId)}/updates')
        .replace(
          queryParameters: afterTurnId == null ? null : {'after': afterTurnId},
        );
    final response = await _client.get(uri);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(
        'KFC session updates failed: ${response.statusCode} ${response.body}',
      );
    }
    return CustomerChatSessionUpdates.fromJson(
      jsonDecode(response.body) as Map<String, Object?>,
    );
  }

  Future<CustomerChatResponse> _post(
    String path,
    Map<String, Object?> body,
  ) async {
    final encodedBody = jsonEncode(body);
    for (var attempt = 1; attempt <= 3; attempt++) {
      try {
        final response = await _client.post(
          _baseUri.resolve(path),
          headers: const {'content-type': 'application/json'},
          body: encodedBody,
        );
        if (_isRetryableStatus(response.statusCode) && attempt < 3) {
          await Future<void>.delayed(_retryDelay * attempt);
          continue;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw StateError(
            'KFC customer chat request failed: ${response.statusCode} $path ${response.body}',
          );
        }
        return CustomerChatResponse.fromJson(
          jsonDecode(response.body) as Map<String, Object?>,
        );
      } on SocketException {
        if (attempt == 3) rethrow;
        await Future<void>.delayed(_retryDelay * attempt);
      } on http.ClientException {
        if (attempt == 3) rethrow;
        await Future<void>.delayed(_retryDelay * attempt);
      }
    }
    throw StateError('KFC customer chat request exhausted retries: $path');
  }

  Future<Map<String, Object?>> _postJson(
    String path,
    Map<String, Object?> body,
  ) async {
    final response = await _client.post(
      _baseUri.resolve(path),
      headers: const {'content-type': 'application/json'},
      body: jsonEncode(body),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(
        'KFC customer run request failed: ${response.statusCode} $path ${response.body}',
      );
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! Map) {
      throw const FormatException('Customer run response must be an object');
    }
    return decoded.cast<String, Object?>();
  }

  bool _isRetryableStatus(int statusCode) =>
      statusCode == 502 || statusCode == 503 || statusCode == 504;

  Map<String, Object?> _decodeObject(String body) {
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map) return decoded.cast<String, Object?>();
    } catch (_) {
      // Normalize malformed server responses without exposing request data.
    }
    return const <String, Object?>{};
  }
}
