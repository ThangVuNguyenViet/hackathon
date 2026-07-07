import 'package:flutter_test/flutter_test.dart';

import 'live_monitor_golden_helpers.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('KFC live monitor primary screen', (tester) async {
    await runLiveMonitorGolden(tester);
  });
}
