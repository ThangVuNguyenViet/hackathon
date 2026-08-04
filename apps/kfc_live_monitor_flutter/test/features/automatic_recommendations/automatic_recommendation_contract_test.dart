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
          'examples/adversarial/scorer-nested-feature.json':
              AutomaticScorerRequestPayload.parse,
          'examples/adversarial/recommended-invented-reason.json':
              AutomaticRecommendationResponsePayload.parse,
          'examples/adversarial/recommended-without-model.json':
              AutomaticRecommendationResponsePayload.parse,
          'examples/adversarial/problem-503-not-retryable.json':
              AutomaticRecommendationProblemPayload.parse,
          'examples/adversarial/modifier-with-product-action.json':
              AutomaticRecommendationResponsePayload.parse,
          'examples/adversarial/impression-empty.json':
              AutomaticRecommendationImpressionPayload.parse,
          'examples/adversarial/recommended-nonmonotonic-counts.json':
              AutomaticRecommendationResponsePayload.parse,
          'examples/adversarial/modifier-four-proposals.json':
              AutomaticRecommendationResponsePayload.parse,
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

  test('Dart scorer reconciliation requires exact pairing', () {
    final root = Directory.current.parent.parent.uri.resolve(
      'contracts/automatic-recommendations/v1/examples/',
    );
    final request =
        jsonDecode(
              File.fromUri(
                root.resolve('scorer-request.json'),
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    final response =
        jsonDecode(
              File.fromUri(
                root.resolve('scorer-response.json'),
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    expect(
      reconcileAutomaticScorerResponse(request, response).toJson(),
      response,
    );
    final reorderedModelResponse =
        jsonDecode(
              File.fromUri(
                root.resolve('scorer-reordered-model-response.json'),
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    expect(
      reconcileAutomaticScorerResponse(
        request,
        reorderedModelResponse,
      ).toJson(),
      reorderedModelResponse,
    );
    for (final invalid in [
      {...response, 'requestId': 'mismatch'},
      {...response, 'scores': []},
      {
        ...response,
        'scores': [response['scores']![0], response['scores']![0]],
      },
      {
        ...response,
        'scores': [
          {...response['scores']![0], 'candidateId': 'extra'},
        ],
      },
    ]) {
      expect(
        () => reconcileAutomaticScorerResponse(request, invalid),
        throwsA(isA<AutomaticRecommendationContractException>()),
      );
    }
  });

  test('Dart scorer feature vector is fixed and type-applicable', () {
    final root = Directory.current.parent.parent.uri.resolve(
      'contracts/automatic-recommendations/v1/examples/',
    );
    final request =
        jsonDecode(
              File.fromUri(
                root.resolve('scorer-request.json'),
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    for (final mutate in <void Function(Map<String, dynamic>)>[
      (features) => features.remove('storeId'),
      (features) => features['selectedAfterDisplay'] = true,
      (features) => features['modifierGroupPath'] = 'meal/side',
    ]) {
      final invalid = jsonDecode(jsonEncode(request)) as Map<String, dynamic>;
      final candidates = invalid['candidates'] as List<dynamic>;
      final candidate = candidates.single as Map<String, dynamic>;
      mutate(candidate['features'] as Map<String, dynamic>);
      expect(
        () => AutomaticScorerRequestPayload.parse(invalid),
        throwsA(isA<AutomaticRecommendationContractException>()),
      );
    }
  });

  test('Dart identity digest binds type and path', () {
    final request = {
      'cart': {'revision': 'cart-1'},
      'storeId': 'KFCVN0002',
    };
    final digest = automaticRecommendationIdentityDigest(
      operationPath: '/v1/recommendations/local-favorites',
      identityType: 'local_favorite',
      payload: request,
    );
    expect(
      digest,
      automaticRecommendationIdentityDigest(
        operationPath: '/v1/recommendations/local-favorites',
        identityType: 'local_favorite',
        payload: {
          'storeId': 'KFCVN0002',
          'cart': {'revision': 'cart-1'},
        },
      ),
    );
    expect(
      digest,
      isNot(
        automaticRecommendationIdentityDigest(
          operationPath: '/v1/recommendations/local-favorites',
          identityType: 'smart_cross_sell',
          payload: request,
        ),
      ),
    );
  });

  test('Dart identity digest matches the published cross-runtime vector', () {
    final contractRoot = Directory.current.parent.parent.uri.resolve(
      'contracts/automatic-recommendations/v1/',
    );
    final manifest =
        jsonDecode(
              File.fromUri(
                contractRoot.resolve('contract-manifest.json'),
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    final vector = manifest['identityDigestVector'] as Map<String, dynamic>;

    expect(
      automaticRecommendationIdentityDigest(
        operationPath: vector['operationPath'] as String,
        identityType: vector['identityType'] as String,
        payload: vector['payload'],
      ),
      vector['sha256'],
    );
  });

  test('Dart modifier binding requires the requested parent cart line', () {
    final root = Directory.current.parent.parent.uri.resolve(
      'contracts/automatic-recommendations/v1/examples/',
    );
    final request =
        jsonDecode(
              File.fromUri(
                root.resolve('modifier-upsell-request.json'),
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    final mismatch =
        jsonDecode(
              File.fromUri(
                root.resolve(
                  'adversarial/modifier-parent-mismatch-response.json',
                ),
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;

    expect(
      () => validateAutomaticRecommendationBinding(
        AutomaticRecommendationType.modifierUpsell,
        request,
        mismatch,
      ),
      throwsA(isA<AutomaticRecommendationContractException>()),
    );
  });
}
