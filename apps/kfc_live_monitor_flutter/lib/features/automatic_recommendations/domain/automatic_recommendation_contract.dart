import 'dart:convert';

import 'package:crypto/crypto.dart';

part 'automatic_recommendation_binding.dart';

enum AutomaticRecommendationType {
  localFavorite,
  forYou,
  modifierUpsell,
  smartCrossSell,
}

const automaticRecommendationSchemaVersion = 'kfc-automatic-recommendation-v1';
const automaticRecommendationContractDigest =
    '5998c1d2b50c09e14d144fbc327a885e71245c7fcbb3cb1f7b23d0ea8a547dbc';

const automaticRecommendationOperationPaths = {
  AutomaticRecommendationType.localFavorite:
      '/v1/recommendations/local-favorites',
  AutomaticRecommendationType.forYou: '/v1/recommendations/for-you',
  AutomaticRecommendationType.modifierUpsell:
      '/v1/recommendations/modifier-upsells',
  AutomaticRecommendationType.smartCrossSell:
      '/v1/recommendations/smart-cross-sells',
};

class AutomaticRecommendationContractException implements Exception {
  AutomaticRecommendationContractException(this.message);

  final String message;

  @override
  String toString() => 'AutomaticRecommendationContractException: $message';
}

class AutomaticRecommendationPayload {
  AutomaticRecommendationPayload(Map<String, dynamic> wire)
    : _wire = Map<String, dynamic>.from(wire);

  final Map<String, dynamic> _wire;

  Map<String, dynamic> toJson() =>
      jsonDecode(jsonEncode(_wire)) as Map<String, dynamic>;
}

class AutomaticRecommendationRequestPayload
    extends AutomaticRecommendationPayload {
  AutomaticRecommendationRequestPayload._(super.wire);

  static AutomaticRecommendationRequestPayload parse(
    AutomaticRecommendationType type,
    Object? value,
  ) {
    _Validator.request(type, value);
    return AutomaticRecommendationRequestPayload._(
      _Validator.object(value, 'request'),
    );
  }
}

class AutomaticRecommendationResponsePayload
    extends AutomaticRecommendationPayload {
  AutomaticRecommendationResponsePayload._(super.wire);

  static AutomaticRecommendationResponsePayload parse(Object? value) {
    _Validator.response(value);
    return AutomaticRecommendationResponsePayload._(
      _Validator.object(value, 'response'),
    );
  }
}

class AutomaticRecommendationImpressionPayload
    extends AutomaticRecommendationPayload {
  AutomaticRecommendationImpressionPayload._(super.wire);

  static AutomaticRecommendationImpressionPayload parse(Object? value) {
    _Validator.impression(value);
    return AutomaticRecommendationImpressionPayload._(
      _Validator.object(value, 'impression'),
    );
  }
}

class AutomaticRecommendationOutcomePayload
    extends AutomaticRecommendationPayload {
  AutomaticRecommendationOutcomePayload._(super.wire);

  static AutomaticRecommendationOutcomePayload parse(Object? value) {
    _Validator.outcome(value);
    return AutomaticRecommendationOutcomePayload._(
      _Validator.object(value, 'outcome'),
    );
  }
}

class AutomaticRecommendationProblemPayload
    extends AutomaticRecommendationPayload {
  AutomaticRecommendationProblemPayload._(super.wire);

  static AutomaticRecommendationProblemPayload parse(Object? value) {
    _Validator.problem(value);
    return AutomaticRecommendationProblemPayload._(
      _Validator.object(value, 'problem'),
    );
  }
}

class AutomaticRecommendationInspectionPayload
    extends AutomaticRecommendationPayload {
  AutomaticRecommendationInspectionPayload._(super.wire);

  static AutomaticRecommendationInspectionPayload parse(Object? value) {
    _Validator.inspection(value);
    return AutomaticRecommendationInspectionPayload._(
      _Validator.object(value, 'inspection'),
    );
  }
}

class AutomaticScorerRequestPayload extends AutomaticRecommendationPayload {
  AutomaticScorerRequestPayload._(super.wire);

  static AutomaticScorerRequestPayload parse(Object? value) {
    _Validator.scorerRequest(value);
    return AutomaticScorerRequestPayload._(
      _Validator.object(value, 'scorer request'),
    );
  }
}

class AutomaticScorerResponsePayload extends AutomaticRecommendationPayload {
  AutomaticScorerResponsePayload._(super.wire);

  static AutomaticScorerResponsePayload parse(Object? value) {
    _Validator.scorerResponse(value);
    return AutomaticScorerResponsePayload._(
      _Validator.object(value, 'scorer response'),
    );
  }
}

AutomaticScorerResponsePayload reconcileAutomaticScorerResponse(
  Object? requestValue,
  Object? responseValue,
) {
  final request = AutomaticScorerRequestPayload.parse(requestValue).toJson();
  final response = AutomaticScorerResponsePayload.parse(responseValue);
  final responseWire = response.toJson();
  if (request['requestId'] != responseWire['requestId']) {
    _Validator.fail('scorer response request identity does not match');
  }
  final sameModel =
      _canonicalJson(request['model']) == _canonicalJson(responseWire['model']);
  if (!sameModel) {
    _Validator.fail('scorer response model binding does not match');
  }
  final candidateIds = (request['candidates'] as List)
      .map((candidate) => (candidate as Map)['candidateId'])
      .toList();
  final scoreIds = (responseWire['scores'] as List)
      .map((score) => (score as Map)['candidateId'])
      .toList();
  if (candidateIds.toSet().length != candidateIds.length ||
      scoreIds.toSet().length != scoreIds.length ||
      candidateIds.toSet().length != scoreIds.toSet().length ||
      !candidateIds.toSet().containsAll(scoreIds)) {
    _Validator.fail(
      'scorer response must contain one score for every candidate',
    );
  }
  return response;
}

String automaticRecommendationIdentityDigest({
  required String operationPath,
  required String identityType,
  required Object? payload,
}) {
  final binding =
      '$operationPath\u0000$identityType\u0000${_canonicalJson(payload)}';
  return sha256.convert(utf8.encode(binding)).toString();
}

String _canonicalJson(Object? value) {
  if (value == null || value is String || value is bool || value is num) {
    if (value is num && !value.isFinite) {
      throw ArgumentError.value(
        value,
        'value',
        'Canonical JSON rejects non-finite numbers',
      );
    }
    return jsonEncode(value);
  }
  if (value is List) return '[${value.map(_canonicalJson).join(',')}]';
  if (value is Map) {
    final keys = value.keys.map((key) => key.toString()).toList()..sort();
    return '{${keys.map((key) => '${jsonEncode(key)}:${_canonicalJson(value[key])}').join(',')}}';
  }
  throw ArgumentError.value(
    value,
    'value',
    'Canonical JSON supports JSON values only',
  );
}

class _Validator {
  static final _opaqueId = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:/-]*$');
  static final _sha256 = RegExp(r'^[a-f0-9]{64}$');
  static const _types = {
    'local_favorite',
    'for_you',
    'modifier_upsell',
    'smart_cross_sell',
  };
  static const _channels = {'kiosk', 'chat', 'workbench', 'other'};
  static const _emptyReasons = {
    'no_qualified_model',
    'no_eligible_candidates',
    'insufficient_history',
    'parent_cart_line_not_found',
    'empty_cart',
    'no_candidate_above_threshold',
    'recommendation_serving_paused',
  };
  static const _reasonCodes = {
    'popular_here',
    'ordered_before',
    'matches_your_history',
    'completes_your_item',
    'completes_your_meal',
    'active_offer',
  };

  static Map<String, dynamic> object(Object? value, String path) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    fail('$path must be an object');
  }

  static Never fail(String message) =>
      throw AutomaticRecommendationContractException(message);

  static Map<String, dynamic> exact(
    Object? value,
    Iterable<String> keys,
    String path,
  ) {
    final map = object(value, path);
    final expected = keys.toSet();
    if (map.keys.toSet().length != expected.length ||
        !map.keys.toSet().containsAll(expected)) {
      fail('$path must contain exactly ${expected.toList()..sort()}');
    }
    return map;
  }

  static String string(Object? value, String path) {
    if (value is! String || value.trim().isEmpty) {
      fail('$path must be a non-empty string');
    }
    return value;
  }

  static void opaqueId(Object? value, String path) {
    final text = string(value, path);
    if (text.length > 256 || !_opaqueId.hasMatch(text)) {
      fail('$path must be an opaque identifier');
    }
  }

  static void sha256(Object? value, String path) {
    if (!_sha256.hasMatch(string(value, path))) {
      fail('$path must be a lowercase SHA-256 digest');
    }
  }

  static void integer(Object? value, String path, [int minimum = 0]) {
    if (value is! int || value < minimum) {
      fail('$path must be an integer at least $minimum');
    }
  }

  static double number(
    Object? value,
    String path,
    double minimum,
    double maximum,
  ) {
    if (value is! num ||
        !value.isFinite ||
        value < minimum ||
        value > maximum) {
      fail('$path must be between $minimum and $maximum');
    }
    return value.toDouble();
  }

  static void dateTime(Object? value, String path) {
    final text = string(value, path);
    if (!(text.endsWith('Z') ||
            RegExp(r'[+-][0-9]{2}:[0-9]{2}$').hasMatch(text)) ||
        DateTime.tryParse(text) == null) {
      fail('$path must be an offset ISO-8601 date-time');
    }
  }

  static void money(Object? value, String path) {
    final map = exact(value, ['amount', 'currency'], path);
    integer(map['amount'], '$path.amount');
    if (map['currency'] != 'VND') fail('$path.currency must be VND');
  }

  static void cart(Object? value, String path, {bool nonEmpty = false}) {
    final map = exact(value, ['cartId', 'revision', 'subtotal', 'lines'], path);
    opaqueId(map['cartId'], '$path.cartId');
    opaqueId(map['revision'], '$path.revision');
    money(map['subtotal'], '$path.subtotal');
    final lines = map['lines'];
    if (lines is! List || (nonEmpty && lines.isEmpty)) {
      fail('$path.lines must be ${nonEmpty ? 'non-empty ' : ''}an array');
    }
    for (var index = 0; index < lines.length; index++) {
      final linePath = '$path.lines[$index]';
      final line = exact(lines[index], [
        'lineId',
        'sellableItemId',
        'quantity',
        'unitPrice',
        'modifiers',
      ], linePath);
      opaqueId(line['lineId'], '$linePath.lineId');
      opaqueId(line['sellableItemId'], '$linePath.sellableItemId');
      integer(line['quantity'], '$linePath.quantity', 1);
      money(line['unitPrice'], '$linePath.unitPrice');
      final modifiers = line['modifiers'];
      if (modifiers is! List) fail('$linePath.modifiers must be an array');
      for (
        var modifierIndex = 0;
        modifierIndex < modifiers.length;
        modifierIndex++
      ) {
        final modifierPath = '$linePath.modifiers[$modifierIndex]';
        final modifier = exact(modifiers[modifierIndex], [
          'groupPath',
          'optionId',
          'quantity',
          'priceImpact',
        ], modifierPath);
        if (modifier['groupPath'] is! List ||
            (modifier['groupPath'] as List).isEmpty) {
          fail('$modifierPath.groupPath must be non-empty');
        }
        for (final identifier in modifier['groupPath'] as List) {
          opaqueId(identifier, '$modifierPath.groupPath');
        }
        opaqueId(modifier['optionId'], '$modifierPath.optionId');
        integer(modifier['quantity'], '$modifierPath.quantity', 1);
        money(modifier['priceImpact'], '$modifierPath.priceImpact');
      }
    }
  }

  static void model(Object? value, String path) {
    final map = exact(value, [
      'bundleId',
      'bundleDigest',
      'modelRevision',
      'calibratorRevision',
      'featureSchemaDigest',
      'thresholdRevision',
      'composerContractDigest',
      'qualificationRunId',
      'qualificationEvidenceDigest',
    ], path);
    for (final field in [
      'bundleId',
      'modelRevision',
      'calibratorRevision',
      'thresholdRevision',
      'qualificationRunId',
    ]) {
      opaqueId(map[field], '$path.$field');
    }
    for (final field in [
      'bundleDigest',
      'featureSchemaDigest',
      'composerContractDigest',
      'qualificationEvidenceDigest',
    ]) {
      sha256(map[field], '$path.$field');
    }
  }

  static void request(AutomaticRecommendationType type, Object? value) {
    final typeField = switch (type) {
      AutomaticRecommendationType.forYou => 'verifiedCustomerRef',
      AutomaticRecommendationType.modifierUpsell => 'parentCartLineId',
      _ => null,
    };
    final map = exact(value, [
      'schemaVersion',
      'requestId',
      'storeId',
      'fulfilmentMode',
      'locale',
      'orderingJourneyRef',
      'opportunityRef',
      'cart',
      ?typeField,
    ], 'request');
    if (map['schemaVersion'] != automaticRecommendationSchemaVersion) {
      fail('request.schemaVersion is invalid');
    }
    for (final field in [
      'requestId',
      'storeId',
      'orderingJourneyRef',
      'opportunityRef',
    ]) {
      opaqueId(map[field], 'request.$field');
    }
    if (!{'pickup', 'delivery'}.contains(map['fulfilmentMode'])) {
      fail('request.fulfilmentMode is invalid');
    }
    final locale = string(map['locale'], 'request.locale');
    if (locale.length < 2 || locale.length > 35) {
      fail('request.locale is invalid');
    }
    cart(
      map['cart'],
      'request.cart',
      nonEmpty: type == AutomaticRecommendationType.smartCrossSell,
    );
    if (typeField != null) opaqueId(map[typeField], 'request.$typeField');
  }

  static void response(Object? value) {
    final map = exact(value, [
      'schemaVersion',
      'requestId',
      'recommendationId',
      'recommendationType',
      'status',
      'emptyReason',
      'cartRevision',
      'catalogRevision',
      'expiresAt',
      'model',
      'proposals',
      'counts',
    ], 'response');
    if (map['schemaVersion'] != automaticRecommendationSchemaVersion ||
        !_types.contains(map['recommendationType'])) {
      fail('response has an invalid schema version or type');
    }
    for (final field in [
      'requestId',
      'recommendationId',
      'cartRevision',
      'catalogRevision',
    ]) {
      opaqueId(map[field], 'response.$field');
    }
    if (!{'recommended', 'empty', 'paused'}.contains(map['status'])) {
      fail('response.status is invalid');
    }
    dateTime(map['expiresAt'], 'response.expiresAt');
    final proposals = map['proposals'];
    final maximum = map['recommendationType'] == 'modifier_upsell' ? 3 : 4;
    if (proposals is! List || proposals.length > maximum) {
      fail('response.proposals is invalid');
    }
    for (var index = 0; index < proposals.length; index++) {
      final proposalPath = 'response.proposals[$index]';
      final proposal = exact(proposals[index], [
        'actionId',
        'action',
        'display',
        'reasonCodes',
      ], proposalPath);
      opaqueId(proposal['actionId'], '$proposalPath.actionId');
      final action = object(proposal['action'], '$proposalPath.action');
      if (action['type'] == 'add_product') {
        final product = exact(action, [
          'type',
          'sellableItemId',
          'quantity',
          'priceImpact',
        ], '$proposalPath.action');
        opaqueId(
          product['sellableItemId'],
          '$proposalPath.action.sellableItemId',
        );
        integer(product['quantity'], '$proposalPath.action.quantity', 1);
        money(product['priceImpact'], '$proposalPath.action.priceImpact');
      } else if (action['type'] == 'apply_modifier') {
        final modifier = exact(action, [
          'type',
          'parentCartLineId',
          'parentSellableItemId',
          'optionId',
          'groupPath',
          'quantity',
          'priceImpact',
        ], '$proposalPath.action');
        for (final field in [
          'parentCartLineId',
          'parentSellableItemId',
          'optionId',
        ]) {
          opaqueId(modifier[field], '$proposalPath.action.$field');
        }
        if (modifier['groupPath'] is! List ||
            (modifier['groupPath'] as List).isEmpty) {
          fail('$proposalPath.action.groupPath is invalid');
        }
        for (final identifier in modifier['groupPath'] as List) {
          opaqueId(identifier, '$proposalPath.action.groupPath');
        }
        integer(modifier['quantity'], '$proposalPath.action.quantity', 1);
        money(modifier['priceImpact'], '$proposalPath.action.priceImpact');
      } else {
        fail('$proposalPath.action.type is invalid');
      }
      final display = exact(proposal['display'], [
        'name',
        'imageUrl',
        'priceImpact',
      ], '$proposalPath.display');
      string(display['name'], '$proposalPath.display.name');
      if (display['imageUrl'] != null) {
        final uri = Uri.tryParse(
          string(display['imageUrl'], '$proposalPath.display.imageUrl'),
        );
        if (uri == null || !uri.hasScheme) {
          fail('$proposalPath.display.imageUrl must be a URI');
        }
      }
      money(display['priceImpact'], '$proposalPath.display.priceImpact');
      if (proposal['reasonCodes'] is! List ||
          (proposal['reasonCodes'] as List).isEmpty) {
        fail('$proposalPath.reasonCodes is invalid');
      }
      if ((proposal['reasonCodes'] as List).any(
        (reason) => !_reasonCodes.contains(reason),
      )) {
        fail('$proposalPath.reasonCodes contain an unknown reason');
      }
    }
    final counts = exact(map['counts'], [
      'potential',
      'eligible',
      'scored',
      'displayed',
    ], 'response.counts');
    for (final field in counts.keys) {
      integer(counts[field], 'response.counts.$field');
    }
    if (counts['displayed'] != proposals.length) {
      fail('response displayed count must equal proposal count');
    }
    if (!(counts['potential'] >= counts['eligible'] &&
        counts['eligible'] >= counts['scored'] &&
        counts['scored'] >= counts['displayed'])) {
      fail('response counts must be monotonic');
    }
    if (proposals
            .map((proposal) => (proposal as Map)['actionId'])
            .toSet()
            .length !=
        proposals.length) {
      fail('response action identifiers must be unique');
    }
    final expectedAction = map['recommendationType'] == 'modifier_upsell'
        ? 'apply_modifier'
        : 'add_product';
    if (proposals.any(
      (proposal) => (proposal as Map)['action']['type'] != expectedAction,
    )) {
      fail('response action is incompatible with recommendation type');
    }
    final status = map['status'];
    if (status == 'recommended') {
      if (map['model'] == null ||
          proposals.isEmpty ||
          map['emptyReason'] != null) {
        fail('recommended response is invalid');
      }
    } else {
      if (map['model'] != null ||
          proposals.isNotEmpty ||
          !_emptyReasons.contains(map['emptyReason'])) {
        fail('empty or paused response is invalid');
      }
      if (status == 'paused' &&
          map['emptyReason'] != 'recommendation_serving_paused') {
        fail('paused reason is invalid');
      }
      if (status == 'empty' &&
          map['emptyReason'] == 'recommendation_serving_paused') {
        fail('empty reason is invalid');
      }
    }
    if (map['model'] != null) model(map['model'], 'response.model');
  }

  static Map<String, dynamic> eventBase(
    Object? value,
    Iterable<String> keys,
    String path,
  ) {
    final map = exact(value, keys, path);
    if (map['schemaVersion'] != 'kfc-automatic-recommendation-event-v1') {
      fail('$path.schemaVersion is invalid');
    }
    for (final field in [
      'eventId',
      'orderingJourneyRef',
      'opportunityRef',
      'cartRevision',
    ]) {
      opaqueId(map[field], '$path.$field');
    }
    if (!_channels.contains(map['channel'])) fail('$path.channel is invalid');
    dateTime(map['occurredAt'], '$path.occurredAt');
    return map;
  }

  static void impression(Object? value) {
    final map = eventBase(value, [
      'schemaVersion',
      'eventId',
      'channel',
      'occurredAt',
      'orderingJourneyRef',
      'opportunityRef',
      'cartRevision',
      'renderedActions',
    ], 'impression');
    final actions = map['renderedActions'];
    if (actions is! List || actions.isEmpty || actions.length > 4) {
      fail('impression.renderedActions is invalid');
    }
    final actionIds = <Object?>{};
    final positions = <Object?>{};
    for (var index = 0; index < actions.length; index++) {
      final action = exact(actions[index], [
        'actionId',
        'renderedPosition',
      ], 'impression.renderedActions[$index]');
      opaqueId(
        action['actionId'],
        'impression.renderedActions[$index].actionId',
      );
      integer(
        action['renderedPosition'],
        'impression.renderedActions[$index].renderedPosition',
        1,
      );
      actionIds.add(action['actionId']);
      positions.add(action['renderedPosition']);
    }
    if (actionIds.length != actions.length ||
        positions.length != actions.length) {
      fail('impression actions and positions must be unique');
    }
  }

  static void outcome(Object? value) {
    final candidate = object(value, 'outcome');
    final type = candidate['eventType'];
    const base = [
      'schemaVersion',
      'eventId',
      'channel',
      'occurredAt',
      'orderingJourneyRef',
      'opportunityRef',
      'cartRevision',
      'eventType',
    ];
    late final Map<String, dynamic> map;
    if ({'selected', 'action_dismissed'}.contains(type)) {
      map = eventBase(value, [
        ...base,
        'actionId',
        'renderedPosition',
      ], 'outcome');
      opaqueId(map['actionId'], 'outcome.actionId');
      integer(map['renderedPosition'], 'outcome.renderedPosition', 1);
    } else if ({
      'cart_mutation_succeeded',
      'cart_mutation_failed',
    }.contains(type)) {
      map = eventBase(value, [
        ...base,
        'actionId',
        'cartMutationRef',
      ], 'outcome');
      opaqueId(map['actionId'], 'outcome.actionId');
      opaqueId(map['cartMutationRef'], 'outcome.cartMutationRef');
    } else if (type == 'slate_dismissed' || type == 'order_abandoned') {
      eventBase(value, base, 'outcome');
    } else if (type == 'checkout_completed') {
      map = eventBase(value, [...base, 'orderRef'], 'outcome');
      opaqueId(map['orderRef'], 'outcome.orderRef');
    } else {
      fail('outcome.eventType is invalid');
    }
  }

  static void problem(Object? value) {
    final map = object(value, 'problem');
    final validKeys = [
      {'type', 'title', 'status', 'code', 'retryable'},
      {'type', 'title', 'status', 'code', 'retryable', 'requestId'},
    ];
    if (!validKeys.any(
      (keys) =>
          map.keys.toSet().length == keys.length &&
          map.keys.toSet().containsAll(keys),
    )) {
      fail('problem fields are invalid');
    }
    string(map['type'], 'problem.type');
    string(map['title'], 'problem.title');
    const codes = {
      400: {'invalid_request'},
      401: {'unauthorized'},
      403: {'forbidden'},
      404: {'recommendation_not_found'},
      409: {'identity_conflict', 'stale_or_invalid_action'},
      503: {'recommendation_infrastructure_unavailable'},
    };
    if (!codes.containsKey(map['status']) ||
        !codes[map['status']]!.contains(map['code'])) {
      fail('problem status and code must agree');
    }
    if (map['retryable'] != (map['status'] == 503)) {
      fail('problem retryability must agree with status');
    }
    if (map['requestId'] != null && map.containsKey('requestId')) {
      opaqueId(map['requestId'], 'problem.requestId');
    }
  }

  static void inspection(Object? value) {
    final map = exact(value, [
      'schemaVersion',
      'recommendationId',
      'requestDigest',
      'cartDigest',
      'model',
      'candidateEvidence',
      'persistenceEvidence',
    ], 'inspection');
    if (map['schemaVersion'] != 'kfc-automatic-inspection-v1') {
      fail('inspection.schemaVersion is invalid');
    }
    opaqueId(map['recommendationId'], 'inspection.recommendationId');
    sha256(map['requestDigest'], 'inspection.requestDigest');
    sha256(map['cartDigest'], 'inspection.cartDigest');
    if (map['model'] != null) model(map['model'], 'inspection.model');
    if (map['candidateEvidence'] is! List ||
        map['persistenceEvidence'] is! Map) {
      fail('inspection evidence is invalid');
    }
  }

  static void scorerRequest(Object? value) {
    final map = exact(value, [
      'schemaVersion',
      'requestId',
      'recommendationType',
      'model',
      'candidates',
    ], 'scorer request');
    if (map['schemaVersion'] != 'kfc-automatic-scorer-v1' ||
        !_types.contains(map['recommendationType'])) {
      fail('scorer request has invalid schema or type');
    }
    opaqueId(map['requestId'], 'scorer request.requestId');
    model(map['model'], 'scorer request.model');
    final candidates = map['candidates'];
    if (candidates is! List || candidates.isEmpty) {
      fail('scorer request candidates are invalid');
    }
    for (var index = 0; index < candidates.length; index++) {
      final candidate = exact(candidates[index], [
        'candidateId',
        'eligibility',
        'priceImpactVnd',
        'features',
      ], 'scorer request.candidates[$index]');
      opaqueId(
        candidate['candidateId'],
        'scorer request.candidates[$index].candidateId',
      );
      if (candidate['eligibility'] != 'eligible') {
        fail('scorer accepts eligible candidates only');
      }
      integer(
        candidate['priceImpactVnd'],
        'scorer request.candidates[$index].priceImpactVnd',
      );
      if (candidate['features'] is! Map) {
        fail('scorer candidate features are invalid');
      }
      (candidate['features'] as Map).forEach((key, feature) {
        string(key, 'scorer feature key');
        if (feature != null &&
            feature is! String &&
            feature is! bool &&
            feature is! num) {
          fail('scorer feature values must be scalar or null');
        }
        if (feature is num && !feature.isFinite) {
          fail('scorer feature values must be finite');
        }
      });
    }
  }

  static void scorerResponse(Object? value) {
    final map = exact(value, [
      'schemaVersion',
      'requestId',
      'model',
      'scores',
    ], 'scorer response');
    if (map['schemaVersion'] != 'kfc-automatic-scorer-v1') {
      fail('scorer response schema is invalid');
    }
    opaqueId(map['requestId'], 'scorer response.requestId');
    model(map['model'], 'scorer response.model');
    final scores = map['scores'];
    if (scores is! List) fail('scorer response scores are invalid');
    for (var index = 0; index < scores.length; index++) {
      final score = exact(scores[index], [
        'candidateId',
        'selectionProbability',
        'jointProbability',
        'explanationValues',
      ], 'scorer response.scores[$index]');
      opaqueId(
        score['candidateId'],
        'scorer response.scores[$index].candidateId',
      );
      final selection = number(
        score['selectionProbability'],
        'scorer response.scores[$index].selectionProbability',
        0,
        1,
      );
      final joint = number(
        score['jointProbability'],
        'scorer response.scores[$index].jointProbability',
        0,
        1,
      );
      if (joint > selection) {
        fail('joint probability cannot exceed selection probability');
      }
      final explanations = score['explanationValues'];
      if (explanations is! Map) fail('scorer explanation values are invalid');
      explanations.forEach((key, entry) {
        string(key, 'scorer explanation key');
        number(entry, 'scorer explanation value', -1, 1);
      });
    }
  }
}
