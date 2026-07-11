var _nextAnonymousCustomerSequence = 0;

class CustomerChatIdentity {
  const CustomerChatIdentity({required this.customerId})
    : sessionId = 'kfc:$customerId';

  final String customerId;
  final String sessionId;
}

CustomerChatIdentity loadOrCreateKfcCustomerChatIdentity() {
  // Demo mode: do not persist the anonymous identity across app launches.
  final customerId = _newAnonymousCustomerId();
  return CustomerChatIdentity(customerId: customerId);
}

String _newAnonymousCustomerId() {
  final timestamp = DateTime.now().microsecondsSinceEpoch;
  final sequence = ++_nextAnonymousCustomerSequence;
  return 'anon_customer_${timestamp}_$sequence';
}
