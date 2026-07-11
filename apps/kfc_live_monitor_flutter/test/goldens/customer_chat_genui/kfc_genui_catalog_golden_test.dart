import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_test_goldens/flutter_test_goldens.dart';

import 'kfc_genui_component_golden_helpers.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testGoldenScene('KFC GenUI eight-widget catalog', (tester) async {
    await runKfcGenUiCatalogGolden(tester);
  });
}
