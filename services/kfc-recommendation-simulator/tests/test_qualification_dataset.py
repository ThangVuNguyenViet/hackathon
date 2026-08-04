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
from kfc_recommendation_simulator.loader import InformationBoundaryError
from kfc_recommendation_simulator.profiles import GenerationProfile
from kfc_recommendation_simulator.qualification import freeze as freeze_module
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
        precommit = freeze_module.precommit_qualification(world, configuration)
        configuration.write_text(
            json.dumps({"champion": "logistic"}), encoding="utf-8"
        )
        frozen = freeze_configuration(
            configuration, root / "frozen.json", precommit=precommit
        )
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
            precommit = freeze_module.precommit_qualification(world, configuration)
            configuration.write_text(
                json.dumps({"champion": "logistic"}), encoding="utf-8"
            )
            frozen = freeze_configuration(
                configuration, root / "frozen.json", precommit=precommit
            )

            table = load_untouched_model_table(world, configuration, frozen)

            self.assertGreater(table.num_rows, 0)
            self.assertEqual(set(table["split"].to_pylist()), {"untouched_test"})

    def test_existing_configuration_cannot_create_posthoc_authorization(
        self,
    ) -> None:
        """Catches minting evaluation access after inspecting protected data."""

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            world = generate_world(
                root / "worlds",
                profile=GenerationProfile("posthoc", 64, (29,)),
                world_revision="posthoc-v1",
            )
            configuration = root / "selected-configuration.json"
            configuration.write_text(
                json.dumps({"champion": "posthoc"}), encoding="utf-8"
            )
            environment = {
                **os.environ,
                "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src"),
            }
            result = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    (
                        "import sys; from pathlib import Path; "
                        "from kfc_recommendation_simulator.qualification.freeze "
                        "import precommit_qualification; "
                        "precommit_qualification(Path(sys.argv[1]), "
                        "Path(sys.argv[2]))"
                    ),
                    str(world),
                    str(configuration),
                ],
                cwd=Path(__file__).resolve().parents[1],
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(
                "configuration already exists before qualification precommit",
                result.stderr,
            )

    def test_caller_cannot_supply_an_authorization_token_path(self) -> None:
        """Catches accepting evaluator-authored precommit evidence."""

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            world = generate_world(
                root / "worlds",
                profile=GenerationProfile("authority", 64, (30,)),
                world_revision="authority-v1",
            )
            configuration = root / "selected-configuration.json"

            with self.assertRaises(TypeError):
                freeze_module.precommit_qualification(
                    world, configuration, root / "caller-token.json"
                )

    def test_precommit_binds_world_source_contract_and_future_config_path(
        self,
    ) -> None:
        """Catches an unbound or evaluator-writable preselection token."""

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            world = generate_world(
                root / "worlds",
                profile=GenerationProfile("precommit", 64, (31,)),
                world_revision="precommit-v1",
            )
            configuration = root / "selected-configuration.json"
            evidence = world / "manifests" / "qualification-precommit.json"

            precommit = freeze_module.precommit_qualification(world, configuration)

            self.assertFalse(configuration.exists())
            self.assertTrue(evidence.is_file())
            self.assertEqual(precommit.evidence_path, evidence.resolve())
            payload = json.loads(evidence.read_text(encoding="utf-8"))
            manifest = json.loads(
                (world / "manifests" / "synthetic-world.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(payload["stage"], "world_generation_precommit")
            self.assertEqual(payload["worldRevision"], manifest["worldRevision"])
            self.assertEqual(
                payload["configurationFileName"], configuration.name
            )
            self.assertRegex(payload["sourceContractSha256"], r"^[a-f0-9]{64}$")
            self.assertEqual(evidence.stat().st_mode & 0o222, 0)

    def test_fresh_process_requires_precommitted_chain_for_untouched_access(
        self,
    ) -> None:
        """Catches a freeze token that omits its preselection authority chain."""

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            world = generate_world(
                root / "worlds",
                profile=GenerationProfile("chain", 64, (37,)),
                world_revision="chain-v1",
            )
            configuration = root / "selected-configuration.json"
            script = (
                "import json,sys; from pathlib import Path; "
                "from kfc_recommendation_simulator.qualification.freeze import "
                "precommit_qualification,freeze_configuration; "
                "from kfc_recommendation_simulator.qualification.datasets import "
                "load_untouched_candidate_relevance_table; "
                "world=Path(sys.argv[1]); config=Path(sys.argv[2]); "
                "pre=precommit_qualification(world,config); "
                "config.write_text(json.dumps({'champion':'precommitted'})); "
                "frozen=freeze_configuration(config,Path(sys.argv[3]),precommit=pre); "
                "table=load_untouched_candidate_relevance_table(world,config,frozen); "
                "print(table.num_rows)"
            )
            result = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    script,
                    str(world),
                    str(configuration),
                    str(root / "frozen.json"),
                ],
                cwd=Path(__file__).resolve().parents[1],
                env={
                    **os.environ,
                    "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src"),
                },
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertGreater(int(result.stdout.strip()), 0)

    def test_freeze_for_one_world_cannot_open_another_world(self) -> None:
        """Catches omitting the precommitted world binding at loader access."""

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            world, configuration, frozen = self._world_and_freeze(root)
            other_world = generate_world(
                root / "other-worlds",
                profile=GenerationProfile("other", 200, (17,)),
                world_revision="other-v1",
            )
            self.assertNotEqual(world, other_world)

            with self.assertRaisesRegex(
                FrozenConfigurationError, "world path does not match"
            ):
                load_untouched_candidate_relevance_table(
                    other_world, configuration, frozen
                )

    def test_replacing_precommit_after_selection_is_rejected(self) -> None:
        """Catches recreating an identical authority token after selection."""

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            world, configuration, frozen = self._world_and_freeze(root)
            precommit_path = frozen.precommit.evidence_path
            original = precommit_path.read_bytes()
            precommit_path.chmod(0o644)
            precommit_path.unlink()
            precommit_path.write_bytes(original)
            precommit_path.chmod(0o444)

            with self.assertRaisesRegex(
                FrozenConfigurationError, "created after configuration selection"
            ):
                load_untouched_candidate_relevance_table(
                    world, configuration, frozen
                )

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
            world = generate_world(
                root / "worlds",
                profile=GenerationProfile("schema-boundary", 200, (17,)),
                world_revision="schema-boundary-v1",
            )
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
            configuration = root / "selected-configuration.json"
            precommit = freeze_module.precommit_qualification(world, configuration)
            configuration.write_text(
                json.dumps({"champion": "logistic"}), encoding="utf-8"
            )
            frozen = freeze_configuration(
                configuration, root / "frozen.json", precommit=precommit
            )

            with self.assertRaisesRegex(
                InformationBoundaryError, "immutable schema"
            ):
                load_untouched_candidate_relevance_table(
                    world, configuration, frozen
                )


if __name__ == "__main__":
    unittest.main()
