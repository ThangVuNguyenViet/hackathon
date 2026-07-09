import 'dart:convert';

import 'package:http/http.dart' as http;

import '../domain/kfc_genui_models.dart';

abstract interface class CustomerChatRepository {
  Future<CustomerChatResponse> sendMessage({
    required String sessionId,
    required String customerId,
    required String text,
  });

  Future<CustomerChatResponse> submitGenUiAction({
    required String sessionId,
    required String customerId,
    required KfcGenUiAction action,
  });
}

class BackendCustomerChatRepository implements CustomerChatRepository {
  BackendCustomerChatRepository({required String baseUrl, http.Client? client})
    : _baseUri = Uri.parse(baseUrl),
      _client = client ?? http.Client();

  final Uri _baseUri;
  final http.Client _client;

  @override
  Future<CustomerChatResponse> sendMessage({
    required String sessionId,
    required String customerId,
    required String text,
  }) async {
    return _post('/chat/mock', {
      'sessionId': sessionId,
      'customerId': customerId,
      'channel': 'web_mock',
      'text': text,
    });
  }

  @override
  Future<CustomerChatResponse> submitGenUiAction({
    required String sessionId,
    required String customerId,
    required KfcGenUiAction action,
  }) async {
    return _post('/chat/genui-action', {
      'sessionId': sessionId,
      'customerId': customerId,
      'channel': 'web_mock',
      'action': action.toJson(),
    });
  }

  Future<CustomerChatResponse> _post(
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
        'KFC customer chat request failed: ${response.statusCode} $path',
      );
    }
    return CustomerChatResponse.fromJson(
      jsonDecode(response.body) as Map<String, Object?>,
    );
  }
}

class FixtureCustomerChatRepository implements CustomerChatRepository {
  const FixtureCustomerChatRepository();

  @override
  Future<CustomerChatResponse> sendMessage({
    required String sessionId,
    required String customerId,
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
    required KfcGenUiAction action,
  }) async {
    if (action.actionId == 'add_item' ||
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
    if (action.actionId == 'open_payment' ||
        action.actionId == 'change_payment_method' ||
        action.actionId == 'track_order') {
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
      text: action.value ?? action.actionId,
    );
  }
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
          {'name': 'Combo Zinger', 'priceVnd': 89000, 'tag': 'Bán chạy'},
          {'name': 'Gà rán 2 miếng', 'priceVnd': 76000, 'tag': 'Giòn cay'},
          {'name': 'Burger Tôm', 'priceVnd': 59000, 'tag': 'Nhẹ bụng'},
        ],
      },
      actions: [
        KfcGenUiActionSpec(
          id: 'add_item',
          label: 'Thêm vào giỏ',
          intent: KfcGenUiActionIntent.primary,
          value: 'Combo Zinger',
        ),
        KfcGenUiActionSpec(
          id: 'customize_item',
          label: 'Tùy chỉnh combo',
          value: 'Combo Zinger',
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
            {'name': 'Combo Zinger', 'quantity': 1, 'unitPriceVnd': 89000},
            {'name': 'Pepsi lớn', 'quantity': 2, 'unitPriceVnd': 19000},
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
            {'name': 'Combo Zinger', 'quantity': 1, 'unitPriceVnd': 89000},
            {'name': 'Pepsi lớn', 'quantity': 2, 'unitPriceVnd': 19000},
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
        KfcGenUiActionSpec(id: 'track_order', label: 'Theo dõi đơn'),
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
  };
}
