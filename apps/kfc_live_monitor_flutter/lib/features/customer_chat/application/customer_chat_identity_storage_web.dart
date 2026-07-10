import 'package:web/web.dart' as web;

const _customerIdKey = 'kfc_customer_chat_anonymous_id';

String? readStoredKfcCustomerId() {
  return web.window.localStorage.getItem(_customerIdKey);
}

void writeStoredKfcCustomerId(String value) {
  web.window.localStorage.setItem(_customerIdKey, value);
}
