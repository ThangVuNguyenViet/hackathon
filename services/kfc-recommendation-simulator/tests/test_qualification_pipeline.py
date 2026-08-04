from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from kfc_recommendation_simulator.cli import main
from kfc_recommendation_simulator.generator import generate_world
from kfc_recommendation_simulator.profiles import PROFILES


class QualificationSmokePipelineTest(unittest.TestCase):
    def test_smoke_benchmarks_dual_heads_and_never_partially_promotes(self) -> None:
        """Catches a challenger/type being skipped or a failed partial release."""

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
                    {"logistic", "lightgbm", "xgboost"},
                )
                for challenger in type_evidence["challengers"].values():
                    self.assertEqual(set(challenger["heads"]), {"selection", "joint"})
                ranking = type_evidence["untouchedTest"]["rankingEvidence"]
                self.assertEqual(ranking["status"], "insufficient_evidence")
                self.assertGreater(
                    ranking["eligibleCandidateRows"], ranking["shownCandidateRows"]
                )
                self.assertGreater(ranking["unlabelledEligibleCandidateRows"], 0)
                self.assertNotIn("rankingIntervals", type_evidence["untouchedTest"])
            self.assertTrue(evidence["freeze"]["verifiedBeforeUntouchedTest"])
            self.assertTrue(evidence["freeze"]["verifiedAfterUntouchedTest"])
            self.assertTrue(evidence["freeze"]["tamperProbeRejected"])
            if evidence["status"] == "failed_qualification":
                self.assertFalse((root / "result" / "qualified-model-bundle").exists())
                self.assertTrue(
                    any(
                        "candidate-level relevance" in reason
                        for reason in evidence["failureReasons"]
                    )
                )


if __name__ == "__main__":
    unittest.main()
