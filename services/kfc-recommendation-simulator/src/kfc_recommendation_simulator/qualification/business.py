from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from .policy_evaluation import (
    POLICY_OUTCOME_DEFINITION,
    evaluate_learned_policy_outcomes,
    journey_clustered_weighted_interval,
)

RECOMMENDATION_TYPES = (
    "local_favorite",
    "for_you",
    "modifier_upsell",
    "smart_cross_sell",
)


def _learned_business_comparison(
    left_rows: list[Mapping[str, Any]], right_rows: list[Mapping[str, Any]]
) -> dict[str, Any]:
    left = {str(row["journeyId"]): row for row in left_rows}
    right = {str(row["journeyId"]): row for row in right_rows}
    if set(left) != set(right):
        raise ValueError("business policies must cover exactly paired journeys")
    journey_ids = sorted(left)
    weights = [
        (float(left[journey_id]["weight"]) + float(right[journey_id]["weight"]))
        / 2
        for journey_id in journey_ids
    ]
    left_revenue = [
        float(left[journey_id]["finalMerchandiseSubtotalVnd"])
        for journey_id in journey_ids
    ]
    right_revenue = [
        float(right[journey_id]["finalMerchandiseSubtotalVnd"])
        for journey_id in journey_ids
    ]
    left_checkout = [
        float(left[journey_id]["checkout"]) for journey_id in journey_ids
    ]
    right_checkout = [
        float(right[journey_id]["checkout"]) for journey_id in journey_ids
    ]
    weighted_left_checkout = sum(
        value * weight
        for value, weight in zip(left_checkout, weights, strict=True)
    )
    weighted_right_checkout = sum(
        value * weight
        for value, weight in zip(right_checkout, weights, strict=True)
    )
    left_aov = sum(
        value * weight
        for value, weight in zip(left_revenue, weights, strict=True)
    ) / max(weighted_left_checkout, 1e-12)
    right_aov = sum(
        value * weight
        for value, weight in zip(right_revenue, weights, strict=True)
    ) / max(weighted_right_checkout, 1e-12)
    total_weight = sum(weights)
    left_rate = weighted_left_checkout / total_weight
    right_rate = weighted_right_checkout / total_weight
    aov_influence = [
        (left_value - left_aov * left_converted) / max(left_rate, 1e-12)
        - (right_value - right_aov * right_converted)
        / max(right_rate, 1e-12)
        for left_value, left_converted, right_value, right_converted in zip(
            left_revenue,
            left_checkout,
            right_revenue,
            right_checkout,
            strict=True,
        )
    ]
    aov_influence_interval = journey_clustered_weighted_interval(
        values=aov_influence,
        weights=weights,
        journey_ids=journey_ids,
    )
    aov_difference = left_aov - right_aov
    aov_half_width = float(aov_influence_interval["upper95"]) - float(
        aov_influence_interval["estimate"]
    )
    def paired_interval(values: list[float]) -> dict[str, float | int]:
        return journey_clustered_weighted_interval(
            values=values,
            weights=weights,
            journey_ids=journey_ids,
        )

    return {
        "journeys": len(journey_ids),
        "effectiveSampleSize": float(
            sum(weights) ** 2 / sum(weight * weight for weight in weights)
        ),
        "aovDifferenceVnd95": {
            "estimate": aov_difference,
            "lower95": aov_difference - aov_half_width,
            "upper95": aov_difference + aov_half_width,
            "leftAov": left_aov,
            "rightAov": right_aov,
            "journeyClusterCount": len(journey_ids),
        },
        "revenuePerStartedJourneyDifferenceVnd95": paired_interval(
            [
                left_value - right_value
                for left_value, right_value in zip(
                    left_revenue, right_revenue, strict=True
                )
            ]
        ),
        "checkoutConversionDifference95": paired_interval(
            [
                left_value - right_value
                for left_value, right_value in zip(
                    left_checkout, right_checkout, strict=True
                )
            ]
        ),
        "abandonmentDifference95": paired_interval(
            [
                (1.0 - left_value) - (1.0 - right_value)
                for left_value, right_value in zip(
                    left_checkout, right_checkout, strict=True
                )
            ]
        ),
    }


def _no_recommendation_baseline(
    world: Path, source_facts: Mapping[str, Mapping[str, Any]]
) -> dict[str, dict[str, Any]]:
    journey_ids = set(source_facts)
    baseline: dict[str, dict[str, Any]] = {}
    parquet = pq.ParquetFile(world / "oracle" / "potential-outcomes.parquet")
    columns = [
        "seed",
        "journeyId",
        "condition",
        "baseCartSubtotalVnd",
        "checkout",
        "finalMerchandiseSubtotalVnd",
    ]
    for batch in parquet.iter_batches(batch_size=100_000, columns=columns):
        for row in batch.to_pylist():
            journey_id = str(row["journeyId"])
            if (
                journey_id in journey_ids
                and row["condition"] == "no_recommendation"
            ):
                baseline[journey_id] = row
    if set(baseline) != journey_ids:
        raise ValueError("no-recommendation oracle lacks paired journey support")
    return baseline


def _business_evidence(
    world: Path,
    source_facts: Mapping[str, Mapping[str, Any]],
    relevance_table: pa.Table,
    decisions_by_type: Mapping[str, Mapping[str, list[dict[str, Any]]]],
) -> dict[str, Any]:
    baseline = _no_recommendation_baseline(world, source_facts)
    relevance_by_candidate = {
        (int(row["seed"]), str(row["opportunityId"]), str(row["candidateId"])): row
        for row in relevance_table.to_pylist()
    }
    combined_decisions = [
        decision
        for recommendation_type in RECOMMENDATION_TYPES
        for decision in decisions_by_type[recommendation_type]["learned"]
    ]
    policies: dict[str, list[dict[str, Any]]] = {
        "learned": evaluate_learned_policy_outcomes(
            baseline,
            relevance_by_candidate,
            combined_decisions,
            policy_name="learned_frozen_champions_and_composer",
        ),
        "no_recommendation": evaluate_learned_policy_outcomes(
            baseline, relevance_by_candidate, [], policy_name="no_recommendation"
        ),
    }
    for policy in ("random", "popularity"):
        decisions = [
            decision
            for recommendation_type in RECOMMENDATION_TYPES
            for decision in decisions_by_type[recommendation_type][policy]
        ]
        policies[policy] = evaluate_learned_policy_outcomes(
            baseline,
            relevance_by_candidate,
            decisions,
            policy_name=policy,
        )
    for recommendation_type in RECOMMENDATION_TYPES:
        decisions = [
            decision
            for other_type in RECOMMENDATION_TYPES
            if other_type != recommendation_type
            for decision in decisions_by_type[other_type]["learned"]
        ]
        policies[f"ablate_{recommendation_type}"] = (
            evaluate_learned_policy_outcomes(
                baseline,
                relevance_by_candidate,
                decisions,
                policy_name=f"ablate_{recommendation_type}",
            )
        )
    comparisons = {
        "combined_vs_no_recommendation": "no_recommendation",
        "combined_vs_random": "random",
        "combined_vs_popularity": "popularity",
        **{
            f"{recommendation_type}_vs_ablation": f"ablate_{recommendation_type}"
            for recommendation_type in RECOMMENDATION_TYPES
        },
    }
    seeds = sorted({int(row["seed"]) for row in policies["learned"]})
    per_seed = {
        str(seed): {
            name: _learned_business_comparison(
                [row for row in policies["learned"] if int(row["seed"]) == seed],
                [row for row in policies[right] if int(row["seed"]) == seed],
            )
            for name, right in comparisons.items()
        }
        for seed in seeds
    }
    combined = {
        name: _learned_business_comparison(policies["learned"], policies[right])
        for name, right in comparisons.items()
    }
    return {
        "policyOutcomeDefinition": POLICY_OUTCOME_DEFINITION,
        "oracleConditionsRead": ["no_recommendation"],
        "learnedPolicyBound": True,
        "perSeed": per_seed,
        "combined": combined,
    }


def _business_gate(
    comparison: Mapping[str, Any],
    *,
    require_positive: bool,
    conversion_noninferiority_margin: float = 0.005,
    abandonment_noninferiority_margin: float = 0.005,
) -> bool:
    aov = comparison["aovDifferenceVnd95"]
    revenue = comparison["revenuePerStartedJourneyDifferenceVnd95"]
    conversion = comparison["checkoutConversionDifference95"]
    abandonment = comparison["abandonmentDifference95"]
    business_effect = (
        aov["lower95"] > 0 and revenue["lower95"] > 0
        if require_positive
        else aov["upper95"] >= 0 and revenue["upper95"] >= 0
    )
    return (
        business_effect
        and conversion["lower95"] >= -conversion_noninferiority_margin
        and abandonment["upper95"] <= abandonment_noninferiority_margin
    )
