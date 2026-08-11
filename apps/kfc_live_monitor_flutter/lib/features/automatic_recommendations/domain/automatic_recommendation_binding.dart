part of 'automatic_recommendation_contract.dart';

AutomaticRecommendationResponsePayload validateAutomaticRecommendationBinding(
  AutomaticRecommendationType type,
  Object? requestValue,
  Object? responseValue,
) {
  final request = AutomaticRecommendationRequestPayload.parse(
    type,
    requestValue,
  ).toJson();
  final response = AutomaticRecommendationResponsePayload.parse(responseValue);
  final responseWire = response.toJson();
  if (request['requestId'] != responseWire['requestId']) {
    _Validator.fail('recommendation response request identity does not match');
  }
  if (responseWire['recommendationType'] !=
      _recommendationTypeWireValue(type)) {
    _Validator.fail('recommendation response type does not match the request');
  }
  if (type == AutomaticRecommendationType.modifierUpsell) {
    final parentCartLineId = request['parentCartLineId'];
    final proposals = responseWire['proposals'] as List;
    if (proposals.any(
      (proposal) =>
          ((proposal as Map)['action'] as Map)['parentCartLineId'] !=
          parentCartLineId,
    )) {
      _Validator.fail('modifier actions must target the requested parent line');
    }
  }
  return response;
}

String _recommendationTypeWireValue(AutomaticRecommendationType type) =>
    switch (type) {
      AutomaticRecommendationType.localFavorite => 'local_favorite',
      AutomaticRecommendationType.forYou => 'for_you',
      AutomaticRecommendationType.modifierUpsell => 'modifier_upsell',
      AutomaticRecommendationType.smartCrossSell => 'smart_cross_sell',
    };
