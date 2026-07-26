from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import pyarrow.parquet as pq

from kfc_recommendation_simulator.artifacts import (
    EVALUATION_FORBIDDEN_COLUMNS,
    ORACLE_FORBIDDEN_COLUMNS,
    audit_bundle,
    generate_bundle,
)
from kfc_recommendation_simulator.benchmark_data import (
    BundleData,
    load_candidate_rows,
    load_impression_rows,
)
from kfc_recommendation_simulator.models import InputPaths, WorldConfig
from kfc_recommendation_simulator.simulator import load_inputs


class SimulatorContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.package_root = Path(__file__).resolve().parents[1]
        cls.repo_root = cls.package_root.parents[1]
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        raw = json.loads(
            (cls.package_root / "worlds/smoke.json").read_text(encoding="utf-8")
        )
        raw["journeyCount"] = 1000
        raw["customerPoolSize"] = 30
        raw["batchJourneys"] = 50
        cls.config = cls.root / "contract.json"
        cls.config.write_text(json.dumps(raw), encoding="utf-8")
        cls.first = cls.root / "first"
        cls.second = cls.root / "second"
        cls.first_manifest = generate_bundle(
            config_path=cls.config,
            output_dir=cls.first,
            repo_root=cls.repo_root,
        )
        cls.second_manifest = generate_bundle(
            config_path=cls.config,
            output_dir=cls.second,
            repo_root=cls.repo_root,
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp.cleanup()

    def read(self, table: str, directory: str = "model-visible") -> list[dict]:
        return pq.read_table(self.first / directory / f"{table}.parquet").to_pylist()

    def test_repeated_generation_has_identical_content(self) -> None:
        self.assertEqual(
            self.first_manifest.content_digest,
            self.second_manifest.content_digest,
        )
        self.assertEqual(
            self.first_manifest.artifact_hashes,
            self.second_manifest.artifact_hashes,
        )

    def test_audit_passes_and_every_canonical_table_exists(self) -> None:
        result = audit_bundle(self.first)
        self.assertEqual("pass", result["status"])
        self.assertTrue(all(result["checks"].values()))
        self.assertEqual(
            {
                "journeys",
                "requests",
                "candidates",
                "eligibility_decisions",
                "pre_policy_rankings",
                "policy_effects",
                "decisions",
                "impressions",
                "outcomes",
                "carts_checkouts",
                "evaluation_slices",
                "potential_outcomes",
            },
            set(self.first_manifest.row_counts),
        )

    def test_starters_follow_history_and_stage_order(self) -> None:
        requests = self.read("requests")
        by_journey: dict[str, list[dict]] = {}
        for row in requests:
            by_journey.setdefault(row["journey_id"], []).append(row)
        for rows in by_journey.values():
            self.assertIn(
                tuple(row["placement"] for row in rows),
                {
                    ("local_favorite", "modifier_upsell", "smart_cross_sell"),
                    ("for_you", "modifier_upsell", "smart_cross_sell"),
                },
            )
            starter = rows[0]
            if starter["placement"] == "for_you":
                self.assertGreaterEqual(starter["prior_completed_orders"], 1)
            else:
                self.assertEqual(0, starter["prior_completed_orders"])
        self.assertTrue(
            any(row["placement"] == "for_you" for row in requests),
            "repeat customers should eventually become For You eligible",
        )

    def test_logging_is_stochastic_and_propensities_are_exactly_bounded(self) -> None:
        impressions = self.read("impressions")
        self.assertTrue(all(0 < row["action_propensity"] <= 1 for row in impressions))
        randomized = {
            row["candidate_id"]
            for row in impressions
            if row["logging_policy"] == "randomized_exploration"
        }
        self.assertGreater(len(randomized), 5)

    def test_smart_cross_sell_uses_ordered_three_or_four_item_slates(self) -> None:
        decisions = [
            row
            for row in self.read("decisions")
            if row["placement"] == "smart_cross_sell" and row["status"] == "recommended"
        ]
        self.assertTrue(decisions)
        for decision in decisions:
            self.assertIn(decision["slate_size"], (3, 4))
            self.assertEqual(
                decision["slate_size"], len(decision["selected_candidate_ids"])
            )
            self.assertEqual(
                len(decision["selected_candidate_ids"]),
                len(set(decision["selected_candidate_ids"])),
            )

        candidates = {
            (row["request_id"], row["candidate_id"]): row
            for row in self.read("candidates")
        }
        impressions_by_slate: dict[str, list[dict]] = {}
        for impression in self.read("impressions"):
            if impression["placement"] == "smart_cross_sell":
                impressions_by_slate.setdefault(impression["slate_id"], []).append(
                    impression
                )
        self.assertTrue(impressions_by_slate)
        for impressions in impressions_by_slate.values():
            impressions.sort(key=lambda row: row["position"])
            self.assertEqual(
                list(range(1, len(impressions) + 1)),
                [row["position"] for row in impressions],
            )
            self.assertLessEqual(len(impressions), 4)
            categories = [
                candidates[(row["request_id"], row["candidate_id"])]["category"]
                for row in impressions
            ]
            self.assertTrue(
                all(categories.count(category) <= 2 for category in categories)
            )
            if len(categories) == 4:
                self.assertNotIn(categories[3], categories[:3])

    def test_slate_outcomes_allow_multiple_adds_without_unshown_negatives(self) -> None:
        impressions = {row["impression_id"]: row for row in self.read("impressions")}
        outcomes = self.read("outcomes")
        self.assertEqual(set(impressions), {row["impression_id"] for row in outcomes})
        selected_by_slate: dict[str, int] = {}
        for outcome in outcomes:
            self.assertIn(outcome["impression_id"], impressions)
            if (
                outcome["placement"] == "smart_cross_sell"
                and outcome["basket_mutation_succeeded"]
            ):
                selected_by_slate[outcome["slate_id"]] = (
                    selected_by_slate.get(outcome["slate_id"], 0) + 1
                )
            if outcome["survived_checkout"]:
                self.assertTrue(outcome["checked_out"])
                if outcome["placement"] == "smart_cross_sell":
                    self.assertGreater(outcome["net_incremental_value_vnd"], 0)
        self.assertTrue(any(count > 1 for count in selected_by_slate.values()))

    def test_store_eligibility_and_sanity_effects_are_present(self) -> None:
        eligibility = self.read("eligibility_decisions")
        self.assertTrue(
            any(row["reason_code"] == "store_unavailable" for row in eligibility)
        )
        effects = self.read("policy_effects")
        effect_names = {row["effect"] for row in effects}
        self.assertTrue(
            {
                "snapshot_evaluated",
                "excluded",
                "boosted",
                "pinned",
                "replaced",
                "suppressed",
            }
            <= effect_names
        )

    def test_model_tables_do_not_leak_oracle_or_evaluation_columns(self) -> None:
        for path in (self.first / "model-visible").glob("*.parquet"):
            columns = set(pq.read_schema(path).names)
            self.assertFalse(columns & ORACLE_FORBIDDEN_COLUMNS, path.name)
            self.assertFalse(columns & EVALUATION_FORBIDDEN_COLUMNS, path.name)

    def test_cold_drift_and_returning_slices_are_evaluation_only(self) -> None:
        slices = self.read("evaluation_slices", "evaluation")
        self.assertTrue(any(row["held_out_store"] for row in slices))
        self.assertTrue(any(row["cold_product"] for row in slices))
        self.assertTrue(any(row["cold_modifier"] for row in slices))
        self.assertTrue(any(row["returning_customer"] for row in slices))
        self.assertEqual({0, 1}, {row["drift_phase"] for row in slices})

    def test_configured_cold_cohort_cardinalities_are_exact(self) -> None:
        generated = self.repo_root / "services/kfc-agent-backend/fixtures/generated"
        fixtures = self.repo_root / "services/kfc-agent-backend/fixtures"
        loaded = load_inputs(
            WorldConfig.model_validate_json(self.config.read_text(encoding="utf-8")),
            InputPaths(
                menu_items=generated / "menu-items.json",
                stores=generated / "stores.json",
                modifiers=generated / "menu-modifiers.json",
                store_availability=generated / "store-availability.json",
                promotions=generated / "promotions.json",
                sanity_policies=self.package_root / "worlds/sanity-policies.json",
                catalog_manifest=fixtures / "catalog-baselines/manifest.json",
            ),
        )
        self.assertEqual(53, len(loaded.held_out_store_ids))
        self.assertEqual(12, len(loaded.cold_product_ids))
        self.assertEqual(6, len(loaded.cold_modifier_ids))

    def test_potential_outcomes_are_bounded_and_counterfactual(self) -> None:
        oracle = self.read("potential_outcomes", "oracle")
        self.assertGreater(len(oracle), len(self.read("impressions")))
        for row in oracle[:1000]:
            self.assertTrue(0 <= row["attention_probability"] <= 1)
            self.assertTrue(0 <= row["acceptance_probability"] <= 1)
            self.assertTrue(0 <= row["cart_mutation_probability"] <= 1)
            self.assertTrue(0 <= row["checkout_probability_if_selected"] <= 1)
            self.assertGreaterEqual(row["expected_net_merchandise_value_vnd"], 0)

    def test_benchmark_loader_keeps_logged_and_eligible_contracts_separate(
        self,
    ) -> None:
        bundle = BundleData(1, self.first, 1000)
        impressions = load_impression_rows(bundle, split="validation")
        candidates = load_candidate_rows(bundle, split="validation")
        self.assertGreater(len(impressions), 0)
        self.assertGreater(len(candidates), len(impressions))
        self.assertFalse(impressions.duplicated(["request_id", "candidate_id"]).any())
        self.assertTrue(
            {
                "action_propensity",
                "success",
                "reward_vnd",
                "held_out_store",
                "cold_product",
            }
            <= set(impressions.columns)
        )
        self.assertTrue(
            {
                "expected_net_merchandise_value_vnd",
                "expected_net_value_by_position_vnd",
            }
            <= set(candidates.columns)
        )


if __name__ == "__main__":
    unittest.main()
