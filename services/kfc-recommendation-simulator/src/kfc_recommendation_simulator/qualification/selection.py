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
    "retained_revenue_lower_95_descending",
    "aov_lower_95_descending",
    "ranking_lower_95_descending",
    "artifact_bytes_ascending",
    "family_identity_ascending",
)


class NoEligibleChallengerError(ValueError):
    """Raised rather than selecting a challenger that failed validation."""


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
            -float(eligible[family]["retainedRevenueLower95Vnd"]),
            -float(eligible[family]["aovLower95Vnd"]),
            -float(eligible[family]["rankingLower95"]),
            int(eligible[family]["artifactBytes"]),
            family,
        ),
    )
