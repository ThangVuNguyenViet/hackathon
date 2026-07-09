import 'package:patrol/patrol.dart';

import 'live_monitor.dart';

final class Modules {
  Modules(this._$);

  final PatrolIntegrationTester _$;

  late final liveMonitor = LiveMonitor(_$);
}
