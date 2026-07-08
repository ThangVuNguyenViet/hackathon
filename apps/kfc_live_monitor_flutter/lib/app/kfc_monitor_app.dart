import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../features/live_monitor/application/live_monitor_controller.dart';
import '../features/live_monitor/data/backend_live_monitor_repository.dart';
import '../features/live_monitor/data/dashboard_event_stream_factory.dart';
import '../features/live_monitor/data/mock_live_monitor_repository.dart';
import '../features/live_monitor/presentation/live_monitor_screen.dart';
import 'theme/kfc_ops_theme.dart';

const _backendUrl = String.fromEnvironment('KFC_AGENT_BACKEND_URL');

class KfcMonitorApp extends StatelessWidget {
  const KfcMonitorApp({super.key, this.liveMonitorController});

  final LiveMonitorController? liveMonitorController;

  @override
  Widget build(BuildContext context) {
    return ShadApp(
      title: 'KFC Live Monitor',
      theme: buildKfcOpsTheme(),
      home: LiveMonitorScreen(
        controller:
            liveMonitorController ??
            LiveMonitorController(
              repository: _backendUrl.isEmpty
                  ? const MockLiveMonitorRepository()
                  : BackendLiveMonitorRepository(baseUrl: _backendUrl),
              eventStream: _backendUrl.isEmpty
                  ? null
                  : createDashboardEventStream(_backendUrl),
            ),
      ),
    );
  }
}
