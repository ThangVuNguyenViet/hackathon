import 'dart:async';

import 'package:state_beacon/state_beacon.dart';

import '../data/automatic_recommendation_client.dart';
import '../domain/automatic_recommendation_contract.dart';

enum KioskLoadStatus {
  configurationMissing,
  idle,
  loading,
  recommended,
  empty,
  paused,
  error,
}

class RecommendationKioskContext {
  const RecommendationKioskContext({
    required this.storeId,
    required this.fulfilmentMode,
    required this.locale,
    required this.orderingJourneyRef,
    required this.opportunityRef,
    required this.cart,
    this.verifiedCustomerRef,
    this.parentCartLineId,
  });

  final String storeId;
  final String fulfilmentMode;
  final String locale;
  final String orderingJourneyRef;
  final String opportunityRef;
  final Map<String, dynamic> cart;
  final String? verifiedCustomerRef;
  final String? parentCartLineId;

  Map<String, dynamic> requestFor(
    AutomaticRecommendationType type, {
    required String requestId,
  }) {
    return {
      'schemaVersion': automaticRecommendationSchemaVersion,
      'requestId': requestId,
      'storeId': storeId,
      'fulfilmentMode': fulfilmentMode,
      'locale': locale,
      'orderingJourneyRef': orderingJourneyRef,
      'opportunityRef': opportunityRef,
      'cart': cart,
      if (type == AutomaticRecommendationType.forYou)
        'verifiedCustomerRef': verifiedCustomerRef,
      if (type == AutomaticRecommendationType.modifierUpsell)
        'parentCartLineId': parentCartLineId,
    };
  }

  bool canRequest(AutomaticRecommendationType type) => switch (type) {
    AutomaticRecommendationType.forYou => verifiedCustomerRef != null,
    AutomaticRecommendationType.modifierUpsell => parentCartLineId != null,
    _ => true,
  };
  String? missingRequirement(AutomaticRecommendationType type) {
    if (type == AutomaticRecommendationType.forYou &&
        verifiedCustomerRef == null) {
      return 'Returning-customer mode requires verifiedCustomerRef.';
    }
    if (type == AutomaticRecommendationType.modifierUpsell &&
        parentCartLineId == null) {
      return 'Modifier mode requires parentCartLineId.';
    }
    return null;
  }
}

class KioskState {
  const KioskState({
    required this.status,
    required this.selectedType,
    this.request,
    this.response,
    this.inspection,
    this.errorMessage,
    this.evidenceMessage,
    this.selectedActionId,
  });

  const KioskState.initial({
    this.selectedType = AutomaticRecommendationType.localFavorite,
  }) : status = KioskLoadStatus.idle,
       request = null,
       response = null,
       inspection = null,
       errorMessage = null,
       evidenceMessage = null,
       selectedActionId = null;

  final KioskLoadStatus status;
  final AutomaticRecommendationType selectedType;
  final Map<String, dynamic>? request;
  final AutomaticRecommendationResponsePayload? response;
  final AutomaticRecommendationInspectionPayload? inspection;
  final String? errorMessage;
  final String? evidenceMessage;
  final String? selectedActionId;

  bool get isLoading => status == KioskLoadStatus.loading;
  bool get hasResponse => response != null;
  bool get isUnavailable =>
      status == KioskLoadStatus.error ||
      status == KioskLoadStatus.configurationMissing;

  KioskState copyWith({
    KioskLoadStatus? status,
    AutomaticRecommendationType? selectedType,
    Object? request = _keep,
    Object? response = _keep,
    Object? inspection = _keep,
    Object? errorMessage = _keep,
    Object? evidenceMessage = _keep,
    Object? selectedActionId = _keep,
  }) {
    return KioskState(
      status: status ?? this.status,
      selectedType: selectedType ?? this.selectedType,
      request: identical(request, _keep)
          ? this.request
          : request as Map<String, dynamic>?,
      response: identical(response, _keep)
          ? this.response
          : response as AutomaticRecommendationResponsePayload?,
      inspection: identical(inspection, _keep)
          ? this.inspection
          : inspection as AutomaticRecommendationInspectionPayload?,
      errorMessage: identical(errorMessage, _keep)
          ? this.errorMessage
          : errorMessage as String?,
      evidenceMessage: identical(evidenceMessage, _keep)
          ? this.evidenceMessage
          : evidenceMessage as String?,
      selectedActionId: identical(selectedActionId, _keep)
          ? this.selectedActionId
          : selectedActionId as String?,
    );
  }

  static const _keep = Object();
}

class KioskActionException implements Exception {
  const KioskActionException(this.message);

  final String message;

  @override
  String toString() => 'KioskActionException: $message';
}

class AutomaticRecommendationKioskController extends BeaconController {
  AutomaticRecommendationKioskController({
    required AutomaticRecommendationClient client,
    RecommendationKioskContext? context,
    AutomaticRecommendationClock? clock,
  }) : _client = client,
       _context = context,
       _clock = clock ?? DateTime.now {
    state.value = KioskState(
      status: context == null
          ? KioskLoadStatus.configurationMissing
          : KioskLoadStatus.idle,
      selectedType: AutomaticRecommendationType.localFavorite,
    );
  }

  final AutomaticRecommendationClient _client;
  final RecommendationKioskContext? _context;
  final AutomaticRecommendationClock _clock;
  var _requestSequence = 0;

  late final state = B.writable(const KioskState.initial());

  RecommendationKioskContext? get context => _context;

  Future<void> load(AutomaticRecommendationType type) async {
    final context = _context;
    if (context == null) {
      state.value = state.value.copyWith(
        status: KioskLoadStatus.configurationMissing,
        selectedType: type,
        errorMessage: 'Kiosk request context is not configured.',
        response: null,
        request: null,
        inspection: null,
        selectedActionId: null,
      );
      return;
    }
    final missing = context.missingRequirement(type);
    if (missing != null) {
      state.value = state.value.copyWith(
        status: KioskLoadStatus.error,
        selectedType: type,
        errorMessage: missing,
        response: null,
        request: null,
        inspection: null,
        selectedActionId: null,
      );
      return;
    }

    final sequence = ++_requestSequence;
    final request = context.requestFor(type, requestId: _newId('request'));
    state.value = KioskState(
      status: KioskLoadStatus.loading,
      selectedType: type,
      request: request,
    );

    try {
      final response = await _client.decide(type: type, request: request);
      if (sequence != _requestSequence) return;
      state.value = KioskState(
        status: _statusFor(response),
        selectedType: type,
        request: request,
        response: response,
      );
      await _recordImpression(response, context);
    } on Object catch (error) {
      if (sequence != _requestSequence) return;
      state.value = KioskState(
        status: KioskLoadStatus.error,
        selectedType: type,
        request: request,
        errorMessage: _messageFor(error),
      );
    }
  }

  Future<void> selectAction(int index) =>
      _recordActionOutcome(index: index, eventType: 'selected');

  Future<void> dismissAction(int index) =>
      _recordActionOutcome(index: index, eventType: 'action_dismissed');

  Future<void> inspectEvidence() async {
    final response = state.value.response;
    if (response == null) {
      throw const KioskActionException(
        'Evidence inspection requires a loaded recommendation.',
      );
    }
    try {
      final inspection = await _client.inspect(
        recommendationId: response.toJson()['recommendationId'] as String,
      );
      state.value = state.value.copyWith(
        inspection: inspection,
        evidenceMessage: 'Durable decision evidence loaded.',
      );
    } on Object catch (error) {
      state.value = state.value.copyWith(evidenceMessage: _messageFor(error));
      rethrow;
    }
  }

  Future<void> _recordImpression(
    AutomaticRecommendationResponsePayload response,
    RecommendationKioskContext context,
  ) async {
    final wire = response.toJson();
    final proposals = wire['proposals'] as List;
    if (proposals.isEmpty) {
      state.value = state.value.copyWith(
        evidenceMessage: 'No rendered actions; no impression event emitted.',
      );
      return;
    }
    final event = _eventBase(context, wire['cartRevision'] as String)
      ..addAll({
        'renderedActions': [
          for (var index = 0; index < proposals.length; index++)
            {
              'actionId': (proposals[index] as Map)['actionId'],
              'renderedPosition': index + 1,
            },
        ],
      });
    try {
      await _client.recordImpression(
        recommendationId: wire['recommendationId'] as String,
        impression: event,
      );
      state.value = state.value.copyWith(
        evidenceMessage: 'Impression persisted to the evidence ledger.',
      );
    } on Object catch (error) {
      state.value = state.value.copyWith(
        evidenceMessage: 'Impression persistence failed: ${_messageFor(error)}',
      );
    }
  }

  Future<void> _recordActionOutcome({
    required int index,
    required String eventType,
  }) async {
    final context = _context;
    final response = state.value.response;
    if (context == null || response == null) {
      throw const KioskActionException('Load a recommendation before acting.');
    }
    final wire = response.toJson();
    final proposals = wire['proposals'] as List;
    if (wire['status'] != 'recommended' ||
        index < 0 ||
        index >= proposals.length) {
      throw const KioskActionException(
        'The requested action is not available.',
      );
    }
    final expiresAt = DateTime.parse(wire['expiresAt'] as String);
    if (!expiresAt.isAfter(_clock())) {
      throw const KioskActionException(
        'The recommendation has expired; reload it.',
      );
    }
    final proposal = Map<String, dynamic>.from(proposals[index] as Map);
    final actionId = proposal['actionId'] as String;
    if (state.value.selectedActionId == actionId) {
      throw const KioskActionException(
        'This action has already been recorded.',
      );
    }
    final event = _eventBase(context, wire['cartRevision'] as String)
      ..addAll({
        'eventType': eventType,
        'actionId': actionId,
        'renderedPosition': index + 1,
      });
    try {
      await _client.recordOutcome(
        recommendationId: wire['recommendationId'] as String,
        outcome: event,
      );
      state.value = state.value.copyWith(
        selectedActionId: actionId,
        evidenceMessage:
            '${eventType == 'selected' ? 'Selection' : 'Dismissal'} persisted.',
      );
    } on Object catch (error) {
      state.value = state.value.copyWith(
        evidenceMessage: 'Outcome persistence failed: ${_messageFor(error)}',
      );
      rethrow;
    }
  }

  Map<String, dynamic> _eventBase(
    RecommendationKioskContext context,
    String cartRevision,
  ) => {
    'schemaVersion': 'kfc-automatic-recommendation-event-v1',
    'eventId': _newId('event'),
    'channel': 'kiosk',
    'occurredAt': _clock().toUtc().toIso8601String(),
    'orderingJourneyRef': context.orderingJourneyRef,
    'opportunityRef': context.opportunityRef,
    'cartRevision': cartRevision,
  };

  KioskLoadStatus _statusFor(AutomaticRecommendationResponsePayload response) {
    return switch (response.toJson()['status']) {
      'recommended' => KioskLoadStatus.recommended,
      'empty' => KioskLoadStatus.empty,
      'paused' => KioskLoadStatus.paused,
      _ => KioskLoadStatus.error,
    };
  }

  String _newId(String prefix) => '$prefix-${_clock().microsecondsSinceEpoch}';

  String _messageFor(Object error) {
    if (error case AutomaticRecommendationHttpException(:final message)) {
      return message;
    }
    if (error case AutomaticRecommendationTransportException(:final message)) {
      return message;
    }
    if (error case AutomaticRecommendationContractException(:final message)) {
      return 'Contract validation failed: $message';
    }
    if (error case KioskActionException(:final message)) return message;
    return 'Automatic recommendation request failed.';
  }

  @override
  void dispose() {
    unawaited(_client.close());
    super.dispose();
  }
}
