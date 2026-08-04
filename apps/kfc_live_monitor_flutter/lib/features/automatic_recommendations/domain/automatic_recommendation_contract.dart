enum AutomaticRecommendationType {
  localFavorite,
  forYou,
  modifierUpsell,
  smartCrossSell,
}

const automaticRecommendationSchemaVersion = 'kfc-automatic-recommendation-v1';

const automaticRecommendationOperationPaths = {
  AutomaticRecommendationType.localFavorite:
      '/v1/recommendations/local-favorites',
  AutomaticRecommendationType.forYou: '/v1/recommendations/for-you',
  AutomaticRecommendationType.modifierUpsell:
      '/v1/recommendations/modifier-upsells',
  AutomaticRecommendationType.smartCrossSell:
      '/v1/recommendations/smart-cross-sells',
};

const automaticRecommendationContractDigest =
    '18bc66980c853f79b11a4d59f746da37533edbdf158beb087eeb184ee969f474';
