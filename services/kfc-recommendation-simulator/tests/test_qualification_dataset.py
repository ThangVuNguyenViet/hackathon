from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from kfc_recommendation_simulator.generator import generate_world
from kfc_recommendation_simulator.loader import InformationBoundaryError
from kfc_recommendation_simulator.profiles import GenerationProfile
from kfc_recommendation_simulator.qualification.datasets import (
    load_untouched_candidate_relevance_table,
    load_untouched_model_table,
)
from kfc_recommendation_simulator.qualification.freeze import (
    FrozenConfiguration,
    FrozenConfigurationError,
    freeze_configuration,
)


class UntouchedDatasetBoundaryTest(unittest.TestCase):
    def _world_and_freeze(
        self, root: Path
    ) -> tuple[Path, Path, FrozenConfiguration]:
        world = generate_world(
            root / "worlds",
            profile=GenerationProfile("boundary", 200, (17,)),
            world_revision="boundary-v1",
        )
        configuration = root / "selected-configuration.json"
        configuration.write_text(
            json.dumps({"champion": "logistic"}), encoding="utf-8"
        )
        frozen = freeze_configuration(configuration, root / "frozen.json")
        return world, configuration, frozen

    def test_untouched_rows_open_only_after_configuration_freeze(self) -> None:
        """Catches test-window access during model or threshold selection."""

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            world = generate_world(
                root / "worlds",
                profile=GenerationProfile("boundary", 200, (17,)),
                world_revision="boundary-v1",
            )
            configuration = root / "selected-configuration.json"
            configuration.write_text(
                json.dumps({"champion": "logistic"}), encoding="utf-8"
            )
            frozen = freeze_configuration(configuration, root / "frozen.json")

            table = load_untouched_model_table(world, configuration, frozen)

            self.assertGreater(table.num_rows, 0)
            self.assertEqual(set(table["split"].to_pylist()), {"untouched_test"})

    def test_candidate_relevance_opens_only_after_verified_freeze(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            world, configuration, frozen = self._world_and_freeze(root)

            table = load_untouched_candidate_relevance_table(
                world, configuration, frozen
            )

            self.assertGreater(table.num_rows, 0)
            self.assertEqual(set(table["split"].to_pylist()), {"untouched_test"})
            fabricated = FrozenConfiguration(
                configuration,
                hashlib.sha256(configuration.read_bytes()).hexdigest(),
                root / "missing-freeze-token.json",
            )
            with self.assertRaises(FrozenConfigurationError):
                load_untouched_candidate_relevance_table(
                    world, configuration, fabricated
                )

    def test_candidate_relevance_rejects_digest_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            world, configuration, frozen = self._world_and_freeze(root)
            artifact = world / "evaluation" / "candidate-relevance.parquet"
            artifact.write_bytes(artifact.read_bytes() + b"tampered")

            with self.assertRaisesRegex(
                InformationBoundaryError, "digest does not match manifest"
            ):
                load_untouched_candidate_relevance_table(
                    world, configuration, frozen
                )

    def test_candidate_relevance_rejects_schema_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            world, configuration, frozen = self._world_and_freeze(root)
            artifact = world / "evaluation" / "candidate-relevance.parquet"
            original = pq.read_table(artifact)
            tampered = original.append_column(
                "trainingLeak", pa.array([True] * original.num_rows)
            )
            pq.write_table(tampered, artifact)
            manifest_path = world / "manifests" / "synthetic-world.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["artifacts"]["evaluation/candidate-relevance.parquet"][
                "sha256"
            ] = hashlib.sha256(artifact.read_bytes()).hexdigest()
            manifest_without_digest = dict(manifest)
            manifest_without_digest.pop("worldDigest")
            manifest["worldDigest"] = hashlib.sha256(
                json.dumps(
                    manifest_without_digest,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                    allow_nan=False,
                ).encode()
            ).hexdigest()
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            with self.assertRaisesRegex(
                InformationBoundaryError, "immutable schema"
            ):
                load_untouched_candidate_relevance_table(
                    world, configuration, frozen
                )


if __name__ == "__main__":
    unittest.main()
