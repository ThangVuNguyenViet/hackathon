part of 'kfc_genui_models.dart';

class KfcGenUiAction {
  const KfcGenUiAction({
    required this.attachmentId,
    required this.actionId,
    this.value,
    this.payload = const <String, Object?>{},
  });

  factory KfcGenUiAction.fromSpec({
    required KfcGenUiAttachment attachment,
    required KfcGenUiActionSpec spec,
  }) {
    return KfcGenUiAction(
      attachmentId: attachment.id,
      actionId: spec.id,
      value: spec.value,
      payload: spec.payload,
    );
  }

  final String attachmentId;
  final String actionId;
  final String? value;
  final Map<String, Object?> payload;

  Map<String, Object?> toJson() {
    return {
      'attachmentId': attachmentId,
      'actionId': actionId,
      if (value != null) 'value': value,
      if (payload.isNotEmpty) 'payload': payload,
    };
  }
}

class CustomerChatMessage {
  const CustomerChatMessage({
    required this.id,
    required this.role,
    required this.text,
    this.genUi,
    this.assistantTurnId,
    this.modelCandidate,
  });

  final String id;
  final CustomerChatRole role;
  final String text;
  final KfcGenUiAttachment? genUi;
  final String? assistantTurnId;
  final KfcAgentModelCandidate? modelCandidate;

  bool get hasAuthoritativeRecommendationTurn =>
      genUi?.widgetKind != KfcGenUiWidgetKind.recommendationOffer ||
      (role == CustomerChatRole.assistant &&
          isValidRecommendationAuthorityId(assistantTurnId));
}

enum CustomerChatRole { customer, assistant }

class CustomerChatResponse {
  const CustomerChatResponse({
    required this.responseText,
    this.genUi,
    this.approvalPause,
  });

  factory CustomerChatResponse.fromJson(Map<String, Object?> json) {
    final genUiJson = json['genUi'];
    final pauseJson = json['pause'];
    return CustomerChatResponse(
      responseText: _asString(json['responseText']),
      genUi: genUiJson is Map
          ? KfcGenUiAttachment.fromJson(Map<String, Object?>.from(genUiJson))
          : null,
      approvalPause: pauseJson == null
          ? null
          : CustomerApprovalPause.fromJson(pauseJson),
    );
  }

  final String responseText;
  final KfcGenUiAttachment? genUi;
  final CustomerApprovalPause? approvalPause;
}

class CustomerChatSessionUpdates {
  const CustomerChatSessionUpdates({
    required this.agentMode,
    required this.turns,
    this.assignedAgentId,
    this.handoffStatus,
  });

  factory CustomerChatSessionUpdates.fromJson(Map<String, Object?> json) =>
      CustomerChatSessionUpdates(
        agentMode: _asString(json['agentMode']),
        assignedAgentId: _nullableString(json['assignedAgentId']),
        handoffStatus: _nullableString(json['handoffStatus']),
        turns: _asList(json['turns'])
            .whereType<Map>()
            .map((turn) {
              final value = Map<String, Object?>.from(turn);
              final metadata = _asMap(value['metadata']);
              return CustomerChatRemoteTurn(
                id: _asString(value['id']),
                role: _asString(value['role']),
                text: _asString(value['text']),
                isHumanAgent: metadata['authorType'] == 'human_agent',
              );
            })
            .toList(growable: false),
      );

  final String agentMode;
  final String? assignedAgentId;
  final String? handoffStatus;
  final List<CustomerChatRemoteTurn> turns;
}

class CustomerChatRemoteTurn {
  const CustomerChatRemoteTurn({
    required this.id,
    required this.role,
    required this.text,
    required this.isHumanAgent,
  });
  final String id;
  final String role;
  final String text;
  final bool isHumanAgent;
}

String _asString(Object? value) => value?.toString() ?? '';

String? _nullableString(Object? value) {
  final text = _asString(value);
  return text.isEmpty ? null : text;
}

List<Object?> _asList(Object? value) => value is List ? value : const [];

Map<String, Object?> _asMap(Object? value) {
  if (value is Map<String, Object?>) return value;
  if (value is Map) return Map<String, Object?>.from(value);
  return const <String, Object?>{};
}

int? _nullablePositiveInt(Object? value) {
  final number = value is num ? value.toInt() : int.tryParse('$value');
  return number != null && number > 0 ? number : null;
}
