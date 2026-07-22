import 'customer_confirmation_models.dart';

part 'kfc_genui_action_authority.dart';
part 'kfc_customer_chat_models.dart';
part 'kfc_payment_method_authority.dart';

enum KfcGenUiWidgetKind {
  smartMenuPicker('smartMenuPicker'),
  fullMenuBrowser('fullMenuBrowser'),
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
    return blocked;
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
    this.authority,
    this.hasValidAuthorityEncoding = true,
    this.hasValidActionEncoding = true,
    this.interactionFinality = KfcGenUiInteractionFinality.authoritative,
  });

  factory KfcGenUiAttachment.fromJson(
    Map<String, Object?> json, {
    bool allowLegacyActionAuthority = false,
  }) {
    final kind = KfcGenUiWidgetKind.fromJson(json['widgetKind']);
    if (kind == null) {
      throw FormatException(
        'Unknown KFC GenUI widget kind: ${json['widgetKind']}',
      );
    }
    final rawAuthority = json['authority'];
    final authority = rawAuthority == null
        ? null
        : KfcGenUiAuthority.tryFromJson(rawAuthority);
    final rawActions = json['actions'];
    final rawAttachmentId = json['id'];
    var hasValidActionEncoding = rawActions is List;
    if (rawAttachmentId is! String ||
        rawAttachmentId.isEmpty ||
        rawAttachmentId != rawAttachmentId.trim() ||
        rawAttachmentId.length > 256) {
      hasValidActionEncoding = false;
    }
    final actions = <KfcGenUiActionSpec>[];
    if (rawActions is List) {
      try {
        for (final rawAction in rawActions) {
          if (rawAction is! Map) {
            throw const FormatException(
              'Invalid KFC GenUI action specification',
            );
          }
          actions.add(
            KfcGenUiActionSpec.fromJson(Map<String, Object?>.from(rawAction)),
          );
        }
      } on Object {
        hasValidActionEncoding = false;
        actions.clear();
      }
    }
    final actionIds = actions
        .map((action) => action.id)
        .toList(growable: false);
    if (actionIds.toSet().length != actionIds.length) {
      hasValidActionEncoding = false;
    }
    return KfcGenUiAttachment(
      id: _asString(json['id']),
      lifecycleStage: _asString(json['lifecycleStage']),
      widgetKind: kind,
      status: KfcGenUiStatus.fromJson(json['status']),
      title: _asString(json['title']),
      summary: _nullableString(json['summary']),
      data: _asMap(json['data']),
      actions: actions,
      selectedAction: _nullableString(json['selectedAction']),
      expiresAt: _nullableString(json['expiresAt']),
      authority: authority,
      hasValidAuthorityEncoding:
          authority != null ||
          (rawAuthority == null && allowLegacyActionAuthority),
      hasValidActionEncoding: hasValidActionEncoding,
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
  final KfcGenUiAuthority? authority;
  final bool hasValidAuthorityEncoding;
  final bool hasValidActionEncoding;
  final KfcGenUiInteractionFinality interactionFinality;

  bool get canSubmitActions =>
      status == KfcGenUiStatus.active &&
      actions.isNotEmpty &&
      hasValidAuthorityEncoding &&
      hasValidActionEncoding &&
      _hasUniqueActionIds &&
      _hasValidActionManifest &&
      (authority == null || authority!.expiresAt == expiresAt) &&
      _hasUnexpiredActionWindow &&
      interactionFinality == KfcGenUiInteractionFinality.authoritative;

  bool get _hasUniqueActionIds {
    final ids = actions.map((action) => action.id).toList(growable: false);
    return ids.toSet().length == ids.length;
  }

  bool get _hasValidActionManifest =>
      actions.every(_isValidActionSpecForAttachment);

  bool _isValidActionSpecForAttachment(KfcGenUiActionSpec action) {
    if (action.id.isEmpty ||
        action.id != action.id.trim() ||
        action.id.length > 256 ||
        action.label.isEmpty ||
        action.label != action.label.trim() ||
        action.label.length > 1000 ||
        (action.value?.length ?? 0) > 1000) {
      return false;
    }
    if (!_isKnownActionForWidget(action.id)) return false;
    if (action.id.startsWith('customize_item:')) {
      return _isValidModifierActionSpec(action);
    }
    if (!_dynamicActionIds.contains(action.id)) {
      return _isValidStaticActionSpec(action);
    }
    if (!_hasValidDataDomainForAction(action.id)) return false;
    if (!_isValidActionSpecPayload(action.id, action.payload)) return false;
    if (action.payload.isEmpty && action.value == null) {
      return action.id != 'add_item';
    }
    return _isActionSpecBoundToAttachmentData(
      action.id,
      action.payload,
      action.value,
    );
  }

  bool _isKnownActionForWidget(String actionId) {
    return switch (widgetKind) {
      KfcGenUiWidgetKind.smartMenuPicker => actionId == 'add_items',
      KfcGenUiWidgetKind.fullMenuBrowser => actionId == 'add_items',
      KfcGenUiWidgetKind.productDetailCard => actionId == 'add_item',
      KfcGenUiWidgetKind.modifierPicker => actionId.startsWith(
        'customize_item:',
      ),
      KfcGenUiWidgetKind.promotionGallery => false,
      KfcGenUiWidgetKind.allergenEvidence => actionId == 'open_allergen_chart',
      KfcGenUiWidgetKind.cartBuilder => {
        'continue_to_fulfillment',
        'edit_cart',
        'update_item_quantity',
        'remove_item',
      }.contains(actionId),
      KfcGenUiWidgetKind.addressFulfillmentCheck => {
        'accept_fulfillment',
        'submit_address',
      }.contains(actionId),
      KfcGenUiWidgetKind.orderReviewConfirm => {
        'confirm_order',
        'apply_voucher',
      }.contains(actionId),
      KfcGenUiWidgetKind.paymentOrderStatus => {
        'open_payment',
        'change_payment_method',
      }.contains(actionId),
      KfcGenUiWidgetKind.orderTrackingStatus => actionId == 'track_order',
      KfcGenUiWidgetKind.supportHandoff => {
        'request_human',
        'send_issue_summary',
      }.contains(actionId),
      KfcGenUiWidgetKind.paymentMethodPicker =>
        actionId == 'select_payment_method',
    };
  }

  bool _isValidStaticActionSpec(KfcGenUiActionSpec action) {
    if (action.id == 'open_allergen_chart') {
      if (action.payload.length != 1) return false;
      final sourceUrl = action.payload['sourceUrl'];
      final evidence = _record(data['evidence']);
      return _isValidSourceUrl(sourceUrl) &&
          evidence['sourceUrl'] == sourceUrl &&
          action.value == sourceUrl;
    }
    if (action.payload.isNotEmpty) return false;
    final value = action.value;
    return switch (action.id) {
      'submit_address' =>
        value == null || _isCanonicalText(value, maximumLength: 500),
      'apply_voucher' =>
        value == null || _isCanonicalText(value, maximumLength: 64),
      'send_issue_summary' =>
        value == null || _isCanonicalText(value, maximumLength: 1000),
      _ => true,
    };
  }

  bool _isValidModifierActionSpec(KfcGenUiActionSpec action) {
    final tree = _record(data['modifierTree']);
    final itemCode = tree['itemCode'];
    final payload = action.payload;
    if (!_isCanonicalIdentifier(itemCode) ||
        payload.length != 3 ||
        payload['itemCode'] != itemCode ||
        !_isCanonicalIdentifier(payload['groupId']) ||
        !_isCanonicalIdentifier(payload['modifierId'])) {
      return false;
    }
    final groups = _uniqueRecordsByIdentifier(
      tree['modifierGroups'],
      'groupId',
    );
    final groupId = payload['groupId'];
    final group = groups?[groupId];
    if (group == null) return false;
    final options = _uniqueRecordsByIdentifier(group['options'], 'modifierId');
    final modifierId = payload['modifierId'];
    final option = options?[modifierId];
    if (option == null) return false;
    final nestedGroups = option['modifierGroups'];
    if (nestedGroups != null &&
        (nestedGroups is! List || nestedGroups.isNotEmpty)) {
      return false;
    }
    final optionName = option['name'];
    if (!_isCanonicalText(optionName, maximumLength: 1000)) return false;
    final expectedActionId =
        'customize_item:${Uri.encodeComponent(groupId! as String)}:'
        '${Uri.encodeComponent(modifierId! as String)}';
    return action.id == expectedActionId &&
        action.label == optionName &&
        action.value == optionName;
  }

  bool _isActionSpecBoundToAttachmentData(
    String actionId,
    Map<String, Object?> payload,
    String? verifiedValue,
  ) {
    if (actionId == 'add_items' || actionId == 'add_item') {
      return _isPayloadBoundToAttachmentData(actionId, payload, verifiedValue);
    }
    final identifierKey = switch (actionId) {
      'update_item_quantity' || 'remove_item' => 'itemCode',
      'select_payment_method' => 'methodId',
      _ => null,
    };
    if (identifierKey == null) return false;
    final identifier = payload[identifierKey];
    if (identifier != null) {
      return _isPayloadBoundToAttachmentData(actionId, payload, verifiedValue);
    }
    if (verifiedValue == null) return true;
    final records = switch (actionId) {
      'update_item_quantity' || 'remove_item' => _uniqueRecordsByIdentifier(
        _asMap(data['cart'])['items'],
        'itemCode',
      ),
      'select_payment_method' => _uniqueRecordsByIdentifier(
        data['methods'],
        'methodId',
        opaqueProviderId: true,
      ),
      _ => null,
    };
    final valueKey = actionId == 'select_payment_method'
        ? 'displayName'
        : 'name';
    final matches =
        records?.values
            .where(
              (record) =>
                  record[valueKey] == verifiedValue &&
                  (actionId != 'select_payment_method' ||
                      (record['supported'] == true &&
                          record['supportStatus'] == 'listed_supported')),
            )
            .length ??
        0;
    return matches == 1;
  }

  bool get _hasUnexpiredActionWindow {
    final issuedAt = authority == null
        ? null
        : DateTime.tryParse(authority!.issuedAt);
    final now = DateTime.now();
    if (issuedAt != null && issuedAt.isAfter(now)) return false;
    if (expiresAt == null) return true;
    final expiry = DateTime.tryParse(expiresAt!);
    return expiry != null && expiry.isAfter(now);
  }

  bool authorityMatches({
    required String sessionId,
    required String customerId,
  }) {
    final value = authority;
    return hasValidAuthorityEncoding &&
        (value == null ||
            (value.sessionId == sessionId && value.customerId == customerId));
  }

  List<KfcGenUiActionSpec> get actionableActions {
    if (!canSubmitActions) return const <KfcGenUiActionSpec>[];
    final counts = <String, int>{};
    for (final action in actions) {
      final id = action.id.trim();
      if (id.isNotEmpty) {
        counts.update(id, (count) => count + 1, ifAbsent: () => 1);
      }
    }
    return actions
        .where(
          (action) =>
              action.id.trim().isNotEmpty &&
              action.id == action.id.trim() &&
              action.id.length <= 256 &&
              action.label.trim().isNotEmpty &&
              (action.value?.length ?? 0) <= 1000 &&
              counts[action.id.trim()] == 1 &&
              (action.id != 'add_item' ||
                  _isValidBoundActionPayload(action.id, action.payload)),
        )
        .toList(growable: false);
  }

  KfcGenUiAction? bindAction({
    required String actionId,
    Map<String, Object?> payload = const <String, Object?>{},
    String? verifiedValue,
  }) {
    final candidates = actionableActions
        .where((action) => action.id == actionId)
        .toList(growable: false);
    if (candidates.length != 1) return null;
    final spec = candidates.single;
    if (!_isValidBoundActionPayload(actionId, payload) ||
        !_containsExactJsonBindings(payload, spec.payload) ||
        (spec.value != null && spec.value != verifiedValue) ||
        !_isPayloadBoundToAttachmentData(actionId, payload, verifiedValue)) {
      return null;
    }
    return KfcGenUiAction(
      attachmentId: id,
      actionId: spec.id,
      value: spec.value ?? verifiedValue,
      payload: payload,
    );
  }

  bool authorizesAction(KfcGenUiAction action) {
    if (action.attachmentId != id) return false;
    if (_dynamicActionIds.contains(action.actionId)) {
      final rebound = bindAction(
        actionId: action.actionId,
        payload: action.payload,
        verifiedValue: action.value,
      );
      return rebound != null && _sameAction(rebound, action);
    }
    final candidates = actionableActions
        .where((spec) => spec.id == action.actionId)
        .toList(growable: false);
    if (candidates.length != 1) return false;
    final spec = candidates.single;
    return action.value == spec.value &&
        _jsonEquivalent(action.payload, spec.payload);
  }

  bool _hasValidDataDomainForAction(String actionId) {
    return switch (actionId) {
      'add_items' =>
        (widgetKind == KfcGenUiWidgetKind.smartMenuPicker ||
                widgetKind == KfcGenUiWidgetKind.fullMenuBrowser) &&
            _uniqueRecordsByIdentifier(data['items'], 'code') != null,
      'add_item' =>
        widgetKind == KfcGenUiWidgetKind.productDetailCard &&
            _productDetailRecord() != null,
      'update_item_quantity' || 'remove_item' =>
        widgetKind == KfcGenUiWidgetKind.cartBuilder &&
            _uniqueRecordsByIdentifier(
                  _asMap(data['cart'])['items'],
                  'itemCode',
                ) !=
                null,
      'select_payment_method' =>
        widgetKind == KfcGenUiWidgetKind.paymentMethodPicker &&
            _uniqueRecordsByIdentifier(
                  data['methods'],
                  'methodId',
                  opaqueProviderId: true,
                ) !=
                null &&
            _isPaymentMethodCollectionAuthority(
              data['paymentMethodCollection'],
            ),
      _ => false,
    };
  }

  bool _isPayloadBoundToAttachmentData(
    String actionId,
    Map<String, Object?> payload,
    String? verifiedValue,
  ) {
    switch (actionId) {
      case 'add_items':
        final records = _uniqueRecordsByIdentifier(data['items'], 'code');
        if (records == null) return false;
        final items = payload['items'];
        return items is List &&
            items.every((item) {
              if (item is! Map) return false;
              final record = records[item['itemCode']];
              return record != null &&
                  _isEligibleMenuItem(
                    record,
                    requireExplicitAvailability: authority != null,
                  );
            });
      case 'add_item':
        final record = _productDetailRecord();
        return record != null &&
            _isEligibleMenuItem(
              record,
              requireExplicitAvailability: authority != null,
            ) &&
            record['code'] == payload['itemCode'] &&
            _matchesVerifiedDisplayValue(record, 'name', verifiedValue);
      case 'update_item_quantity':
      case 'remove_item':
        final records = _uniqueRecordsByIdentifier(
          _asMap(data['cart'])['items'],
          'itemCode',
        );
        final record = records?[payload['itemCode']];
        return record != null &&
            _matchesVerifiedDisplayValue(record, 'name', verifiedValue);
      case 'select_payment_method':
        final records = _uniqueRecordsByIdentifier(
          data['methods'],
          'methodId',
          opaqueProviderId: true,
        );
        final record = records?[payload['methodId']];
        return record != null &&
            record['supported'] == true &&
            record['supportStatus'] == 'listed_supported' &&
            _matchesVerifiedDisplayValue(record, 'displayName', verifiedValue);
      default:
        return false;
    }
  }

  Map<String, Object?>? _productDetailRecord() {
    final records = _recordList(data['items']);
    final indexed = _uniqueRecordsByIdentifier(records, 'code');
    if (indexed == null || indexed.length != 1) return null;
    final listed = indexed.values.single;
    final direct = _record(data['item']);
    if (direct.isNotEmpty &&
        (direct['code'] != listed['code'] ||
            direct['name'] != listed['name'])) {
      return null;
    }
    return listed;
  }

  KfcGenUiAttachment withInteractionFinality(
    KfcGenUiInteractionFinality finality,
  ) {
    return KfcGenUiAttachment(
      id: id,
      lifecycleStage: lifecycleStage,
      widgetKind: widgetKind,
      status: status,
      title: title,
      summary: summary,
      data: data,
      actions: actions,
      selectedAction: selectedAction,
      expiresAt: expiresAt,
      authority: authority,
      hasValidAuthorityEncoding: hasValidAuthorityEncoding,
      hasValidActionEncoding: hasValidActionEncoding,
      interactionFinality: finality,
    );
  }

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
    if (authority != null) 'authority': authority!.toJson(),
  };
}

const _dynamicActionIds = {
  'add_item',
  'add_items',
  'update_item_quantity',
  'remove_item',
  'select_payment_method',
};

bool _sameAction(KfcGenUiAction left, KfcGenUiAction right) {
  return left.attachmentId == right.attachmentId &&
      left.actionId == right.actionId &&
      left.value == right.value &&
      _jsonEquivalent(left.payload, right.payload);
}

bool _containsExactJsonBindings(
  Map<String, Object?> candidate,
  Map<String, Object?> requiredBindings,
) {
  for (final entry in requiredBindings.entries) {
    if (!candidate.containsKey(entry.key) ||
        !_jsonEquivalent(candidate[entry.key], entry.value)) {
      return false;
    }
  }
  return true;
}

bool _isValidActionSpecPayload(String actionId, Map<String, Object?> payload) {
  switch (actionId) {
    case 'add_items':
      return payload.isEmpty || _isValidBoundActionPayload(actionId, payload);
    case 'add_item':
      return _isValidBoundActionPayload(actionId, payload);
    case 'update_item_quantity':
      return payload.keys.every(
            (key) => key == 'itemCode' || key == 'quantity',
          ) &&
          (payload['itemCode'] == null ||
              _isCanonicalIdentifier(payload['itemCode'])) &&
          (payload['quantity'] == null ||
              (payload['quantity'] is int &&
                  (payload['quantity']! as int) >= 1 &&
                  (payload['quantity']! as int) <= 99));
    case 'remove_item':
      return payload.isEmpty ||
          (payload.length == 1 && _isCanonicalIdentifier(payload['itemCode']));
    case 'select_payment_method':
      return payload.isEmpty ||
          (payload.length == 1 && _isOpaqueProviderId(payload['methodId']));
    default:
      return false;
  }
}

bool _isValidBoundActionPayload(String actionId, Map<String, Object?> payload) {
  switch (actionId) {
    case 'add_items':
      if (payload.length != 1 || payload['items'] is! List) return false;
      final items = payload['items']! as List;
      if (items.isEmpty || items.length > 5) return false;
      final seenItemCodes = <String>{};
      for (final item in items) {
        if (item is! Map || item.length != 2) return false;
        final itemCode = item['itemCode'];
        final quantity = item['quantity'];
        if (!_isCanonicalIdentifier(itemCode) ||
            !seenItemCodes.add(itemCode as String) ||
            quantity is! int ||
            quantity < 1 ||
            quantity > 99) {
          return false;
        }
      }
      return true;
    case 'add_item':
      return payload.length == 2 &&
          _isCanonicalIdentifier(payload['itemCode']) &&
          payload['quantity'] is int &&
          (payload['quantity']! as int) >= 1 &&
          (payload['quantity']! as int) <= 99;
    case 'update_item_quantity':
      return payload.length == 2 &&
          _isCanonicalIdentifier(payload['itemCode']) &&
          payload['quantity'] is int &&
          (payload['quantity']! as int) >= 1 &&
          (payload['quantity']! as int) <= 99;
    case 'remove_item':
      return payload.length == 1 && _isCanonicalIdentifier(payload['itemCode']);
    case 'select_payment_method':
      return payload.length == 1 && _isOpaqueProviderId(payload['methodId']);
    default:
      return false;
  }
}

bool _isCanonicalIdentifier(Object? value) {
  return value is String &&
      value.isNotEmpty &&
      value == value.trim() &&
      value.length <= 128;
}

bool _isEligibleMenuItem(
  Map<String, Object?> item, {
  required bool requireExplicitAvailability,
}) {
  final modifierGroups = item['modifierGroups'];
  final availabilityIsValid = requireExplicitAvailability
      ? item['available'] == true
      : item['available'] != false;
  return availabilityIsValid &&
      item['isCustomize'] != true &&
      item['hasModifiers'] != true &&
      (modifierGroups == null ||
          (modifierGroups is List && modifierGroups.isEmpty));
}

bool _isValidSourceUrl(Object? value) {
  if (!_isCanonicalText(value, maximumLength: 2048)) return false;
  final uri = Uri.tryParse(value! as String);
  return uri != null && uri.hasScheme && uri.host.isNotEmpty;
}

Map<String, Object?> _record(Object? value) {
  if (value is! Map) return const <String, Object?>{};
  try {
    return Map<String, Object?>.from(value);
  } on Object {
    return const <String, Object?>{};
  }
}

List<Map<String, Object?>>? _recordList(Object? value) {
  if (value is! List) return null;
  final records = <Map<String, Object?>>[];
  for (final entry in value) {
    final record = _record(entry);
    if (record.isEmpty) return null;
    records.add(record);
  }
  return records;
}

Map<String, Map<String, Object?>>? _uniqueRecordsByIdentifier(
  Object? value,
  String identifierKey, {
  bool opaqueProviderId = false,
}) {
  final records = _recordList(value);
  if (records == null || records.isEmpty) return null;
  final indexed = <String, Map<String, Object?>>{};
  for (final record in records) {
    final identifier = record[identifierKey];
    if (!(opaqueProviderId
            ? _isOpaqueProviderId(identifier)
            : _isCanonicalIdentifier(identifier)) ||
        indexed.containsKey(identifier)) {
      return null;
    }
    indexed[identifier! as String] = record;
  }
  return indexed;
}

bool _matchesVerifiedDisplayValue(
  Map<String, Object?> record,
  String valueKey,
  String? verifiedValue,
) {
  return verifiedValue == null || record[valueKey] == verifiedValue;
}

bool _jsonEquivalent(Object? left, Object? right) {
  if (left is Map && right is Map) {
    final leftMap = Map<Object?, Object?>.from(left);
    final rightMap = Map<Object?, Object?>.from(right);
    if (leftMap.length != rightMap.length) return false;
    return leftMap.entries.every(
      (entry) =>
          rightMap.containsKey(entry.key) &&
          _jsonEquivalent(entry.value, rightMap[entry.key]),
    );
  }
  if (left is List && right is List) {
    if (left.length != right.length) return false;
    for (var index = 0; index < left.length; index += 1) {
      if (!_jsonEquivalent(left[index], right[index])) return false;
    }
    return true;
  }
  return left == right;
}
