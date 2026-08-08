from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from kfc_recommendation_simulator.cli import main
from kfc_recommendation_simulator.generator import generate_world
from kfc_recommendation_simulator.profiles import PROFILES
from kfc_recommendation_simulator.qualification.configuration import _base_configuration


class QualificationSmokePipelineTest(unittest.TestCase):
    def test_smoke_benchmarks_every_family_threshold_and_fails_closed(self) -> None:
        """Catches test access or fallback when no validation candidate passes."""

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            world = generate_world(
                root / "worlds",
                profile=PROFILES["smoke"],
                world_revision="qualification-smoke-v1",
            )
            result_root = root / "result"
            exit_code = main(
                [
                    "qualify-models",
                    "--world",
                    str(world),
                    "--output",
                    str(result_root),
                ]
            )
            evidence = json.loads(
                (result_root / "qualification-evidence.json").read_text(
                    encoding="utf-8"
                )
            )

            self.assertEqual(exit_code, 2)
            self.assertEqual(evidence["status"], "failed_selection")
            self.assertEqual(
                evidence["syntheticOnlyDisclaimer"],
                "Synthetic qualification evidence only; this does not claim "
                "compatibility with real KFC data or authorize real-customer exposure.",
            )
            self.assertRegex(evidence["source"]["gitSha"], r"^[a-f0-9]{40}$")
            self.assertEqual(
                set(evidence["types"]),
                {
                    "local_favorite",
                    "for_you",
                    "modifier_upsell",
                    "smart_cross_sell",
                },
            )
            for type_evidence in evidence["types"].values():
                self.assertEqual(
                    set(type_evidence["challengers"]),
                    {"logistic", "lightgbm", "xgboost", "mlp"},
                )
                for challenger in type_evidence["challengers"].values():
                    self.assertEqual(set(challenger["heads"]), {"selection", "joint"})
                    self.assertEqual(len(challenger["validationThresholds"]), 9)
                    for head in challenger["heads"].values():
                        self.assertGreater(head["trainEffectiveSampleSize"], 0)
                        self.assertGreater(head["calibrationEffectiveSampleSize"], 0)
                        self.assertGreater(head["validationEffectiveSampleSize"], 0)
                self.assertEqual(type_evidence["selectionStatus"], "failed")
                self.assertIsNone(type_evidence["champion"])
            self.assertTrue(evidence["freeze"]["worldPrecommitVerifiedBeforeSelection"])
            self.assertFalse(evidence["freeze"]["selectedConfigurationWritten"])
            self.assertFalse(evidence["freeze"]["untouchedTestOpened"])
            self.assertFalse(evidence["freeze"]["candidateRelevanceOpened"])
            self.assertFalse((result_root / "selected-configuration.json").exists())
            self.assertFalse((result_root / "frozen-configuration.json").exists())
            self.assertFalse((result_root / "qualified-model-bundle").exists())


    def test_predeclared_regularized_challenger_is_versioned(self) -> None:
        configuration = _base_configuration(
            {
                "worldDigest": "a" * 64,
                "profile": "development",
                "splitStrategy": "journey-hash-v1",
            }
        )
        self.assertEqual(
            configuration["configurationRevision"],
            "kfc-model-qualification-v3-regularized-challenger-20260806",
        )
        self.assertEqual(configuration["modelSeed"], 2_026_080_7)
        self.assertIn("lower-capacity", configuration["challengerDeclaration"])
        self.assertEqual(configuration["challengers"]["logistic"]["C"], 0.1)
        self.assertEqual(configuration["challengers"]["lightgbm"]["n_estimators"], 48)
        self.assertEqual(configuration["challengers"]["xgboost"]["n_estimators"], 48)
        self.assertEqual(
            configuration["challengers"]["mlp"]["hidden_layer_sizes"],
            [4],
        )

if __name__ == "__main__":
    unittest.main()
