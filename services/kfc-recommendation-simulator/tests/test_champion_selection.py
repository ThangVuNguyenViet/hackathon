from __future__ import annotations

import unittest

from kfc_recommendation_simulator.qualification.selection import (
    NoEligibleChallengerError,
    select_gate_first_champion,
)


class GateFirstChampionSelectionTest(unittest.TestCase):
    def test_failed_validation_gate_cannot_win_on_revenue(self) -> None:
        """Catches a high-value challenger bypassing a failed validation gate."""

        candidates = {
            "unsafe": {
                "gates": {
                    "calibration": False,
                    "coverage": True,
                    "ranking": True,
                    "business": True,
                    "validity": True,
                },
                "retainedRevenueLower95Vnd": 10_000.0,
                "aovLower95Vnd": 9_000.0,
                "rankingLower95": 0.9,
                "artifactBytes": 1,
            },
            "qualified": {
                "gates": {
                    "calibration": True,
                    "coverage": True,
                    "ranking": True,
                    "business": True,
                    "validity": True,
                },
                "retainedRevenueLower95Vnd": 100.0,
                "aovLower95Vnd": 80.0,
                "rankingLower95": 0.1,
                "artifactBytes": 50,
            },
        }

        selected = select_gate_first_champion(candidates)

        self.assertEqual(selected, "qualified")

    def test_declared_lexicographic_order_breaks_only_real_ties(self) -> None:
        """Catches Brier or family identity replacing business-first ordering."""

        passing_gates = {
            "calibration": True,
            "coverage": True,
            "ranking": True,
            "business": True,
            "validity": True,
        }
        candidates = {
            "better-ranking": {
                "gates": passing_gates,
                "retainedRevenueLower95Vnd": 120.0,
                "aovLower95Vnd": 90.0,
                "rankingLower95": 0.4,
                "artifactBytes": 500,
            },
            "smaller-artifact": {
                "gates": passing_gates,
                "retainedRevenueLower95Vnd": 120.0,
                "aovLower95Vnd": 90.0,
                "rankingLower95": 0.4,
                "artifactBytes": 100,
            },
            "higher-aov": {
                "gates": passing_gates,
                "retainedRevenueLower95Vnd": 120.0,
                "aovLower95Vnd": 95.0,
                "rankingLower95": 0.1,
                "artifactBytes": 1_000,
            },
            "higher-revenue": {
                "gates": passing_gates,
                "retainedRevenueLower95Vnd": 121.0,
                "aovLower95Vnd": 1.0,
                "rankingLower95": 0.0,
                "artifactBytes": 10_000,
            },
        }

        self.assertEqual(select_gate_first_champion(candidates), "higher-revenue")
        candidates.pop("higher-revenue")
        self.assertEqual(select_gate_first_champion(candidates), "higher-aov")
        candidates.pop("higher-aov")
        self.assertEqual(select_gate_first_champion(candidates), "smaller-artifact")

    def test_no_validation_eligible_challenger_fails_closed(self) -> None:
        """Catches silent fallback to the least-bad validation failure."""

        candidate = {
            "gates": {
                "calibration": True,
                "coverage": True,
                "ranking": False,
                "business": True,
                "validity": True,
            },
            "retainedRevenueLower95Vnd": 100.0,
            "aovLower95Vnd": 90.0,
            "rankingLower95": -0.1,
            "artifactBytes": 10,
        }

        with self.assertRaisesRegex(
            NoEligibleChallengerError, "no challenger passed every validation gate"
        ):
            select_gate_first_champion({"failed": candidate})


if __name__ == "__main__":
    unittest.main()
