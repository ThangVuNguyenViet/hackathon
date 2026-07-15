import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../features/showcase/showcase_controller.dart';
import '../features/showcase/showcase_repository.dart';
import '../features/showcase/showcase_screen.dart';
import 'theme/kfc_ops_theme.dart';

const _backendUrl = String.fromEnvironment('KFC_AGENT_BACKEND_URL');

class KfcShowcaseApp extends StatefulWidget {
  const KfcShowcaseApp({super.key, this.controller});

  final ShowcaseController? controller;

  @override
  State<KfcShowcaseApp> createState() => _KfcShowcaseAppState();
}

class _KfcShowcaseAppState extends State<KfcShowcaseApp> {
  late final ShowcaseController _controller;
  late final bool _ownsController;

  @override
  void initState() {
    super.initState();
    _ownsController = widget.controller == null;
    _controller =
        widget.controller ??
        ShowcaseController(ShowcaseRepository(baseUrl: _backendUrl));
  }

  @override
  void dispose() {
    if (_ownsController) _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ShadApp(
      title: 'KFC Test Kitchen',
      theme: buildKfcOpsTheme(),
      home: ShowcaseScreen(controller: _controller),
    );
  }
}
