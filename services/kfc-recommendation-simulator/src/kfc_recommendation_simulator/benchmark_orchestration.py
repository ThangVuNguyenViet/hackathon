from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CHECKPOINT_SCHEMA = "benchmark-stage-checkpoint-v1"
DEFAULT_MAX_RSS_MIB = 1_600
PRE_MODEL_STAGE_SEQUENCE = (
    "prepare-data",
    "prepare-caches",
)


@dataclass(frozen=True)
class IsolatedStage:
    name: str
    input_digest: str
    checkpoint: Path
    artifacts: tuple[Path, ...] = ()
    worker_module: str = "kfc_recommendation_simulator.benchmark_worker"


def _matching_checkpoint(stage: IsolatedStage) -> bool:
    if not stage.checkpoint.is_file():
        return False
    try:
        checkpoint = json.loads(stage.checkpoint.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return False
    return (
        checkpoint
        == {
            "schemaVersion": CHECKPOINT_SCHEMA,
            "stage": stage.name,
            "status": "complete",
            "inputDigest": stage.input_digest,
        }
        and all(path.is_file() for path in stage.artifacts)
    )


def write_stage_checkpoint(stage: IsolatedStage) -> None:
    stage.checkpoint.parent.mkdir(parents=True, exist_ok=True)
    stage.checkpoint.write_text(
        json.dumps(
            {
                "schemaVersion": CHECKPOINT_SCHEMA,
                "stage": stage.name,
                "status": "complete",
                "inputDigest": stage.input_digest,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def _process_group_rss_kib(process_group: int) -> int:
    result = subprocess.run(
        ["ps", "-Ao", "pgid=,rss="],
        check=True,
        capture_output=True,
        text=True,
    )
    return sum(
        int(rss)
        for line in result.stdout.splitlines()
        if len(parts := line.split()) == 2
        and int(parts[0]) == process_group
        for rss in [parts[1]]
    )


def _run_bounded(
    command: list[str],
    *,
    environment: dict[str, str],
    max_rss_mib: int,
) -> dict[str, float | int]:
    started = time.monotonic()
    process = subprocess.Popen(
        command,
        env=environment,
        start_new_session=True,
    )
    peak_rss_kib = 0
    try:
        while process.poll() is None:
            peak_rss_kib = max(
                peak_rss_kib,
                _process_group_rss_kib(process.pid),
            )
            if peak_rss_kib > max_rss_mib * 1024:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                raise RuntimeError(
                    f"isolated stage exceeded {max_rss_mib} MiB RSS "
                    f"(observed {peak_rss_kib / 1024:.1f} MiB)"
                )
            time.sleep(0.25)
        peak_rss_kib = max(peak_rss_kib, _process_group_rss_kib(process.pid))
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait()
    if process.returncode:
        raise subprocess.CalledProcessError(process.returncode, command)
    return {
        "elapsedSeconds": round(time.monotonic() - started, 3),
        "peakRssMiB": round(peak_rss_kib / 1024, 3),
        "maxRssMiB": max_rss_mib,
    }


def run_isolated_stage(
    stage: IsolatedStage,
    *,
    output_dir: Path,
    runner: Callable[..., Any] | None = None,
) -> str:
    if _matching_checkpoint(stage):
        return "reused"
    environment = {
        **os.environ,
        "TF_DETERMINISTIC_OPS": "1",
        "TF_NUM_INTRAOP_THREADS": "1",
        "TF_NUM_INTEROP_THREADS": "1",
        "USE_TF": "0",
        "OMP_NUM_THREADS": "1",
        "OPENBLAS_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
        "NUMEXPR_NUM_THREADS": "1",
        "KFC_BENCHMARK_MAX_RSS_MIB": str(DEFAULT_MAX_RSS_MIB),
    }
    command = [
        sys.executable,
        "-m",
        stage.worker_module,
        "--stage",
        stage.name,
        "--input-digest",
        stage.input_digest,
        "--output",
        str(output_dir.resolve()),
    ]
    if runner is None:
        resource_metrics = _run_bounded(
            command,
            environment=environment,
            max_rss_mib=DEFAULT_MAX_RSS_MIB,
        )
        resource_path = stage.checkpoint.with_name(
            f"{stage.checkpoint.stem}-resources.json"
        )
        resource_path.write_text(
            json.dumps(resource_metrics, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    else:
        runner(command, check=True, env=environment)
    if not _matching_checkpoint(stage):
        raise RuntimeError(
            f"isolated stage {stage.name!r} did not produce its matching checkpoint"
        )
    return "executed"
