from __future__ import annotations

import unittest

from kfc_recommendation_simulator.qualification.ranking import (
    InsufficientRankingEvidence,
    evaluate_opportunity_ndcg,
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


if __name__ == "__main__":
    unittest.main()
