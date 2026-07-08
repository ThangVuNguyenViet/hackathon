import 'package:flutter/widgets.dart';

import 'app/kfc_monitor_app.dart';
import 'features/live_monitor/application/live_monitor_controller.dart';
import 'features/live_monitor/data/backend_live_monitor_repository.dart';
import 'features/live_monitor/data/dashboard_event_stream_factory.dart';

const _backendUrl = 'http://localhost:18090';

void main() {
  runApp(
    KfcMonitorApp(
      liveMonitorController: LiveMonitorController(
        repository: BackendLiveMonitorRepository(baseUrl: _backendUrl),
        eventStream: createDashboardEventStream(_backendUrl),
      ),
    ),
  );
}
