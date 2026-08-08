from __future__ import annotations

import unittest

import numpy as np

from kfc_recommendation_simulator.qualification.validation import (
    evaluate_validation_thresholds,
)


def _paired_policy_inputs(
    rows: list[dict[str, object]],
) -> dict[str, object]:
    baseline: dict[str, dict[str, object]] = {}
    candidate_potentials: dict[tuple[int, str, str], dict[str, object]] = {}
    for row in rows:
        journey_id = str(row["journeyId"])
        base_subtotal = int(row["cartSubtotalVnd"])
        current = baseline.get(journey_id)
        if current is None or base_subtotal < int(current["baseCartSubtotalVnd"]):
            baseline[journey_id] = {
                "seed": int(row["seed"]),
                "journeyId": journey_id,
                "baseCartSubtotalVnd": base_subtotal,
                "checkout": True,
                "finalMerchandiseSubtotalVnd": base_subtotal,
            }
        retained = bool(row["selectedThroughCheckout"])
        candidate_potentials[
            (
                int(row["seed"]),
                str(row["opportunityId"]),
                str(row["candidateId"]),
            )
        ] = {
            "potentialSelected": bool(row["selected"]),
            "potentialCheckout": retained,
            "potentialRetained": retained,
            "potentialIncrementalValueVnd": (
                int(row["priceImpactVnd"]) if retained else 0
            ),
        }
    return {
        "baseline_by_journey": baseline,
        "candidate_potentials": candidate_potentials,
        "conversion_noninferiority_margin": 0.005,
        "abandonment_noninferiority_margin": 0.005,
    }


class ValidationPolicyEvaluationTest(unittest.TestCase):
    def test_aov_counts_base_cart_once_across_journey_opportunities(self) -> None:
        """Catches pseudo-checkouts that repeat the base cart per shown candidate."""

        rows = [
            {
                "seed": 11,
                "journeyId": "journey-1",
                "opportunityId": f"opportunity-{index}",
                "candidateId": f"candidate-{index}",
                "candidateCategoryId": "sides",
                "priceImpactVnd": price,
                "remainingBudgetVnd": 100,
                "priorItemOrderCount": 1,
                "shown": True,
                "selected": True,
                "selectedThroughCheckout": True,
                "exposurePropensity": 1.0,
                "cartSubtotalVnd": 100,
                "modifierOptionAvailable": None,
                "modifierOptionSafe": None,
            }
            for index, price in enumerate((10, 20), start=1)
        ]

        evidence = evaluate_validation_thresholds(
            recommendation_type="for_you",
            rows=rows,
            selection_probability=np.asarray([0.9, 0.8]),
            joint_probability=np.asarray([0.8, 0.7]),
            thresholds=(0.0,),
            desired_size_by_journey={"journey-1": 1},
            maximum_weight=10.0,
            maximum_ece=0.05,
            coverage_fraction=0.95,
            ranking_lower_bound=0.0,
            **_paired_policy_inputs(rows),
        )["0.0"]

        self.assertEqual(evidence["aovVnd95"]["estimate"], 130.0)

    def test_business_gate_uses_paired_learned_candidate_potentials(self) -> None:
        """Catches positive factual value masking learned-vs-baseline harm."""

        rows = [
            {
                "seed": 11,
                "journeyId": f"journey-{index}",
                "opportunityId": f"opportunity-{index}",
                "candidateId": f"candidate-{index}",
                "candidateCategoryId": "sides",
                "priceImpactVnd": 20,
                "remainingBudgetVnd": 100,
                "priorItemOrderCount": 1,
                "shown": True,
                "selected": True,
                "selectedThroughCheckout": True,
                "exposurePropensity": 1.0,
                "cartSubtotalVnd": 100,
                "modifierOptionAvailable": None,
                "modifierOptionSafe": None,
            }
            for index in (1, 2)
        ]
        baseline = {
            f"journey-{index}": {
                "seed": 11,
                "journeyId": f"journey-{index}",
                "baseCartSubtotalVnd": 100,
                "checkout": True,
                "finalMerchandiseSubtotalVnd": 100,
            }
            for index in (1, 2)
        }
        candidate_potentials = {
            (11, f"opportunity-{index}", f"candidate-{index}"): {
                "potentialSelected": True,
                "potentialCheckout": False,
                "potentialRetained": True,
                "potentialIncrementalValueVnd": 20,
            }
            for index in (1, 2)
        }

        try:
            evidence = evaluate_validation_thresholds(
                recommendation_type="for_you",
                rows=rows,
                selection_probability=np.asarray([0.9, 0.8]),
                joint_probability=np.asarray([0.8, 0.7]),
                thresholds=(0.0,),
                desired_size_by_journey={
                    "journey-1": 1,
                    "journey-2": 1,
                },
                maximum_weight=10.0,
                maximum_ece=0.05,
                coverage_fraction=0.95,
                ranking_lower_bound=0.0,
                baseline_by_journey=baseline,
                candidate_potentials=candidate_potentials,
                conversion_noninferiority_margin=0.005,
                abandonment_noninferiority_margin=0.005,
            )["0.0"]
        except TypeError as error:
            self.fail(f"validation evaluator lacks paired policy inputs: {error}")

        comparison = evidence["businessComparisonVsNoRecommendation"]
        self.assertEqual(
            comparison["checkoutConversionDifference95"]["estimate"], -1.0
        )
        self.assertEqual(comparison["abandonmentDifference95"]["estimate"], 1.0)
        self.assertFalse(evidence["gates"]["business"])

    def test_every_threshold_runs_through_exact_smart_composer(self) -> None:
        """Catches row-level threshold selection that skips slate composition."""

        rows = [
            {
                "seed": 11,
                "journeyId": "journey-1",
                "opportunityId": "opportunity-1",
                "candidateId": candidate_id,
                "candidateCategoryId": category,
                "priceImpactVnd": 10,
                "remainingBudgetVnd": 100,
                "priorItemOrderCount": index,
                "shown": True,
                "selected": True,
                "selectedThroughCheckout": True,
                "exposurePropensity": 1.0,
                "cartSubtotalVnd": 50,
                "modifierOptionAvailable": None,
                "modifierOptionSafe": None,
            }
            for index, (candidate_id, category) in enumerate(
                (("a", "chicken"), ("b", "sides"), ("c", "drinks"))
            )
        ]

        evidence = evaluate_validation_thresholds(
            recommendation_type="smart_cross_sell",
            rows=rows,
            selection_probability=np.asarray([0.90, 0.80, 0.70]),
            joint_probability=np.asarray([0.80, 0.70, 0.60]),
            thresholds=(0.0, 0.95),
            desired_size_by_journey={"journey-1": 3},
            maximum_weight=10.0,
            maximum_ece=0.05,
            coverage_fraction=0.95,
            ranking_lower_bound=0.0,
            **_paired_policy_inputs(rows),
        )

        self.assertEqual(set(evidence), {"0.0", "0.95"})
        self.assertEqual(evidence["0.0"]["composer"]["renderedCandidateCount"], 3)
        self.assertEqual(evidence["0.0"]["invalidCounters"]["paddingViolations"], 0)
        self.assertEqual(evidence["0.95"]["composer"]["renderedCandidateCount"], 0)
        self.assertEqual(evidence["0.95"]["coverage"], 0.0)
        self.assertFalse(evidence["0.95"]["gates"]["coverage"])

    def test_invalid_modifier_is_counted_in_its_evaluated_policy(self) -> None:
        """Catches fabricated zero validity counters in policy evidence."""

        rows = [
            {
                "seed": 11,
                "journeyId": "journey-1",
                "opportunityId": "opportunity-1",
                "candidateId": "modifier:a",
                "candidateCategoryId": "modifier",
                "priceImpactVnd": 10,
                "remainingBudgetVnd": 100,
                "priorItemOrderCount": 1,
                "shown": True,
                "selected": True,
                "selectedThroughCheckout": True,
                "exposurePropensity": 1.0,
                "cartSubtotalVnd": 50,
                "modifierOptionAvailable": False,
                "modifierOptionSafe": True,
            }
        ]

        evidence = evaluate_validation_thresholds(
            recommendation_type="modifier_upsell",
            rows=rows,
            selection_probability=np.asarray([0.9]),
            joint_probability=np.asarray([0.8]),
            thresholds=(0.0,),
            desired_size_by_journey={"journey-1": 1},
            maximum_weight=10.0,
            maximum_ece=0.05,
            coverage_fraction=0.95,
            ranking_lower_bound=0.0,
            **_paired_policy_inputs(rows),
        )["0.0"]

        self.assertEqual(evidence["invalidCounters"]["modifierValidityViolations"], 1)
        self.assertFalse(evidence["gates"]["validity"])

    def test_split_ess_is_reported_from_actual_ipw_rows(self) -> None:
        """Catches reporting training ESS while omitting calibration/validation."""

        rows = [
            {
                "seed": 11,
                "journeyId": "journey-1",
                "opportunityId": "opportunity-1",
                "candidateId": "a",
                "candidateCategoryId": "sides",
                "priceImpactVnd": 10,
                "remainingBudgetVnd": None,
                "priorItemOrderCount": 1,
                "shown": True,
                "selected": True,
                "selectedThroughCheckout": True,
                "exposurePropensity": 0.5,
                "cartSubtotalVnd": 50,
                "modifierOptionAvailable": None,
                "modifierOptionSafe": None,
            },
            {
                "seed": 11,
                "journeyId": "journey-2",
                "opportunityId": "opportunity-2",
                "candidateId": "b",
                "candidateCategoryId": "drinks",
                "priceImpactVnd": 10,
                "remainingBudgetVnd": None,
                "priorItemOrderCount": 1,
                "shown": True,
                "selected": False,
                "selectedThroughCheckout": False,
                "exposurePropensity": 0.25,
                "cartSubtotalVnd": 50,
                "modifierOptionAvailable": None,
                "modifierOptionSafe": None,
            },
        ]

        evidence = evaluate_validation_thresholds(
            recommendation_type="for_you",
            rows=rows,
            selection_probability=np.asarray([0.8, 0.2]),
            joint_probability=np.asarray([0.7, 0.1]),
            thresholds=(0.0,),
            desired_size_by_journey={"journey-1": 1, "journey-2": 1},
            maximum_weight=10.0,
            maximum_ece=0.05,
            coverage_fraction=0.95,
            ranking_lower_bound=0.0,
            **_paired_policy_inputs(rows),
        )["0.0"]

        self.assertAlmostEqual(evidence["effectiveSampleSize"], 1.8)


if __name__ == "__main__":
    unittest.main()
