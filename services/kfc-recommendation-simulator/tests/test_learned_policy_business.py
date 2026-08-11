from __future__ import annotations

import unittest

from kfc_recommendation_simulator.qualification.policy_evaluation import (
    evaluate_learned_policy_outcomes,
    journey_clustered_weighted_interval,
)


class LearnedPolicyOutcomeTest(unittest.TestCase):
    def test_business_outcome_follows_frozen_composed_candidate_order(self) -> None:
        """Catches reusing proxy automatic outcomes for a learned policy."""

        baseline = {
            "journey-1": {
                "seed": 7,
                "journeyId": "journey-1",
                "checkout": True,
                "finalMerchandiseSubtotalVnd": 100,
                "baseCartSubtotalVnd": 100,
            }
        }
        relevance = {
            (7, "opportunity-1", "rejected"): {
                "potentialSelected": False,
                "potentialCheckout": True,
                "potentialRetained": False,
                "potentialIncrementalValueVnd": 0,
            },
            (7, "opportunity-1", "good"): {
                "potentialSelected": True,
                "potentialCheckout": True,
                "potentialRetained": True,
                "potentialIncrementalValueVnd": 50,
            },
            (7, "opportunity-1", "bad"): {
                "potentialSelected": True,
                "potentialCheckout": False,
                "potentialRetained": False,
                "potentialIncrementalValueVnd": 0,
            },
        }
        good_decision = [
            {
                "seed": 7,
                "journeyId": "journey-1",
                "opportunityId": "opportunity-1",
                "recommendationType": "smart_cross_sell",
                "candidateIds": ["rejected", "good", "bad"],
            }
        ]
        bad_decision = [good_decision[0] | {"candidateIds": ["bad", "good"]}]

        good = evaluate_learned_policy_outcomes(
            baseline, relevance, good_decision, policy_name="learned"
        )[0]
        bad = evaluate_learned_policy_outcomes(
            baseline, relevance, bad_decision, policy_name="learned"
        )[0]

        self.assertEqual(good["selectedCandidateIds"], ["good"])
        self.assertTrue(good["checkout"])
        self.assertEqual(good["finalMerchandiseSubtotalVnd"], 150)
        self.assertEqual(bad["selectedCandidateIds"], ["bad"])
        self.assertFalse(bad["checkout"])
        self.assertEqual(bad["finalMerchandiseSubtotalVnd"], 0)

    def test_empty_learned_policy_is_exact_no_recommendation_baseline(self) -> None:
        """Catches inventing an unpaired no-recommendation comparator."""

        baseline = {
            "journey-1": {
                "seed": 7,
                "journeyId": "journey-1",
                "checkout": True,
                "finalMerchandiseSubtotalVnd": 100,
                "baseCartSubtotalVnd": 100,
            }
        }

        outcome = evaluate_learned_policy_outcomes(
            baseline, {}, [], policy_name="no_recommendation"
        )[0]

        self.assertTrue(outcome["checkout"])
        self.assertEqual(outcome["finalMerchandiseSubtotalVnd"], 100)
        self.assertEqual(outcome["selectedCandidateIds"], [])


class JourneyClusteredIntervalTest(unittest.TestCase):
    def test_clusters_weighted_influence_by_journey(self) -> None:
        """Catches treating opportunities from one journey as independent rows."""

        interval = journey_clustered_weighted_interval(
            values=[1.0, 3.0, 10.0],
            weights=[1.0, 1.0, 2.0],
            journey_ids=["a", "a", "b"],
        )

        self.assertEqual(interval["journeyClusterCount"], 2)
        self.assertAlmostEqual(interval["estimate"], 6.0)
        self.assertAlmostEqual(interval["effectiveSampleSize"], 8.0 / 3.0)
        self.assertAlmostEqual(interval["lower95"], -1.839855938160216)
        self.assertAlmostEqual(interval["upper95"], 13.839855938160216)


if __name__ == "__main__":
    unittest.main()
