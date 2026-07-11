enum KfcGenUiWidgetKind {
  smartMenuPicker('smartMenuPicker'),
  productDetailCard('productDetailCard'),
  modifierPicker('modifierPicker'),
  promotionGallery('promotionGallery'),
  allergenEvidence('allergenEvidence'),
  cartBuilder('cartBuilder'),
  addressFulfillmentCheck('addressFulfillmentCheck'),
  orderReviewConfirm('orderReviewConfirm'),
  paymentOrderStatus('paymentOrderStatus'),
  orderTrackingStatus('orderTrackingStatus'),
  supportHandoff('supportHandoff'),
  paymentMethodPicker('paymentMethodPicker');

  const KfcGenUiWidgetKind(this.wireName);

  final String wireName;

  static KfcGenUiWidgetKind? fromJson(Object? value) {
    for (final kind in values) {
      if (kind.wireName == value) return kind;
    }
    return null;
  }
}

class KfcVerifiedMedia {
  const KfcVerifiedMedia({
    required this.mediaKey,
    required this.url,
    required this.altText,
    this.width,
    this.height,
  });

  static KfcVerifiedMedia? tryFromJson(Object? value) {
    if (value is! Map) return null;
    final json = Map<String, Object?>.from(value);
    final mediaKey = _asString(json['mediaKey']).trim();
    final url = _asString(json['url']).trim();
    final altText = _asString(json['altText']).trim();
    final uri = Uri.tryParse(url);
    if (!mediaKey.startsWith('kfcvn:') ||
        uri == null ||
        uri.scheme != 'https' ||
        uri.host != 'static.kfcvietnam.com.vn' ||
        altText.isEmpty) {
      return null;
    }
    return KfcVerifiedMedia(
      mediaKey: mediaKey,
      url: url,
      altText: altText,
      width: _nullablePositiveInt(json['width']),
      height: _nullablePositiveInt(json['height']),
    );
  }

  final String mediaKey;
  final String url;
  final String altText;
  final int? width;
  final int? height;
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

enum KfcGenUiHandoffReason {
  customerRequestedHuman(
    'customer_requested_human',
    'Khách yêu cầu gặp nhân viên',
  ),
  humanRequested('human_requested', 'Khách yêu cầu gặp nhân viên'),
  paymentFailed('payment_failed', 'Thanh toán gặp lỗi'),
  angryCustomer('angry_customer', 'Khách đang không hài lòng'),
  abnormalLargeOrder('abnormal_large_order', 'Đơn hàng cần kiểm tra thêm'),
  humanReviewRequired('human_review_required', 'Cần nhân viên kiểm tra'),
  toolExecutionFailed('tool_execution_failed', 'Hệ thống chưa xử lý được'),
  menuItemVerificationRequired(
    'menu_item_verification_required',
    'Cần xác minh món trong menu',
  ),
  unknown('unknown', 'Lý do cần nhân viên hỗ trợ');

  const KfcGenUiHandoffReason(this.wireName, this.labelVi);

  final String wireName;
  final String labelVi;

  static KfcGenUiHandoffReason fromJson(Object? value) {
    for (final reason in values) {
      if (reason != unknown && reason.wireName == value) return reason;
    }
    return unknown;
  }
}

enum KfcGenUiOrderStatus {
  previewed('previewed', 'Đang kiểm tra'),
  created('created', 'Đã tạo đơn'),
  preparing('preparing', 'Đang chuẩn bị'),
  delivering('delivering', 'Đang giao hàng'),
  completed('completed', 'Đã hoàn tất'),
  cancelled('cancelled', 'Đã hủy'),
  unknown('unknown', 'Đang cập nhật');

  const KfcGenUiOrderStatus(this.wireName, this.labelVi);

  final String wireName;
  final String labelVi;

  static KfcGenUiOrderStatus fromJson(Object? value) {
    for (final status in values) {
      if (status != unknown && status.wireName == value) return status;
    }
    return unknown;
  }
}

enum KfcGenUiPaymentStatus {
  notStarted('not_started', 'Chưa thanh toán'),
  pending('pending', 'Chờ thanh toán'),
  paid('paid', 'Đã thanh toán'),
  failed('failed', 'Thanh toán thất bại'),
  unknown('unknown', 'Đang cập nhật');

  const KfcGenUiPaymentStatus(this.wireName, this.labelVi);

  final String wireName;
  final String labelVi;

  static KfcGenUiPaymentStatus fromJson(Object? value) {
    for (final status in values) {
      if (status != unknown && status.wireName == value) return status;
    }
    return unknown;
  }
}

String kfcGenUiHandoffReasonLabel(Object? value) {
  final text = value?.toString() ?? '';
  if (text.isEmpty) return '';
  return KfcGenUiHandoffReason.fromJson(text).labelVi;
}

String kfcGenUiOrderStatusLabel(Object? value) {
  final text = value?.toString() ?? '';
  if (text.isEmpty) return '';
  return KfcGenUiOrderStatus.fromJson(text).labelVi;
}

String kfcGenUiPaymentStatusLabel(Object? value) {
  final text = value?.toString() ?? '';
  if (text.isEmpty) return '';
  return KfcGenUiPaymentStatus.fromJson(text).labelVi;
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

  Map<String, Object?> toJson() => {
    'id': id,
    'lifecycleStage': lifecycleStage,
    'widgetKind': widgetKind.name,
    'status': status.name,
    'title': title,
    if (summary != null) 'summary': summary,
    'data': data,
    'actions': actions
        .map(
          (action) => <String, Object?>{
            'id': action.id,
            'label': action.label,
            'intent': action.intent.name,
            if (action.value != null) 'value': action.value,
            if (action.payload.isNotEmpty) 'payload': action.payload,
            if (action.destructive) 'destructive': true,
          },
        )
        .toList(growable: false),
    if (selectedAction != null) 'selectedAction': selectedAction,
    if (expiresAt != null) 'expiresAt': expiresAt,
  };
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

class CustomerChatSessionUpdates {
  const CustomerChatSessionUpdates({
    required this.agentMode,
    required this.turns,
    this.assignedAgentId,
    this.handoffStatus,
  });

  factory CustomerChatSessionUpdates.fromJson(Map<String, Object?> json) =>
      CustomerChatSessionUpdates(
        agentMode: _asString(json['agentMode']),
        assignedAgentId: _nullableString(json['assignedAgentId']),
        handoffStatus: _nullableString(json['handoffStatus']),
        turns: _asList(json['turns'])
            .whereType<Map>()
            .map((turn) {
              final value = Map<String, Object?>.from(turn);
              final metadata = _asMap(value['metadata']);
              return CustomerChatRemoteTurn(
                id: _asString(value['id']),
                role: _asString(value['role']),
                text: _asString(value['text']),
                isHumanAgent: metadata['authorType'] == 'human_agent',
              );
            })
            .toList(growable: false),
      );

  final String agentMode;
  final String? assignedAgentId;
  final String? handoffStatus;
  final List<CustomerChatRemoteTurn> turns;
}

class CustomerChatRemoteTurn {
  const CustomerChatRemoteTurn({
    required this.id,
    required this.role,
    required this.text,
    required this.isHumanAgent,
  });
  final String id;
  final String role;
  final String text;
  final bool isHumanAgent;
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

int? _nullablePositiveInt(Object? value) {
  final number = value is num ? value.toInt() : int.tryParse('$value');
  return number != null && number > 0 ? number : null;
}
