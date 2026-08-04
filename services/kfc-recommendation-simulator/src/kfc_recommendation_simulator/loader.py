from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from .schemas import TRAINING_SCHEMA

FORBIDDEN_TRAINING_FIELDS = frozenset(
    {
        "condition",
        "assignedCondition",
        "terminalState",
        "finalMerchandiseSubtotalVnd",
        "latentAffinity",
        "potentialSelection",
        "dismissed",
        "acceptedItemRemoved",
        "cartMutation",
        "checkout",
        "abandonment",
    }
)
TRAINING_SPLITS = ("training", "calibration", "validation")


class InformationBoundaryError(ValueError):
    """Raised when a consumer attempts to cross a physical data surface."""


def _read_manifest(world_root: Path) -> dict[str, object]:
    manifest_path = world_root / "manifests" / "synthetic-world.json"
    if not manifest_path.is_file():
        raise InformationBoundaryError(
            "world root must own the immutable synthetic-world manifest"
        )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise InformationBoundaryError("world manifest must be an object")
    bound = dict(manifest)
    expected_digest = bound.pop("worldDigest", None)
    canonical = json.dumps(
        bound,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode()
    actual_digest = hashlib.sha256(canonical).hexdigest()
    if expected_digest != actual_digest:
        raise InformationBoundaryError("world manifest digest does not match")
    return manifest


def load_training_table(world_root: Path | str) -> pa.Table:
    """Load permitted splits from the one fixed model-visible artifact.

    The caller supplies a world root, never an artifact path. Evaluation and
    oracle locations are therefore not addressable through this API.
    """

    root = Path(world_root).resolve()
    manifest = _read_manifest(root)
    relative_path = "model-visible/training-examples.parquet"
    training_path = root / relative_path
    table = pq.read_table(training_path)
    forbidden = FORBIDDEN_TRAINING_FIELDS.intersection(table.column_names)
    if forbidden:
        raise InformationBoundaryError(
            f"forbidden training field(s): {', '.join(sorted(forbidden))}"
        )
    expected_names = TRAINING_SCHEMA.names
    if table.column_names != expected_names or table.schema != TRAINING_SCHEMA:
        raise InformationBoundaryError(
            "training artifact does not match its immutable schema"
        )
    artifact = manifest.get("artifacts", {}).get(relative_path, {})  # type: ignore[union-attr]
    expected_digest = artifact.get("sha256") if isinstance(artifact, dict) else None
    actual_digest = hashlib.sha256(training_path.read_bytes()).hexdigest()
    if expected_digest != actual_digest:
        raise InformationBoundaryError(
            "training artifact digest does not match manifest"
        )
    allowed = pa.array(TRAINING_SPLITS, type=pa.string())
    return table.filter(pc.is_in(table["split"], value_set=allowed))
