from __future__ import annotations

import json
import tempfile
import unittest
from collections import defaultdict
from itertools import permutations
from pathlib import Path

import pyarrow.parquet as pq

from kfc_recommendation_simulator.generator import generate_world
from kfc_recommendation_simulator.profiles import GenerationProfile


class CausalJourneyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temporary = tempfile.TemporaryDirectory()
        cls.world = generate_world(
            Path(cls.temporary.name),
            profile=GenerationProfile("causal-test", 256, (31,)),
            world_revision="causal-test-v2",
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temporary.cleanup()

    def test_each_treatment_owns_a_value_consistent_action_path(self) -> None:
        rows = pq.read_table(
            self.world / "oracle" / "potential-outcomes.parquet"
        ).to_pylist()
        no_treatment = [row for row in rows if row["condition"] == "no_recommendation"]
        self.assertTrue(no_treatment)
        self.assertTrue(
            all(
                json.loads(row["selectedActionIdsJson"]) == []
                and json.loads(row["retainedActionIdsJson"]) == []
                and row["treatmentRevenueVnd"] == 0
                for row in no_treatment
            )
        )
        for row in rows:
            expected = (
                row["baseCartSubtotalVnd"] + row["treatmentRevenueVnd"]
                if row["checkout"]
                else 0
            )
            self.assertEqual(row["finalMerchandiseSubtotalVnd"], expected)
            if row["checkout"]:
                self.assertGreater(row["finalMerchandiseSubtotalVnd"], 0)
        retained_automatic = [
            row
            for row in rows
            if row["condition"] == "automatic"
            and row["checkout"]
            and json.loads(row["retainedActionIdsJson"])
        ]
        self.assertTrue(retained_automatic)
        self.assertTrue(
            all(
                row["treatmentRevenueVnd"] > 0
                and row["finalMerchandiseSubtotalVnd"] > row["baseCartSubtotalVnd"]
                for row in retained_automatic
            )
        )

    def test_factual_journeys_have_exact_stateful_lifecycle(self) -> None:
        source = {
            row["journeyId"]: row
            for row in pq.read_table(
                self.world / "source" / "journeys.parquet"
            ).to_pylist()
        }
        population = {
            row["customerId"]: row
            for row in pq.read_table(
                self.world / "source" / "population.parquet"
            ).to_pylist()
        }
        grouped: dict[str, list[dict[str, object]]] = defaultdict(list)
        for row in pq.read_table(
            self.world / "evaluation" / "opportunities.parquet"
        ).to_pylist():
            grouped[row["journeyId"]].append(row)

        modifier_outcomes: set[str] = set()
        for journey_id, opportunities in grouped.items():
            opportunities.sort(key=lambda row: row["sequence"])
            self.assertEqual([row["sequence"] for row in opportunities], [1, 2, 3])
            journey = source[journey_id]
            customer = population[journey["customerId"]]
            expected_starter = (
                "local_favorite" if customer["completedOrderCount"] == 0 else "for_you"
            )
            starter, modifier, smart = opportunities
            self.assertEqual(starter["recommendationType"], expected_starter)
            self.assertEqual(journey["starterRecommendationType"], expected_starter)
            if starter["outcomeClass"] == "accepted":
                self.assertIsNotNone(starter["createdCartLineId"])
                if modifier["status"] != "suppressed":
                    self.assertEqual(
                        modifier["parentCartLineId"], starter["createdCartLineId"]
                    )
            elif modifier["status"] != "suppressed":
                self.assertEqual(modifier["status"], "empty")
                self.assertEqual(modifier["emptyReason"], "parent_cart_line_not_found")
            self.assertEqual(modifier["recommendationType"], "modifier_upsell")
            self.assertEqual(smart["recommendationType"], "smart_cross_sell")
            self.assertEqual(
                smart["cartSubtotalBeforeVnd"], modifier["cartSubtotalAfterVnd"]
            )
            self.assertEqual(
                smart["cartLineCountBefore"], modifier["cartLineCountAfter"]
            )
            modifier_outcomes.add(modifier["outcomeClass"])
        self.assertEqual(
            modifier_outcomes,
            {"accepted", "dismissed", "ignored", "empty", "suppressed"},
        )

    def test_counterfactual_policies_and_ablations_are_exact(self) -> None:
        rows = pq.read_table(
            self.world / "oracle" / "potential-outcomes.parquet"
        ).to_pylist()
        by_journey: dict[str, dict[str, list[dict[str, object]]]] = defaultdict(dict)
        for row in rows:
            by_journey[row["journeyId"]][row["condition"]] = json.loads(
                row["treatmentPathJson"]
            )

        for conditions in by_journey.values():
            self.assertEqual(
                {placement["policyName"] for placement in conditions["automatic"]},
                {"automatic_proxy_scorer_composer_v1"},
            )
            for placement in conditions["no_recommendation"]:
                self.assertEqual(placement["status"], "suppressed")
                self.assertEqual(placement["members"], [])
            for placement in conditions["popularity"]:
                if placement["status"] == "ready":
                    self.assertEqual(
                        placement["rankedCandidateIds"],
                        placement["popularityOrderCandidateIds"],
                    )
            for placement in conditions["random_eligible"]:
                if placement["status"] != "ready":
                    continue
                self.assertGreater(placement["slatePropensity"], 0)
                self.assertLessEqual(placement["slatePropensity"], 1)
                self.assertTrue(
                    all(
                        0 < member["selectionPropensity"] <= 1
                        for member in placement["members"]
                    )
                )
            for recommendation_type in (
                "local_favorite",
                "for_you",
                "modifier_upsell",
                "smart_cross_sell",
            ):
                ablation = conditions[f"ablate_{recommendation_type}"]
                matching = [
                    placement
                    for placement in ablation
                    if placement["recommendationType"] == recommendation_type
                ]
                if matching:
                    self.assertEqual(matching[0]["status"], "suppressed")
                self.assertTrue(
                    all(
                        placement["status"] != "suppressed"
                        for placement in ablation
                        if placement["recommendationType"] != recommendation_type
                    )
                )

    def test_every_policy_ranks_then_uses_one_exact_propensity_composer(self) -> None:
        source = {
            row["journeyId"]: row
            for row in pq.read_table(
                self.world / "source" / "journeys.parquet"
            ).to_pylist()
        }
        rows = pq.read_table(
            self.world / "oracle" / "potential-outcomes.parquet"
        ).to_pylist()

        def compose(
            ranked: list[dict[str, object]],
            recommendation_type: str,
            desired_smart_size: int,
            remaining_budget_vnd: int,
        ) -> list[dict[str, object]]:
            if recommendation_type != "smart_cross_sell":
                return ranked[:1]
            selected: list[dict[str, object]] = []
            categories: set[str] = set()
            total_vnd = 0
            for candidate in ranked:
                category = str(candidate["categoryId"])
                price_vnd = int(candidate["priceImpactVnd"])
                if (
                    float(candidate["composerScore"]) <= 0
                    or category in categories
                    or total_vnd + price_vnd > remaining_budget_vnd
                ):
                    continue
                selected.append(candidate)
                categories.add(category)
                total_vnd += price_vnd
                if len(selected) == desired_smart_size:
                    break
            return selected if len(selected) >= 3 else []

        for row in rows:
            path = json.loads(row["treatmentPathJson"])
            for placement in path:
                if placement["status"] == "suppressed":
                    continue
                facts = placement.get("eligibleCandidates")
                ranked_ids = placement.get("rankedCandidateIds")
                self.assertIsNotNone(facts)
                self.assertIsNotNone(ranked_ids)
                lookup = {candidate["candidateId"]: candidate for candidate in facts}
                ranked = [lookup[candidate_id] for candidate_id in ranked_ids]
                expected = compose(
                    ranked,
                    placement["recommendationType"],
                    source[row["journeyId"]]["desiredSmartSlateSize"],
                    max(0, 250_000 - placement["cartSubtotalBeforeVnd"]),
                )
                actual_ids = [member["candidateId"] for member in placement["members"]]
                self.assertEqual(
                    actual_ids,
                    [candidate["candidateId"] for candidate in expected],
                )
                if row["condition"] != "random_eligible" or not expected:
                    continue
                possible = [
                    compose(
                        list(order),
                        placement["recommendationType"],
                        source[row["journeyId"]]["desiredSmartSlateSize"],
                        max(0, 250_000 - placement["cartSubtotalBeforeVnd"]),
                    )
                    for order in permutations(facts)
                ]
                matching = sum(
                    [candidate["candidateId"] for candidate in output] == actual_ids
                    for output in possible
                )
                self.assertAlmostEqual(
                    placement["slatePropensity"], matching / len(possible)
                )
                for member in placement["members"]:
                    included = sum(
                        member["candidateId"]
                        in {candidate["candidateId"] for candidate in output}
                        for output in possible
                    )
                    self.assertAlmostEqual(
                        member["selectionPropensity"], included / len(possible)
                    )


if __name__ == "__main__":
    unittest.main()
