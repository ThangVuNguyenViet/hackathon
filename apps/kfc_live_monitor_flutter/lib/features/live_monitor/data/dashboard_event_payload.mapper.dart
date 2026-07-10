// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
// ignore_for_file: type=lint
// ignore_for_file: invalid_use_of_protected_member
// ignore_for_file: unused_element, unnecessary_cast, override_on_non_overriding_member
// ignore_for_file: strict_raw_type, inference_failure_on_untyped_parameter

part of 'dashboard_event_payload.dart';

class DashboardEventTypeMapper extends EnumMapper<DashboardEventType> {
  DashboardEventTypeMapper._();

  static DashboardEventTypeMapper? _instance;
  static DashboardEventTypeMapper ensureInitialized() {
    if (_instance == null) {
      MapperContainer.globals.use(_instance = DashboardEventTypeMapper._());
    }
    return _instance!;
  }

  static DashboardEventType fromValue(dynamic value) {
    ensureInitialized();
    return MapperContainer.globals.fromValue(value);
  }

  @override
  DashboardEventType decode(dynamic value) {
    switch (value) {
      case 'session_updated':
        return DashboardEventType.sessionUpdated;
      case 'conversation_turn_created':
        return DashboardEventType.conversationTurnCreated;
      case 'customer_message_received':
        return DashboardEventType.customerMessageReceived;
      case 'assistant_reply_sent':
        return DashboardEventType.assistantReplySent;
      case 'agent_run_pending':
        return DashboardEventType.agentRunPending;
      case 'agent_run_scheduled':
        return DashboardEventType.agentRunScheduled;
      case 'agent_run_started':
        return DashboardEventType.agentRunStarted;
      case 'agent_run_superseded':
        return DashboardEventType.agentRunSuperseded;
      case 'agent_run_delivery_suppressed':
        return DashboardEventType.agentRunDeliverySuppressed;
      case 'agent_run_delivered':
        return DashboardEventType.agentRunDelivered;
      case 'cart_changed':
        return DashboardEventType.cartChanged;
      case 'voucher_applied':
        return DashboardEventType.voucherApplied;
      case 'voucher_rejected':
        return DashboardEventType.voucherRejected;
      case 'payment_link_created':
        return DashboardEventType.paymentLinkCreated;
      case 'payment_failed':
        return DashboardEventType.paymentFailed;
      case 'payment_paid':
        return DashboardEventType.paymentPaid;
      case 'order_previewed':
        return DashboardEventType.orderPreviewed;
      case 'order_created':
        return DashboardEventType.orderCreated;
      case 'handoff_required':
        return DashboardEventType.handoffRequired;
      case 'session_resolved':
        return DashboardEventType.sessionResolved;
      default:
        throw MapperException.unknownEnumValue(value);
    }
  }

  @override
  dynamic encode(DashboardEventType self) {
    switch (self) {
      case DashboardEventType.sessionUpdated:
        return 'session_updated';
      case DashboardEventType.conversationTurnCreated:
        return 'conversation_turn_created';
      case DashboardEventType.customerMessageReceived:
        return 'customer_message_received';
      case DashboardEventType.assistantReplySent:
        return 'assistant_reply_sent';
      case DashboardEventType.agentRunPending:
        return 'agent_run_pending';
      case DashboardEventType.agentRunScheduled:
        return 'agent_run_scheduled';
      case DashboardEventType.agentRunStarted:
        return 'agent_run_started';
      case DashboardEventType.agentRunSuperseded:
        return 'agent_run_superseded';
      case DashboardEventType.agentRunDeliverySuppressed:
        return 'agent_run_delivery_suppressed';
      case DashboardEventType.agentRunDelivered:
        return 'agent_run_delivered';
      case DashboardEventType.cartChanged:
        return 'cart_changed';
      case DashboardEventType.voucherApplied:
        return 'voucher_applied';
      case DashboardEventType.voucherRejected:
        return 'voucher_rejected';
      case DashboardEventType.paymentLinkCreated:
        return 'payment_link_created';
      case DashboardEventType.paymentFailed:
        return 'payment_failed';
      case DashboardEventType.paymentPaid:
        return 'payment_paid';
      case DashboardEventType.orderPreviewed:
        return 'order_previewed';
      case DashboardEventType.orderCreated:
        return 'order_created';
      case DashboardEventType.handoffRequired:
        return 'handoff_required';
      case DashboardEventType.sessionResolved:
        return 'session_resolved';
    }
  }
}

extension DashboardEventTypeMapperExtension on DashboardEventType {
  dynamic toValue() {
    DashboardEventTypeMapper.ensureInitialized();
    return MapperContainer.globals.toValue<DashboardEventType>(this);
  }
}

class DashboardEventPayloadMapper
    extends ClassMapperBase<DashboardEventPayload> {
  DashboardEventPayloadMapper._();

  static DashboardEventPayloadMapper? _instance;
  static DashboardEventPayloadMapper ensureInitialized() {
    if (_instance == null) {
      MapperContainer.globals.use(_instance = DashboardEventPayloadMapper._());
      DashboardEventTypeMapper.ensureInitialized();
    }
    return _instance!;
  }

  @override
  final String id = 'DashboardEventPayload';

  static String _$id(DashboardEventPayload v) => v.id;
  static const Field<DashboardEventPayload, String> _f$id = Field('id', _$id);
  static String _$sessionId(DashboardEventPayload v) => v.sessionId;
  static const Field<DashboardEventPayload, String> _f$sessionId = Field(
    'sessionId',
    _$sessionId,
  );
  static DashboardEventType _$type(DashboardEventPayload v) => v.type;
  static const Field<DashboardEventPayload, DashboardEventType> _f$type = Field(
    'type',
    _$type,
  );
  static Map<String, dynamic> _$payload(DashboardEventPayload v) => v.payload;
  static const Field<DashboardEventPayload, Map<String, dynamic>> _f$payload =
      Field('payload', _$payload);
  static DateTime _$createdAt(DashboardEventPayload v) => v.createdAt;
  static const Field<DashboardEventPayload, DateTime> _f$createdAt = Field(
    'createdAt',
    _$createdAt,
  );

  @override
  final MappableFields<DashboardEventPayload> fields = const {
    #id: _f$id,
    #sessionId: _f$sessionId,
    #type: _f$type,
    #payload: _f$payload,
    #createdAt: _f$createdAt,
  };

  static DashboardEventPayload _instantiate(DecodingData data) {
    return DashboardEventPayload(
      id: data.dec(_f$id),
      sessionId: data.dec(_f$sessionId),
      type: data.dec(_f$type),
      payload: data.dec(_f$payload),
      createdAt: data.dec(_f$createdAt),
    );
  }

  @override
  final Function instantiate = _instantiate;

  static DashboardEventPayload fromMap(Map<String, dynamic> map) {
    return ensureInitialized().decodeMap<DashboardEventPayload>(map);
  }

  static DashboardEventPayload fromJson(String json) {
    return ensureInitialized().decodeJson<DashboardEventPayload>(json);
  }
}

mixin DashboardEventPayloadMappable {
  String toJson() {
    return DashboardEventPayloadMapper.ensureInitialized()
        .encodeJson<DashboardEventPayload>(this as DashboardEventPayload);
  }

  Map<String, dynamic> toMap() {
    return DashboardEventPayloadMapper.ensureInitialized()
        .encodeMap<DashboardEventPayload>(this as DashboardEventPayload);
  }

  DashboardEventPayloadCopyWith<
    DashboardEventPayload,
    DashboardEventPayload,
    DashboardEventPayload
  >
  get copyWith =>
      _DashboardEventPayloadCopyWithImpl<
        DashboardEventPayload,
        DashboardEventPayload
      >(this as DashboardEventPayload, $identity, $identity);
  @override
  String toString() {
    return DashboardEventPayloadMapper.ensureInitialized().stringifyValue(
      this as DashboardEventPayload,
    );
  }

  @override
  bool operator ==(Object other) {
    return DashboardEventPayloadMapper.ensureInitialized().equalsValue(
      this as DashboardEventPayload,
      other,
    );
  }

  @override
  int get hashCode {
    return DashboardEventPayloadMapper.ensureInitialized().hashValue(
      this as DashboardEventPayload,
    );
  }
}

extension DashboardEventPayloadValueCopy<$R, $Out>
    on ObjectCopyWith<$R, DashboardEventPayload, $Out> {
  DashboardEventPayloadCopyWith<$R, DashboardEventPayload, $Out>
  get $asDashboardEventPayload => $base.as(
    (v, t, t2) => _DashboardEventPayloadCopyWithImpl<$R, $Out>(v, t, t2),
  );
}

abstract class DashboardEventPayloadCopyWith<
  $R,
  $In extends DashboardEventPayload,
  $Out
>
    implements ClassCopyWith<$R, $In, $Out> {
  MapCopyWith<$R, String, dynamic, ObjectCopyWith<$R, dynamic, dynamic>?>
  get payload;
  $R call({
    String? id,
    String? sessionId,
    DashboardEventType? type,
    Map<String, dynamic>? payload,
    DateTime? createdAt,
  });
  DashboardEventPayloadCopyWith<$R2, $In, $Out2> $chain<$R2, $Out2>(
    Then<$Out2, $R2> t,
  );
}

class _DashboardEventPayloadCopyWithImpl<$R, $Out>
    extends ClassCopyWithBase<$R, DashboardEventPayload, $Out>
    implements DashboardEventPayloadCopyWith<$R, DashboardEventPayload, $Out> {
  _DashboardEventPayloadCopyWithImpl(super.value, super.then, super.then2);

  @override
  late final ClassMapperBase<DashboardEventPayload> $mapper =
      DashboardEventPayloadMapper.ensureInitialized();
  @override
  MapCopyWith<$R, String, dynamic, ObjectCopyWith<$R, dynamic, dynamic>?>
  get payload => MapCopyWith(
    $value.payload,
    (v, t) => ObjectCopyWith(v, $identity, t),
    (v) => call(payload: v),
  );
  @override
  $R call({
    String? id,
    String? sessionId,
    DashboardEventType? type,
    Map<String, dynamic>? payload,
    DateTime? createdAt,
  }) => $apply(
    FieldCopyWithData({
      if (id != null) #id: id,
      if (sessionId != null) #sessionId: sessionId,
      if (type != null) #type: type,
      if (payload != null) #payload: payload,
      if (createdAt != null) #createdAt: createdAt,
    }),
  );
  @override
  DashboardEventPayload $make(CopyWithData data) => DashboardEventPayload(
    id: data.get(#id, or: $value.id),
    sessionId: data.get(#sessionId, or: $value.sessionId),
    type: data.get(#type, or: $value.type),
    payload: data.get(#payload, or: $value.payload),
    createdAt: data.get(#createdAt, or: $value.createdAt),
  );

  @override
  DashboardEventPayloadCopyWith<$R2, DashboardEventPayload, $Out2>
  $chain<$R2, $Out2>(Then<$Out2, $R2> t) =>
      _DashboardEventPayloadCopyWithImpl<$R2, $Out2>($value, $cast, t);
}
