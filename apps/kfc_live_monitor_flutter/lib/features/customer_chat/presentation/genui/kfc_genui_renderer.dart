import 'package:flutter/widgets.dart';

import '../../../../app/theme/kfc_ops_tokens.dart';
import '../../domain/kfc_genui_models.dart';
import 'widgets/address_fulfillment_check.dart';
import 'widgets/allergen_evidence.dart';
import 'widgets/cart_builder.dart';
import 'widgets/full_menu_browser.dart';
import 'widgets/modifier_picker.dart';
import 'widgets/order_review_confirm.dart';
import 'widgets/order_tracking_status.dart';
import 'widgets/payment_order_status.dart';
import 'widgets/payment_method_picker.dart';
import 'widgets/product_detail_card.dart';
import 'widgets/promotion_gallery.dart';
import 'widgets/smart_menu_picker.dart';
import 'widgets/support_handoff.dart';
import 'widgets/genui_widget_chrome.dart';

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
      KfcGenUiWidgetKind.fullMenuBrowser => FullMenuBrowser(
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
    final summary = completed
        ? actionLabel == null
              ? 'Đã hoàn tất'
              : 'Đã hoàn tất · $actionLabel'
        : 'Nội dung trước đó · chỉ xem';
    return GenUiWidgetChrome(
      attachment: attachment,
      onAction: (_) {},
      showActions: false,
      displaySummary: summary,
      children: [
        Text(
          _verifiedCompletionSummary(attachment) ??
              attachment.summary ??
              summary,
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
  if (actionId == 'update_cart' || actionId == 'continue_to_fulfillment') {
    final quantities = <String, int>{
      for (final item in genUiList(payload['items']))
        genUiText(item['itemCode'], fallback: ''):
            (item['quantity'] as num?)?.toInt() ?? 0,
    };
    final names = [
      for (final item in genUiList(genUiMap(attachment.data['cart'])['items']))
        if ((quantities[genUiText(item['itemCode'], fallback: '')] ?? 0) > 0)
          '${quantities[genUiText(item['itemCode'], fallback: '')]} × '
              '${genUiText(item['name'], fallback: 'Món KFC')}',
    ];
    return names.isEmpty ? 'Giỏ hàng trống' : names.join(', ');
  }
  if (actionId == 'apply_modifiers') {
    final tree = genUiMap(attachment.data['modifierTree']);
    final optionNames = <String>[];
    for (final selection in genUiList(payload['selections'])) {
      final groupId = genUiText(selection['groupId'], fallback: '');
      final modifierId = genUiText(selection['modifierId'], fallback: '');
      for (final group in genUiList(tree['modifierGroups'])) {
        if (genUiText(group['groupId'], fallback: '') != groupId) continue;
        for (final option in genUiList(group['options'])) {
          if (genUiText(option['modifierId'], fallback: '') == modifierId) {
            optionNames.add(genUiText(option['name'], fallback: ''));
          }
        }
      }
    }
    return optionNames.where((name) => name.isNotEmpty).join(', ');
  }
  return null;
}
