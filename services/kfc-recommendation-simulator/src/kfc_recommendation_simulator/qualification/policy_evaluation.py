from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any

POLICY_OUTCOME_DEFINITION = {
    "schemaVersion": "kfc-learned-policy-potential-outcome-v1",
    "slateSelection": (
        "in frozen composer order, select the first candidate whose immutable "
        "singleton potentialSelected outcome is true; select at most one per "
        "opportunity"
    ),
    "journeyCheckout": (
        "use the paired no-recommendation outcome when no learned action is "
        "selected; otherwise require every selected candidate potentialCheckout"
    ),
    "retainedValue": (
        "sum immutable potentialIncrementalValueVnd only for selected candidates "
        "whose potentialRetained outcome is true"
    ),
}


def evaluate_learned_policy_outcomes(
    baseline_by_journey: Mapping[str, Mapping[str, Any]],
    relevance_by_candidate: Mapping[tuple[int, str, str], Mapping[str, Any]],
    decisions: Sequence[Mapping[str, Any]],
    *,
    policy_name: str,
) -> list[dict[str, Any]]:
    """Compose frozen learned decisions with immutable candidate potentials."""

    decisions_by_journey: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for decision in decisions:
        journey_id = str(decision["journeyId"])
        if journey_id not in baseline_by_journey:
            raise ValueError("learned decision lacks paired journey baseline")
        decisions_by_journey[journey_id].append(decision)

    outcomes: list[dict[str, Any]] = []
    for journey_id, baseline in sorted(baseline_by_journey.items()):
        selected: list[tuple[str, Mapping[str, Any]]] = []
        ordered_decisions = sorted(
            decisions_by_journey.get(journey_id, []),
            key=lambda decision: str(decision["opportunityId"]),
        )
        for decision in ordered_decisions:
            seed = int(decision["seed"])
            opportunity_id = str(decision["opportunityId"])
            for candidate_id_value in decision["candidateIds"]:
                candidate_id = str(candidate_id_value)
                key = (seed, opportunity_id, candidate_id)
                if key not in relevance_by_candidate:
                    raise ValueError(
                        "learned decision candidate lacks immutable potential outcome"
                    )
                potential = relevance_by_candidate[key]
                if bool(potential["potentialSelected"]):
                    selected.append((candidate_id, potential))
                    break
        if selected:
            checkout = all(
                bool(potential["potentialCheckout"])
                for _, potential in selected
            )
        else:
            checkout = bool(baseline["checkout"])
        retained_value = sum(
            int(potential["potentialIncrementalValueVnd"])
            for _, potential in selected
            if bool(potential["potentialRetained"])
        )
        base_subtotal = int(baseline["baseCartSubtotalVnd"])
        outcomes.append(
            {
                "seed": int(baseline["seed"]),
                "journeyId": journey_id,
                "policyName": policy_name,
                "selectedCandidateIds": [
                    candidate_id for candidate_id, _ in selected
                ],
                "checkout": checkout,
                "abandonment": not checkout,
                "retainedIncrementalValueVnd": retained_value if checkout else 0,
                "finalMerchandiseSubtotalVnd": (
                    base_subtotal + retained_value if checkout else 0
                ),
                "weight": 1.0,
            }
        )
    return outcomes


def journey_clustered_weighted_interval(
    *,
    values: Sequence[float],
    weights: Sequence[float],
    journey_ids: Sequence[str],
) -> dict[str, float | int]:
    if not values or not (len(values) == len(weights) == len(journey_ids)):
        raise ValueError("clustered interval inputs must be non-empty and aligned")
    if any(weight <= 0 for weight in weights):
        raise ValueError("clustered interval weights must be positive")
    total_weight = float(sum(weights))
    estimate = float(
        sum(value * weight for value, weight in zip(values, weights, strict=True))
        / total_weight
    )
    cluster_scores: dict[str, float] = defaultdict(float)
    for value, weight, journey_id in zip(
        values, weights, journey_ids, strict=True
    ):
        cluster_scores[str(journey_id)] += float(weight) * (
            float(value) - estimate
        )
    cluster_count = len(cluster_scores)
    if cluster_count < 2:
        standard_error = 0.0
    else:
        variance = (
            cluster_count
            / (cluster_count - 1)
            * sum(score * score for score in cluster_scores.values())
            / (total_weight * total_weight)
        )
        standard_error = math.sqrt(variance)
    half_width = 1.959963984540054 * standard_error
    sum_squared_weights = sum(float(weight) ** 2 for weight in weights)
    return {
        "estimate": estimate,
        "lower95": estimate - half_width,
        "upper95": estimate + half_width,
        "journeyClusterCount": cluster_count,
        "effectiveSampleSize": total_weight * total_weight / sum_squared_weights,
    }
