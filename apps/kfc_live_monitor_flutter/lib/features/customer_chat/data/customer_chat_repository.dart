import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../domain/kfc_genui_models.dart';
import '../domain/customer_run_models.dart';
import 'customer_run_sse.dart';

abstract interface class CustomerChatRepository {
  Future<CustomerRunStartResponse> startRun({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    String? text,
    KfcGenUiAction? action,
    Map<String, Object?>? metadata,
  });

  Stream<CustomerRunEventEnvelope> watchRun(String runId, int afterSequence);

  Future<CustomerRunCancelResponse> cancelRun(String runId);

  // Manual emergency fallback; the Flutter demo controller never selects it.
  Future<CustomerChatResponse> sendMessage({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required String text,
  });

  Future<CustomerChatResponse> submitGenUiAction({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required KfcGenUiAction action,
  });

  Future<CustomerChatSessionUpdates> getSessionUpdates({
    required String sessionId,
    String? afterTurnId,
  });
}

class BackendCustomerChatRepository implements CustomerChatRepository {
  BackendCustomerChatRepository({
    required String baseUrl,
    http.Client? client,
    Duration retryDelay = const Duration(milliseconds: 500),
  }) : _baseUri = Uri.parse(baseUrl),
       _client = client ?? http.Client(),
       _retryDelay = retryDelay;

  final Uri _baseUri;
  final http.Client _client;
  final Duration _retryDelay;

  @override
  Future<CustomerRunStartResponse> startRun({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    String? text,
    KfcGenUiAction? action,
    Map<String, Object?>? metadata,
  }) async {
    if ((text == null) == (action == null)) {
      throw ArgumentError('Exactly one customer run input is required');
    }
    final response = await _postJson('/chat/kfc/runs', {
      'schemaVersion': 1,
      'sessionId': sessionId,
      'customerId': customerId,
      'clientMessageId': clientMessageId,
      'metadata': ?metadata,
      'input': text != null
          ? {'kind': 'text', 'text': text}
          : {'kind': 'genui_action', ...action!.toJson()},
    });
    return CustomerRunStartResponse.fromJson(response);
  }

  @override
  Stream<CustomerRunEventEnvelope> watchRun(
    String runId,
    int afterSequence,
  ) async* {
    final request = http.Request(
      'GET',
      _baseUri
          .resolve('/chat/kfc/runs/${Uri.encodeComponent(runId)}/events')
          .replace(queryParameters: {'after': '$afterSequence'}),
    );
    request.headers['accept'] = 'text/event-stream';
    final response = await _client.send(request);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final body = await response.stream.bytesToString();
      throw StateError('KFC run events failed: ${response.statusCode} $body');
    }
    yield* decodeCustomerRunSse(response.stream);
  }

  @override
  Future<CustomerRunCancelResponse> cancelRun(String runId) async {
    final response = await _postJson(
      '/chat/kfc/runs/${Uri.encodeComponent(runId)}/cancel',
      const <String, Object?>{},
    );
    return CustomerRunCancelResponse.fromJson(response);
  }

  @override
  Future<CustomerChatResponse> sendMessage({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required String text,
  }) async {
    return _post('/chat/kfc/message', {
      'sessionId': sessionId,
      'customerId': customerId,
      'clientMessageId': clientMessageId,
      'text': text,
    });
  }

  @override
  Future<CustomerChatResponse> submitGenUiAction({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required KfcGenUiAction action,
  }) async {
    return _post('/chat/kfc/genui-action', {
      'sessionId': sessionId,
      'customerId': customerId,
      'clientMessageId': clientMessageId,
      'action': action.toJson(),
    });
  }

  @override
  Future<CustomerChatSessionUpdates> getSessionUpdates({
    required String sessionId,
    String? afterTurnId,
  }) async {
    final uri = _baseUri
        .resolve('/chat/kfc/sessions/${Uri.encodeComponent(sessionId)}/updates')
        .replace(
          queryParameters: afterTurnId == null ? null : {'after': afterTurnId},
        );
    final response = await _client.get(uri);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(
        'KFC session updates failed: ${response.statusCode} ${response.body}',
      );
    }
    return CustomerChatSessionUpdates.fromJson(
      jsonDecode(response.body) as Map<String, Object?>,
    );
  }

  Future<CustomerChatResponse> _post(
    String path,
    Map<String, Object?> body,
  ) async {
    final encodedBody = jsonEncode(body);
    for (var attempt = 1; attempt <= 3; attempt++) {
      try {
        final response = await _client.post(
          _baseUri.resolve(path),
          headers: const {'content-type': 'application/json'},
          body: encodedBody,
        );
        if (_isRetryableStatus(response.statusCode) && attempt < 3) {
          await Future<void>.delayed(_retryDelay * attempt);
          continue;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw StateError(
            'KFC customer chat request failed: ${response.statusCode} $path ${response.body}',
          );
        }
        return CustomerChatResponse.fromJson(
          jsonDecode(response.body) as Map<String, Object?>,
        );
      } on SocketException {
        if (attempt == 3) rethrow;
        await Future<void>.delayed(_retryDelay * attempt);
      } on http.ClientException {
        if (attempt == 3) rethrow;
        await Future<void>.delayed(_retryDelay * attempt);
      }
    }
    throw StateError('KFC customer chat request exhausted retries: $path');
  }

  Future<Map<String, Object?>> _postJson(
    String path,
    Map<String, Object?> body,
  ) async {
    final response = await _client.post(
      _baseUri.resolve(path),
      headers: const {'content-type': 'application/json'},
      body: jsonEncode(body),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(
        'KFC customer run request failed: ${response.statusCode} $path ${response.body}',
      );
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! Map) {
      throw const FormatException('Customer run response must be an object');
    }
    return decoded.cast<String, Object?>();
  }

  bool _isRetryableStatus(int statusCode) =>
      statusCode == 502 || statusCode == 503 || statusCode == 504;
}

class FixtureCustomerChatRepository implements CustomerChatRepository {
  const FixtureCustomerChatRepository({
    this.eventDelay = const Duration(milliseconds: 25),
  });

  final Duration eventDelay;

  @override
  Future<CustomerRunStartResponse> startRun({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    String? text,
    KfcGenUiAction? action,
    Map<String, Object?>? metadata,
  }) async => CustomerRunStartResponse(
    schemaVersion: 1,
    runId: action == null
        ? 'fixture_${_fixtureIntent(text!)}_run_$clientMessageId'
        : 'fixture_action_${action.actionId}_$clientMessageId',
    status: 'accepted',
    nextSequence: 1,
    replayed: false,
  );

  @override
  Stream<CustomerRunEventEnvelope> watchRun(
    String runId,
    int afterSequence,
  ) async* {
    final response = runId.contains('action_confirm_order')
        ? CustomerChatResponse(
            responseText: 'Đơn đã được tạo và sẵn sàng thanh toán.',
            genUi: kfcGenUiFixture(KfcGenUiWidgetKind.paymentOrderStatus),
          )
        : runId.contains('action_')
        ? CustomerChatResponse(
            responseText: 'Mình đã cập nhật giỏ hàng.',
            genUi: kfcGenUiFixture(KfcGenUiWidgetKind.cartBuilder),
          )
        : await sendMessage(
            sessionId: 'kfc:fixture',
            customerId: 'fixture',
            clientMessageId: runId,
            text: switch (runId) {
              final value when value.contains('fixture_cart_') =>
                'Thêm món vào giỏ',
              final value when value.contains('fixture_delivery_') =>
                'Kiểm tra giao hàng',
              final value when value.contains('fixture_confirm_') =>
                'Xác nhận thanh toán',
              final value when value.contains('fixture_support_') =>
                'Cho tôi gặp nhân viên',
              _ => 'Gợi ý combo',
            },
          );
    final raw = <(String, Map<String, Object?>)>[
      ('run_accepted', {'status': 'accepted'}),
      ('run_started', {'status': 'running'}),
      (
        'progress_updated',
        {
          'code': 'planning',
          'label': 'Đang hiểu yêu cầu của bạn',
          'cancellable': true,
        },
      ),
      (
        'progress_updated',
        {
          'code': 'verified',
          'label': 'Đã kiểm tra thông tin cần thiết',
          'cancellable': true,
        },
      ),
      ('text_started', {'text': ''}),
      ..._fixtureChunks(
        response.responseText,
      ).map((delta) => ('text_delta', <String, Object?>{'delta': delta})),
      if (response.genUi case final snapshot?)
        (
          'genui_revision',
          {
            'revision': 1,
            'snapshot': {...snapshot.toJson(), 'actions': <Object?>[]},
          },
        ),
      if (response.genUi case final snapshot?)
        ('genui_snapshot', {'snapshot': snapshot.toJson()}),
      (
        'run_completed',
        {'status': 'completed', 'responseText': response.responseText},
      ),
    ];
    for (var index = afterSequence; index < raw.length; index += 1) {
      if (eventDelay > Duration.zero) await Future<void>.delayed(eventDelay);
      final item = raw[index];
      yield CustomerRunEventEnvelope.fromJson({
        'schemaVersion': 1,
        'eventId': 'fixture_event_${index + 1}',
        'runId': runId,
        'sequence': index + 1,
        'type': item.$1,
        'occurredAt': DateTime(
          2026,
          7,
          11,
        ).add(Duration(milliseconds: index)).toIso8601String(),
        'payload': item.$2,
      });
    }
  }

  @override
  Future<CustomerRunCancelResponse> cancelRun(String runId) async =>
      CustomerRunCancelResponse(runId: runId, status: 'cancelling');

  @override
  Future<CustomerChatResponse> sendMessage({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required String text,
  }) async {
    final normalized = text.toLowerCase();
    if (normalized.contains('địa chỉ') || normalized.contains('giao')) {
      return CustomerChatResponse(
        responseText: 'KFC kiểm tra giao hàng cho địa chỉ của bạn.',
        genUi: kfcGenUiFixture(KfcGenUiWidgetKind.addressFulfillmentCheck),
      );
    }
    if (normalized.contains('giỏ') || normalized.contains('thêm')) {
      return CustomerChatResponse(
        responseText: 'Mình đã cập nhật giỏ hàng để bạn kiểm tra.',
        genUi: kfcGenUiFixture(KfcGenUiWidgetKind.cartBuilder),
      );
    }
    if (normalized.contains('xác nhận') || normalized.contains('thanh toán')) {
      return CustomerChatResponse(
        responseText: 'Bạn kiểm tra lần cuối trước khi đặt đơn.',
        genUi: kfcGenUiFixture(KfcGenUiWidgetKind.orderReviewConfirm),
      );
    }
    if (normalized.contains('nhân viên') || normalized.contains('khiếu nại')) {
      return CustomerChatResponse(
        responseText: 'Mình sẽ chuyển nhân viên hỗ trợ.',
        genUi: kfcGenUiFixture(KfcGenUiWidgetKind.supportHandoff),
      );
    }
    return CustomerChatResponse(
      responseText: 'Mình gợi ý vài món phù hợp để bạn chọn nhanh.',
      genUi: kfcGenUiFixture(KfcGenUiWidgetKind.smartMenuPicker),
    );
  }

  @override
  Future<CustomerChatResponse> submitGenUiAction({
    required String sessionId,
    required String customerId,
    required String clientMessageId,
    required KfcGenUiAction action,
  }) async {
    if (action.actionId == 'add_item' ||
        action.actionId == 'add_items' ||
        action.actionId == 'edit_cart' ||
        action.actionId == 'remove_item') {
      return CustomerChatResponse(
        responseText: 'Mình đã cập nhật giỏ hàng để bạn kiểm tra.',
        genUi: kfcGenUiFixture(KfcGenUiWidgetKind.cartBuilder),
      );
    }
    if (action.actionId == 'continue_to_fulfillment') {
      return CustomerChatResponse(
        responseText: 'KFC kiểm tra giao hàng cho địa chỉ của bạn.',
        genUi: kfcGenUiFixture(KfcGenUiWidgetKind.addressFulfillmentCheck),
      );
    }
    if (action.actionId == 'accept_fulfillment') {
      return CustomerChatResponse(
        responseText: 'Bạn kiểm tra lần cuối trước khi đặt đơn.',
        genUi: kfcGenUiFixture(KfcGenUiWidgetKind.orderReviewConfirm),
      );
    }
    if (action.actionId == 'confirm_order') {
      return CustomerChatResponse(
        responseText:
            'Đơn đã được ghi nhận. Bạn có thể theo dõi thanh toán và trạng thái giao hàng.',
        genUi: kfcGenUiFixture(KfcGenUiWidgetKind.paymentOrderStatus),
      );
    }
    if (action.actionId == 'open_payment' || action.actionId == 'track_order') {
      return CustomerChatResponse(
        responseText:
            'Thanh toán đã thành công. KFC đang chuẩn bị đơn của bạn.',
        genUi: kfcGenUiFixture(KfcGenUiWidgetKind.orderTrackingStatus),
      );
    }
    if (action.actionId == 'change_payment_method') {
      return CustomerChatResponse(
        responseText: 'Mình đang theo dõi thanh toán và trạng thái đơn.',
        genUi: kfcGenUiFixture(KfcGenUiWidgetKind.paymentOrderStatus),
      );
    }
    if (action.actionId == 'request_human' ||
        action.actionId == 'send_issue_summary') {
      return CustomerChatResponse(
        responseText: 'Nhân viên KFC sẽ tiếp nhận cuộc trò chuyện này.',
        genUi: kfcGenUiFixture(KfcGenUiWidgetKind.supportHandoff),
      );
    }
    return sendMessage(
      sessionId: sessionId,
      customerId: customerId,
      clientMessageId: clientMessageId,
      text: action.value ?? action.actionId,
    );
  }

  @override
  Future<CustomerChatSessionUpdates> getSessionUpdates({
    required String sessionId,
    String? afterTurnId,
  }) async {
    return const CustomerChatSessionUpdates(agentMode: 'ai_active', turns: []);
  }
}

List<String> _fixtureChunks(String text) {
  if (text.length < 3) return [text];
  final first = text.length ~/ 3;
  final second = (text.length * 2) ~/ 3;
  return [
    text.substring(0, first),
    text.substring(first, second),
    text.substring(second),
  ];
}

String _fixtureIntent(String text) {
  final normalized = text.toLowerCase();
  if (normalized.contains('thêm') || normalized.contains('giỏ')) return 'cart';
  if (normalized.contains('giao') || normalized.contains('địa chỉ')) {
    return 'delivery';
  }
  if (normalized.contains('xác nhận') || normalized.contains('thanh toán')) {
    return 'confirm';
  }
  if (normalized.contains('nhân viên') || normalized.contains('hỗ trợ')) {
    return 'support';
  }
  return 'menu';
}

KfcGenUiAttachment kfcGenUiFixture(KfcGenUiWidgetKind kind) {
  return switch (kind) {
    KfcGenUiWidgetKind.smartMenuPicker => const KfcGenUiAttachment(
      id: 'fixture_menu',
      lifecycleStage: 'menu',
      widgetKind: KfcGenUiWidgetKind.smartMenuPicker,
      status: KfcGenUiStatus.active,
      title: 'Chọn món KFC',
      summary: 'Gợi ý theo nhu cầu hiện tại',
      data: {
        'items': [
          {
            'code': '20751',
            'name': 'Combo Hợp Gu 99K',
            'priceVnd': 99000,
            'imageUrl':
                'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL',
          },
          {
            'code': '2945',
            'name': 'Xô Zòn Zã 159K',
            'priceVnd': 159000,
            'imageUrl':
                'https://static.kfcvietnam.com.vn/images/items/lg/FS-BUCKET5COB.jpg?v=LNN7PL',
          },
          {
            'code': 'burger-flava',
            'name': 'Burger Phi-lê Gà Quay',
            'priceVnd': 56000,
            'imageUrl':
                'https://static.kfcvietnam.com.vn/images/items/lg/Burger-Flava.jpg?v=LNN7PL',
          },
        ],
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'add_items',
          label: 'Xác nhận món',
          intent: KfcGenUiActionIntent.primary,
        ),
      ],
    ),
    KfcGenUiWidgetKind.productDetailCard => const KfcGenUiAttachment(
      id: 'fixture_detail',
      lifecycleStage: 'menu_detail',
      widgetKind: KfcGenUiWidgetKind.productDetailCard,
      status: KfcGenUiStatus.active,
      title: 'Chi tiết món',
      data: {
        'item': {
          'code': 'burger-flava',
          'name': 'Burger Phi-lê Gà Quay',
          'description': 'Burger với phi-lê gà quay',
          'priceVnd': 56000,
          'media': _fixtureBurgerMedia,
        },
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'add_item',
          label: 'Thêm vào giỏ',
          intent: KfcGenUiActionIntent.primary,
          payload: {'itemCode': 'burger-flava', 'quantity': 1},
        ),
      ],
    ),
    KfcGenUiWidgetKind.modifierPicker => const KfcGenUiAttachment(
      id: 'fixture_modifier',
      lifecycleStage: 'modifier',
      widgetKind: KfcGenUiWidgetKind.modifierPicker,
      status: KfcGenUiStatus.active,
      title: 'Tùy chỉnh món',
      data: {
        'productName': 'Tùy chỉnh 3 Miếng Gà',
        'parentMedia': _fixtureChickenMedia,
        'modifierTree': {
          'itemCode': 'three-chicken',
          'name': '3 Miếng Gà',
          'modifierGroups': [
            {
              'groupId': 'flavor',
              'name': 'Loại gà',
              'options': [
                {'modifierId': 'hot-spicy', 'name': 'Gà Giòn Cay'},
                {'modifierId': 'keep-current', 'name': 'Giữ lựa chọn hiện tại'},
              ],
            },
          ],
        },
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'customize_item:flavor:hot-spicy',
          label: 'Gà Giòn Cay',
          value: 'Gà Giòn Cay',
          payload: {
            'itemCode': 'three-chicken',
            'groupId': 'flavor',
            'modifierId': 'hot-spicy',
          },
        ),
        KfcGenUiActionSpec(
          id: 'customize_item:flavor:keep-current',
          label: 'Giữ lựa chọn hiện tại',
          value: 'Giữ lựa chọn hiện tại',
          payload: {
            'itemCode': 'three-chicken',
            'groupId': 'flavor',
            'modifierId': 'keep-current',
          },
        ),
      ],
    ),
    KfcGenUiWidgetKind.promotionGallery => const KfcGenUiAttachment(
      id: 'fixture_promotions',
      lifecycleStage: 'promotion',
      widgetKind: KfcGenUiWidgetKind.promotionGallery,
      status: KfcGenUiStatus.active,
      title: 'Khuyến mãi đang áp dụng',
      data: {
        'promotions': [
          {
            'id': 'lunch-2026',
            'title': 'Trưa Nay Khỏi Nghĩ Nhiều',
            'startDate': '2026-01-02',
            'endDate': '2026-12-31',
            'eligibility': '10:00–14:00, thứ Hai đến thứ Sáu',
            'media': _fixtureLunchPromotionMedia,
          },
        ],
      },
      actions: [],
    ),
    KfcGenUiWidgetKind.allergenEvidence => const KfcGenUiAttachment(
      id: 'fixture_allergen',
      lifecycleStage: 'allergen',
      widgetKind: KfcGenUiWidgetKind.allergenEvidence,
      status: KfcGenUiStatus.active,
      title: 'Thông tin dị ứng',
      data: {
        'item': {'code': 'burger-flava', 'name': 'Burger Phi-lê Gà Quay'},
        'evidence':
            'Thông tin dị ứng cần dựa trên bảng công bố chính thức của KFC.',
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'open_allergen_chart',
          label: 'Xem bảng dị ứng',
          payload: {
            'sourceUrl': 'https://www.kfcvietnam.com.vn/allergen-chart',
          },
        ),
      ],
    ),
    KfcGenUiWidgetKind.cartBuilder => const KfcGenUiAttachment(
      id: 'fixture_cart',
      lifecycleStage: 'cart',
      widgetKind: KfcGenUiWidgetKind.cartBuilder,
      status: KfcGenUiStatus.active,
      title: 'Giỏ hàng',
      data: {
        'cart': {
          'items': [
            {
              'itemCode': 'combo_zinger',
              'name': 'Combo Zinger',
              'quantity': 1,
              'unitPriceVnd': 89000,
              'imageUrl':
                  'https://static.kfcvietnam.com.vn/images/items/lg/COMBO-ZINGER.jpg?v=LNN7PL',
            },
            {
              'itemCode': 'pepsi_large',
              'name': 'Pepsi lớn',
              'quantity': 2,
              'unitPriceVnd': 19000,
              'imageUrl':
                  'https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-L.jpg?v=LNN7PL',
            },
          ],
          'subtotalVnd': 127000,
          'deliveryFeeVnd': 18000,
          'totalVnd': 145000,
        },
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'continue_to_fulfillment',
          label: 'Tiếp tục giao hàng',
          intent: KfcGenUiActionIntent.primary,
        ),
        KfcGenUiActionSpec(id: 'edit_cart', label: 'Sửa giỏ hàng'),
        KfcGenUiActionSpec(id: 'update_item_quantity', label: 'Đổi số lượng'),
        KfcGenUiActionSpec(
          id: 'remove_item',
          label: 'Xóa Pepsi',
          intent: KfcGenUiActionIntent.destructive,
          value: 'Pepsi lớn',
        ),
      ],
    ),
    KfcGenUiWidgetKind.addressFulfillmentCheck => const KfcGenUiAttachment(
      id: 'fixture_fulfillment',
      lifecycleStage: 'fulfillment',
      widgetKind: KfcGenUiWidgetKind.addressFulfillmentCheck,
      status: KfcGenUiStatus.active,
      title: 'Giao hàng',
      summary: 'KFC Nguyễn Văn Linh còn đủ món',
      data: {
        'address': '12 Nguyễn Văn Linh, Quận 7',
        'fulfillment': {
          'storeName': 'KFC Nguyễn Văn Linh',
          'etaMinutes': 28,
          'feeVnd': 18000,
        },
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'accept_fulfillment',
          label: 'Giao đến địa chỉ này',
          intent: KfcGenUiActionIntent.primary,
          value: '12 Nguyễn Văn Linh, Quận 7',
        ),
        KfcGenUiActionSpec(id: 'submit_address', label: 'Đổi địa chỉ'),
      ],
    ),
    KfcGenUiWidgetKind.orderReviewConfirm => const KfcGenUiAttachment(
      id: 'fixture_review',
      lifecycleStage: 'checkout',
      widgetKind: KfcGenUiWidgetKind.orderReviewConfirm,
      status: KfcGenUiStatus.active,
      title: 'Xác nhận đơn',
      summary: 'Chỉ nút này được phép đặt đơn',
      data: {
        'cart': {
          'items': [
            {
              'itemCode': 'combo_zinger',
              'name': 'Combo Zinger',
              'quantity': 1,
              'unitPriceVnd': 89000,
              'category': 'main',
              'imageUrl':
                  'https://static.kfcvietnam.com.vn/images/items/lg/COMBO-ZINGER.jpg?v=LNN7PL',
            },
            {
              'itemCode': 'pepsi_large',
              'name': 'Pepsi lớn',
              'quantity': 2,
              'unitPriceVnd': 19000,
              'category': 'drink',
              'imageUrl':
                  'https://static.kfcvietnam.com.vn/images/items/lg/PEPSI-L.jpg?v=LNN7PL',
            },
          ],
          'subtotalVnd': 127000,
          'deliveryFeeVnd': 18000,
          'totalVnd': 145000,
        },
        'fulfillment': {
          'storeName': 'KFC Nguyễn Văn Linh',
          'etaMinutes': 28,
          'feeVnd': 18000,
        },
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'confirm_order',
          label: 'Đặt đơn 145.000đ',
          intent: KfcGenUiActionIntent.primary,
          value: 'confirmed',
        ),
        KfcGenUiActionSpec(id: 'apply_voucher', label: 'Áp mã giảm giá'),
      ],
    ),
    KfcGenUiWidgetKind.paymentOrderStatus => const KfcGenUiAttachment(
      id: 'fixture_status',
      lifecycleStage: 'post_order',
      widgetKind: KfcGenUiWidgetKind.paymentOrderStatus,
      status: KfcGenUiStatus.active,
      title: 'Thanh toán và đơn hàng',
      summary: 'Chờ thanh toán MoMo',
      data: {
        'order': {'orderCode': 'KFC-1024', 'status': 'created'},
        'paymentAttempt': {
          'method': 'momo',
          'status': 'pending',
          'amountVnd': 145000,
        },
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'open_payment',
          label: 'Thanh toán MoMo',
          intent: KfcGenUiActionIntent.primary,
          value: 'MoMo',
        ),
        KfcGenUiActionSpec(
          id: 'change_payment_method',
          label: 'Đổi phương thức',
        ),
      ],
    ),
    KfcGenUiWidgetKind.orderTrackingStatus => const KfcGenUiAttachment(
      id: 'fixture_tracking',
      lifecycleStage: 'post_payment',
      widgetKind: KfcGenUiWidgetKind.orderTrackingStatus,
      status: KfcGenUiStatus.active,
      title: 'Đơn đã thanh toán',
      summary: 'KFC Nguyễn Văn Linh đang chuẩn bị',
      data: {
        'order': {'orderCode': 'KFC-1024', 'status': 'preparing'},
        'paymentAttempt': {
          'method': 'momo',
          'status': 'paid',
          'amountVnd': 145000,
        },
        'fulfillment': {
          'storeName': 'KFC Nguyễn Văn Linh',
          'etaMinutes': 28,
          'feeVnd': 18000,
        },
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'track_order',
          label: 'Theo dõi đơn',
          intent: KfcGenUiActionIntent.primary,
          value: 'KFC-1024',
        ),
      ],
    ),
    KfcGenUiWidgetKind.supportHandoff => const KfcGenUiAttachment(
      id: 'fixture_support',
      lifecycleStage: 'support',
      widgetKind: KfcGenUiWidgetKind.supportHandoff,
      status: KfcGenUiStatus.active,
      title: 'Nhân viên hỗ trợ',
      summary: 'Ưu tiên cuộc trò chuyện có rủi ro cao',
      data: {
        'reasons': ['payment_failed', 'customer_requested_human'],
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'request_human',
          label: 'Gặp nhân viên ngay',
          intent: KfcGenUiActionIntent.primary,
        ),
        KfcGenUiActionSpec(id: 'send_issue_summary', label: 'Gửi tóm tắt lỗi'),
      ],
    ),
    KfcGenUiWidgetKind.paymentMethodPicker => const KfcGenUiAttachment(
      id: 'fixture_payment_methods',
      lifecycleStage: 'payment_method',
      widgetKind: KfcGenUiWidgetKind.paymentMethodPicker,
      status: KfcGenUiStatus.active,
      title: 'Chọn phương thức thanh toán',
      data: {
        'methods': [
          {
            'methodId': 'cod',
            'displayName': 'Thanh toán khi nhận hàng',
            'category': 'cash_on_delivery',
            'supported': true,
          },
          {
            'methodId': 'zalopay',
            'displayName': 'Ví ZaloPay',
            'category': 'digital_wallet',
            'supported': true,
          },
          {
            'methodId': 'momo',
            'displayName': 'Ví MoMo',
            'category': 'digital_wallet',
            'supported': false,
          },
        ],
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'select_payment_method',
          label: 'Chọn phương thức',
        ),
      ],
    ),
  };
}

const _fixtureBurgerMedia = <String, Object?>{
  'mediaKey': 'kfcvn:item-image:burger-flava',
  'url':
      'https://static.kfcvietnam.com.vn/images/items/lg/Burger-Flava.jpg?v=LNN7PL',
  'altText': 'Burger Phi-lê Gà Quay của KFC',
};
const _fixtureChickenMedia = <String, Object?>{
  'mediaKey': 'kfcvn:item-image:3-fried-chicken',
  'url':
      'https://static.kfcvietnam.com.vn/images/items/lg/3-Fried-Chicken.jpg?v=LNN7PL',
  'altText': 'Ba miếng gà KFC',
};
const _fixtureLunchPromotionMedia = <String, Object?>{
  'mediaKey': 'kfcvn:promotion-image:lunch-2026',
  'url':
      'https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg',
  'altText': 'Khuyến mãi bữa trưa KFC năm 2026',
};
