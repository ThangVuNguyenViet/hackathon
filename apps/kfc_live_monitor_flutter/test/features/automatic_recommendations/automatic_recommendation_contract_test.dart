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

  test('Dart representations parse every canonical fixture', () {
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
    final parsers = <String, AutomaticRecommendationPayload Function(Object?)>{
      'local_favorite_request': (value) =>
          AutomaticRecommendationRequestPayload.parse(
            AutomaticRecommendationType.localFavorite,
            value,
          ),
      'for_you_request': (value) => AutomaticRecommendationRequestPayload.parse(
        AutomaticRecommendationType.forYou,
        value,
      ),
      'modifier_upsell_request': (value) =>
          AutomaticRecommendationRequestPayload.parse(
            AutomaticRecommendationType.modifierUpsell,
            value,
          ),
      'smart_cross_sell_request': (value) =>
          AutomaticRecommendationRequestPayload.parse(
            AutomaticRecommendationType.smartCrossSell,
            value,
          ),
      'recommendation_response': AutomaticRecommendationResponsePayload.parse,
      'impression_request': AutomaticRecommendationImpressionPayload.parse,
      'outcome_request': AutomaticRecommendationOutcomePayload.parse,
      'problem_details': AutomaticRecommendationProblemPayload.parse,
      'inspection_response': AutomaticRecommendationInspectionPayload.parse,
      'scorer_request': AutomaticScorerRequestPayload.parse,
      'scorer_response': AutomaticScorerResponsePayload.parse,
    };

    for (final example in (manifest['examples']! as List<Object?>)) {
      final descriptor = example! as Map<String, Object?>;
      final value = jsonDecode(
        File.fromUri(
          contractRoot.resolve(descriptor['file']! as String),
        ).readAsStringSync(),
      );
      expect(parsers[descriptor['kind']]!(value).toJson(), value);
    }
  });

  test('Dart representations reject every negative fixture', () {
    final contractRoot = Directory.current.parent.parent.uri.resolve(
      'contracts/automatic-recommendations/v1/',
    );
    final negativeExamples =
        <String, AutomaticRecommendationPayload Function(Object?)>{
          'examples/negative/request-missing-journey-reference.json': (value) =>
              AutomaticRecommendationRequestPayload.parse(
                AutomaticRecommendationType.localFavorite,
                value,
              ),
          'examples/negative/outcome-generic-payload.json':
              AutomaticRecommendationOutcomePayload.parse,
          'examples/negative/scorer-missing-provenance.json':
              AutomaticScorerRequestPayload.parse,
          'examples/negative/problem-status-code-mismatch.json':
              AutomaticRecommendationProblemPayload.parse,
        };

    for (final entry in negativeExamples.entries) {
      final value = jsonDecode(
        File.fromUri(contractRoot.resolve(entry.key)).readAsStringSync(),
      );
      expect(
        () => entry.value(value),
        throwsA(isA<AutomaticRecommendationContractException>()),
      );
    }
  });
}
