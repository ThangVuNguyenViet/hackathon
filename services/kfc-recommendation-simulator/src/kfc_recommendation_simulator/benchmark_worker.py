from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .benchmark import (
    run_explanation_stage,
    run_logging_stage,
    run_prepare_cache_stage,
    run_prepare_data_stage,
    run_test_stage,
    run_train_candidate_stage,
    run_tune_baseline_stage,
    run_tune_model_stage,
    run_validation_candidate_stage,
)
from .benchmark_orchestration import IsolatedStage, write_stage_checkpoint


def main() -> None:
    parser = argparse.ArgumentParser(prog="kfc-rec-sim-benchmark-worker")
    parser.add_argument("--stage", required=True)
    parser.add_argument("--input-digest", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output_dir = args.output.resolve()
    run_manifest = json.loads(
        (output_dir / "benchmark-run.json").read_text(encoding="utf-8")
    )
    try:
        os.nice(10)
    except OSError:
        pass

    if args.stage == "prepare-data":
        run_prepare_data_stage(
            profile_name=run_manifest["profile"],
            package_root=Path(run_manifest["packageRoot"]),
            repo_root=Path(run_manifest["repoRoot"]),
            output_dir=output_dir,
        )
    elif args.stage == "prepare-caches":
        run_prepare_cache_stage(
            profile_name=run_manifest["profile"],
            output_dir=output_dir,
        )
    elif args.stage == "tune-baseline":
        run_tune_baseline_stage(
            profile_name=run_manifest["profile"],
            output_dir=output_dir,
        )
    elif args.stage.startswith("tune-"):
        run_tune_model_stage(
            model_name=args.stage.removeprefix("tune-"),
            profile_name=run_manifest["profile"],
            output_dir=output_dir,
        )
    elif args.stage.startswith("train-"):
        run_train_candidate_stage(
            candidate_name=args.stage.removeprefix("train-"),
            profile_name=run_manifest["profile"],
            output_dir=output_dir,
        )
    elif args.stage.startswith("validate-"):
        run_validation_candidate_stage(
            candidate_name=args.stage.removeprefix("validate-"),
            profile_name=run_manifest["profile"],
            output_dir=output_dir,
        )
    elif args.stage.startswith("test-"):
        run_test_stage(
            kind=args.stage.removeprefix("test-"),
            profile_name=run_manifest["profile"],
            output_dir=output_dir,
        )
    elif args.stage.startswith("explain-"):
        run_explanation_stage(
            candidate_name=args.stage.removeprefix("explain-"),
            output_dir=output_dir,
        )
    elif args.stage == "log-candidates":
        run_logging_stage(output_dir=output_dir)
    else:
        raise ValueError(f"unsupported benchmark stage: {args.stage}")

    write_stage_checkpoint(
        IsolatedStage(
            name=args.stage,
            input_digest=args.input_digest,
            checkpoint=output_dir / ".stages" / f"{args.stage}.json",
        )
    )


if __name__ == "__main__":
    main()
