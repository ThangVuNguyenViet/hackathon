import 'package:flutter/widgets.dart';

import '../../../../app/theme/kfc_ops_tokens.dart';
import '../../domain/kfc_genui_models.dart';
import 'widgets/address_fulfillment_check.dart';
import 'widgets/allergen_evidence.dart';
import 'widgets/cart_builder.dart';
import 'widgets/genui_widget_chrome.dart';
import 'widgets/modifier_picker.dart';
import 'widgets/order_review_confirm.dart';
import 'widgets/order_tracking_status.dart';
import 'widgets/payment_order_status.dart';
import 'widgets/payment_method_picker.dart';
import 'widgets/product_detail_card.dart';
import 'widgets/promotion_gallery.dart';
import 'widgets/smart_menu_picker.dart';
import 'widgets/support_handoff.dart';

class KfcGenUiRenderer extends StatelessWidget {
  const KfcGenUiRenderer({
    super.key,
    required this.attachment,
    required this.onAction,
    this.handoffStatus,
    this.interactive = true,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;
  final String? handoffStatus;
  final bool interactive;

  @override
  Widget build(BuildContext context) {
    if (attachment.status == KfcGenUiStatus.answered ||
        (!interactive && attachment.canSubmitActions)) {
      return _CollapsedGenUiSummary(
        attachment: attachment,
        completed: attachment.status == KfcGenUiStatus.answered,
      );
    }
    return switch (attachment.widgetKind) {
      KfcGenUiWidgetKind.smartMenuPicker => SmartMenuPicker(
        attachment: attachment,
        onAction: onAction,
      ),
      KfcGenUiWidgetKind.productDetailCard => ProductDetailCard(
        attachment: attachment,
        onAction: onAction,
      ),
      KfcGenUiWidgetKind.modifierPicker => ModifierPicker(
        attachment: attachment,
        onAction: onAction,
      ),
      KfcGenUiWidgetKind.promotionGallery => PromotionGallery(
        attachment: attachment,
        onAction: onAction,
      ),
      KfcGenUiWidgetKind.allergenEvidence => AllergenEvidence(
        attachment: attachment,
        onAction: onAction,
      ),
      KfcGenUiWidgetKind.cartBuilder => CartBuilder(
        attachment: attachment,
        onAction: onAction,
      ),
      KfcGenUiWidgetKind.addressFulfillmentCheck => AddressFulfillmentCheck(
        attachment: attachment,
        onAction: onAction,
      ),
      KfcGenUiWidgetKind.orderReviewConfirm => OrderReviewConfirm(
        attachment: attachment,
        onAction: onAction,
      ),
      KfcGenUiWidgetKind.paymentOrderStatus => PaymentOrderStatus(
        attachment: attachment,
        onAction: onAction,
      ),
      KfcGenUiWidgetKind.orderTrackingStatus => OrderTrackingStatus(
        attachment: attachment,
        onAction: onAction,
      ),
      KfcGenUiWidgetKind.supportHandoff => SupportHandoff(
        attachment: attachment,
        onAction: onAction,
        handoffStatus: handoffStatus,
      ),
      KfcGenUiWidgetKind.paymentMethodPicker => PaymentMethodPicker(
        attachment: attachment,
        onAction: onAction,
      ),
    };
  }
}

class _CollapsedGenUiSummary extends StatelessWidget {
  const _CollapsedGenUiSummary({
    required this.attachment,
    required this.completed,
  });

  final KfcGenUiAttachment attachment;
  final bool completed;

  @override
  Widget build(BuildContext context) {
    final actionLabel = attachment.actions
        .where((action) => action.id == attachment.selectedAction)
        .map((action) => action.label)
        .firstOrNull;
    final statusSummary = completed
        ? actionLabel == null
              ? 'Đã hoàn tất'
              : 'Đã hoàn tất · $actionLabel'
        : 'Nội dung trước đó · chỉ xem';
    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: (_) {},
      showActions: false,
      displaySummary: statusSummary,
      children: [
        Text(
          _verifiedCompletionSummary(attachment) ??
              attachment.summary ??
              statusSummary,
          style: const TextStyle(
            color: KfcOpsTokens.secondary,
            fontSize: 13,
            height: 18 / 13,
          ),
        ),
      ],
    );
  }
}

String? _verifiedCompletionSummary(KfcGenUiAttachment attachment) {
  final completed = genUiMap(attachment.data['_completedAction']);
  final payload = genUiMap(completed['payload']);
  final actionId = genUiText(completed['actionId'], fallback: '');

  if (actionId == 'add_items' ||
      actionId == 'add_item' ||
      actionId == 'update_cart' ||
      actionId == 'continue_to_fulfillment') {
    final quantities = <String, int>{};
    for (final item in genUiList(payload['items'])) {
      final itemCode = genUiText(
        item['itemCode'] ?? item['code'],
        fallback: '',
      );
      final quantity = (item['quantity'] as num?)?.toInt() ?? 0;
      if (itemCode.isNotEmpty && quantity > 0) quantities[itemCode] = quantity;
    }
    final singleItemCode = genUiText(
      payload['itemCode'] ?? payload['code'],
      fallback: '',
    );
    final singleQuantity = (payload['quantity'] as num?)?.toInt() ?? 0;
    if (singleItemCode.isNotEmpty && singleQuantity > 0) {
      quantities[singleItemCode] = singleQuantity;
    }

    final sourceItems = <Map<String, Object?>>[
      ...genUiList(attachment.data['items']),
      ...genUiList(genUiMap(attachment.data['cart'])['items']),
      if (genUiMap(attachment.data['item']).isNotEmpty)
        genUiMap(attachment.data['item']),
    ];
    final names = <String>[];
    for (final item in sourceItems) {
      final itemCode = genUiText(
        item['itemCode'] ?? item['code'],
        fallback: '',
      );
      final quantity = quantities.remove(itemCode) ?? 0;
      if (quantity <= 0) continue;
      names.add('$quantity × ${genUiText(item['name'], fallback: 'Món KFC')}');
    }
    for (final entry in quantities.entries) {
      names.add('${entry.value} × Món KFC');
    }
    if (names.isNotEmpty) return names.join(', ');
    if (actionId == 'update_cart' || actionId == 'continue_to_fulfillment') {
      return 'Giỏ hàng trống';
    }
  }

  if (actionId == 'apply_modifiers') {
    final namesByIdentity = <String, String>{};
    void visitGroups(List<Map<String, Object?>> groups) {
      for (final group in groups) {
        final groupId = genUiText(group['groupId'], fallback: '');
        for (final option in genUiList(group['options'])) {
          final modifierId = genUiText(option['modifierId'], fallback: '');
          final name = genUiText(option['name'], fallback: '');
          if (groupId.isNotEmpty && modifierId.isNotEmpty && name.isNotEmpty) {
            namesByIdentity['$groupId\u0000$modifierId'] = name;
          }
          visitGroups(genUiList(option['modifierGroups']));
        }
      }
    }

    visitGroups(
      genUiList(genUiMap(attachment.data['modifierTree'])['modifierGroups']),
    );
    final names = <String>[];
    for (final selection in genUiList(payload['selections'])) {
      final groupId = genUiText(selection['groupId'], fallback: '');
      final modifierId = genUiText(selection['modifierId'], fallback: '');
      final name = namesByIdentity['$groupId\u0000$modifierId'];
      if (name != null) names.add(name);
    }
    if (names.isNotEmpty) return names.join(', ');
  }

  if (actionId == 'select_payment_method') {
    final methodId = genUiText(payload['methodId'], fallback: '');
    for (final method in genUiList(attachment.data['methods'])) {
      if (genUiText(method['id'] ?? method['methodId'], fallback: '') ==
          methodId) {
        return genUiText(method['name'], fallback: 'Đã chọn thanh toán');
      }
    }
  }

  return null;
}
