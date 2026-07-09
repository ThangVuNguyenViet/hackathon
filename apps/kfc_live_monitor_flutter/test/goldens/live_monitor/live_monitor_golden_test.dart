import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_test_goldens/flutter_test_goldens.dart';

import 'live_monitor_golden_helpers.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testGoldenScene('KFC live monitor primary screen', (tester) async {
    await runLiveMonitorGolden(tester);
  });
}
