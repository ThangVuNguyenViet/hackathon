import 'package:kfc_live_monitor/app/kfc_monitor_app.dart';
import 'package:patrol/patrol.dart';

import 'api_clients/api_clients.dart';
import 'modules/modules.dart';
import 'system.dart';

typedef PatrolScenario =
    Future<void> Function(
      PatrolIntegrationTester $,
      Modules modules,
      System system,
      ApiClients apiClients,
    );

void testApp(String description, PatrolScenario scenario) {
  patrolTest(description, ($) async {
    final apiClients = ApiClients();
    final controller = apiClients.liveMonitorHistory.createController();
    final modules = Modules($);
    final system = System();

    await $.pumpWidgetAndSettle(
      KfcMonitorApp(liveMonitorController: controller),
    );

    try {
      await scenario($, modules, system, apiClients);
    } finally {
      controller.dispose();
      apiClients.dispose();
    }
  });
}
