import 'package:flutter/widgets.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

import '../features/live_monitor/application/live_monitor_controller.dart';
import '../features/live_monitor/data/backend_live_monitor_repository.dart';
import '../features/live_monitor/data/dashboard_event_stream_factory.dart';
import '../features/live_monitor/data/live_monitor_repository.dart';
import '../features/live_monitor/domain/chat_session.dart';
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
            createLiveMonitorController(backendUrl: _backendUrl),
      ),
    );
  }
}

LiveMonitorController createLiveMonitorController({
  required String backendUrl,
}) {
  if (backendUrl.isNotEmpty) {
    return LiveMonitorController(
      repository: BackendLiveMonitorRepository(baseUrl: backendUrl),
      eventStream: createDashboardEventStream(backendUrl),
    );
  }

  return LiveMonitorController(repository: const _MissingBackendRepository());
}

class _MissingBackendRepository implements LiveMonitorRepository {
  const _MissingBackendRepository();

  @override
  Future<LiveMonitorReadiness> loadReadiness() async {
    return const LiveMonitorReadiness.configMissing(
      message: 'Missing KFC_AGENT_BACKEND_URL',
    );
  }

  @override
  Future<List<ChatSession>> loadSessions() async => const [];

  @override
  Future<void> joinHuman(String sessionId, {required String agentId}) async {}

  @override
  Future<void> resumeAi(String sessionId, {required String agentId}) async {}
}
