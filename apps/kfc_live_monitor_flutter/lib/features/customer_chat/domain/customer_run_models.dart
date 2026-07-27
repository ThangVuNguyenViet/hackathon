import 'kfc_agent_model_candidate.dart';
import 'kfc_genui_models.dart';

enum CustomerRunEventType {
  runAccepted,
  runStarted,
  progressUpdated,
  textStarted,
  textDelta,
  genUiRevision,
  genUiSnapshot,
  cancellationRequested,
  runCompleted,
  runCancelled,
  runFailed,
  runSuperseded,
}

enum CustomerRunConnectionState { connecting, connected, reconnecting, closed }

enum CustomerRunStatus {
  accepted('accepted'),
  running('running'),
  cancelling('cancelling'),
  completed('completed'),
  failed('failed'),
  cancelled('cancelled'),
  superseded('superseded');

  const CustomerRunStatus(this.wireName);

  final String wireName;
}

enum CustomerRunTerminal { completed, cancelled, failed, superseded }

enum CustomerRunAgentMode { humanPaused }

class CustomerRunStartResponse {
  const CustomerRunStartResponse({
    required this.schemaVersion,
    required this.runId,
    required this.status,
    required this.nextSequence,
    required this.replayed,
  });

  factory CustomerRunStartResponse.fromJson(Map<String, Object?> json) {
    return CustomerRunStartResponse(
      schemaVersion: _int(json, 'schemaVersion'),
      runId: _string(json, 'runId'),
      status: _runStatus(_string(json, 'status')),
      nextSequence: _int(json, 'nextSequence'),
      replayed: json['replayed'] == true,
    );
  }

  final int schemaVersion;
  final String runId;
  final CustomerRunStatus status;
  final int nextSequence;
  final bool replayed;
}

class CustomerRunCancelResponse {
  const CustomerRunCancelResponse({required this.runId, required this.status});
  factory CustomerRunCancelResponse.fromJson(Map<String, Object?> json) =>
      CustomerRunCancelResponse(
        runId: _string(json, 'runId'),
        status: _runStatus(_string(json, 'status')),
      );
  final String runId;
  final CustomerRunStatus status;
}

sealed class CustomerRunEventData {
  const CustomerRunEventData();
}

class CustomerRunEmptyData extends CustomerRunEventData {
  const CustomerRunEmptyData();
}

class CustomerRunProgressData extends CustomerRunEventData {
  const CustomerRunProgressData({
    required this.code,
    required this.label,
    required this.cancellable,
  });
  final String code;
  final String label;
  final bool cancellable;
}

class CustomerRunTextDeltaData extends CustomerRunEventData {
  const CustomerRunTextDeltaData(this.delta);
  final String delta;
}

class CustomerRunGenUiData extends CustomerRunEventData {
  const CustomerRunGenUiData(this.snapshot);
  final KfcGenUiAttachment snapshot;
}

/// A durable, non-actionable reference to an approval paused by the backend.
///
/// Unlike [CustomerApprovalPause], this value intentionally contains no signed
/// approval capability and cannot be used to resume an irreversible action.
class CustomerApprovalPausePointer {
  const CustomerApprovalPausePointer({
    required this.capability,
    required this.requestId,
    required this.expiresAt,
  });

  factory CustomerApprovalPausePointer.fromJson(Object? value) {
    if (value is! Map ||
        value.keys.any((key) => key is! String) ||
        value.length != 3) {
      throw const FormatException('Invalid approval pause pointer');
    }
    final json = value.cast<String, Object?>();
    const allowedKeys = {'capability', 'requestId', 'expiresAt'};
    if (json.keys.any((key) => !allowedKeys.contains(key))) {
      throw const FormatException('Invalid approval pause pointer');
    }
    final capability = _string(json, 'capability');
    if (!_streamedApprovalCapabilities.contains(capability)) {
      throw const FormatException('Unsupported approval capability');
    }
    final requestId = _string(json, 'requestId');
    if (!_customerRunUuidPattern.hasMatch(requestId)) {
      throw const FormatException('Invalid approval request id');
    }
    final expiresAt = DateTime.tryParse(_string(json, 'expiresAt'));
    if (expiresAt == null || !expiresAt.isUtc) {
      throw const FormatException('Invalid approval expiry');
    }
    return CustomerApprovalPausePointer(
      capability: capability,
      requestId: requestId,
      expiresAt: expiresAt,
    );
  }

  final String capability;
  final String requestId;
  final DateTime expiresAt;
}

class CustomerRunTerminalData extends CustomerRunEventData {
  const CustomerRunTerminalData({
    this.message,
    this.responseText,
    this.approvalPausePointer,
    this.assistantTurnId,
  });
  final String? message;
  final String? responseText;
  final CustomerApprovalPausePointer? approvalPausePointer;
  final String? assistantTurnId;
}

class CustomerRunSupersededData extends CustomerRunEventData {
  const CustomerRunSupersededData({
    required this.status,
    this.suppressed = false,
    this.agentMode,
  });

  final CustomerRunStatus status;
  final bool suppressed;
  final CustomerRunAgentMode? agentMode;

  bool get isHumanPaused =>
      suppressed && agentMode == CustomerRunAgentMode.humanPaused;
}

class CustomerRunEventEnvelope {
  const CustomerRunEventEnvelope({
    required this.schemaVersion,
    required this.eventId,
    required this.runId,
    required this.sequence,
    required this.type,
    required this.occurredAt,
    required this.data,
  });

  factory CustomerRunEventEnvelope.fromJson(
    Map<String, Object?> json, {
    bool allowLegacyActionAuthority = false,
  }) {
    final type = _eventType(_string(json, 'type'));
    final payload = _map(json, 'payload');
    return CustomerRunEventEnvelope(
      schemaVersion: _int(json, 'schemaVersion'),
      eventId: _string(json, 'eventId'),
      runId: _string(json, 'runId'),
      sequence: _int(json, 'sequence'),
      type: type,
      occurredAt: DateTime.parse(_string(json, 'occurredAt')),
      data: switch (type) {
        CustomerRunEventType.progressUpdated => CustomerRunProgressData(
          code: _string(payload, 'code'),
          label: _string(payload, 'label'),
          cancellable: payload['cancellable'] == true,
        ),
        CustomerRunEventType.textDelta => CustomerRunTextDeltaData(
          _string(payload, 'delta'),
        ),
        CustomerRunEventType.genUiRevision ||
        CustomerRunEventType.genUiSnapshot => CustomerRunGenUiData(
          KfcGenUiAttachment.fromJson(
            _map(payload, 'snapshot'),
            allowLegacyActionAuthority: allowLegacyActionAuthority,
          ),
        ),
        CustomerRunEventType.runCompleted ||
        CustomerRunEventType.runCancelled ||
        CustomerRunEventType.runFailed => _terminalData(type, payload),
        CustomerRunEventType.runSuperseded => _supersededData(payload),
        _ => const CustomerRunEmptyData(),
      },
    );
  }

  final int schemaVersion;
  final String eventId;
  final String runId;
  final int sequence;
  final CustomerRunEventType type;
  final DateTime occurredAt;
  final CustomerRunEventData data;
}

class CustomerRunSequenceGap implements Exception {
  const CustomerRunSequenceGap({required this.expected, required this.actual});
  final int expected;
  final int actual;
}

class ActiveAssistantDraft {
  const ActiveAssistantDraft({
    required this.runId,
    required this.lastSequence,
    required this.connection,
    required this.text,
    required this.cancellable,
    this.progressLabel,
    this.genUi,
    this.terminal,
    this.terminalMessage,
    this.approvalPausePointer,
    this.assistantTurnId,
    this.agentMode,
    this.modelCandidate,
    this.isStopping = false,
    this.materialized = false,
  });

  factory ActiveAssistantDraft.accepted({
    required String runId,
    KfcAgentModelCandidate? modelCandidate,
  }) {
    return ActiveAssistantDraft(
      runId: runId,
      lastSequence: 0,
      connection: CustomerRunConnectionState.connecting,
      text: '',
      cancellable: false,
      modelCandidate: modelCandidate,
    );
  }

  final String runId;
  final int lastSequence;
  final CustomerRunConnectionState connection;
  final String? progressLabel;
  final String text;
  final KfcGenUiAttachment? genUi;
  final bool cancellable;
  final bool isStopping;
  final CustomerRunTerminal? terminal;
  final String? terminalMessage;
  final CustomerApprovalPausePointer? approvalPausePointer;
  final String? assistantTurnId;
  final CustomerRunAgentMode? agentMode;
  final KfcAgentModelCandidate? modelCandidate;
  final bool materialized;

  bool get isTerminal => terminal != null;

  ActiveAssistantDraft reduce(CustomerRunEventEnvelope event) {
    if (event.runId != runId || event.sequence <= lastSequence) return this;
    if (isTerminal) return this;
    if (event.sequence != lastSequence + 1) {
      throw CustomerRunSequenceGap(
        expected: lastSequence + 1,
        actual: event.sequence,
      );
    }
    var next = copyWith(
      lastSequence: event.sequence,
      connection: CustomerRunConnectionState.connected,
    );
    switch (event.type) {
      case CustomerRunEventType.progressUpdated:
        final data = event.data as CustomerRunProgressData;
        next = next.copyWith(
          progressLabel: data.label,
          cancellable: data.cancellable,
        );
      case CustomerRunEventType.textDelta:
        final data = event.data as CustomerRunTextDeltaData;
        next = next.copyWith(text: '$text${data.delta}');
      case CustomerRunEventType.genUiRevision:
        next = next.copyWith(
          genUi: (event.data as CustomerRunGenUiData).snapshot
              .withInteractionFinality(KfcGenUiInteractionFinality.provisional),
        );
      case CustomerRunEventType.genUiSnapshot:
        next = next.copyWith(
          genUi: (event.data as CustomerRunGenUiData).snapshot
              .withInteractionFinality(
                KfcGenUiInteractionFinality.authoritative,
              ),
        );
      case CustomerRunEventType.cancellationRequested:
        next = next.copyWith(isStopping: true, cancellable: false);
      case CustomerRunEventType.runCompleted:
        final data = event.data as CustomerRunTerminalData;
        next = next.copyWith(
          terminal: CustomerRunTerminal.completed,
          approvalPausePointer: data.approvalPausePointer,
          assistantTurnId: data.assistantTurnId,
          cancellable: false,
          connection: CustomerRunConnectionState.closed,
        );
      case CustomerRunEventType.runCancelled:
        next = next.copyWith(
          genUi: genUi?.withInteractionFinality(
            KfcGenUiInteractionFinality.retainedAfterTerminalFailure,
          ),
          terminal: CustomerRunTerminal.cancelled,
          terminalMessage: (event.data as CustomerRunTerminalData).message,
          cancellable: false,
          connection: CustomerRunConnectionState.closed,
        );
      case CustomerRunEventType.runFailed:
        next = next.copyWith(
          genUi: genUi?.withInteractionFinality(
            KfcGenUiInteractionFinality.retainedAfterTerminalFailure,
          ),
          terminal: CustomerRunTerminal.failed,
          terminalMessage: (event.data as CustomerRunTerminalData).message,
          cancellable: false,
          connection: CustomerRunConnectionState.closed,
        );
      case CustomerRunEventType.runSuperseded:
        final data = event.data as CustomerRunSupersededData;
        next = next.copyWith(
          clearText: data.isHumanPaused,
          clearGenUi: data.isHumanPaused,
          terminal: CustomerRunTerminal.superseded,
          agentMode: data.agentMode,
          cancellable: false,
          connection: CustomerRunConnectionState.closed,
        );
      default:
        break;
    }
    return next;
  }

  ActiveAssistantDraft copyWith({
    int? lastSequence,
    CustomerRunConnectionState? connection,
    String? progressLabel,
    String? text,
    bool clearText = false,
    KfcGenUiAttachment? genUi,
    bool clearGenUi = false,
    bool? cancellable,
    bool? isStopping,
    CustomerRunTerminal? terminal,
    String? terminalMessage,
    CustomerApprovalPausePointer? approvalPausePointer,
    bool clearApprovalPausePointer = false,
    String? assistantTurnId,
    CustomerRunAgentMode? agentMode,
    KfcAgentModelCandidate? modelCandidate,
    bool? materialized,
  }) {
    return ActiveAssistantDraft(
      runId: runId,
      lastSequence: lastSequence ?? this.lastSequence,
      connection: connection ?? this.connection,
      progressLabel: progressLabel ?? this.progressLabel,
      text: clearText ? '' : (text ?? this.text),
      genUi: clearGenUi ? null : (genUi ?? this.genUi),
      cancellable: cancellable ?? this.cancellable,
      isStopping: isStopping ?? this.isStopping,
      terminal: terminal ?? this.terminal,
      terminalMessage: terminalMessage ?? this.terminalMessage,
      approvalPausePointer: clearApprovalPausePointer
          ? null
          : (approvalPausePointer ?? this.approvalPausePointer),
      assistantTurnId: assistantTurnId ?? this.assistantTurnId,
      agentMode: agentMode ?? this.agentMode,
      modelCandidate: modelCandidate ?? this.modelCandidate,
      materialized: materialized ?? this.materialized,
    );
  }
}

CustomerRunEventType _eventType(String value) => switch (value) {
  'run_accepted' => CustomerRunEventType.runAccepted,
  'run_started' => CustomerRunEventType.runStarted,
  'progress_updated' => CustomerRunEventType.progressUpdated,
  'text_started' => CustomerRunEventType.textStarted,
  'text_delta' => CustomerRunEventType.textDelta,
  'genui_revision' => CustomerRunEventType.genUiRevision,
  'genui_snapshot' => CustomerRunEventType.genUiSnapshot,
  'cancellation_requested' => CustomerRunEventType.cancellationRequested,
  'run_completed' => CustomerRunEventType.runCompleted,
  'run_cancelled' => CustomerRunEventType.runCancelled,
  'run_failed' => CustomerRunEventType.runFailed,
  'run_superseded' => CustomerRunEventType.runSuperseded,
  _ => throw FormatException('Unsupported customer run event type'),
};

CustomerRunStatus _runStatus(String value) {
  for (final status in CustomerRunStatus.values) {
    if (status.wireName == value) return status;
  }
  throw const FormatException('Unsupported customer run status');
}

CustomerRunTerminalData _terminalData(
  CustomerRunEventType type,
  Map<String, Object?> payload,
) {
  final status = _runStatus(_string(payload, 'status'));
  final expected = switch (type) {
    CustomerRunEventType.runCompleted => CustomerRunStatus.completed,
    CustomerRunEventType.runCancelled => CustomerRunStatus.cancelled,
    CustomerRunEventType.runFailed => CustomerRunStatus.failed,
    _ => throw const FormatException('Expected terminal customer run event'),
  };
  if (status != expected) {
    throw const FormatException('Customer run terminal status mismatch');
  }
  final rawAssistantTurnId = payload['assistantTurnId'];
  if (rawAssistantTurnId != null &&
      (type != CustomerRunEventType.runCompleted ||
          !isValidRecommendationAuthorityId(rawAssistantTurnId))) {
    throw const FormatException('Invalid assistant turn id');
  }
  return CustomerRunTerminalData(
    message: payload['message'] as String?,
    responseText: payload['responseText'] as String?,
    approvalPausePointer: payload['approvalPause'] == null
        ? null
        : type != CustomerRunEventType.runCompleted
        ? throw const FormatException(
            'Only a completed run may contain an approval pause pointer',
          )
        : CustomerApprovalPausePointer.fromJson(payload['approvalPause']),
    assistantTurnId: rawAssistantTurnId as String?,
  );
}

CustomerRunSupersededData _supersededData(Map<String, Object?> payload) {
  if (!payload.containsKey('status')) {
    throw const FormatException('Invalid customer run superseded payload');
  }
  final status = _runStatus(_string(payload, 'status'));
  if (status != CustomerRunStatus.superseded) {
    throw const FormatException('Invalid customer run superseded payload');
  }
  if (payload.length == 1) {
    return const CustomerRunSupersededData(
      status: CustomerRunStatus.superseded,
    );
  }
  if (payload.length != 3 ||
      payload['suppressed'] != true ||
      payload['agentMode'] != 'human_paused') {
    throw const FormatException('Invalid customer run superseded payload');
  }
  return const CustomerRunSupersededData(
    status: CustomerRunStatus.superseded,
    suppressed: true,
    agentMode: CustomerRunAgentMode.humanPaused,
  );
}

String _string(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! String || value.isEmpty) throw FormatException('Expected $key');
  return value;
}

int _int(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! int) throw FormatException('Expected $key');
  return value;
}

Map<String, Object?> _map(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! Map) throw FormatException('Expected $key');
  return value.cast<String, Object?>();
}

const _streamedApprovalCapabilities = {
  'placeOrder',
  'createPaymentLink',
  'acquireVoucher',
  'redeemReward',
  'handoff',
};

final _customerRunUuidPattern = RegExp(
  r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
);
