from __future__ import annotations

from collections.abc import Mapping
from typing import Any

VALIDATION_GATE_NAMES = (
    "calibration",
    "coverage",
    "ranking",
    "business",
    "validity",
)
CHAMPION_SELECTION_ORDER = (
    "all_validation_gates_pass",
    "revenue_difference_lower_95_descending",
    "aov_difference_lower_95_descending",
    "ranking_lower_95_descending",
    "artifact_bytes_ascending",
    "family_identity_ascending",
)


class NoEligibleChallengerError(ValueError):
    """Raised rather than selecting a challenger that failed validation."""


def build_selection_candidate(
    threshold_evidence: Mapping[str, Any], *, artifact_bytes: int
) -> dict[str, Any]:
    comparison = threshold_evidence["businessComparisonVsNoRecommendation"]
    return {
        "gates": threshold_evidence["gates"],
        "revenueDifferenceLower95Vnd": comparison[
            "revenuePerStartedJourneyDifferenceVnd95"
        ]["lower95"],
        "aovDifferenceLower95Vnd": comparison["aovDifferenceVnd95"]["lower95"],
        "rankingLower95": threshold_evidence["rankingLower95"],
        "artifactBytes": artifact_bytes,
    }


def select_gate_first_champion(
    candidates: Mapping[str, Mapping[str, Any]],
) -> str:
    eligible = {
        family: evidence
        for family, evidence in candidates.items()
        if all(bool(evidence["gates"].get(gate)) for gate in VALIDATION_GATE_NAMES)
    }
    if not eligible:
        raise NoEligibleChallengerError(
            "no challenger passed every validation gate"
        )
    return min(
        eligible,
        key=lambda family: (
            -float(eligible[family]["revenueDifferenceLower95Vnd"]),
            -float(eligible[family]["aovDifferenceLower95Vnd"]),
            -float(eligible[family]["rankingLower95"]),
            int(eligible[family]["artifactBytes"]),
            family,
        ),
    )
