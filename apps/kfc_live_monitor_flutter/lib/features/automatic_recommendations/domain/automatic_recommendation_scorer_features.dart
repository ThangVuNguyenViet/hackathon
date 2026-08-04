part of 'automatic_recommendation_contract.dart';

void _validateAutomaticScorerFeatures(
  Object? value,
  String expectedType,
  int expectedPrice,
  String path,
) {
  const keys = [
    'featureSchemaVersion',
    'recommendationType',
    'storeId',
    'fulfilmentMode',
    'locale',
    'localHour',
    'daypart',
    'catalogRevision',
    'cartSubtotalVnd',
    'cartLineCount',
    'cartDistinctCategoryCount',
    'candidateSellableItemId',
    'candidateModifierOptionId',
    'candidateCategoryId',
    'candidatePriceImpactVnd',
    'candidateUnitPriceVnd',
    'candidateDiscountAmountVnd',
    'candidateDiscountActive',
    'promotionActive',
    'completedOrderCount',
    'priorItemOrderCount',
    'priorCategoryOrderCount',
    'historyRecencyDays',
    'localDemandCount',
    'modifierParentCartLineId',
    'modifierParentSellableItemId',
    'modifierGroupPath',
    'modifierSelectionMode',
    'modifierOptionAvailable',
    'modifierOptionSafe',
    'modifierPriceRatio',
    'remainingBudgetVnd',
    'basketAssociationCount',
    'basketComplementarityScore',
    'basketRedundancyCount',
    'basketCategoryDiversityCount',
  ];
  final feature = _Validator.exact(value, keys, path);
  if (feature['featureSchemaVersion'] != 'automatic-feature-v1' ||
      feature['recommendationType'] != expectedType) {
    _Validator.fail('$path has invalid schema or recommendation type');
  }
  for (final name in [
    'storeId',
    'locale',
    'catalogRevision',
    'candidateSellableItemId',
    'candidateCategoryId',
  ]) {
    _Validator.string(feature[name], '$path.$name');
  }
  if (!{'pickup', 'delivery'}.contains(feature['fulfilmentMode']) ||
      !{
        'breakfast',
        'lunch',
        'afternoon',
        'dinner',
        'late_night',
      }.contains(feature['daypart'])) {
    _Validator.fail('$path has invalid fulfilment mode or daypart');
  }
  _Validator.integer(feature['localHour'], '$path.localHour');
  if ((feature['localHour'] as int) > 23) {
    _Validator.fail('$path.localHour must be at most 23');
  }
  for (final name in [
    'cartSubtotalVnd',
    'cartLineCount',
    'cartDistinctCategoryCount',
    'candidatePriceImpactVnd',
    'candidateUnitPriceVnd',
    'candidateDiscountAmountVnd',
    'completedOrderCount',
    'priorItemOrderCount',
    'priorCategoryOrderCount',
  ]) {
    _Validator.integer(feature[name], '$path.$name');
  }
  if (feature['candidatePriceImpactVnd'] != expectedPrice) {
    _Validator.fail('$path.candidatePriceImpactVnd must match the candidate');
  }
  for (final name in ['candidateDiscountActive', 'promotionActive']) {
    if (feature[name] is! bool) {
      _Validator.fail('$path.$name must be a boolean');
    }
  }
  void nullableInteger(String name) {
    if (feature[name] != null) {
      _Validator.integer(feature[name], '$path.$name');
    }
  }

  void nullableNumber(String name, num minimum, num maximum) {
    final number = feature[name];
    if (number != null &&
        (number is! num ||
            !number.isFinite ||
            number < minimum ||
            number > maximum)) {
      _Validator.fail('$path.$name is invalid');
    }
  }

  nullableNumber('historyRecencyDays', 0, double.infinity);
  for (final name in [
    'localDemandCount',
    'remainingBudgetVnd',
    'basketAssociationCount',
    'basketRedundancyCount',
    'basketCategoryDiversityCount',
  ]) {
    nullableInteger(name);
  }
  nullableNumber('basketComplementarityScore', -1, 1);
  nullableNumber('modifierPriceRatio', 0, double.infinity);
  for (final name in [
    'candidateModifierOptionId',
    'modifierParentCartLineId',
    'modifierParentSellableItemId',
    'modifierGroupPath',
  ]) {
    if (feature[name] != null) {
      _Validator.string(feature[name], '$path.$name');
    }
  }
  if (!{
    null,
    'single',
    'multiple',
  }.contains(feature['modifierSelectionMode'])) {
    _Validator.fail('$path.modifierSelectionMode is invalid');
  }
  for (final name in ['modifierOptionAvailable', 'modifierOptionSafe']) {
    if (feature[name] != null && feature[name] is! bool) {
      _Validator.fail('$path.$name must be a boolean or null');
    }
  }
  const modifierFields = [
    'candidateModifierOptionId',
    'modifierParentCartLineId',
    'modifierParentSellableItemId',
    'modifierGroupPath',
    'modifierSelectionMode',
    'modifierOptionAvailable',
    'modifierOptionSafe',
    'modifierPriceRatio',
  ];
  if (expectedType == 'modifier_upsell') {
    if (modifierFields.any((name) => feature[name] == null)) {
      _Validator.fail('$path is missing modifier features');
    }
  } else if (modifierFields.any((name) => feature[name] != null)) {
    _Validator.fail('$path contains inapplicable modifier features');
  }
  const basketFields = [
    'basketAssociationCount',
    'basketComplementarityScore',
    'basketRedundancyCount',
    'basketCategoryDiversityCount',
  ];
  if (expectedType != 'smart_cross_sell' &&
      basketFields.any((name) => feature[name] != null)) {
    _Validator.fail('$path contains inapplicable basket features');
  }
  if (!{'modifier_upsell', 'smart_cross_sell'}.contains(expectedType) &&
      feature['remainingBudgetVnd'] != null) {
    _Validator.fail('$path.remainingBudgetVnd is inapplicable');
  }
  if (expectedType != 'local_favorite' && feature['localDemandCount'] != null) {
    _Validator.fail('$path.localDemandCount is inapplicable');
  }
  if (expectedType != 'for_you' && feature['historyRecencyDays'] != null) {
    _Validator.fail('$path.historyRecencyDays is inapplicable');
  }
}
