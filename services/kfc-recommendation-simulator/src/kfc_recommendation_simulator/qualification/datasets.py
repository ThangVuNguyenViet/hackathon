from __future__ import annotations

import hashlib
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from ..loader import InformationBoundaryError, _read_manifest
from ..schemas import CANDIDATE_RELEVANCE_SCHEMA, TRAINING_SCHEMA
from .freeze import FrozenConfiguration, verify_frozen_configuration


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
