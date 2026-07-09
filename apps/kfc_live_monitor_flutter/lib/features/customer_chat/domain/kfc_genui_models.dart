enum KfcGenUiWidgetKind {
  smartMenuPicker('smartMenuPicker'),
  cartBuilder('cartBuilder'),
  addressFulfillmentCheck('addressFulfillmentCheck'),
  orderReviewConfirm('orderReviewConfirm'),
  paymentOrderStatus('paymentOrderStatus'),
  supportHandoff('supportHandoff');

  const KfcGenUiWidgetKind(this.wireName);

  final String wireName;

  static KfcGenUiWidgetKind? fromJson(Object? value) {
    for (final kind in values) {
      if (kind.wireName == value) return kind;
    }
    return null;
  }
}

enum KfcGenUiStatus {
  active('active'),
  answered('answered'),
  expired('expired'),
  blocked('blocked');

  const KfcGenUiStatus(this.wireName);

  final String wireName;

  static KfcGenUiStatus fromJson(Object? value) {
    for (final status in values) {
      if (status.wireName == value) return status;
    }
    return active;
  }
}

enum KfcGenUiActionIntent {
  primary('primary'),
  secondary('secondary'),
  destructive('destructive'),
  recovery('recovery');

  const KfcGenUiActionIntent(this.wireName);

  final String wireName;

  static KfcGenUiActionIntent fromJson(Object? value) {
    for (final intent in values) {
      if (intent.wireName == value) return intent;
    }
    return secondary;
  }
}

class KfcGenUiActionSpec {
  const KfcGenUiActionSpec({
    required this.id,
    required this.label,
    this.intent = KfcGenUiActionIntent.secondary,
    this.value,
    this.payload = const <String, Object?>{},
    this.destructive = false,
  });

  factory KfcGenUiActionSpec.fromJson(Map<String, Object?> json) {
    return KfcGenUiActionSpec(
      id: _asString(json['id']),
      label: _asString(json['label']),
      intent: json['destructive'] == true
          ? KfcGenUiActionIntent.destructive
          : KfcGenUiActionIntent.fromJson(json['intent']),
      value: _nullableString(json['value']),
      payload: _asMap(json['payload']),
      destructive: json['destructive'] == true,
    );
  }

  final String id;
  final String label;
  final KfcGenUiActionIntent intent;
  final String? value;
  final Map<String, Object?> payload;
  final bool destructive;
}

class KfcGenUiAttachment {
  const KfcGenUiAttachment({
    required this.id,
    required this.lifecycleStage,
    required this.widgetKind,
    required this.status,
    required this.title,
    this.summary,
    this.data = const <String, Object?>{},
    this.actions = const <KfcGenUiActionSpec>[],
    this.selectedAction,
    this.expiresAt,
  });

  factory KfcGenUiAttachment.fromJson(Map<String, Object?> json) {
    final kind = KfcGenUiWidgetKind.fromJson(json['widgetKind']);
    if (kind == null) {
      throw FormatException(
        'Unknown KFC GenUI widget kind: ${json['widgetKind']}',
      );
    }
    return KfcGenUiAttachment(
      id: _asString(json['id']),
      lifecycleStage: _asString(json['lifecycleStage']),
      widgetKind: kind,
      status: KfcGenUiStatus.fromJson(json['status']),
      title: _asString(json['title']),
      summary: _nullableString(json['summary']),
      data: _asMap(json['data']),
      actions: _asList(json['actions'])
          .whereType<Map>()
          .map(
            (value) =>
                KfcGenUiActionSpec.fromJson(Map<String, Object?>.from(value)),
          )
          .toList(growable: false),
      selectedAction: _nullableString(json['selectedAction']),
      expiresAt: _nullableString(json['expiresAt']),
    );
  }

  final String id;
  final String lifecycleStage;
  final KfcGenUiWidgetKind widgetKind;
  final KfcGenUiStatus status;
  final String title;
  final String? summary;
  final Map<String, Object?> data;
  final List<KfcGenUiActionSpec> actions;
  final String? selectedAction;
  final String? expiresAt;
}

class KfcGenUiAction {
  const KfcGenUiAction({
    required this.attachmentId,
    required this.actionId,
    this.value,
    this.payload = const <String, Object?>{},
  });

  factory KfcGenUiAction.fromSpec({
    required KfcGenUiAttachment attachment,
    required KfcGenUiActionSpec spec,
  }) {
    return KfcGenUiAction(
      attachmentId: attachment.id,
      actionId: spec.id,
      value: spec.value,
      payload: spec.payload,
    );
  }

  final String attachmentId;
  final String actionId;
  final String? value;
  final Map<String, Object?> payload;

  Map<String, Object?> toJson() {
    return {
      'attachmentId': attachmentId,
      'actionId': actionId,
      if (value != null) 'value': value,
      if (payload.isNotEmpty) 'payload': payload,
    };
  }
}

class CustomerChatMessage {
  const CustomerChatMessage({
    required this.id,
    required this.role,
    required this.text,
    this.genUi,
  });

  final String id;
  final CustomerChatRole role;
  final String text;
  final KfcGenUiAttachment? genUi;
}

enum CustomerChatRole { customer, assistant }

class CustomerChatResponse {
  const CustomerChatResponse({required this.responseText, this.genUi});

  factory CustomerChatResponse.fromJson(Map<String, Object?> json) {
    final genUiJson = json['genUi'];
    return CustomerChatResponse(
      responseText: _asString(json['responseText']),
      genUi: genUiJson is Map
          ? KfcGenUiAttachment.fromJson(Map<String, Object?>.from(genUiJson))
          : null,
    );
  }

  final String responseText;
  final KfcGenUiAttachment? genUi;
}

String _asString(Object? value) => value?.toString() ?? '';

String? _nullableString(Object? value) {
  final text = _asString(value);
  return text.isEmpty ? null : text;
}

List<Object?> _asList(Object? value) => value is List ? value : const [];

Map<String, Object?> _asMap(Object? value) {
  if (value is Map<String, Object?>) return value;
  if (value is Map) return Map<String, Object?>.from(value);
  return const <String, Object?>{};
}
