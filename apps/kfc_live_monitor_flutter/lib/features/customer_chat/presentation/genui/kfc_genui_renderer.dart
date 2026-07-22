import 'package:flutter/widgets.dart';

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

class KfcGenUiRenderer extends StatelessWidget {
  const KfcGenUiRenderer({
    super.key,
    required this.attachment,
    required this.onAction,
    this.handoffStatus,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;
  final String? handoffStatus;

  @override
  Widget build(BuildContext context) {
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
