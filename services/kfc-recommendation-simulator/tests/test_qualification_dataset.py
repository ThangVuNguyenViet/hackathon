from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from kfc_recommendation_simulator.generator import generate_world
from kfc_recommendation_simulator.profiles import GenerationProfile
from kfc_recommendation_simulator.qualification.datasets import (
    load_untouched_model_table,
)
from kfc_recommendation_simulator.qualification.freeze import freeze_configuration


class UntouchedDatasetBoundaryTest(unittest.TestCase):
    def test_untouched_rows_open_only_after_configuration_freeze(self) -> None:
        """Catches test-window access during model or threshold selection."""

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            world = generate_world(
                root / "worlds",
                profile=GenerationProfile("boundary", 200, (17,)),
                world_revision="boundary-v1",
            )
            configuration = root / "selected-configuration.json"
            configuration.write_text(
                json.dumps({"champion": "logistic"}), encoding="utf-8"
            )
            frozen = freeze_configuration(configuration, root / "frozen.json")

            table = load_untouched_model_table(world, configuration, frozen)

            self.assertGreater(table.num_rows, 0)
            self.assertEqual(set(table["split"].to_pylist()), {"untouched_test"})


if __name__ == "__main__":
    unittest.main()
