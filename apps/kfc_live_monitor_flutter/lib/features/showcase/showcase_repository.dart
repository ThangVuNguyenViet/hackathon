import 'dart:convert';

import 'package:http/http.dart' as http;

import 'showcase_models.dart';

class ShowcaseRepository {
  factory ShowcaseRepository({required String baseUrl, http.Client? client}) {
    final sharedClient = client ?? http.Client();
    return ShowcaseRepository._(baseUrl, sharedClient);
  }

  ShowcaseRepository._(String baseUrl, http.Client client)
    : _baseUri = Uri.parse(baseUrl),
      _client = client;

  final Uri _baseUri;
  final http.Client _client;

  Future<ShowcaseCatalog> loadCatalog() async =>
      ShowcaseCatalog.fromJson(await _request('/showcase/scenarios'));

  Future<Map<String, Object?>> _request(String path) async {
    final response = await _client.get(_baseUri.resolve(path));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('$path failed: ${response.statusCode} ${response.body}');
    }
    return jsonDecode(response.body) as Map<String, Object?>;
  }
}
