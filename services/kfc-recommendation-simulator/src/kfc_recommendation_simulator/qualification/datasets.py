from __future__ import annotations

import hashlib
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from ..loader import InformationBoundaryError, _read_manifest
from ..schemas import (
    CANDIDATE_RELEVANCE_SCHEMA,
    ORACLE_SCHEMA,
    SOURCE_JOURNEY_SCHEMA,
    TRAINING_SCHEMA,
)
from .freeze import FrozenConfiguration, verify_frozen_configuration


def _verified_table(
    root: Path,
    manifest: dict[str, object],
    relative_path: str,
    schema: pa.Schema,
    *,
    filters: list[tuple[str, str, object]] | None = None,
) -> pa.Table:
    artifact_path = root / relative_path
    artifact = manifest.get("artifacts", {}).get(relative_path, {})  # type: ignore[union-attr]
    expected_digest = artifact.get("sha256") if isinstance(artifact, dict) else None
    if hashlib.sha256(artifact_path.read_bytes()).hexdigest() != expected_digest:
        raise InformationBoundaryError(
            f"{relative_path} digest does not match manifest"
        )
    table = pq.read_table(artifact_path, filters=filters)
    if table.schema != schema:
        raise InformationBoundaryError(
            f"{relative_path} does not match its immutable schema"
        )
    return table


def load_validation_policy_evaluation(
    world_root: Path | str,
) -> tuple[pa.Table, dict[str, dict[str, object]]]:
    """Load only predeclared validation potentials and paired baseline outcomes."""

    root = Path(world_root).resolve()
    manifest = _read_manifest(root)
    source = _verified_table(
        root,
        manifest,
        "source/journeys.parquet",
        SOURCE_JOURNEY_SCHEMA,
        filters=[("split", "=", "validation")],
    )
    journey_ids = {str(value) for value in source["journeyId"].to_pylist()}
    relevance = _verified_table(
        root,
        manifest,
        "evaluation/candidate-relevance.parquet",
        CANDIDATE_RELEVANCE_SCHEMA,
        filters=[("split", "=", "validation")],
    )
    oracle = _verified_table(
        root,
        manifest,
        "oracle/potential-outcomes.parquet",
        ORACLE_SCHEMA,
        filters=[
            ("journeyId", "in", sorted(journey_ids)),
            ("condition", "=", "no_recommendation"),
        ],
    )
    baseline_rows = oracle.to_pylist()
    baseline = {str(row["journeyId"]): row for row in baseline_rows}
    if set(baseline) != journey_ids:
        raise InformationBoundaryError(
            "validation baseline does not exactly cover validation journeys"
        )
    return relevance, baseline


def load_untouched_model_table(
    world_root: Path | str,
    configuration_path: Path | str,
    frozen: FrozenConfiguration,
) -> pa.Table:
    """Evaluator-only access to the physically bound untouched model surface."""

    root = Path(world_root).resolve()
    verify_frozen_configuration(
        configuration_path, frozen, world_root=root
    )
    manifest = _read_manifest(root)
    relative_path = "model-visible/training-examples.parquet"
    artifact_path = root / relative_path
    artifact = manifest.get("artifacts", {}).get(relative_path, {})  # type: ignore[union-attr]
    expected_digest = artifact.get("sha256") if isinstance(artifact, dict) else None
    if hashlib.sha256(artifact_path.read_bytes()).hexdigest() != expected_digest:
        raise InformationBoundaryError(
            "untouched model artifact digest does not match manifest"
        )
    table = pq.read_table(artifact_path)
    if table.schema != TRAINING_SCHEMA:
        raise InformationBoundaryError(
            "untouched model artifact does not match immutable schema"
        )
    return table.filter(pc.equal(table["split"], "untouched_test"))


def load_untouched_candidate_relevance_table(
    world_root: Path | str,
    configuration_path: Path | str,
    frozen: FrozenConfiguration,
) -> pa.Table:
    """Load held-out candidate value only after configuration freeze verification."""

    root = Path(world_root).resolve()
    verify_frozen_configuration(
        configuration_path, frozen, world_root=root
    )
    manifest = _read_manifest(root)
    relative_path = "evaluation/candidate-relevance.parquet"
    artifact_path = root / relative_path
    artifact = manifest.get("artifacts", {}).get(relative_path, {})  # type: ignore[union-attr]
    expected_digest = artifact.get("sha256") if isinstance(artifact, dict) else None
    if hashlib.sha256(artifact_path.read_bytes()).hexdigest() != expected_digest:
        raise InformationBoundaryError(
            "candidate relevance artifact digest does not match manifest"
        )
    table = pq.read_table(artifact_path)
    if table.schema != CANDIDATE_RELEVANCE_SCHEMA:
        raise InformationBoundaryError(
            "candidate relevance artifact does not match immutable schema"
        )
    return table.filter(pc.equal(table["split"], "untouched_test"))
