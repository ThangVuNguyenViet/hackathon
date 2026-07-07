import 'package:flutter/widgets.dart';
import 'package:kfc_live_monitor/app/theme/kfc_ops_theme.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

class TestApp extends StatelessWidget {
  const TestApp({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ShadApp(theme: buildKfcOpsTheme(), home: child);
  }
}
