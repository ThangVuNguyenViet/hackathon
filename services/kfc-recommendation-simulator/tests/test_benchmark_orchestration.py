from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from kfc_recommendation_simulator.benchmark_orchestration import (
    PRE_MODEL_STAGE_SEQUENCE,
    IsolatedStage,
    run_isolated_stage,
)


class BenchmarkOrchestrationTest(unittest.TestCase):
    def test_data_and_cache_stages_finish_before_models_are_loaded(self) -> None:
        self.assertEqual(
            PRE_MODEL_STAGE_SEQUENCE,
            ("prepare-data", "prepare-caches"),
        )

    def test_completed_checkpoint_skips_isolated_worker(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_dir = Path(temporary_directory)
            checkpoint = output_dir / "validation-core.json"
            checkpoint.write_text(
                json.dumps(
                    {
                        "schemaVersion": "benchmark-stage-checkpoint-v1",
                        "stage": "validation-core",
                        "status": "complete",
                        "inputDigest": "digest-a",
                    }
                ),
                encoding="utf-8",
            )
            runner = Mock()

            outcome = run_isolated_stage(
                IsolatedStage(
                    name="validation-core",
                    input_digest="digest-a",
                    checkpoint=checkpoint,
                ),
                output_dir=output_dir,
                runner=runner,
            )

            self.assertEqual(outcome, "reused")
            runner.assert_not_called()

    def test_missing_checkpoint_runs_worker_with_bounded_environment(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_dir = Path(temporary_directory)
            checkpoint = output_dir / "validation-core.json"

            def complete_stage(*args: object, **kwargs: object) -> None:
                environment = kwargs["env"]
                self.assertEqual(environment["TF_NUM_INTRAOP_THREADS"], "1")
                self.assertEqual(environment["TF_NUM_INTEROP_THREADS"], "1")
                self.assertEqual(environment["OMP_NUM_THREADS"], "1")
                checkpoint.write_text(
                    json.dumps(
                        {
                            "schemaVersion": "benchmark-stage-checkpoint-v1",
                            "stage": "validation-core",
                            "status": "complete",
                            "inputDigest": "digest-b",
                        }
                    ),
                    encoding="utf-8",
                )

            runner = Mock(side_effect=complete_stage)
            outcome = run_isolated_stage(
                IsolatedStage(
                    name="validation-core",
                    input_digest="digest-b",
                    checkpoint=checkpoint,
                ),
                output_dir=output_dir,
                runner=runner,
            )

            self.assertEqual(outcome, "executed")
            command = runner.call_args.args[0]
            self.assertIn("kfc_recommendation_simulator.benchmark_worker", command)
            self.assertEqual(command[-2:], ["--output", str(output_dir.resolve())])

    def test_worker_without_matching_checkpoint_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_dir = Path(temporary_directory)
            checkpoint = output_dir / "validation-core.json"
            runner = Mock()

            with self.assertRaisesRegex(RuntimeError, "did not produce"):
                run_isolated_stage(
                    IsolatedStage(
                        name="validation-core",
                        input_digest="digest-c",
                        checkpoint=checkpoint,
                    ),
                    output_dir=output_dir,
                    runner=runner,
                )

    def test_checkpoint_without_required_artifact_is_not_reused(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_dir = Path(temporary_directory)
            checkpoint = output_dir / "validation-core.json"
            checkpoint.write_text(
                json.dumps(
                    {
                        "schemaVersion": "benchmark-stage-checkpoint-v1",
                        "stage": "validation-core",
                        "status": "complete",
                        "inputDigest": "digest-d",
                    }
                ),
                encoding="utf-8",
            )
            runner = Mock()

            with self.assertRaisesRegex(RuntimeError, "did not produce"):
                run_isolated_stage(
                    IsolatedStage(
                        name="validation-core",
                        input_digest="digest-d",
                        checkpoint=checkpoint,
                        artifacts=(output_dir / "missing-model.json",),
                    ),
                    output_dir=output_dir,
                    runner=runner,
                )
            runner.assert_called_once()


if __name__ == "__main__":
    unittest.main()
