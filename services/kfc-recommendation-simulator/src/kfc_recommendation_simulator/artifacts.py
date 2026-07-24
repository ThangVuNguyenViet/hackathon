from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq
from jsonschema import Draft202012Validator

from .models import BundleManifest, InputPaths, WorldConfig
from .simulator import SimulationTables, simulate

MODEL_VISIBLE_TABLES = (
    "requests",
    "candidates",
    "impressions",
    "outcomes",
)
ORACLE_FORBIDDEN_COLUMNS = {
    "latent_taste_vector",
    "taste_match",
    "basket_affinity",
    "mission_match",
    "price_response",
    "diversity_effect",
    "total_utility",
    "base_response_probability",
    "common_random_draw",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_hash(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _write_table(rows: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pylist(rows)
    table.validate(full=True)
    pq.write_table(table, path, compression="zstd")


def _default_inputs(repo_root: Path) -> InputPaths:
    fixtures = repo_root / "services/kfc-agent-backend/fixtures"
    generated = fixtures / "generated"
    return InputPaths(
        menu_items=generated / "menu-items.json",
        stores=generated / "stores.json",
        modifiers=generated / "menu-modifiers.json",
        catalog_manifest=fixtures / "catalog-baselines/manifest.json",
    )


def generate_bundle(
    *,
    config_path: Path,
    output_dir: Path,
    repo_root: Path,
) -> BundleManifest:
    raw_config = json.loads(config_path.read_text(encoding="utf-8"))
    config = WorldConfig.model_validate(raw_config)
    Draft202012Validator.check_schema(WorldConfig.model_json_schema())
    inputs = _default_inputs(repo_root)
    for path in (
        inputs.menu_items,
        inputs.stores,
        inputs.modifiers,
        inputs.catalog_manifest,
    ):
        if not path.is_file():
            raise FileNotFoundError(path)

    tables: SimulationTables = simulate(config, inputs)
    model_dir = output_dir / "model-visible"
    oracle_dir = output_dir / "oracle"
    paths = {
        "requests": model_dir / "requests.parquet",
        "candidates": model_dir / "candidates.parquet",
        "impressions": model_dir / "impressions.parquet",
        "outcomes": model_dir / "outcomes.parquet",
        "oracle": oracle_dir / "counterfactuals.parquet",
    }
    _write_table(tables.requests, paths["requests"])
    _write_table(tables.candidates, paths["candidates"])
    _write_table(tables.impressions, paths["impressions"])
    _write_table(tables.outcomes, paths["outcomes"])
    _write_table(tables.oracle, paths["oracle"])

    schema_dir = output_dir / "schemas"
    schema_dir.mkdir(parents=True, exist_ok=True)
    (schema_dir / "simulator-world-v1.schema.json").write_text(
        json.dumps(WorldConfig.model_json_schema(), indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
    row_counts = {
        "requests": len(tables.requests),
        "candidates": len(tables.candidates),
        "impressions": len(tables.impressions),
        "outcomes": len(tables.outcomes),
        "oracle": len(tables.oracle),
    }
    artifact_hashes = {
        name: _sha256(path.relative_to(output_dir) and path)
        for name, path in paths.items()
    }
    manifest = BundleManifest(
        schemaVersion="recommendation-simulator-bundle-v1",
        bundleId=f"{config.world_id}-{_canonical_hash(raw_config)[:12]}",
        generatedAt=datetime.now(UTC).isoformat(),
        worldId=config.world_id,
        configHash=_canonical_hash(raw_config),
        inputHashes={
            "menuItems": _sha256(inputs.menu_items),
            "stores": _sha256(inputs.stores),
            "modifiers": _sha256(inputs.modifiers),
            "catalogManifest": _sha256(inputs.catalog_manifest),
        },
        rowCounts=row_counts,
        artifactHashes=artifact_hashes,
        modelVisibleDirectory="model-visible",
        oracleDirectory="oracle",
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "manifest.json").write_text(
        manifest.model_dump_json(by_alias=True, indent=2) + "\n",
        encoding="utf-8",
    )
    audit_bundle(output_dir)
    return manifest


def _read_table(path: Path) -> pa.Table:
    table = pq.read_table(path)
    table.validate(full=True)
    return table


def audit_bundle(bundle_dir: Path) -> dict[str, Any]:
    manifest = BundleManifest.model_validate_json(
        (bundle_dir / "manifest.json").read_text(encoding="utf-8")
    )
    failures: list[str] = []
    observed_counts: dict[str, int] = {}
    for table_name in MODEL_VISIBLE_TABLES:
        table = _read_table(bundle_dir / "model-visible" / f"{table_name}.parquet")
        observed_counts[table_name] = table.num_rows
        leaked = ORACLE_FORBIDDEN_COLUMNS.intersection(table.column_names)
        if leaked:
            failures.append(f"{table_name} leaks oracle columns: {sorted(leaked)}")
    oracle = _read_table(bundle_dir / "oracle" / "counterfactuals.parquet")
    observed_counts["oracle"] = oracle.num_rows

    impressions = _read_table(
        bundle_dir / "model-visible" / "impressions.parquet"
    ).to_pylist()
    if any(
        not 0 < float(row["joint_slate_propensity"]) <= 1 for row in impressions
    ):
        failures.append("joint slate propensities must be in (0, 1]")
    if observed_counts != manifest.row_counts:
        failures.append(
            f"manifest row counts differ: {manifest.row_counts} != {observed_counts}"
        )
    artifact_paths = {
        "requests": bundle_dir / "model-visible" / "requests.parquet",
        "candidates": bundle_dir / "model-visible" / "candidates.parquet",
        "impressions": bundle_dir / "model-visible" / "impressions.parquet",
        "outcomes": bundle_dir / "model-visible" / "outcomes.parquet",
        "oracle": bundle_dir / "oracle" / "counterfactuals.parquet",
    }
    observed_hashes = {name: _sha256(path) for name, path in artifact_paths.items()}
    if observed_hashes != manifest.artifact_hashes:
        failures.append("artifact hashes differ from manifest")

    result = {
        "schemaVersion": "recommendation-simulator-audit-v1",
        "status": "pass" if not failures else "fail",
        "bundleId": manifest.bundle_id,
        "checks": {
            "physicalTablesValid": True,
            "modelOracleColumnSeparation": not any(
                "leaks oracle" in failure for failure in failures
            ),
            "propensitiesBounded": not any(
                "propensities" in failure for failure in failures
            ),
            "manifestCountsMatch": observed_counts == manifest.row_counts,
            "artifactHashesMatch": observed_hashes == manifest.artifact_hashes,
        },
        "failures": failures,
    }
    (bundle_dir / "audit.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    if failures:
        raise ValueError("; ".join(failures))
    return result
