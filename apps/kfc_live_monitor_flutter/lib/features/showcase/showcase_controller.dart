import 'package:state_beacon/state_beacon.dart';

import 'showcase_models.dart';
import 'showcase_repository.dart';

class ShowcaseController extends BeaconController {
  ShowcaseController(this._repository);

  final ShowcaseRepository _repository;

  late final catalog = B.future(_loadCatalog);
  late final selectedScenarioId = B.writable<String?>(null);
  late final selectedMode = B.writable(ShowcaseMode.genui);

  late final selectedScenario = B.derived(() {
    final scenarios =
        catalog.value.lastData?.scenarios ?? const <ShowcaseScenario>[];
    if (scenarios.isEmpty) return null;
    final selectedId = selectedScenarioId.value;
    return scenarios.firstWhere(
      (scenario) => scenario.id == selectedId,
      orElse: () => scenarios.first,
    );
  });

  void selectScenario(String id) {
    selectedScenarioId.value = id;
  }

  void selectMode(ShowcaseMode mode) {
    selectedMode.value = mode;
  }

  Future<ShowcaseCatalog> _loadCatalog() async {
    final value = await _repository.loadCatalog();
    selectedScenarioId.value ??= value.scenarios.isEmpty
        ? null
        : value.scenarios.first.id;
    return value;
  }
}
