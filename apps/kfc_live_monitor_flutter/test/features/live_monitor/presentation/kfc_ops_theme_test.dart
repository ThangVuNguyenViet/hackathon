import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/app/theme/kfc_ops_theme.dart';
import 'package:kfc_live_monitor/app/theme/kfc_ops_tokens.dart';

void main() {
  test('KfcOpsTokens match approved Stitch colors', () {
    expect(KfcOpsTokens.surface, const Color(0xFFF8F9FA));
    expect(KfcOpsTokens.primary, const Color(0xFFB60020));
    expect(KfcOpsTokens.critical, const Color(0xFFDC3545));
    expect(KfcOpsTokens.warning, const Color(0xFFFFC107));
    expect(KfcOpsTokens.success, const Color(0xFF198754));
    expect(KfcOpsTokens.radiusLg, const Radius.circular(8));
  });

  test('buildKfcOpsTheme uses Be Vietnam Pro', () {
    final theme = buildKfcOpsTheme();

    expect(theme.textTheme.family, 'Be Vietnam Pro');
  });
}
