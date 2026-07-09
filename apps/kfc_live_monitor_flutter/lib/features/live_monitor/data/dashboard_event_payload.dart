import 'package:dart_mappable/dart_mappable.dart';

part 'dashboard_event_payload.mapper.dart';

@MappableEnum()
enum DashboardEventType {
  @MappableValue('session_updated')
  sessionUpdated,
  @MappableValue('conversation_turn_created')
  conversationTurnCreated,
  @MappableValue('customer_message_received')
  customerMessageReceived,
  @MappableValue('assistant_reply_sent')
  assistantReplySent,
  @MappableValue('cart_changed')
  cartChanged,
  @MappableValue('voucher_applied')
  voucherApplied,
  @MappableValue('voucher_rejected')
  voucherRejected,
  @MappableValue('payment_link_created')
  paymentLinkCreated,
  @MappableValue('payment_failed')
  paymentFailed,
  @MappableValue('payment_paid')
  paymentPaid,
  @MappableValue('order_previewed')
  orderPreviewed,
  @MappableValue('order_created')
  orderCreated,
  @MappableValue('handoff_required')
  handoffRequired,
  @MappableValue('session_resolved')
  sessionResolved,
}

@MappableClass()
class DashboardEventPayload with DashboardEventPayloadMappable {
  const DashboardEventPayload({
    required this.id,
    required this.sessionId,
    required this.type,
    required this.payload,
    required this.createdAt,
  });

  final String id;
  final String sessionId;
  final DashboardEventType type;
  final Map<String, dynamic> payload;
  final DateTime createdAt;

  static final fromMap = DashboardEventPayloadMapper.fromMap;
  static final fromJson = DashboardEventPayloadMapper.fromJson;
}
