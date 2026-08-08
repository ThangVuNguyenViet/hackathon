from __future__ import annotations

import json
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

    def test_suppressed_factual_policies_keep_automatic_eligible_candidates(
        self,
    ) -> None:
        """Catches policy suppression erasing the evaluation candidate set."""

        journeys = pq.read_table(
            self.world / "evaluation" / "journeys.parquet"
        ).to_pylist()
        suppressed_journeys = {
            row["journeyId"]: row["assignedCondition"]
            for row in journeys
            if row["assignedCondition"] == "no_recommendation"
            or row["assignedCondition"].startswith("ablate_")
        }
        self.assertTrue(suppressed_journeys)
        automatic_paths = {}
        for row in pq.read_table(
            self.world / "oracle" / "potential-outcomes.parquet",
            columns=["journeyId", "condition", "treatmentPathJson"],
        ).to_pylist():
            if (
                row["condition"] == "automatic"
                and row["journeyId"] in suppressed_journeys
            ):
                automatic_paths[row["journeyId"]] = json.loads(
                    row["treatmentPathJson"]
                )
        relevance = pq.read_table(
            self.world / "evaluation" / "candidate-relevance.parquet"
        ).to_pylist()
        training = pq.read_table(
            self.world / "model-visible" / "training-examples.parquet"
        ).to_pylist()
        relevance_by_opportunity = {}
        for row in relevance:
            if row["journeyId"] in suppressed_journeys:
                relevance_by_opportunity.setdefault(row["opportunityId"], set()).add(
                    row["candidateId"]
                )
        training_by_opportunity = {}
        for row in training:
            if row["journeyId"] in suppressed_journeys:
                training_by_opportunity.setdefault(row["opportunityId"], []).append(row)

        expected_nonempty_by_condition = {}
        for journey_id, path in automatic_paths.items():
            condition = suppressed_journeys[journey_id]
            for placement in path:
                if condition != "no_recommendation" and condition != (
                    f"ablate_{placement['recommendationType']}"
                ):
                    continue
                expected = set(placement["eligibleCandidateIds"])
                expected_nonempty_by_condition[condition] = (
                    expected_nonempty_by_condition.get(condition, 0) + bool(expected)
                )
                self.assertEqual(
                    relevance_by_opportunity.get(placement["opportunityId"], set()),
                    expected,
                )
                model_rows = training_by_opportunity.get(
                    placement["opportunityId"], []
                )
                self.assertEqual(
                    {row["candidateId"] for row in model_rows}, expected
                )
                self.assertTrue(all(not row["shown"] for row in model_rows))
                self.assertTrue(
                    all(row["selectedThroughCheckout"] is None for row in model_rows)
                )
        self.assertIn("no_recommendation", expected_nonempty_by_condition)
        self.assertTrue(
            all(count > 0 for count in expected_nonempty_by_condition.values())
        )

    def test_canonical_enumeration_retains_every_factual_exposure_label(
        self,
    ) -> None:
        """Catches canonical eligibility silently dropping observed support."""

        training = pq.read_table(
            self.world / "model-visible" / "training-examples.parquet"
        ).to_pylist()
        exposures = pq.read_table(
            self.world / "evaluation" / "exposures.parquet"
        ).to_pylist()
        shown_keys = {
            (row["opportunityId"], row["candidateId"])
            for row in training
            if row["shown"]
        }
        exposure_keys = {
            (row["opportunityId"], row["candidateId"])
            for row in exposures
        }

        self.assertEqual(shown_keys, exposure_keys)

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

    def test_relevance_responds_to_candidate_and_opportunity_context(self) -> None:
        """Catches graded relevance collapsing to price within opportunities."""

        rows = pq.read_table(
            self.world / "evaluation" / "candidate-relevance.parquet"
        ).to_pylist()
        by_opportunity = {}
        by_candidate = {}
        for row in rows:
            by_opportunity.setdefault(row["opportunityId"], []).append(row)
            by_candidate.setdefault(row["candidateId"], []).append(row)

        candidate_probability_groups = 0
        cheaper_but_more_relevant_pairs = 0
        for opportunity_rows in by_opportunity.values():
            if len(opportunity_rows) < 2:
                continue
            probability_tuples = {
                (
                    row["selectionProbability"],
                    row["checkoutProbability"],
                    row["removalProbability"],
                )
                for row in opportunity_rows
            }
            candidate_probability_groups += len(probability_tuples) > 1
            cheaper_but_more_relevant_pairs += any(
                left["priceImpactVnd"] < right["priceImpactVnd"]
                and left["gradedRelevance"] > right["gradedRelevance"]
                for left in opportunity_rows
                for right in opportunity_rows
            )
        context_responsive_candidates = sum(
            len(
                {
                    (
                        row["selectionProbability"],
                        row["checkoutProbability"],
                        row["removalProbability"],
                    )
                    for row in candidate_rows
                }
            )
            > 1
            for candidate_rows in by_candidate.values()
            if len(candidate_rows) > 1
        )

        self.assertGreater(candidate_probability_groups, 10)
        self.assertGreater(cheaper_but_more_relevant_pairs, 10)
        self.assertGreater(context_responsive_candidates, 10)

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
