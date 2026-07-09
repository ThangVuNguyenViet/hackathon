import 'package:flutter/widgets.dart';

import '../../domain/kfc_genui_models.dart';
import 'widgets/address_fulfillment_check.dart';
import 'widgets/cart_builder.dart';
import 'widgets/order_review_confirm.dart';
import 'widgets/order_tracking_status.dart';
import 'widgets/payment_order_status.dart';
import 'widgets/smart_menu_picker.dart';
import 'widgets/support_handoff.dart';

class KfcGenUiRenderer extends StatelessWidget {
  const KfcGenUiRenderer({
    super.key,
    required this.attachment,
    required this.onAction,
  });

  final KfcGenUiAttachment attachment;
  final ValueChanged<KfcGenUiAction> onAction;

  @override
  Widget build(BuildContext context) {
    return switch (attachment.widgetKind) {
      KfcGenUiWidgetKind.smartMenuPicker => SmartMenuPicker(
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
      ),
    };
  }
}
