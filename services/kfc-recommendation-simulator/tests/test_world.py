from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from kfc_recommendation_simulator.generator import generate_world
from kfc_recommendation_simulator.loader import (
    InformationBoundaryError,
    load_training_table,
)
from kfc_recommendation_simulator.profiles import PROFILES, GenerationProfile
from kfc_recommendation_simulator.validation import count_invalid_rows

SIMULATOR_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = SIMULATOR_ROOT.parents[1]
SCORER_SRC = REPOSITORY_ROOT / "services" / "kfc-recommendation-scorer" / "src"
sys.path.insert(0, str(SCORER_SRC))

from kfc_recommendation_scorer.contract import (  # noqa: E402
    parse_automatic_scorer_request,
)

EXPECTED_ARTIFACTS = {
    "source/catalog.parquet",
    "source/population.parquet",
    "source/journeys.parquet",
    "model-visible/training-examples.parquet",
    "evaluation/opportunities.parquet",
    "evaluation/exposures.parquet",
    "evaluation/journeys.parquet",
    "oracle/potential-outcomes.parquet",
    "traffic/arrivals-per-minute.parquet",
    "traffic/scorer-candidate-shapes.parquet",
}


def file_bytes(root: Path) -> dict[str, bytes]:
    return {
        str(path.relative_to(root)): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


class SyntheticWorldTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temporary = tempfile.TemporaryDirectory()
        cls.output = Path(cls.temporary.name) / "first"
        cls.world = generate_world(
            cls.output,
            profile=PROFILES["smoke"],
            world_revision="synthetic-causal-world-v1",
        )
        cls.manifest_path = cls.world / "manifests" / "synthetic-world.json"
        cls.manifest = json.loads(cls.manifest_path.read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temporary.cleanup()

    def test_manifest_binds_exact_profile_schemas_and_artifact_digests(self) -> None:
        self.assertEqual(
            self.manifest["schemaVersion"], "kfc-synthetic-world-manifest-v3"
        )
        self.assertEqual(self.manifest["artifactEncoding"], "parquet")
        self.assertEqual(self.manifest["profile"]["journeysPerSeed"], 2_000)
        self.assertEqual(self.manifest["profile"]["seeds"], [101])
        self.assertEqual(self.manifest["profile"]["totalJourneys"], 2_000)
        self.assertEqual(set(self.manifest["artifacts"]), EXPECTED_ARTIFACTS)
        for relative_path, evidence in self.manifest["artifacts"].items():
            payload = (self.world / relative_path).read_bytes()
            self.assertEqual(hashlib.sha256(payload).hexdigest(), evidence["sha256"])
            self.assertGreater(evidence["rowCount"], 0)
            self.assertRegex(evidence["schemaDigest"], r"^[a-f0-9]{64}$")

    def test_world_digest_binds_manifest_configuration_and_artifacts(self) -> None:
        bound_manifest = dict(self.manifest)
        expected = bound_manifest.pop("worldDigest")
        canonical = json.dumps(
            bound_manifest,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode()
        self.assertEqual(hashlib.sha256(canonical).hexdigest(), expected)

    def test_environment_is_exactly_pinned_and_bound_to_manifest(self) -> None:
        project = tomllib.loads(
            (SIMULATOR_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        )
        self.assertEqual(project["project"]["requires-python"], "==3.11.14")
        self.assertEqual(project["project"]["dependencies"], ["pyarrow==23.0.1"])
        self.assertEqual(project["dependency-groups"]["dev"], ["ruff==0.16.1"])
        environment = self.manifest["environment"]
        self.assertEqual(environment["pythonVersion"], "3.11.14")
        self.assertEqual(environment["pyarrowVersion"], "23.0.1")
        self.assertEqual(
            environment["uvLockSha256"],
            hashlib.sha256((SIMULATOR_ROOT / "uv.lock").read_bytes()).hexdigest(),
        )
        self.assertEqual(
            environment["parquetWriter"],
            {
                "formatVersion": "2.6",
                "dataPageVersion": "2.0",
                "compression": "zstd",
                "compressionLevel": 3,
                "dictionaryEncoding": True,
                "writeStatistics": True,
            },
        )
        self.assertEqual(
            self.manifest.get("placementComposer"),
            {
                "order": (
                    "condition-specific ranking then shared deterministic composer"
                ),
                "singleActionTypes": [
                    "local_favorite",
                    "for_you",
                    "modifier_upsell",
                ],
                "smartCrossSell": {
                    "budgetCeilingVnd": 250_000,
                    "defaultRenderedCount": 3,
                    "maximumRenderedCount": 4,
                    "minimumReadyCount": 3,
                    "insufficientResult": "typed empty with no slate",
                    "fourthMemberRule": (
                        "requested size is 4; score is positive; category is new; "
                        "composed total remains within remaining budget"
                    ),
                },
            },
        )

    def test_identical_inputs_regenerate_every_public_byte(self) -> None:
        second = generate_world(
            Path(self.temporary.name) / "second",
            profile=PROFILES["smoke"],
            world_revision="synthetic-causal-world-v1",
        )
        self.assertEqual(file_bytes(self.world), file_bytes(second))

    def test_named_random_streams_are_independent(self) -> None:
        profile = GenerationProfile("stream-test", 128, (17,))
        baseline = generate_world(
            Path(self.temporary.name) / "stream-baseline",
            profile=profile,
            world_revision="stream-independence-v1",
        )
        changed = generate_world(
            Path(self.temporary.name) / "stream-changed",
            profile=profile,
            world_revision="stream-independence-v1",
            stream_seed_overrides={"outcomes": 99_999},
        )
        for relative_path in (
            "source/catalog.parquet",
            "source/population.parquet",
            "source/journeys.parquet",
            "traffic/arrivals-per-minute.parquet",
        ):
            self.assertEqual(
                (baseline / relative_path).read_bytes(),
                (changed / relative_path).read_bytes(),
            )
        self.assertNotEqual(
            (baseline / "oracle/potential-outcomes.parquet").read_bytes(),
            (changed / "oracle/potential-outcomes.parquet").read_bytes(),
        )

    def test_training_surface_has_positive_support_and_unshown_is_unlabelled(
        self,
    ) -> None:
        table = pq.read_table(
            self.world / "model-visible" / "training-examples.parquet"
        )
        rows = table.to_pylist()
        self.assertGreater(len(rows), 0)
        shown = [row for row in rows if row["shown"]]
        unshown = [row for row in rows if not row["shown"]]
        self.assertTrue(shown)
        self.assertTrue(unshown)
        self.assertTrue(all(0 < row["exposurePropensity"] <= 1 for row in shown))
        self.assertTrue(
            all(
                row["exposurePropensity"] is None
                and row["selected"] is None
                and row["selectedThroughCheckout"] is None
                for row in unshown
            )
        )

    def test_exposure_evidence_records_policy_propensity_and_position(self) -> None:
        opportunities = pq.read_table(
            self.world / "evaluation" / "opportunities.parquet"
        ).to_pylist()
        exposures = pq.read_table(
            self.world / "evaluation" / "exposures.parquet"
        ).to_pylist()
        self.assertEqual(
            {row["treatmentPolicy"] for row in opportunities},
            {
                "automatic_proxy_scorer_composer_v1",
                "no_recommendation",
                "random_uniform_without_replacement",
                "popularity_descending_v1",
            },
        )
        self.assertTrue(
            all(
                row["renderedPosition"] >= 1
                and 0 < row["slatePropensity"] <= 1
                and 0 < row["selectionPropensity"] <= 1
                for row in exposures
            )
        )
        self.assertEqual(
            self.manifest["treatmentPolicies"],
            {
                "automatic": "automatic_proxy_scorer_composer_v1",
                "random_eligible": "random_uniform_without_replacement",
                "popularity": "popularity_descending_v1",
                "ablations": "automatic proxy with exactly one named type suppressed",
                "no_recommendation": "no action or slate",
            },
        )

    def test_chronological_splits_and_untouched_slices_are_complete(self) -> None:
        rows = pq.read_table(self.world / "source" / "journeys.parquet").to_pylist()
        split_order = {
            "training": 0,
            "calibration": 1,
            "validation": 2,
            "untouched_test": 3,
        }
        self.assertEqual(
            [split_order[row["split"]] for row in rows],
            sorted(split_order[row["split"]] for row in rows),
        )
        untouched = [row for row in rows if row["split"] == "untouched_test"]
        earlier = [row for row in rows if row["split"] != "untouched_test"]
        self.assertTrue(any(row["heldOutStore"] for row in untouched))
        self.assertTrue(any(row["coldCustomer"] for row in untouched))
        self.assertTrue(any(row["coldCandidate"] for row in untouched))
        self.assertTrue(any(row["drift"] for row in untouched))
        self.assertTrue(any(row["rush"] for row in untouched))
        self.assertEqual({row["daypart"] for row in untouched}, {"lunch", "dinner"})
        self.assertFalse(
            any(
                row["heldOutStore"]
                or row["coldCustomer"]
                or row["coldCandidate"]
                or row["drift"]
                for row in earlier
            )
        )

    def test_all_types_typed_empty_cases_and_complete_terminal_journeys_exist(
        self,
    ) -> None:
        opportunities = pq.read_table(
            self.world / "evaluation" / "opportunities.parquet"
        ).to_pylist()
        self.assertEqual(
            {row["recommendationType"] for row in opportunities},
            {"local_favorite", "for_you", "modifier_upsell", "smart_cross_sell"},
        )
        self.assertTrue(
            any(
                row["status"] == "empty" and row["emptyReason"] for row in opportunities
            )
        )
        journeys = pq.read_table(
            self.world / "evaluation" / "journeys.parquet"
        ).to_pylist()
        self.assertEqual(len(journeys), 2_000)
        self.assertTrue(
            all(
                row["terminalState"] in {"checkout_completed", "order_abandoned"}
                for row in journeys
            )
        )
        self.assertTrue(
            all(row["finalMerchandiseSubtotalVnd"] is not None for row in journeys)
        )
        self.assertTrue(
            all(
                not row["checkout"] or row["finalMerchandiseSubtotalVnd"] > 0
                for row in journeys
            )
        )

    def test_oracle_has_paired_complete_outcomes_for_every_condition(self) -> None:
        rows = pq.read_table(
            self.world / "oracle" / "potential-outcomes.parquet"
        ).to_pylist()
        conditions = {
            "automatic",
            "no_recommendation",
            "random_eligible",
            "popularity",
            "ablate_local_favorite",
            "ablate_for_you",
            "ablate_modifier_upsell",
            "ablate_smart_cross_sell",
        }
        by_journey: dict[str, set[str]] = {}
        for row in rows:
            by_journey.setdefault(row["journeyId"], set()).add(row["condition"])
            self.assertIn(
                row["terminalState"], {"checkout_completed", "order_abandoned"}
            )
            self.assertIsNotNone(row["finalMerchandiseSubtotalVnd"])
        self.assertEqual(len(by_journey), 2_000)
        self.assertTrue(all(found == conditions for found in by_journey.values()))

    def test_candidate_shape_and_arrival_exports_are_strict_load_fixtures(self) -> None:
        shapes = pq.read_table(
            self.world / "traffic" / "scorer-candidate-shapes.parquet"
        ).to_pylist()
        self.assertEqual(
            {row["recommendationType"] for row in shapes},
            {"local_favorite", "for_you", "modifier_upsell", "smart_cross_sell"},
        )
        for shape in shapes:
            request = json.loads(shape["requestJson"])
            self.assertEqual(len(request["candidates"]), shape["candidateCount"])
            parse_automatic_scorer_request(request)
        self.assertEqual(
            {row["shapeClass"] for row in shapes},
            {
                "local_favorite_120",
                "local_favorite_240_stress",
                "for_you_120",
                "for_you_240_stress",
                "modifier_5",
                "modifier_17",
                "modifier_25",
                "smart_insufficient_2",
                "smart_default_3",
                "smart_max_4",
                "smart_no_padding",
                "smart_120",
                "smart_240_stress",
            },
        )
        arrivals = pq.read_table(
            self.world / "traffic" / "arrivals-per-minute.parquet"
        ).to_pylist()
        observed = [
            row
            for row in arrivals
            if row["trafficProfile"] == "synthetic_world_observed"
        ]
        qualification = [
            row for row in arrivals if row["trafficProfile"] == "aws_qualification_v1"
        ]
        self.assertEqual(sum(row["arrivals"] for row in observed), 2_000)
        self.assertTrue(
            all(
                row["arrivals"] == row["targetRps"] * row["durationSeconds"]
                for row in qualification
            )
        )
        self.assertEqual(
            len([row for row in qualification if row["phase"] == "peak_50_rps"]),
            30,
        )
        self.assertEqual(
            len([row for row in qualification if row["phase"] == "shock_100_rps"]),
            2,
        )
        self.assertTrue(
            any(row["rush"] and row["daypart"] == "lunch" for row in observed)
        )
        self.assertTrue(
            any(row["rush"] and row["daypart"] == "dinner" for row in observed)
        )

    def test_smart_slates_are_ordered_diverse_and_never_padded(self) -> None:
        opportunities = pq.read_table(
            self.world / "evaluation" / "opportunities.parquet"
        ).to_pylist()
        exposures = pq.read_table(
            self.world / "evaluation" / "exposures.parquet"
        ).to_pylist()
        by_opportunity: dict[str, list[dict[str, object]]] = {}
        for exposure in exposures:
            by_opportunity.setdefault(exposure["opportunityId"], []).append(exposure)
        smart = [
            row
            for row in opportunities
            if row["recommendationType"] == "smart_cross_sell"
        ]
        self.assertEqual(len(smart), 2_000)
        self.assertTrue(
            any(
                row["status"] == "empty"
                and row["emptyReason"] == "insufficient_composable_candidates"
                and row["slateSize"] == 0
                and row["slateId"] is None
                for row in smart
            )
        )
        self.assertTrue(any(row["slateSize"] == 3 for row in smart))
        self.assertTrue(any(row["slateSize"] == 4 for row in smart))
        for opportunity in smart:
            if opportunity["status"] == "ready":
                self.assertIn(opportunity["slateSize"], {3, 4})
            self.assertLessEqual(opportunity["slateSize"], 4)
            self.assertLessEqual(
                opportunity["slateSize"], opportunity["candidateCount"]
            )
            members = sorted(
                by_opportunity.get(opportunity["opportunityId"], []),
                key=lambda member: member["renderedPosition"],
            )
            self.assertEqual(
                [member["renderedPosition"] for member in members],
                list(range(1, opportunity["slateSize"] + 1)),
            )
            if opportunity["treatmentPolicy"] == "automatic_proxy_scorer_composer_v1":
                categories = [member["categoryId"] for member in members]
                self.assertEqual(len(categories), len(set(categories)))

    def test_ready_starter_and_modifier_placements_render_one_valid_action(
        self,
    ) -> None:
        opportunities = pq.read_table(
            self.world / "evaluation" / "opportunities.parquet"
        ).to_pylist()
        exposures = pq.read_table(
            self.world / "evaluation" / "exposures.parquet"
        ).to_pylist()
        by_opportunity: dict[str, list[dict[str, object]]] = {}
        for exposure in exposures:
            by_opportunity.setdefault(exposure["opportunityId"], []).append(exposure)
        by_journey: dict[str, list[dict[str, object]]] = {}
        for opportunity in opportunities:
            by_journey.setdefault(opportunity["journeyId"], []).append(opportunity)

        ready_types: set[str] = set()
        for journey in by_journey.values():
            journey.sort(key=lambda row: row["sequence"])
            starter, modifier, _smart = journey
            for opportunity in (starter, modifier):
                if opportunity["status"] != "ready":
                    continue
                ready_types.add(opportunity["recommendationType"])
                members = by_opportunity[opportunity["opportunityId"]]
                self.assertEqual(opportunity["slateSize"], 1)
                self.assertEqual(len(members), 1)
                self.assertEqual(members[0]["renderedPosition"], 1)
            if modifier["status"] == "ready":
                self.assertEqual(
                    modifier["parentCartLineId"], starter["createdCartLineId"]
                )
                self.assertGreater(
                    by_opportunity[modifier["opportunityId"]][0]["priceImpactVnd"],
                    0,
                )
        self.assertEqual(ready_types, {"local_favorite", "for_you", "modifier_upsell"})

    def test_every_policy_uses_the_same_smart_composer_constraints(self) -> None:
        source = {
            row["journeyId"]: row
            for row in pq.read_table(
                self.world / "source" / "journeys.parquet"
            ).to_pylist()
        }
        opportunities = pq.read_table(
            self.world / "evaluation" / "opportunities.parquet"
        ).to_pylist()
        exposures = pq.read_table(
            self.world / "evaluation" / "exposures.parquet"
        ).to_pylist()
        by_opportunity: dict[str, list[dict[str, object]]] = {}
        for exposure in exposures:
            by_opportunity.setdefault(exposure["opportunityId"], []).append(exposure)

        active_conditions: set[str] = set()
        for opportunity in opportunities:
            if (
                opportunity["recommendationType"] != "smart_cross_sell"
                or opportunity["status"] != "ready"
            ):
                continue
            active_conditions.add(opportunity["assignedCondition"])
            members = by_opportunity[opportunity["opportunityId"]]
            categories = [member["categoryId"] for member in members]
            self.assertEqual(len(categories), len(set(categories)))
            remaining_budget_vnd = 250_000 - opportunity["cartSubtotalBeforeVnd"]
            self.assertLessEqual(
                sum(member["priceImpactVnd"] for member in members),
                remaining_budget_vnd,
            )
            self.assertTrue(
                all(
                    member.get("composerScore") is not None
                    and member["composerScore"] > 0
                    for member in members
                )
            )
            if opportunity["slateSize"] == 4:
                self.assertEqual(
                    source[opportunity["journeyId"]]["desiredSmartSlateSize"], 4
                )
        self.assertTrue(
            {
                "automatic",
                "random_eligible",
                "popularity",
                "ablate_local_favorite",
                "ablate_for_you",
                "ablate_modifier_upsell",
            }.issubset(active_conditions)
        )

    def test_untouched_drift_changes_actual_candidate_features(self) -> None:
        rows = pq.read_table(
            self.world / "model-visible" / "training-examples.parquet"
        ).to_pylist()
        baseline = [row for row in rows if row["split"] != "untouched_test"]
        drift = [row for row in rows if row["split"] == "untouched_test"]
        self.assertTrue(baseline)
        self.assertTrue(drift)
        self.assertEqual(
            {row["catalogRevision"] for row in baseline},
            {"synthetic-catalog-101-baseline-v1"},
        )
        self.assertEqual(
            {row["catalogRevision"] for row in drift},
            {"synthetic-catalog-101-drift-v2"},
        )
        self.assertNotEqual(
            sum(row["promotionActive"] for row in baseline) / len(baseline),
            sum(row["promotionActive"] for row in drift) / len(drift),
        )
        self.assertEqual(self.manifest["driftMechanism"]["window"], "untouched_test")

    def test_training_loader_physically_excludes_and_rejects_hidden_fields(
        self,
    ) -> None:
        table = load_training_table(self.world)
        forbidden = {
            "condition",
            "terminalState",
            "finalMerchandiseSubtotalVnd",
            "latentAffinity",
            "potentialSelection",
            "treatmentPathJson",
            "treatmentRevenueVnd",
        }
        self.assertTrue(forbidden.isdisjoint(table.column_names))
        with self.assertRaises(InformationBoundaryError):
            load_training_table(self.world / "evaluation")

        leaked_world = Path(self.temporary.name) / "leaked"
        generate_world(
            leaked_world,
            profile=GenerationProfile("leak-test", 64, (19,)),
            world_revision="leak-test-v1",
        )
        leaked_revision = leaked_world / "leak-test-v1"
        training_path = leaked_revision / "model-visible" / "training-examples.parquet"
        original = pq.read_table(training_path)
        leaked = original.append_column(
            "potentialSelection", pa.array([True] * original.num_rows, type=pa.bool_())
        )
        pq.write_table(leaked, training_path)
        environment = {
            **os.environ,
            "PYTHONPATH": str(SIMULATOR_ROOT / "src"),
        }
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "kfc_recommendation_simulator.cli",
                "training-summary",
                "--world",
                str(leaked_revision),
            ],
            cwd=SIMULATOR_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("forbidden training field", result.stderr)

    def test_training_loader_rejects_mutated_manifest_configuration(self) -> None:
        output = Path(self.temporary.name) / "manifest-tamper"
        world = generate_world(
            output,
            profile=GenerationProfile("manifest-test", 32, (23,)),
            world_revision="manifest-tamper-v1",
        )
        manifest_path = world / "manifests" / "synthetic-world.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["profile"]["name"] = "silently-mutated"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(InformationBoundaryError, "world manifest digest"):
            load_training_table(world)

    def test_invalid_counters_detect_each_broken_contract(self) -> None:
        counters = count_invalid_rows(
            training_rows=[
                {
                    "shown": True,
                    "exposurePropensity": 0.0,
                    "fulfilmentMode": "dine_in",
                    "selected": None,
                    "selectedThroughCheckout": None,
                }
            ],
            journey_rows=[{"terminalState": None}],
            scorer_requests=[{"candidates": []}],
        )
        self.assertEqual(
            counters,
            {
                "invalidPropensity": 1,
                "invalidFulfilmentMode": 1,
                "invalidShownLabel": 1,
                "missingTerminalJourney": 1,
                "invalidScorerCandidateShape": 1,
            },
        )


if __name__ == "__main__":
    unittest.main()
