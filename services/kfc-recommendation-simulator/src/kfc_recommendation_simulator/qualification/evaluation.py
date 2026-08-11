from __future__ import annotations

import hashlib
from collections import defaultdict
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from .calibration import enforce_joint_probability_bound
from .composer import ScoredCandidate, compose_candidates
from .metrics import binary_metrics, normal_mean_interval, recall_at_k
from .policy_evaluation import journey_clustered_weighted_interval
from .ranking import InsufficientRankingEvidence, evaluate_opportunity_ndcg
from .weighting import clipped_inverse_propensity_weights, effective_sample_size

HEAD_LABELS = {"selection": "selected", "joint": "selectedThroughCheckout"}


def _filter_rows(table: pa.Table, recommendation_type: str) -> list[dict[str, Any]]:
    mask = pc.and_(
        pc.equal(table["recommendationType"], recommendation_type),
        pc.equal(table["split"], "untouched_test"),
    )
    return table.filter(mask).to_pylist()


def _labels_weights(
    rows: list[Mapping[str, Any]], label: str, maximum_weight: float
) -> tuple[np.ndarray, np.ndarray]:
    labels = np.asarray([int(bool(row[label])) for row in rows], dtype=np.int8)
    weights = clipped_inverse_propensity_weights(
        np.asarray([float(row["exposurePropensity"]) for row in rows]),
        maximum_weight=maximum_weight,
    )
    return labels, weights


def _stable_random_score(seed: int, opportunity: str, candidate: str) -> float:
    digest = hashlib.sha256(f"{seed}\0{opportunity}\0{candidate}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def _source_facts(world: Path, *, split: str) -> dict[str, dict[str, Any]]:
    table = pq.read_table(
        world / "source" / "journeys.parquet",
        columns=[
            "journeyId",
            "split",
            "returningCustomer",
            "fulfilmentMode",
            "daypart",
            "heldOutStore",
            "coldCandidate",
            "drift",
            "storeId",
            "desiredSmartSlateSize",
        ],
    )
    table = table.filter(pc.equal(table["split"], split))
    return {row["journeyId"]: row for row in table.to_pylist()}


def _slice_names(facts: Mapping[str, Any]) -> tuple[str, ...]:
    values = [
        "all",
        str(facts["daypart"]),
        str(facts["fulfilmentMode"]),
        "returning" if facts["returningCustomer"] else "new",
        f"store:{facts['storeId']}",
    ]
    if facts["coldCandidate"]:
        values.append("cold")
    if facts["heldOutStore"]:
        values.append("held_out_store")
    if facts["drift"]:
        values.append("drift")
    return tuple(values)


def journey_clustered_ranking_summary(
    ndcg_by_policy: Mapping[str, list[float]],
    recall_by_policy: Mapping[str, list[float]],
    *,
    journey_ids: list[str],
) -> dict[str, Any]:
    model = np.asarray(ndcg_by_policy["model"], dtype=np.float64)
    if not journey_ids or len(journey_ids) != len(model):
        raise ValueError("ranking values and journey clusters must be aligned")
    weights = [1.0] * len(journey_ids)

    def interval(values: list[float] | np.ndarray) -> dict[str, float | int]:
        return journey_clustered_weighted_interval(
            values=np.asarray(values, dtype=np.float64).tolist(),
            weights=weights,
            journey_ids=journey_ids,
        )

    return {
        "opportunityCount": len(model),
        "policyIntervals": {
            policy: interval(values)
            for policy, values in sorted(ndcg_by_policy.items())
        },
        "pairedDifferences": {
            f"model_vs_{policy}": interval(
                model - np.asarray(values, dtype=np.float64)
            )
            for policy, values in sorted(ndcg_by_policy.items())
            if policy != "model"
        },
        "recallAtK": {
            policy: interval(values)
            for policy, values in sorted(recall_by_policy.items())
        },
    }


def _evaluate_type(
    trained: Any,
    test_table: pa.Table,
    relevance_table: pa.Table,
    source_facts: Mapping[str, Mapping[str, Any]],
    configuration: Mapping[str, Any],
) -> tuple[dict[str, Any], bool, dict[str, list[dict[str, Any]]]]:
    rows = _filter_rows(test_table, trained.recommendation_type)
    features = trained.encoder.transform(rows)
    selection_probability = trained.champion.calibrators["selection"].predict(
        trained.champion.models["selection"].predict_probability(features)
    )
    joint_probability = enforce_joint_probability_bound(
        selection_probability,
        trained.champion.calibrators["joint"].predict(
            trained.champion.models["joint"].predict_probability(features)
        ),
    )
    maximum_weight = float(configuration["inversePropensityMaximumWeight"])
    shown_indices = [index for index, row in enumerate(rows) if row["shown"]]
    shown_rows = [rows[index] for index in shown_indices]
    selection_y, weights = _labels_weights(
        shown_rows, HEAD_LABELS["selection"], maximum_weight
    )
    joint_y, _ = _labels_weights(shown_rows, HEAD_LABELS["joint"], maximum_weight)
    shown_selection_probability = selection_probability[shown_indices]
    shown_joint_probability = joint_probability[shown_indices]
    groups: dict[tuple[int, str], list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        groups[(int(row["seed"]), str(row["opportunityId"]))].append(index)
    relevance_rows = relevance_table.filter(
        pc.equal(
            relevance_table["recommendationType"], trained.recommendation_type
        )
    ).to_pylist()
    model_candidate_keys = {
        (int(row["seed"]), str(row["opportunityId"]), str(row["candidateId"]))
        for row in rows
    }
    relevance_by_key = {
        (int(row["seed"]), str(row["opportunityId"]), str(row["candidateId"])): row
        for row in relevance_rows
    }
    if len(relevance_by_key) != len(relevance_rows):
        raise InsufficientRankingEvidence(
            "candidate relevance contains duplicate candidate identifiers"
        )
    if set(relevance_by_key) != model_candidate_keys:
        raise InsufficientRankingEvidence(
            "candidate relevance does not exactly cover the model-visible candidate set"
        )
    relevance_versions = {
        (
            str(row["evaluationDefinitionVersion"]),
            str(row["evaluationDefinitionDigest"]),
            str(row["intervention"]),
        )
        for row in relevance_rows
    }
    if len(relevance_versions) != 1:
        raise InsufficientRankingEvidence(
            "candidate relevance must use one immutable evaluation definition"
        )
    relevance_version, relevance_digest, relevance_intervention = next(
        iter(relevance_versions)
    )
    coverage_by_seed_slice: dict[tuple[int, str], dict[str, list[int]]] = defaultdict(
        lambda: defaultdict(list)
    )
    shown_indices_by_seed_slice: dict[tuple[int, str], list[int]] = defaultdict(list)
    invalid_by_seed_slice: dict[tuple[int, str], dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    policy_decisions: dict[str, list[dict[str, Any]]] = defaultdict(list)
    combined_ndcg: dict[str, list[float]] = defaultdict(list)
    combined_recall: dict[str, list[float]] = defaultdict(list)
    combined_journey_ids: list[str] = []
    per_seed_ndcg: dict[int, dict[str, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    per_seed_recall: dict[int, dict[str, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    per_seed_journey_ids: dict[int, list[str]] = defaultdict(list)
    invalid = {
        "jointProbabilityAboveSelection": 0,
        "invalidComposerCardinality": 0,
        "paddingViolations": 0,
        "eligibilityViolations": 0,
        "modifierValidityViolations": 0,
    }
    per_seed_ranking_counts: dict[str, dict[str, int]] = {}
    for seed in sorted({int(row["seed"]) for row in rows}):
        seed_rows = [row for row in rows if int(row["seed"]) == seed]
        per_seed_ranking_counts[str(seed)] = {
            "eligibleCandidateRows": len(seed_rows),
            "shownCandidateRows": sum(bool(row["shown"]) for row in seed_rows),
            "unlabelledEligibleCandidateRows": sum(
                row["selectedThroughCheckout"] is None for row in seed_rows
            ),
        }
    for (seed, opportunity), indices in groups.items():
        candidate_rows = [rows[index] for index in indices]
        desired_size = (
            int(
                source_facts[str(candidate_rows[0]["journeyId"])][
                    "desiredSmartSlateSize"
                ]
            )
            if trained.recommendation_type == "smart_cross_sell"
            else 1
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
        remaining_budget = next(
            (
                int(row["remainingBudgetVnd"])
                for row in candidate_rows
                if row["remainingBudgetVnd"] is not None
            ),
            250_000,
        )
        composed = compose_candidates(
            recommendation_type=trained.recommendation_type,
            candidates=candidates,
            abstention_threshold=trained.threshold,
            remaining_budget_vnd=remaining_budget,
            desired_smart_size=desired_size,
        )
        valid_cardinality = len(composed) in (
            {0, 3, 4} if trained.recommendation_type == "smart_cross_sell" else {0, 1}
        )
        local_invalid = {
            "jointProbabilityAboveSelection": int(
                np.sum(joint_probability[indices] > selection_probability[indices])
            ),
            "invalidComposerCardinality": int(not valid_cardinality),
            "paddingViolations": int(
                trained.recommendation_type == "smart_cross_sell"
                and 0 < len(composed) < 3
            ),
            "eligibilityViolations": sum(
                candidate.candidate_id
                not in {str(row["candidateId"]) for row in candidate_rows}
                for candidate in composed
            ),
            "modifierValidityViolations": 0,
        }
        if trained.recommendation_type == "modifier_upsell":
            row_by_candidate = {
                str(row["candidateId"]): row for row in candidate_rows
            }
            local_invalid["modifierValidityViolations"] = sum(
                not bool(
                    row_by_candidate[candidate.candidate_id][
                        "modifierOptionAvailable"
                    ]
                )
                or not bool(
                    row_by_candidate[candidate.candidate_id]["modifierOptionSafe"]
                )
                for candidate in composed
            )
        for name, count in local_invalid.items():
            invalid[name] += count
        facts = source_facts[str(candidate_rows[0]["journeyId"])]
        random_order = sorted(
            indices,
            key=lambda index: (
                -_stable_random_score(
                    seed, opportunity, str(rows[index]["candidateId"])
                )
            ),
        )
        popularity_order = sorted(
            indices,
            key=lambda index: (
                -int(rows[index]["priorItemOrderCount"]),
                str(rows[index]["candidateId"]),
            ),
        )
        score_by_policy = {
            "model": {
                str(rows[index]["candidateId"]): float(
                    joint_probability[index] * int(rows[index]["priceImpactVnd"])
                )
                for index in indices
            },
            "random": {
                str(rows[index]["candidateId"]): _stable_random_score(
                    seed, opportunity, str(rows[index]["candidateId"])
                )
                for index in indices
            },
            "popularity": {
                str(rows[index]["candidateId"]): float(
                    rows[index]["priorItemOrderCount"]
                )
                for index in indices
            },
        }
        relevance_by_candidate = {
            str(rows[index]["candidateId"]): float(
                relevance_by_key[
                    (seed, opportunity, str(rows[index]["candidateId"]))
                ]["gradedRelevance"]
            )
            for index in indices
        }
        retained_by_candidate = {
            str(rows[index]["candidateId"]): int(
                relevance_by_key[
                    (seed, opportunity, str(rows[index]["candidateId"]))
                ]["potentialRetained"]
            )
            for index in indices
        }
        ranking_journey_id = str(candidate_rows[0]["journeyId"])
        combined_journey_ids.append(ranking_journey_id)
        per_seed_journey_ids[seed].append(ranking_journey_id)
        for policy, scores in score_by_policy.items():
            ndcg_value = evaluate_opportunity_ndcg(
                candidate_rows,
                score_by_candidate=scores,
                relevance_by_candidate=relevance_by_candidate,
                k=desired_size,
            )
            ordered_candidate_ids = sorted(
                scores, key=lambda candidate_id: (-scores[candidate_id], candidate_id)
            )
            recall_value = recall_at_k(
                [
                    retained_by_candidate[candidate_id]
                    for candidate_id in ordered_candidate_ids
                ],
                k=desired_size,
            )
            combined_ndcg[policy].append(ndcg_value)
            combined_recall[policy].append(recall_value)
            per_seed_ndcg[seed][policy].append(ndcg_value)
            per_seed_recall[seed][policy].append(recall_value)

        def baseline_composed(
            order: list[int],
            *,
            budget: int = remaining_budget,
            size: int = desired_size,
        ) -> tuple[ScoredCandidate, ...]:
            baseline_candidates = []
            for rank, index in enumerate(order):
                rank_score = float(len(order) - rank) / max(1, len(order))
                price = int(rows[index]["priceImpactVnd"])
                baseline_candidates.append(
                    ScoredCandidate(
                        str(rows[index]["candidateId"]),
                        str(rows[index]["candidateCategoryId"]),
                        price,
                        min(1.0, rank_score / max(1, price)),
                    )
                )
            return compose_candidates(
                recommendation_type=trained.recommendation_type,
                candidates=baseline_candidates,
                abstention_threshold=0.0,
                remaining_budget_vnd=budget,
                desired_smart_size=size,
            )

        random_composed = baseline_composed(random_order)
        popularity_composed = baseline_composed(popularity_order)
        for policy, policy_composed in (
            ("learned", composed),
            ("random", random_composed),
            ("popularity", popularity_composed),
        ):
            policy_decisions[policy].append(
                {
                    "seed": seed,
                    "journeyId": str(candidate_rows[0]["journeyId"]),
                    "opportunityId": opportunity,
                    "recommendationType": trained.recommendation_type,
                    "candidateIds": [
                        candidate.candidate_id for candidate in policy_composed
                    ],
                }
            )
        for slice_name in _slice_names(facts):
            values = coverage_by_seed_slice[(seed, slice_name)]
            values["model"].append(int(bool(composed)))
            values["random"].append(int(bool(random_composed)))
            values["popularity"].append(int(bool(popularity_composed)))
            for name, count in local_invalid.items():
                invalid_by_seed_slice[(seed, slice_name)][name] += count
        for index in indices:
            if not rows[index]["shown"]:
                continue
            for slice_name in _slice_names(facts):
                shown_indices_by_seed_slice[(seed, slice_name)].append(index)
    slice_evidence: dict[str, Any] = {}
    slice_pass = True
    for (seed, slice_name), values in sorted(coverage_by_seed_slice.items()):
        model_coverage = float(np.mean(values["model"]))
        random_coverage = float(np.mean(values["random"]))
        popularity_coverage = float(np.mean(values["popularity"]))
        required = max(random_coverage, popularity_coverage) * float(
            configuration["promotionGates"]["coverageFractionOfBetterBaseline"]
        )
        coverage_pass = model_coverage >= required
        slice_invalid = {
            key: invalid_by_seed_slice[(seed, slice_name)].get(key, 0)
            for key in invalid
        }
        passed = coverage_pass and all(value == 0 for value in slice_invalid.values())
        slice_pass = slice_pass and passed
        slice_indices = shown_indices_by_seed_slice[(seed, slice_name)]
        slice_rows = [rows[index] for index in slice_indices]
        slice_selection_y, slice_weights = _labels_weights(
            slice_rows, HEAD_LABELS["selection"], maximum_weight
        )
        slice_joint_y, _ = _labels_weights(
            slice_rows, HEAD_LABELS["joint"], maximum_weight
        )
        slice_evidence[f"{seed}:{slice_name}"] = {
            "opportunities": len(values["model"]),
            "shownCandidateRows": len(slice_indices),
            "coverage": model_coverage,
            "randomCoverage": random_coverage,
            "popularityCoverage": popularity_coverage,
            "requiredCoverage": required,
            "selectionCalibration": binary_metrics(
                slice_selection_y,
                selection_probability[slice_indices],
                slice_weights,
            ),
            "jointCalibration": binary_metrics(
                slice_joint_y,
                joint_probability[slice_indices],
                slice_weights,
            ),
            "selectionOutcomeInterval95": normal_mean_interval(
                slice_selection_y.astype(float)
            ),
            "jointOutcomeInterval95": normal_mean_interval(slice_joint_y.astype(float)),
            "invalidCounters": slice_invalid,
            "passed": passed,
        }
    selection_metrics = binary_metrics(
        selection_y, shown_selection_probability, weights
    )
    joint_metrics = binary_metrics(joint_y, shown_joint_probability, weights)
    calibration_tolerance = float(
        configuration["promotionGates"]["calibrationBrierTolerance"]
    )
    calibration_pass = (
        selection_metrics["brier"]
        <= selection_metrics["nullBrier"] + calibration_tolerance
        and joint_metrics["brier"]
        <= joint_metrics["nullBrier"] + calibration_tolerance
        and selection_metrics["ece"]
        <= float(configuration["promotionGates"]["maximumEce"])
        and joint_metrics["ece"]
        <= float(configuration["promotionGates"]["maximumEce"])
    )
    ranking_summary = journey_clustered_ranking_summary(
        combined_ndcg,
        combined_recall,
        journey_ids=combined_journey_ids,
    )
    per_seed_ranking = {
        str(seed): journey_clustered_ranking_summary(
            per_seed_ndcg[seed],
            per_seed_recall[seed],
            journey_ids=per_seed_journey_ids[seed],
        )
        | per_seed_ranking_counts[str(seed)]
        for seed in sorted(per_seed_ndcg)
    }
    paired = ranking_summary["pairedDifferences"]
    ranking_pass = (
        paired["model_vs_random"]["lower95"]
        > float(configuration["promotionGates"]["rankingPairedLower95MustExceed"])
        and paired["model_vs_popularity"]["lower95"]
        > float(configuration["promotionGates"]["rankingPairedLower95MustExceed"])
    )
    validity_pass = all(value == 0 for value in invalid.values())
    gate = calibration_pass and ranking_pass and slice_pass and validity_pass
    evidence = {
        "eligibleCandidateRows": len(rows),
        "shownCandidateRows": len(shown_rows),
        "effectiveSampleSize": effective_sample_size(weights),
        "selectionCalibration": selection_metrics,
        "jointCalibration": joint_metrics,
        "rankingEvidence": {
            "status": "evaluated",
            "eligibleCandidateRows": len(rows),
            "shownCandidateRows": len(shown_rows),
            "relevanceRows": len(relevance_rows),
            "evaluationDefinitionVersion": relevance_version,
            "evaluationDefinitionDigest": relevance_digest,
            "intervention": relevance_intervention,
            "relevanceOpenedAfterConfigurationFreeze": True,
            "perSeed": per_seed_ranking,
            "combined": ranking_summary,
            "oracleUsedForModelSelection": False,
            "passed": ranking_pass,
        },
        "perSeedSlices": slice_evidence,
        "invalidCounters": invalid,
        "baselineMethods": {
            "random": "evaluator-only SHA-256 ordering",
            "popularity": "evaluator-only prior-item-order-count ordering",
            "noRecommendation": "evaluator-only zero-coverage baseline",
        },
        "gateComponents": {
            "calibration": calibration_pass,
            "ranking": ranking_pass,
            "sliceCoverageAndValidity": slice_pass and validity_pass,
        },
        "passed": gate,
    }
    return evidence, gate, dict(policy_decisions)
