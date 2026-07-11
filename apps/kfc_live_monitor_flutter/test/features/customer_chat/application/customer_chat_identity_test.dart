import 'package:flutter_test/flutter_test.dart';

import '../../../../lib/features/customer_chat/application/customer_chat_identity.dart';

void main() {
  test('creates a fresh anonymous session for each app initialization', () {
    final first = loadOrCreateKfcCustomerChatIdentity();
    final second = loadOrCreateKfcCustomerChatIdentity();

    expect(first.customerId, startsWith('anon_customer_'));
    expect(first.sessionId, 'kfc:${first.customerId}');
    expect(second.customerId, startsWith('anon_customer_'));
    expect(second.sessionId, 'kfc:${second.customerId}');
    expect(second.customerId, isNot(first.customerId));
    expect(second.sessionId, isNot(first.sessionId));
  });
}
