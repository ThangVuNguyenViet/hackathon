from __future__ import annotations

import unittest

from kfc_recommendation_simulator.qualification.ranking import (
    InsufficientRankingEvidence,
    evaluate_opportunity_ndcg,
    evaluate_paired_policy_ndcg,
)


class RankingEvidenceBoundaryTest(unittest.TestCase):
    def test_one_rendered_action_does_not_collapse_the_eligible_ranking_set(
        self,
    ) -> None:
        """Catches treating a one-action placement as a one-candidate ranker."""

        eligible_rows = [
            {"candidateId": "a", "selectedThroughCheckout": True},
            {"candidateId": "b", "selectedThroughCheckout": None},
            {"candidateId": "c", "selectedThroughCheckout": None},
        ]

        with self.assertRaisesRegex(
            InsufficientRankingEvidence,
            "2 of 3 eligible candidates lack candidate-level relevance",
        ):
            evaluate_opportunity_ndcg(
                eligible_rows,
                score_by_candidate={"a": 0.8, "b": 0.7, "c": 0.6},
                k=1,
            )

    def test_fully_observed_eligible_set_produces_real_ndcg(self) -> None:
        """Catches rejecting an honestly labelled full candidate set."""

        eligible_rows = [
            {"candidateId": "a", "selectedThroughCheckout": False},
            {"candidateId": "b", "selectedThroughCheckout": True},
            {"candidateId": "c", "selectedThroughCheckout": False},
        ]

        result = evaluate_opportunity_ndcg(
            eligible_rows,
            score_by_candidate={"a": 0.2, "b": 0.9, "c": 0.1},
            k=1,
        )

        self.assertEqual(result, 1.0)

    def test_separate_candidate_relevance_produces_honest_ideal_dcg(self) -> None:
        eligible_rows = [
            {"candidateId": "a", "selectedThroughCheckout": None},
            {"candidateId": "b", "selectedThroughCheckout": None},
            {"candidateId": "c", "selectedThroughCheckout": None},
        ]

        result = evaluate_opportunity_ndcg(
            eligible_rows,
            score_by_candidate={"a": 0.8, "b": 0.7, "c": 0.6},
            relevance_by_candidate={"a": 1.0, "b": 3.0, "c": 2.0},
            k=2,
        )

        self.assertGreater(result, 0.0)
        self.assertLess(result, 1.0)

    def test_model_random_and_popularity_use_paired_candidate_outcomes(self) -> None:
        eligible = {
            "op-1": [{"candidateId": value} for value in ("a", "b", "c")],
            "op-2": [{"candidateId": value} for value in ("d", "e", "f")],
            "op-3": [{"candidateId": value} for value in ("g", "h", "i")],
        }
        relevance = {
            "op-1": {"a": 3.0, "b": 2.0, "c": 1.0},
            "op-2": {"d": 1.0, "e": 3.0, "f": 2.0},
            "op-3": {"g": 2.0, "h": 1.0, "i": 3.0},
        }
        scores = {
            "model": {
                "op-1": {"a": 3.0, "b": 2.0, "c": 1.0},
                "op-2": {"d": 1.0, "e": 3.0, "f": 2.0},
                "op-3": {"g": 2.0, "h": 1.0, "i": 3.0},
            },
            "random": {
                "op-1": {"a": 1.0, "b": 2.0, "c": 3.0},
                "op-2": {"d": 3.0, "e": 1.0, "f": 2.0},
                "op-3": {"g": 2.0, "h": 3.0, "i": 1.0},
            },
            "popularity": {
                "op-1": {"a": 3.0, "b": 1.0, "c": 2.0},
                "op-2": {"d": 1.0, "e": 2.0, "f": 3.0},
                "op-3": {"g": 3.0, "h": 1.0, "i": 2.0},
            },
        }

        evidence = evaluate_paired_policy_ndcg(
            eligible,
            relevance_by_opportunity=relevance,
            scores_by_policy=scores,
            reference_policy="model",
            k=2,
        )

        self.assertEqual(evidence["opportunityCount"], 3)
        self.assertEqual(evidence["policyIntervals"]["model"]["estimate"], 1.0)
        self.assertGreater(
            evidence["pairedDifferences"]["model_vs_random"]["estimate"], 0
        )
        self.assertGreater(
            evidence["pairedDifferences"]["model_vs_popularity"]["estimate"],
            0,
        )


if __name__ == "__main__":
    unittest.main()
