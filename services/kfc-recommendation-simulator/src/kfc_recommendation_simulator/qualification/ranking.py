from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

from .metrics import ndcg, normal_mean_interval


class InsufficientRankingEvidence(ValueError):
    """Raised when canonical eligible-set NDCG cannot be identified."""


def evaluate_opportunity_ndcg(
    eligible_rows: Sequence[Mapping[str, Any]],
    *,
    score_by_candidate: Mapping[str, float],
    relevance_by_candidate: Mapping[str, float] | None = None,
    k: int,
) -> float:
    candidate_ids = [str(row["candidateId"]) for row in eligible_rows]
    if len(candidate_ids) != len(set(candidate_ids)):
        raise InsufficientRankingEvidence(
            "eligible candidate set contains duplicate candidate identifiers"
        )
    if relevance_by_candidate is None:
        missing = sum(
            row.get("selectedThroughCheckout") is None for row in eligible_rows
        )
    else:
        missing = sum(
            candidate_id not in relevance_by_candidate
            for candidate_id in candidate_ids
        )
    if missing:
        raise InsufficientRankingEvidence(
            f"{missing} of {len(eligible_rows)} eligible candidates lack "
            "candidate-level relevance required for ideal DCG"
        )
    ordered = sorted(
        eligible_rows,
        key=lambda row: (
            -score_by_candidate[str(row["candidateId"])],
            str(row["candidateId"]),
        ),
    )
    relevance = [
        float(relevance_by_candidate[str(row["candidateId"])])
        if relevance_by_candidate is not None
        else float(bool(row["selectedThroughCheckout"]))
        for row in ordered
    ]
    return ndcg(relevance, k=k)


def evaluate_paired_policy_ndcg(
    eligible_rows_by_opportunity: Mapping[
        str, Sequence[Mapping[str, Any]]
    ],
    *,
    relevance_by_opportunity: Mapping[str, Mapping[str, float]],
    scores_by_policy: Mapping[
        str, Mapping[str, Mapping[str, float]]
    ],
    reference_policy: str,
    k: int,
) -> dict[str, Any]:
    """Evaluate policies against the same candidate outcomes per opportunity."""

    opportunity_ids = set(eligible_rows_by_opportunity)
    if set(relevance_by_opportunity) != opportunity_ids:
        raise InsufficientRankingEvidence(
            "candidate relevance must cover exactly the evaluated opportunities"
        )
    if reference_policy not in scores_by_policy:
        raise InsufficientRankingEvidence("reference policy scores are missing")
    per_policy: dict[str, list[float]] = {}
    for policy, policy_scores in scores_by_policy.items():
        if set(policy_scores) != opportunity_ids:
            raise InsufficientRankingEvidence(
                f"{policy} scores must cover exactly the evaluated opportunities"
            )
        per_policy[policy] = [
            evaluate_opportunity_ndcg(
                eligible_rows_by_opportunity[opportunity_id],
                score_by_candidate=policy_scores[opportunity_id],
                relevance_by_candidate=relevance_by_opportunity[opportunity_id],
                k=k,
            )
            for opportunity_id in sorted(opportunity_ids)
        ]
    reference = np.asarray(per_policy[reference_policy], dtype=np.float64)
    return {
        "opportunityCount": len(opportunity_ids),
        "policyIntervals": {
            policy: normal_mean_interval(np.asarray(values, dtype=np.float64))
            for policy, values in sorted(per_policy.items())
        },
        "pairedDifferences": {
            f"{reference_policy}_vs_{policy}": normal_mean_interval(
                reference - np.asarray(values, dtype=np.float64)
            )
            for policy, values in sorted(per_policy.items())
            if policy != reference_policy
        },
    }
