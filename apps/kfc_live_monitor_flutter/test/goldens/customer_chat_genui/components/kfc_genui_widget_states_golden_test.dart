import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_test_goldens/flutter_test_goldens.dart';
import 'package:kfc_live_monitor/features/customer_chat/domain/kfc_genui_models.dart';

import '../kfc_genui_component_golden_helpers.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  for (final kind in KfcGenUiWidgetKind.values) {
    testGoldenScene('golden ${kind.wireName}', (tester) async {
      await runKfcGenUiComponentGolden(tester, kind);
    });
  }
}
