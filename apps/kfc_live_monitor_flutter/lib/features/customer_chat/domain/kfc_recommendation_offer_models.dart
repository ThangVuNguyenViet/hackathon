part of 'kfc_genui_models.dart';

enum KfcRecommendationPlacement {
  localFavorite('local_favorite'),
  forYou('for_you'),
  modifierUpsell('modifier_upsell'),
  smartCrossSell('smart_cross_sell');

  const KfcRecommendationPlacement(this.wireName);

  final String wireName;

  static KfcRecommendationPlacement? tryFromJson(Object? value) {
    for (final placement in values) {
      if (placement.wireName == value) return placement;
    }
    return null;
  }
}

enum KfcRecommendationOfferKind {
  product('product'),
  modifier('modifier');

  const KfcRecommendationOfferKind(this.wireName);

  final String wireName;

  static KfcRecommendationOfferKind? tryFromJson(Object? value) {
    for (final kind in values) {
      if (kind.wireName == value) return kind;
    }
    return null;
  }
}

class KfcRecommendationMoney {
  const KfcRecommendationMoney({required this.amount, required this.currency});

  static KfcRecommendationMoney? tryFromJson(Object? value) {
    if (value is! Map || value.length != 2) return null;
    final amount = value['amount'];
    final currency = value['currency'];
    if (amount is! int || amount < 0 || currency != 'VND') return null;
    return KfcRecommendationMoney(
      amount: amount,
      currency: currency! as String,
    );
  }

  final int amount;
  final String currency;
}

class KfcRecommendationOfferItem {
  const KfcRecommendationOfferItem({
    required this.recommendationActionId,
    required this.kind,
    required this.name,
    required this.price,
    required this.priceImpact,
    this.imageUrl,
  });

  static KfcRecommendationOfferItem? tryFromJson(Object? value) {
    if (value is! Map) return null;
    final json = Map<String, Object?>.from(value);
    const requiredKeys = {
      'recommendationActionId',
      'kind',
      'name',
      'imageUrl',
      'price',
      'priceImpact',
    };
    if (json.length != requiredKeys.length ||
        !json.keys.every(requiredKeys.contains)) {
      return null;
    }
    final recommendationActionId = json['recommendationActionId'];
    final name = json['name'];
    final kind = KfcRecommendationOfferKind.tryFromJson(json['kind']);
    final price = KfcRecommendationMoney.tryFromJson(json['price']);
    final priceImpact = KfcRecommendationMoney.tryFromJson(json['priceImpact']);
    final imageUrl = json['imageUrl'];
    if (recommendationActionId is! String ||
        recommendationActionId.isEmpty ||
        recommendationActionId != recommendationActionId.trim() ||
        recommendationActionId.length > 200 ||
        name is! String ||
        name.trim().isEmpty ||
        name != name.trim() ||
        name.length > 1000 ||
        kind == null ||
        price == null ||
        priceImpact == null ||
        !_isRecommendationImageValue(imageUrl)) {
      return null;
    }
    return KfcRecommendationOfferItem(
      recommendationActionId: recommendationActionId,
      kind: kind,
      name: name,
      imageUrl: imageUrl as String?,
      price: price,
      priceImpact: priceImpact,
    );
  }

  final String recommendationActionId;
  final KfcRecommendationOfferKind kind;
  final String name;
  final String? imageUrl;
  final KfcRecommendationMoney price;
  final KfcRecommendationMoney priceImpact;

  String get selectionActionId =>
      'recommendation_select:$recommendationActionId';
}

class KfcRecommendationOfferData {
  const KfcRecommendationOfferData({
    required this.recommendationId,
    required this.orderFlowId,
    required this.placement,
    required this.decisionSource,
    required this.offers,
    required this.reasonCodes,
    required this.reasonText,
    required this.cartRevision,
    required this.actionDigest,
    required this.decisionDigest,
    required this.versionBindingDigest,
  });

  static KfcRecommendationOfferData? tryFromJson(Object? value) {
    if (value is! Map) return null;
    final json = Map<String, Object?>.from(value);
    const requiredKeys = {
      'recommendationId',
      'orderFlowId',
      'placement',
      'decisionSource',
      'offers',
      'reasonCodes',
      'reasonText',
      'cartRevision',
      'actionDigest',
      'decisionDigest',
      'versionBindingDigest',
    };
    if (json.length != requiredKeys.length ||
        !json.keys.every(requiredKeys.contains)) {
      return null;
    }
    final recommendationId = _recommendationOpaqueId(json['recommendationId']);
    final orderFlowId = _recommendationOpaqueId(json['orderFlowId']);
    final cartRevision = _recommendationOpaqueId(json['cartRevision']);
    final placement = KfcRecommendationPlacement.tryFromJson(json['placement']);
    final decisionSource = json['decisionSource'];
    final rawOffers = json['offers'];
    final rawReasonCodes = json['reasonCodes'];
    final rawReasonText = json['reasonText'];
    if (recommendationId == null ||
        orderFlowId == null ||
        cartRevision == null ||
        placement == null ||
        !_recommendationDecisionSources.contains(decisionSource) ||
        rawOffers is! List ||
        rawReasonCodes is! List ||
        rawReasonText is! List ||
        !_isSha256(json['actionDigest']) ||
        !_isSha256(json['decisionDigest']) ||
        !_isSha256(json['versionBindingDigest'])) {
      return null;
    }
    final offers = rawOffers
        .map(KfcRecommendationOfferItem.tryFromJson)
        .toList(growable: false);
    if (offers.any((offer) => offer == null)) return null;
    final typedOffers = offers.cast<KfcRecommendationOfferItem>();
    final actionIds = typedOffers
        .map((offer) => offer.recommendationActionId)
        .toSet();
    final isMerchandisingReplacement =
        decisionSource == 'merchandising_replacement';
    final expectedOfferCount = isMerchandisingReplacement
        ? typedOffers.length == 1
        : placement == KfcRecommendationPlacement.smartCrossSell
        ? typedOffers.length >= 3 && typedOffers.length <= 4
        : typedOffers.length == 1;
    final expectedKind =
        placement == KfcRecommendationPlacement.modifierUpsell &&
            !isMerchandisingReplacement
        ? KfcRecommendationOfferKind.modifier
        : KfcRecommendationOfferKind.product;
    if (!expectedOfferCount ||
        actionIds.length != typedOffers.length ||
        typedOffers.any((offer) => offer.kind != expectedKind)) {
      return null;
    }
    final reasonCodes = _recommendationStrings(
      rawReasonCodes,
      allowed: _recommendationReasonCodes,
    );
    final reasonText = _recommendationStrings(rawReasonText);
    if (reasonCodes == null ||
        reasonText == null ||
        reasonCodes.length != reasonText.length) {
      return null;
    }
    return KfcRecommendationOfferData(
      recommendationId: recommendationId,
      orderFlowId: orderFlowId,
      placement: placement,
      decisionSource: decisionSource! as String,
      offers: List.unmodifiable(typedOffers),
      reasonCodes: List.unmodifiable(reasonCodes),
      reasonText: List.unmodifiable(reasonText),
      cartRevision: cartRevision,
      actionDigest: json['actionDigest']! as String,
      decisionDigest: json['decisionDigest']! as String,
      versionBindingDigest: json['versionBindingDigest']! as String,
    );
  }

  final String recommendationId;
  final String orderFlowId;
  final KfcRecommendationPlacement placement;
  final String decisionSource;
  final List<KfcRecommendationOfferItem> offers;
  final List<String> reasonCodes;
  final List<String> reasonText;
  final String cartRevision;
  final String actionDigest;
  final String decisionDigest;
  final String versionBindingDigest;
}

class KfcRenderedRecommendationAction {
  const KfcRenderedRecommendationAction({
    required this.actionId,
    required this.position,
  });

  final String actionId;
  final int position;

  Map<String, Object?> toJson() => {'actionId': actionId, 'position': position};
}

class KfcRecommendationImpression {
  const KfcRecommendationImpression({
    required this.recommendationId,
    required this.eventId,
    required this.occurredAt,
    required this.assistantTurnId,
    required this.attachmentId,
    required this.renderedActions,
    required this.cartRevision,
    required this.actionDigest,
  });

  static KfcRecommendationImpression? tryFromAttachment({
    required String assistantTurnId,
    required KfcGenUiAttachment attachment,
    required DateTime occurredAt,
  }) {
    final recommendation = attachment.recommendationOfferData;
    final normalizedAssistantTurnId = _recommendationOpaqueId(assistantTurnId);
    if (recommendation == null ||
        normalizedAssistantTurnId == null ||
        _recommendationOpaqueId(attachment.id) == null ||
        attachment.status != KfcGenUiStatus.active ||
        attachment.interactionFinality !=
            KfcGenUiInteractionFinality.authoritative ||
        !attachment.canSubmitActions) {
      return null;
    }
    final eventId = _recommendationImpressionEventId(
      attachment.id,
      recommendation.decisionDigest,
    );
    if (_recommendationOpaqueId(eventId) == null) return null;
    return KfcRecommendationImpression(
      recommendationId: recommendation.recommendationId,
      eventId: eventId,
      occurredAt: occurredAt.toUtc().toIso8601String(),
      assistantTurnId: normalizedAssistantTurnId,
      attachmentId: attachment.id,
      renderedActions: [
        for (final (index, offer) in recommendation.offers.indexed)
          KfcRenderedRecommendationAction(
            actionId: offer.recommendationActionId,
            position: index + 1,
          ),
      ],
      cartRevision: recommendation.cartRevision,
      actionDigest: recommendation.actionDigest,
    );
  }

  final String recommendationId;
  final String eventId;
  final String occurredAt;
  final String assistantTurnId;
  final String attachmentId;
  final List<KfcRenderedRecommendationAction> renderedActions;
  final String cartRevision;
  final String actionDigest;

  Map<String, Object?> toJson() => {
    'schemaVersion': 'kfc-recommendation-event-v1',
    'eventId': eventId,
    'occurredAt': occurredAt,
    'assistantTurnId': assistantTurnId,
    'attachmentId': attachmentId,
    'renderedActions': renderedActions
        .map((action) => action.toJson())
        .toList(growable: false),
    'cartRevision': cartRevision,
    'actionDigest': actionDigest,
  };
}

String? _recommendationActionId(String actionId) {
  const prefix = 'recommendation_select:';
  if (!actionId.startsWith(prefix)) return null;
  return _recommendationOpaqueId(actionId.substring(prefix.length));
}

String? _recommendationOpaqueId(Object? value) {
  if (value is! String ||
      value.isEmpty ||
      value.length > 128 ||
      !_isRecommendationOpaqueIdStart(value.codeUnitAt(0)) ||
      value.codeUnits
          .skip(1)
          .any((unit) => !_isRecommendationOpaqueIdContinuation(unit))) {
    return null;
  }
  return value;
}

bool _isRecommendationOpaqueIdStart(int unit) =>
    (unit >= 48 && unit <= 57) ||
    (unit >= 65 && unit <= 90) ||
    (unit >= 97 && unit <= 122);

bool _isRecommendationOpaqueIdContinuation(int unit) =>
    _isRecommendationOpaqueIdStart(unit) ||
    unit == 58 ||
    unit == 95 ||
    unit == 45;

String _recommendationImpressionEventId(
  String attachmentId,
  String decisionDigest,
) {
  const attachmentPrefix = 'recommendation-attachment:';
  if (attachmentId.startsWith(attachmentPrefix)) {
    return 'recommendation-impression:${attachmentId.substring(attachmentPrefix.length)}';
  }
  final direct = 'impression:$attachmentId';
  return direct.length <= 128 ? direct : 'impression:$decisionDigest';
}

List<String>? _recommendationStrings(
  List<Object?> values, {
  Set<String>? allowed,
}) {
  final result = <String>[];
  for (final value in values) {
    if (value is! String ||
        value.trim().isEmpty ||
        value != value.trim() ||
        value.length > 1000 ||
        (allowed != null && !allowed.contains(value))) {
      return null;
    }
    result.add(value);
  }
  return result;
}

bool _isSha256(Object? value) {
  if (value is! String || value.length != 64) return false;
  for (final unit in value.codeUnits) {
    final decimal = unit >= 48 && unit <= 57;
    final lowerHex = unit >= 97 && unit <= 102;
    if (!decimal && !lowerHex) return false;
  }
  return true;
}

bool _isRecommendationImageValue(Object? value) =>
    value == null || value is String;

const _recommendationDecisionSources = {
  'ranked',
  'merchandising_replacement',
  'fallback',
};

const _recommendationReasonCodes = {
  'popular_here',
  'ordered_before',
  'matches_your_history',
  'completes_your_item',
  'completes_your_meal',
  'active_offer',
  'merchandising_selection',
};
