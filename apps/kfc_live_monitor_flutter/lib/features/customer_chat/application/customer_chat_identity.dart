import 'customer_chat_identity_storage_none.dart'
    if (dart.library.html) 'customer_chat_identity_storage_web.dart';

var _nextAnonymousCustomerSequence = 0;

class CustomerChatIdentity {
  const CustomerChatIdentity({required this.customerId})
    : sessionId = 'kfc:$customerId';

  final String customerId;
  final String sessionId;
}

CustomerChatIdentity loadOrCreateKfcCustomerChatIdentity() {
  final storedCustomerId = readStoredKfcCustomerId();
  if (_isValidKfcCustomerId(storedCustomerId)) {
    return CustomerChatIdentity(customerId: storedCustomerId!);
  }
  final customerId = _newAnonymousCustomerId();
  writeStoredKfcCustomerId(customerId);
  return CustomerChatIdentity(customerId: customerId);
}

String _newAnonymousCustomerId() {
  final timestamp = DateTime.now().microsecondsSinceEpoch;
  final sequence = ++_nextAnonymousCustomerSequence;
  return 'anon_customer_${timestamp}_$sequence';
}

bool _isValidKfcCustomerId(String? value) {
  return value != null && value.startsWith('anon_customer_');
}
