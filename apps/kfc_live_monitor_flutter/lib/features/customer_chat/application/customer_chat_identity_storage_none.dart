String? _storedCustomerId;

String? readStoredKfcCustomerId() => _storedCustomerId;

void writeStoredKfcCustomerId(String value) {
  _storedCustomerId = value;
}
