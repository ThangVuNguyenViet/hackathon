from __future__ import annotations

import hashlib
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from .business import _business_gate, _learned_business_comparison
from .composer import ScoredCandidate, compose_candidates
from .metrics import binary_metrics
from .policy_evaluation import (
    evaluate_learned_policy_outcomes,
    journey_clustered_weighted_interval,
)
from .weighting import clipped_inverse_propensity_weights, effective_sample_size


def _random_score(seed: int, opportunity_id: str, candidate_id: str) -> float:
    digest = hashlib.sha256(
        f"{seed}\0{opportunity_id}\0{candidate_id}".encode()
    ).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def _baseline_composed(
    *,
    recommendation_type: str,
    rows: Sequence[Mapping[str, Any]],
    order: Sequence[int],
    remaining_budget_vnd: int,
    desired_size: int,
) -> tuple[ScoredCandidate, ...]:
    candidates = []
    for rank, index in enumerate(order):
        rank_score = float(len(order) - rank) / max(1, len(order))
        price = int(rows[index]["priceImpactVnd"])
        candidates.append(
            ScoredCandidate(
                str(rows[index]["candidateId"]),
                str(rows[index]["candidateCategoryId"]),
                price,
                min(1.0, rank_score / max(1, price)),
            )
        )
    return compose_candidates(
        recommendation_type=recommendation_type,
        candidates=candidates,
        abstention_threshold=0.0,
        remaining_budget_vnd=remaining_budget_vnd,
        desired_smart_size=desired_size,
    )


def _weighted_aov_interval(
    *,
    revenue: list[float],
    checkout: list[float],
    weights: list[float],
    journey_ids: list[str],
) -> dict[str, float | int]:
    weighted_checkout = sum(
        value * weight for value, weight in zip(checkout, weights, strict=True)
    )
    if weighted_checkout <= 0:
        return {
            "estimate": 0.0,
            "lower95": 0.0,
            "upper95": 0.0,
            "journeyClusterCount": len(set(journey_ids)),
            "effectiveSampleSize": effective_sample_size(np.asarray(weights)),
        }
    total_weight = sum(weights)
    aov = sum(
        value * weight for value, weight in zip(revenue, weights, strict=True)
    ) / weighted_checkout
    checkout_rate = weighted_checkout / total_weight
    influence = [
        (value - aov * converted) / checkout_rate
        for value, converted in zip(revenue, checkout, strict=True)
    ]
    influence_interval = journey_clustered_weighted_interval(
        values=influence,
        weights=weights,
        journey_ids=journey_ids,
    )
    half_width = float(influence_interval["upper95"]) - float(
        influence_interval["estimate"]
    )
    return {
        "estimate": aov,
        "lower95": aov - half_width,
        "upper95": aov + half_width,
        "journeyClusterCount": influence_interval["journeyClusterCount"],
        "effectiveSampleSize": influence_interval["effectiveSampleSize"],
    }


def evaluate_validation_thresholds(
    *,
    recommendation_type: str,
    rows: Sequence[Mapping[str, Any]],
    selection_probability: NDArray[np.float64],
    joint_probability: NDArray[np.float64],
    thresholds: Sequence[float],
    desired_size_by_journey: Mapping[str, int],
    maximum_weight: float,
    maximum_ece: float,
    calibration_brier_tolerance: float,
    coverage_fraction: float,
    ranking_lower_bound: float,
    baseline_by_journey: Mapping[str, Mapping[str, Any]],
    candidate_potentials: Mapping[tuple[int, str, str], Mapping[str, Any]],
    conversion_noninferiority_margin: float,
    abandonment_noninferiority_margin: float,
) -> dict[str, dict[str, Any]]:
    if not rows or len(rows) != len(selection_probability) or len(rows) != len(
        joint_probability
    ):
        raise ValueError(
            "validation rows and probabilities must be non-empty and aligned"
        )
    shown_indices = [index for index, row in enumerate(rows) if bool(row["shown"])]
    shown_rows = [rows[index] for index in shown_indices]
    weights_array = clipped_inverse_propensity_weights(
        np.asarray(
            [float(row["exposurePropensity"]) for row in shown_rows],
            dtype=np.float64,
        ),
        maximum_weight=maximum_weight,
    )
    weights = weights_array.tolist()
    selection_labels = np.asarray(
        [int(bool(row["selected"])) for row in shown_rows], dtype=np.int8
    )
    joint_labels = np.asarray(
        [int(bool(row["selectedThroughCheckout"])) for row in shown_rows],
        dtype=np.int8,
    )
    selection_metrics = binary_metrics(
        selection_labels, selection_probability[shown_indices], weights_array
    )
    joint_metrics = binary_metrics(
        joint_labels, joint_probability[shown_indices], weights_array
    )
    calibration_pass = (
        selection_metrics["brier"]
        <= selection_metrics["nullBrier"] + calibration_brier_tolerance
        and joint_metrics["brier"]
        <= joint_metrics["nullBrier"] + calibration_brier_tolerance
        and selection_metrics["ece"] <= maximum_ece
        and joint_metrics["ece"] <= maximum_ece
    )
    groups: dict[tuple[int, str], list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        groups[(int(row["seed"]), str(row["opportunityId"]))].append(index)
    validation_journey_ids = {str(row["journeyId"]) for row in rows}
    policy_baseline = {
        journey_id: baseline_by_journey[journey_id]
        for journey_id in sorted(validation_journey_ids)
        if journey_id in baseline_by_journey
    }
    if set(policy_baseline) != validation_journey_ids:
        raise ValueError("validation policy lacks paired no-recommendation journeys")

    evidence: dict[str, dict[str, Any]] = {}
    for threshold in thresholds:
        selected_by_policy: dict[str, set[tuple[int, str, str]]] = {
            "model": set(),
            "random": set(),
            "popularity": set(),
        }
        coverage = {policy: [] for policy in selected_by_policy}
        invalid = {
            "jointProbabilityAboveSelection": 0,
            "invalidComposerCardinality": 0,
            "paddingViolations": 0,
            "eligibilityViolations": 0,
            "modifierValidityViolations": 0,
        }
        rendered_count = 0
        model_decisions: list[dict[str, Any]] = []
        for (seed, opportunity_id), indices in sorted(groups.items()):
            group_rows = [rows[index] for index in indices]
            journey_id = str(group_rows[0]["journeyId"])
            desired_size = (
                int(desired_size_by_journey[journey_id])
                if recommendation_type == "smart_cross_sell"
                else 1
            )
            remaining_budget = next(
                (
                    int(row["remainingBudgetVnd"])
                    for row in group_rows
                    if row["remainingBudgetVnd"] is not None
                ),
                250_000,
            )
            candidates = [
                ScoredCandidate(
                    str(rows[index]["candidateId"]),
                    str(rows[index]["candidateCategoryId"]),
                    int(rows[index]["priceImpactVnd"]),
                    float(joint_probability[index]),
                )
                for index in indices
            ]
            composed_by_policy = {
                "model": compose_candidates(
                    recommendation_type=recommendation_type,
                    candidates=candidates,
                    abstention_threshold=float(threshold),
                    remaining_budget_vnd=remaining_budget,
                    desired_smart_size=desired_size,
                ),
                "random": _baseline_composed(
                    recommendation_type=recommendation_type,
                    rows=rows,
                    order=sorted(
                        indices,
                        key=lambda index: (
                            -_random_score(
                                seed,
                                opportunity_id,
                                str(rows[index]["candidateId"]),
                            ),
                            str(rows[index]["candidateId"]),
                        ),
                    ),
                    remaining_budget_vnd=remaining_budget,
                    desired_size=desired_size,
                ),
                "popularity": _baseline_composed(
                    recommendation_type=recommendation_type,
                    rows=rows,
                    order=sorted(
                        indices,
                        key=lambda index: (
                            -int(rows[index]["priorItemOrderCount"]),
                            str(rows[index]["candidateId"]),
                        ),
                    ),
                    remaining_budget_vnd=remaining_budget,
                    desired_size=desired_size,
                ),
            }
            model_composed = composed_by_policy["model"]
            model_decisions.append(
                {
                    "seed": seed,
                    "journeyId": journey_id,
                    "opportunityId": opportunity_id,
                    "recommendationType": recommendation_type,
                    "candidateIds": [
                        candidate.candidate_id for candidate in model_composed
                    ],
                }
            )
            rendered_count += len(model_composed)
            valid_cardinality = len(model_composed) in (
                {0, 3, 4} if recommendation_type == "smart_cross_sell" else {0, 1}
            )
            invalid["invalidComposerCardinality"] += int(not valid_cardinality)
            invalid["paddingViolations"] += int(
                recommendation_type == "smart_cross_sell"
                and 0 < len(model_composed) < 3
            )
            eligible_ids = {str(row["candidateId"]) for row in group_rows}
            invalid["eligibilityViolations"] += sum(
                candidate.candidate_id not in eligible_ids
                for candidate in model_composed
            )
            if recommendation_type == "modifier_upsell":
                row_by_id = {
                    str(row["candidateId"]): row for row in group_rows
                }
                invalid["modifierValidityViolations"] += sum(
                    not bool(
                        row_by_id[candidate.candidate_id]["modifierOptionAvailable"]
                    )
                    or not bool(row_by_id[candidate.candidate_id]["modifierOptionSafe"])
                    for candidate in model_composed
                )
            invalid["jointProbabilityAboveSelection"] += int(
                np.sum(joint_probability[indices] > selection_probability[indices])
            )
            for policy, composed in composed_by_policy.items():
                coverage[policy].append(int(bool(composed)))
                selected_by_policy[policy].update(
                    (seed, opportunity_id, candidate.candidate_id)
                    for candidate in composed
                )

        policy_values: dict[str, list[float]] = defaultdict(list)
        journey_ids: list[str] = []
        for row in shown_rows:
            key = (
                int(row["seed"]),
                str(row["opportunityId"]),
                str(row["candidateId"]),
            )
            retained = float(bool(row["selectedThroughCheckout"]))
            price = float(row["priceImpactVnd"])
            for policy in selected_by_policy:
                policy_values[policy].append(
                    retained * price * float(key in selected_by_policy[policy])
            )
            journey_id = str(row["journeyId"])
            journey_ids.append(journey_id)

        revenue_interval = journey_clustered_weighted_interval(
            values=policy_values["model"],
            weights=weights,
            journey_ids=journey_ids,
        )
        ranking_differences = {
            f"model_vs_{policy}": journey_clustered_weighted_interval(
                values=[
                    model - baseline
                    for model, baseline in zip(
                        policy_values["model"],
                        policy_values[policy],
                        strict=True,
                    )
                ],
                weights=weights,
                journey_ids=journey_ids,
            )
            for policy in ("random", "popularity")
        }
        learned_outcomes = evaluate_learned_policy_outcomes(
            policy_baseline,
            candidate_potentials,
            model_decisions,
            policy_name=f"validation_{recommendation_type}_{float(threshold)}",
        )
        no_recommendation_outcomes = evaluate_learned_policy_outcomes(
            policy_baseline,
            candidate_potentials,
            [],
            policy_name="validation_no_recommendation",
        )
        business_comparison = _learned_business_comparison(
            learned_outcomes, no_recommendation_outcomes
        )
        aov_interval = _weighted_aov_interval(
            revenue=[
                float(outcome["finalMerchandiseSubtotalVnd"])
                for outcome in learned_outcomes
            ],
            checkout=[float(outcome["checkout"]) for outcome in learned_outcomes],
            weights=[float(outcome["weight"]) for outcome in learned_outcomes],
            journey_ids=[str(outcome["journeyId"]) for outcome in learned_outcomes],
        )
        model_coverage = float(np.mean(coverage["model"]))
        random_coverage = float(np.mean(coverage["random"]))
        popularity_coverage = float(np.mean(coverage["popularity"]))
        required_coverage = (
            max(random_coverage, popularity_coverage) * coverage_fraction
        )
        coverage_pass = model_coverage >= required_coverage
        ranking_pass = all(
            float(interval["lower95"]) > ranking_lower_bound
            for interval in ranking_differences.values()
        )
        business_pass = _business_gate(
            business_comparison,
            require_positive=False,
            conversion_noninferiority_margin=conversion_noninferiority_margin,
            abandonment_noninferiority_margin=abandonment_noninferiority_margin,
        )
        validity_pass = all(value == 0 for value in invalid.values())
        evidence[str(float(threshold))] = {
            "threshold": float(threshold),
            "effectiveSampleSize": effective_sample_size(weights_array),
            "selectionCalibration": selection_metrics,
            "jointCalibration": joint_metrics,
            "coverage": model_coverage,
            "randomCoverage": random_coverage,
            "popularityCoverage": popularity_coverage,
            "requiredCoverage": required_coverage,
            "retainedRevenuePerOpportunityVnd95": revenue_interval,
            "aovVnd95": aov_interval,
            "businessComparisonVsNoRecommendation": business_comparison,
            "rankingPairedDifferences": ranking_differences,
            "rankingLower95": min(
                float(interval["lower95"])
                for interval in ranking_differences.values()
            ),
            "invalidCounters": invalid,
            "composer": {
                "opportunityCount": len(groups),
                "renderedCandidateCount": rendered_count,
            },
            "gates": {
                "calibration": calibration_pass,
                "coverage": coverage_pass,
                "ranking": ranking_pass,
                "business": business_pass,
                "validity": validity_pass,
            },
            "passed": (
                calibration_pass
                and coverage_pass
                and ranking_pass
                and business_pass
                and validity_pass
            ),
        }
    return evidence
