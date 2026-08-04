from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
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
            self.manifest["schemaVersion"], "kfc-synthetic-world-manifest-v1"
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
        exposed = [row for row in opportunities if row["shownCandidateId"] is not None]
        self.assertEqual(
            {row["loggingPolicy"] for row in opportunities},
            {
                "stochastic_popularity",
                "basket_association",
                "promotion_biased",
                "randomized_exploration",
            },
        )
        self.assertTrue(
            all(
                row["renderedPosition"] == 1 and 0 < row["exposurePropensity"] <= 1
                for row in exposed
            )
        )
        self.assertEqual(
            self.manifest["exposurePolicy"],
            {
                "explorationRate": 0.2,
                "knownPositiveSupport": True,
                "policies": [
                    "stochastic_popularity",
                    "basket_association",
                    "promotion_biased",
                    "randomized_exploration",
                ],
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

    def test_empty_opportunities_have_no_impossible_potential_selection(self) -> None:
        opportunities = pq.read_table(
            self.world / "evaluation" / "opportunities.parquet"
        ).to_pylist()
        empty_journeys = {
            row["journeyId"] for row in opportunities if row["candidateCount"] == 0
        }
        oracle = pq.read_table(
            self.world / "oracle" / "potential-outcomes.parquet"
        ).to_pylist()
        impossible = [
            row
            for row in oracle
            if row["journeyId"] in empty_journeys and row["potentialSelection"]
        ]
        self.assertEqual(impossible, [])

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
        arrivals = pq.read_table(
            self.world / "traffic" / "arrivals-per-minute.parquet"
        ).to_pylist()
        self.assertEqual(sum(row["arrivals"] for row in arrivals), 2_000)
        self.assertTrue(
            any(row["rush"] and row["daypart"] == "lunch" for row in arrivals)
        )
        self.assertTrue(
            any(row["rush"] and row["daypart"] == "dinner" for row in arrivals)
        )

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
