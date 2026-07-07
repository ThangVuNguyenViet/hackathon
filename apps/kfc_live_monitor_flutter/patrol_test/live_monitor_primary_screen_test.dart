import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kfc_live_monitor/app/kfc_monitor_app.dart';
import 'package:kfc_live_monitor/features/live_monitor/testing/live_monitor_keys.dart';
import 'package:patrol/patrol.dart';

import 'helpers/patrol_screenshot_catalog.dart';

void main() {
  const screenshotRootKey = Key('live_monitor.screenshot_root');

  patrolTest(
    'primary monitor renders a key session card and captures catalog screenshot',
    ($) async {
      await $.pumpWidgetAndSettle(
        const RepaintBoundary(key: screenshotRootKey, child: KfcMonitorApp()),
      );

      final screenshots = PatrolScreenshotCatalog(
        $,
        'live_monitor_primary_screen',
      );
      await screenshots.capture(
        'primary_monitor_grid',
        target: find.byKey(screenshotRootKey),
      );

      await $(
        LiveMonitorKeys.sessionCard('session-payment-nguyen-a'),
      ).scrollTo();
      await $(
        LiveMonitorKeys.sessionCard('session-payment-nguyen-a'),
      ).waitUntilVisible();
      await $(
        LiveMonitorKeys.sessionOpenChatButton('session-payment-nguyen-a'),
      ).waitUntilVisible();
    },
  );
}
