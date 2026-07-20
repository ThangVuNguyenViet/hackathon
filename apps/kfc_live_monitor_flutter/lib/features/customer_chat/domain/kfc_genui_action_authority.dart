part of 'kfc_genui_models.dart';

enum KfcGenUiInteractionFinality {
  authoritative,
  provisional,
  retainedAfterTerminalFailure,
}

enum KfcGenUiActionIntent {
  primary('primary'),
  secondary('secondary'),
  destructive('destructive'),
  recovery('recovery');

  const KfcGenUiActionIntent(this.wireName);

  final String wireName;

  static KfcGenUiActionIntent? tryFromJson(Object? value) {
    for (final intent in values) {
      if (intent.wireName == value) return intent;
    }
    return null;
  }
}

class KfcGenUiActionSpec {
  const KfcGenUiActionSpec({
    required this.id,
    required this.label,
    this.intent = KfcGenUiActionIntent.secondary,
    this.value,
    this.payload = const <String, Object?>{},
    this.destructive = false,
  });

  factory KfcGenUiActionSpec.fromJson(Map<String, Object?> json) {
    const allowedKeys = {
      'id',
      'label',
      'intent',
      'value',
      'payload',
      'destructive',
    };
    final rawId = json['id'];
    final rawLabel = json['label'];
    final rawIntent = json['intent'];
    final rawValue = json['value'];
    final rawPayload = json['payload'];
    final rawDestructive = json['destructive'];
    final parsedIntent = rawIntent == null
        ? KfcGenUiActionIntent.secondary
        : KfcGenUiActionIntent.tryFromJson(rawIntent);
    if (!json.keys.every(allowedKeys.contains) ||
        rawId is! String ||
        rawId.trim().isEmpty ||
        rawId != rawId.trim() ||
        rawId.length > 256 ||
        rawLabel is! String ||
        rawLabel.trim().isEmpty ||
        rawLabel != rawLabel.trim() ||
        parsedIntent == null ||
        (rawValue != null && rawValue is! String) ||
        (rawValue is String && rawValue.length > 1000) ||
        (rawPayload != null && rawPayload is! Map) ||
        (rawDestructive != null && rawDestructive is! bool)) {
      throw const FormatException('Invalid KFC GenUI action specification');
    }
    Map<String, Object?> payload;
    try {
      payload = rawPayload is Map
          ? Map<String, Object?>.from(rawPayload)
          : const <String, Object?>{};
    } on Object {
      throw const FormatException('Invalid KFC GenUI action payload');
    }
    return KfcGenUiActionSpec(
      id: rawId,
      label: rawLabel,
      intent: rawDestructive == true
          ? KfcGenUiActionIntent.destructive
          : parsedIntent,
      value: _nullableString(rawValue),
      payload: payload,
      destructive: rawDestructive == true,
    );
  }

  final String id;
  final String label;
  final KfcGenUiActionIntent intent;
  final String? value;
  final Map<String, Object?> payload;
  final bool destructive;
}

class KfcGenUiAuthority {
  const KfcGenUiAuthority({
    required this.schemaVersion,
    required this.sessionId,
    required this.customerId,
    required this.verifiedRevision,
    required this.actionLifecycle,
    required this.issuedAt,
    required this.expiresAt,
  });

  static KfcGenUiAuthority? tryFromJson(Object? value) {
    if (value is! Map) return null;
    late final Map<String, Object?> json;
    try {
      json = Map<String, Object?>.from(value);
    } on Object {
      return null;
    }
    const requiredKeys = {
      'schemaVersion',
      'sessionId',
      'customerId',
      'verifiedRevision',
      'actionLifecycle',
      'issuedAt',
      'expiresAt',
    };
    if (json.length != requiredKeys.length ||
        !json.keys.every(requiredKeys.contains)) {
      return null;
    }
    final values = [
      json['schemaVersion'],
      json['sessionId'],
      json['customerId'],
      json['verifiedRevision'],
      json['actionLifecycle'],
      json['issuedAt'],
      json['expiresAt'],
    ];
    if (values.any((field) => field is! String)) return null;
    final schemaVersion = json['schemaVersion']! as String;
    final sessionId = json['sessionId']! as String;
    final customerId = json['customerId']! as String;
    final verifiedRevision = json['verifiedRevision']! as String;
    final actionLifecycle = json['actionLifecycle']! as String;
    final issuedAt = json['issuedAt']! as String;
    final expiresAt = json['expiresAt']! as String;
    final issuedAtTime = DateTime.tryParse(issuedAt);
    final expiresAtTime = DateTime.tryParse(expiresAt);
    if (schemaVersion != 'kfc-genui-v1' ||
        sessionId.isEmpty ||
        sessionId != sessionId.trim() ||
        sessionId.length > 256 ||
        customerId.isEmpty ||
        customerId != customerId.trim() ||
        customerId.length > 256 ||
        !RegExp(r'^[0-9a-f]{64}$').hasMatch(verifiedRevision) ||
        (actionLifecycle != 'one_shot' && actionLifecycle != 'replayable') ||
        issuedAtTime == null ||
        expiresAtTime == null ||
        !issuedAtTime.isBefore(expiresAtTime)) {
      return null;
    }
    return KfcGenUiAuthority(
      schemaVersion: schemaVersion,
      sessionId: sessionId,
      customerId: customerId,
      verifiedRevision: verifiedRevision,
      actionLifecycle: actionLifecycle,
      issuedAt: issuedAt,
      expiresAt: expiresAt,
    );
  }

  final String schemaVersion;
  final String sessionId;
  final String customerId;
  final String verifiedRevision;
  final String actionLifecycle;
  final String issuedAt;
  final String expiresAt;

  Map<String, Object?> toJson() => {
    'schemaVersion': schemaVersion,
    'sessionId': sessionId,
    'customerId': customerId,
    'verifiedRevision': verifiedRevision,
    'actionLifecycle': actionLifecycle,
    'issuedAt': issuedAt,
    'expiresAt': expiresAt,
  };
}
