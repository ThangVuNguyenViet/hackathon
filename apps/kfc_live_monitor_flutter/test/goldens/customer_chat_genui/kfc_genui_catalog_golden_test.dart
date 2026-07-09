import 'package:flutter_test/flutter_test.dart';

import 'kfc_genui_component_golden_helpers.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('KFC GenUI six-widget catalog', (tester) async {
    await runKfcGenUiCatalogGolden(tester);
  });
}
