from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from kfc_recommendation_simulator.generator import generate_world
from kfc_recommendation_simulator.profiles import GenerationProfile

SIMULATOR_ROOT = Path(__file__).resolve().parents[1]


class CandidateRelevanceSurfaceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temporary = tempfile.TemporaryDirectory()
        cls.world = generate_world(
            Path(cls.temporary.name),
            profile=GenerationProfile("candidate-relevance", 512, (43,)),
            world_revision="candidate-relevance-v1",
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temporary.cleanup()

    def test_surface_has_one_candidate_specific_value_for_every_eligible_row(
        self,
    ) -> None:
        relevance_path = self.world / "evaluation" / "candidate-relevance.parquet"
        self.assertTrue(
            relevance_path.is_file(),
            "evaluation candidate relevance artifact is missing",
        )
        relevance = pq.read_table(relevance_path).to_pylist()
        training = pq.read_table(
            self.world / "model-visible" / "training-examples.parquet"
        ).to_pylist()
        opportunities = pq.read_table(
            self.world / "evaluation" / "opportunities.parquet"
        ).to_pylist()
        expected_keys = {
            (row["journeyId"], row["opportunityId"], row["candidateId"])
            for row in training
        }
        actual_keys = [
            (row["journeyId"], row["opportunityId"], row["candidateId"])
            for row in relevance
        ]
        self.assertEqual(len(actual_keys), len(set(actual_keys)))
        self.assertEqual(set(actual_keys), expected_keys)
        self.assertEqual(
            len(relevance), sum(row["candidateCount"] for row in opportunities)
        )
        self.assertEqual(
            set(relevance[0]),
            {
                "evaluationDefinitionVersion",
                "evaluationDefinitionDigest",
                "intervention",
                "seed",
                "split",
                "journeyId",
                "opportunityId",
                "recommendationType",
                "candidateId",
                "potentialOutcomeRef",
                "priceImpactVnd",
                "selectionProbability",
                "checkoutProbability",
                "removalProbability",
                "potentialSelected",
                "potentialCheckout",
                "potentialRemoved",
                "potentialRetained",
                "potentialIncrementalValueVnd",
                "expectedRetainedValueVnd",
                "gradedRelevance",
            },
        )

    def test_relevance_and_realized_value_follow_the_declared_causal_identity(
        self,
    ) -> None:
        rows = pq.read_table(
            self.world / "evaluation" / "candidate-relevance.parquet"
        ).to_pylist()
        self.assertTrue(rows)
        for row in rows:
            expected_retained = (
                row["potentialSelected"]
                and row["potentialCheckout"]
                and not row["potentialRemoved"]
            )
            self.assertEqual(row["potentialRetained"], expected_retained)
            self.assertEqual(
                row["potentialIncrementalValueVnd"],
                row["priceImpactVnd"] if expected_retained else 0,
            )
            expected_value = (
                row["priceImpactVnd"]
                * row["selectionProbability"]
                * row["checkoutProbability"]
                * (1 - row["removalProbability"])
            )
            self.assertAlmostEqual(row["expectedRetainedValueVnd"], expected_value)
            self.assertEqual(row["gradedRelevance"], row["expectedRetainedValueVnd"])
            self.assertGreater(row["gradedRelevance"], 0)
        self.assertGreater(len({row["gradedRelevance"] for row in rows}), 10)

    def test_training_surface_keeps_unshown_labels_null_and_rejects_relevance(
        self,
    ) -> None:
        training_path = (
            self.world / "model-visible" / "training-examples.parquet"
        )
        training = pq.read_table(training_path)
        relevance_fields = {
            "evaluationDefinitionVersion",
            "evaluationDefinitionDigest",
            "intervention",
            "potentialOutcomeRef",
            "selectionProbability",
            "checkoutProbability",
            "removalProbability",
            "potentialSelected",
            "potentialCheckout",
            "potentialRemoved",
            "potentialRetained",
            "potentialIncrementalValueVnd",
            "expectedRetainedValueVnd",
            "gradedRelevance",
        }
        self.assertTrue(relevance_fields.isdisjoint(training.column_names))
        rows = training.to_pylist()
        unshown = [row for row in rows if not row["shown"]]
        self.assertTrue(unshown)
        self.assertTrue(
            all(row["selectedThroughCheckout"] is None for row in unshown)
        )

        leaked = training.append_column(
            "gradedRelevance",
            pa.array([1.0] * training.num_rows, type=pa.float64()),
        )
        pq.write_table(leaked, training_path)
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "kfc_recommendation_simulator.cli",
                "training-summary",
                "--world",
                str(self.world),
            ],
            cwd=SIMULATOR_ROOT,
            env={**os.environ, "PYTHONPATH": str(SIMULATOR_ROOT / "src")},
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("forbidden training field", result.stderr)


if __name__ == "__main__":
    unittest.main()
