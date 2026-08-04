import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/features/automatic_recommendations/domain/automatic_recommendation_contract.dart';

void main() {
  test('Dart client exposes the four exact decision operations', () {
    expect(
      automaticRecommendationSchemaVersion,
      'kfc-automatic-recommendation-v1',
    );
    expect(automaticRecommendationOperationPaths, {
      AutomaticRecommendationType.localFavorite:
          '/v1/recommendations/local-favorites',
      AutomaticRecommendationType.forYou: '/v1/recommendations/for-you',
      AutomaticRecommendationType.modifierUpsell:
          '/v1/recommendations/modifier-upsells',
      AutomaticRecommendationType.smartCrossSell:
          '/v1/recommendations/smart-cross-sells',
    });
  });

  test('Dart representation matches the canonical contract digest', () {
    final contractRoot = Directory.current.parent.parent.uri.resolve(
      'contracts/automatic-recommendations/v1/',
    );
    final manifest =
        jsonDecode(
              File.fromUri(
                contractRoot.resolve('contract-manifest.json'),
              ).readAsStringSync(),
            )
            as Map<String, Object?>;
    final authorityFiles = (manifest['authorityFiles']! as List<Object?>)
        .cast<String>();
    final bytes = <int>[];

    for (final relativePath in authorityFiles) {
      bytes
        ..addAll(utf8.encode(relativePath))
        ..add(0)
        ..addAll(
          File.fromUri(contractRoot.resolve(relativePath)).readAsBytesSync(),
        )
        ..add(0);
    }

    expect(
      automaticRecommendationContractDigest,
      sha256.convert(bytes).toString(),
    );
    expect(automaticRecommendationContractDigest, manifest['canonicalDigest']);
  });
}
