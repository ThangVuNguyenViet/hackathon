enum CustomerConfirmationDecision {
  approve('approve'),
  reject('reject');

  const CustomerConfirmationDecision(this.wireName);

  final String wireName;
}

enum CustomerConfirmationContinuation {
  approvalRequired('approval_required'),
  turnCompleted('turn_completed');

  const CustomerConfirmationContinuation(this.wireName);

  final String wireName;

  static CustomerConfirmationContinuation parse(Object? value) {
    for (final continuation in values) {
      if (continuation.wireName == value) return continuation;
    }
    throw const FormatException('Unsupported confirmation continuation');
  }
}

enum CustomerConfirmationActionOutcome {
  succeeded('succeeded'),
  failed('failed');

  const CustomerConfirmationActionOutcome(this.wireName);

  final String wireName;

  static CustomerConfirmationActionOutcome parse(Object? value) {
    for (final outcome in values) {
      if (outcome.wireName == value) return outcome;
    }
    throw const FormatException('Unsupported confirmation action outcome');
  }
}

class CustomerApprovalPause {
  const CustomerApprovalPause({
    required this.capability,
    required this.requestId,
    required this.approvalCapability,
    required this.expiresAt,
  });

  factory CustomerApprovalPause.fromJson(Object? value) {
    final json = _strictObject(
      value,
      allowedKeys: const {
        'capability',
        'requestId',
        'approvalCapability',
        'expiresAt',
      },
      label: 'approval pause',
    );
    final capability = _requiredString(json, 'capability');
    if (!_supportedCapabilities.contains(capability)) {
      throw const FormatException('Unsupported approval capability');
    }
    final requestId = _requiredString(json, 'requestId');
    if (!_uuidPattern.hasMatch(requestId)) {
      throw const FormatException('Invalid approval request id');
    }
    final approvalCapability = _requiredString(json, 'approvalCapability');
    if (approvalCapability.length > 8192) {
      throw const FormatException('Approval capability is too large');
    }
    final expiresAtText = _requiredString(json, 'expiresAt');
    final expiresAt = DateTime.tryParse(expiresAtText);
    if (expiresAt == null || !expiresAt.isUtc) {
      throw const FormatException('Invalid approval expiry');
    }
    return CustomerApprovalPause(
      capability: capability,
      requestId: requestId,
      approvalCapability: approvalCapability,
      expiresAt: expiresAt,
    );
  }

  final String capability;
  final String requestId;

  /// A short-lived, one-shot server-signed credential. Keep in memory only.
  final String approvalCapability;
  final DateTime expiresAt;
}

class CustomerConfirmationResumeResult {
  const CustomerConfirmationResumeResult({
    required this.actionOutcome,
    required this.continuation,
    required this.requestId,
    required this.responseText,
    this.orderId,
    this.nextApproval,
  });

  factory CustomerConfirmationResumeResult.fromJson(Object? value) {
    final envelope = _strictObject(
      value,
      allowedKeys: const {'status', 'result'},
      label: 'confirmation resume response',
    );
    if (_requiredString(envelope, 'status') != 'completed') {
      throw const FormatException('Confirmation resume is not completed');
    }
    final result = _strictObject(
      envelope['result'],
      allowedKeys: const {
        'actionOutcome',
        'continuation',
        'requestId',
        'responseText',
        'orderId',
        'capability',
        'approvalCapability',
        'expiresAt',
      },
      label: 'confirmation resume result',
    );
    final actionOutcome = CustomerConfirmationActionOutcome.parse(
      result['actionOutcome'],
    );
    final continuation = CustomerConfirmationContinuation.parse(
      result['continuation'],
    );
    final requestId = _requiredString(result, 'requestId');
    if (!_uuidPattern.hasMatch(requestId)) {
      throw const FormatException('Invalid confirmation result request id');
    }
    final responseText = _requiredString(result, 'responseText');
    final orderId = switch (result['orderId']) {
      null => null,
      final String value => value,
      _ => throw const FormatException('Invalid confirmation order id'),
    };
    final hasNextApprovalFields =
        result.containsKey('capability') ||
        result.containsKey('approvalCapability') ||
        result.containsKey('expiresAt');
    final nextApproval =
        continuation == CustomerConfirmationContinuation.approvalRequired
        ? CustomerApprovalPause.fromJson({
            'capability': result['capability'],
            'requestId': requestId,
            'approvalCapability': result['approvalCapability'],
            'expiresAt': result['expiresAt'],
          })
        : null;
    if (continuation == CustomerConfirmationContinuation.turnCompleted &&
        hasNextApprovalFields) {
      throw const FormatException(
        'Completed confirmation contains another approval capability',
      );
    }
    return CustomerConfirmationResumeResult(
      actionOutcome: actionOutcome,
      continuation: continuation,
      requestId: requestId,
      responseText: responseText,
      orderId: orderId,
      nextApproval: nextApproval,
    );
  }

  final CustomerConfirmationActionOutcome actionOutcome;
  final CustomerConfirmationContinuation continuation;
  final String requestId;
  final String responseText;
  final String? orderId;
  final CustomerApprovalPause? nextApproval;
}

class CustomerConfirmationResumeException implements Exception {
  const CustomerConfirmationResumeException({
    required this.statusCode,
    required this.errorCode,
  });

  final int statusCode;
  final String errorCode;

  bool get invalidatesCapability =>
      statusCode == 400 ||
      statusCode == 403 ||
      statusCode == 404 ||
      statusCode == 410 ||
      errorCode == 'approval_capability_replayed' ||
      errorCode == 'confirmation_decision_conflict';

  @override
  String toString() =>
      'CustomerConfirmationResumeException($statusCode, $errorCode)';
}

const _supportedCapabilities = {
  'placeOrder',
  'createPaymentLink',
  'acquireVoucher',
  'redeemReward',
  'handoff',
};

final _uuidPattern = RegExp(
  r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
);

Map<String, Object?> _strictObject(
  Object? value, {
  required Set<String> allowedKeys,
  required String label,
}) {
  if (value is! Map) throw FormatException('Expected $label');
  final result = value.cast<String, Object?>();
  if (result.keys.any((key) => !allowedKeys.contains(key))) {
    throw FormatException('Unexpected field in $label');
  }
  return result;
}

String _requiredString(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! String || value.isEmpty) {
    throw FormatException('Expected $key');
  }
  return value;
}
