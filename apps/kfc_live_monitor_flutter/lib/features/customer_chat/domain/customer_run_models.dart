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
}

enum CustomerRunConnectionState { connecting, connected, reconnecting, closed }

enum CustomerRunTerminal { completed, cancelled, failed }

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
      status: _string(json, 'status'),
      nextSequence: _int(json, 'nextSequence'),
      replayed: json['replayed'] == true,
    );
  }

  final int schemaVersion;
  final String runId;
  final String status;
  final int nextSequence;
  final bool replayed;
}

class CustomerRunCancelResponse {
  const CustomerRunCancelResponse({required this.runId, required this.status});
  factory CustomerRunCancelResponse.fromJson(Map<String, Object?> json) =>
      CustomerRunCancelResponse(
        runId: _string(json, 'runId'),
        status: _string(json, 'status'),
      );
  final String runId;
  final String status;
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

class CustomerRunTerminalData extends CustomerRunEventData {
  const CustomerRunTerminalData({this.message, this.responseText});
  final String? message;
  final String? responseText;
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

  factory CustomerRunEventEnvelope.fromJson(Map<String, Object?> json) {
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
          KfcGenUiAttachment.fromJson(_map(payload, 'snapshot')),
        ),
        CustomerRunEventType.runCompleted ||
        CustomerRunEventType.runCancelled ||
        CustomerRunEventType.runFailed => CustomerRunTerminalData(
          message: payload['message'] as String?,
          responseText: payload['responseText'] as String?,
        ),
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
    this.isStopping = false,
    this.materialized = false,
  });

  factory ActiveAssistantDraft.accepted({required String runId}) {
    return ActiveAssistantDraft(
      runId: runId,
      lastSequence: 0,
      connection: CustomerRunConnectionState.connecting,
      text: '',
      cancellable: false,
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
  final bool materialized;

  bool get isTerminal => terminal != null;

  ActiveAssistantDraft reduce(CustomerRunEventEnvelope event) {
    if (event.runId != runId || event.sequence <= lastSequence) return this;
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
      case CustomerRunEventType.genUiSnapshot:
        next = next.copyWith(
          genUi: (event.data as CustomerRunGenUiData).snapshot,
        );
      case CustomerRunEventType.cancellationRequested:
        next = next.copyWith(isStopping: true, cancellable: false);
      case CustomerRunEventType.runCompleted:
        next = next.copyWith(
          terminal: CustomerRunTerminal.completed,
          cancellable: false,
          connection: CustomerRunConnectionState.closed,
        );
      case CustomerRunEventType.runCancelled:
        next = next.copyWith(
          terminal: CustomerRunTerminal.cancelled,
          terminalMessage: (event.data as CustomerRunTerminalData).message,
          cancellable: false,
          connection: CustomerRunConnectionState.closed,
        );
      case CustomerRunEventType.runFailed:
        next = next.copyWith(
          terminal: CustomerRunTerminal.failed,
          terminalMessage: (event.data as CustomerRunTerminalData).message,
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
    KfcGenUiAttachment? genUi,
    bool? cancellable,
    bool? isStopping,
    CustomerRunTerminal? terminal,
    String? terminalMessage,
    bool? materialized,
  }) {
    return ActiveAssistantDraft(
      runId: runId,
      lastSequence: lastSequence ?? this.lastSequence,
      connection: connection ?? this.connection,
      progressLabel: progressLabel ?? this.progressLabel,
      text: text ?? this.text,
      genUi: genUi ?? this.genUi,
      cancellable: cancellable ?? this.cancellable,
      isStopping: isStopping ?? this.isStopping,
      terminal: terminal ?? this.terminal,
      terminalMessage: terminalMessage ?? this.terminalMessage,
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
  _ => throw FormatException('Unsupported customer run event type'),
};

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
