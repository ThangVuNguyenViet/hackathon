part of 'kfc_genui_models.dart';

const _opaqueProviderIdMaxLength = 2048;

bool _isWellFormedUtf16(String value) {
  for (var index = 0; index < value.length; index += 1) {
    final codeUnit = value.codeUnitAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      final next = value.codeUnitAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}

bool _isProtocolWhitespace(int codePoint) {
  return (codePoint >= 0x0009 && codePoint <= 0x000d) ||
      codePoint == 0x0020 ||
      codePoint == 0x0085 ||
      codePoint == 0x00a0 ||
      codePoint == 0x1680 ||
      (codePoint >= 0x2000 && codePoint <= 0x200a) ||
      codePoint == 0x2028 ||
      codePoint == 0x2029 ||
      codePoint == 0x202f ||
      codePoint == 0x205f ||
      codePoint == 0x3000 ||
      codePoint == 0xfeff;
}

bool _containsProtocolNonWhitespace(String value) {
  return value.runes.any((codePoint) => !_isProtocolWhitespace(codePoint));
}

bool _hasProtocolCanonicalEdges(String value) {
  final codePoints = value.runes;
  return codePoints.isNotEmpty &&
      !_isProtocolWhitespace(codePoints.first) &&
      !_isProtocolWhitespace(codePoints.last);
}

bool _isOpaqueProviderId(Object? value) {
  return value is String &&
      value.isNotEmpty &&
      value.length <= _opaqueProviderIdMaxLength &&
      _isWellFormedUtf16(value) &&
      _containsProtocolNonWhitespace(value) &&
      _hasProtocolCanonicalEdges(value);
}

bool _isPaymentMethodCollectionAuthority(Object? value) {
  final authority = _record(value);
  return authority.length == 3 &&
      _isCanonicalText(authority['collectionKey'], maximumLength: 2048) &&
      _isCanonicalText(authority['collectionRevision'], maximumLength: 2048) &&
      _isCanonicalText(authority['providerRevision'], maximumLength: 2048);
}

bool _isCanonicalText(Object? value, {required int maximumLength}) {
  return value is String &&
      value.isNotEmpty &&
      value.length <= maximumLength &&
      _isWellFormedUtf16(value) &&
      _containsProtocolNonWhitespace(value) &&
      _hasProtocolCanonicalEdges(value);
}
