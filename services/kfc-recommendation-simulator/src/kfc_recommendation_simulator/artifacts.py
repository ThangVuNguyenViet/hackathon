from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq
from jsonschema import Draft202012Validator

from .models import BundleManifest, InputPaths, WorldConfig
from .simulator import (
    EVALUATION_TABLES,
    MODEL_TABLES,
    ORACLE_TABLES,
    iter_simulation,
)

ORACLE_FORBIDDEN_COLUMNS = {
    "latent_taste_vector",
    "taste_match",
    "basket_affinity",
    "mission_match",
    "price_response",
    "promotion_response",
    "history_affinity",
    "store_popularity",
    "drift_effect",
    "diversity_effect",
    "fatigue_effect",
    "total_utility",
    "attention_probability",
    "acceptance_probability",
    "cart_mutation_probability",
    "checkout_probability_if_selected",
    "expected_net_merchandise_value_vnd",
    "common_random_draw",
}
EVALUATION_FORBIDDEN_COLUMNS = {
    "held_out_store",
    "cold_product",
    "cold_modifier",
    "customer_cold_start",
    "returning_customer",
    "drift_phase",
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


def _default_inputs(repo_root: Path, package_root: Path) -> InputPaths:
    fixtures = repo_root / "services/kfc-agent-backend/fixtures"
    generated = fixtures / "generated"
    return InputPaths(
        menu_items=generated / "menu-items.json",
        stores=generated / "stores.json",
        modifiers=generated / "menu-modifiers.json",
        store_availability=generated / "store-availability.json",
        promotions=generated / "promotions.json",
        sanity_policies=package_root / "worlds/sanity-policies.json",
        catalog_manifest=fixtures / "catalog-baselines/manifest.json",
    )


def _table_paths(output_dir: Path) -> dict[str, Path]:
    return {
        **{
            name: output_dir / "model-visible" / f"{name}.parquet"
            for name in MODEL_TABLES
        },
        **{
            name: output_dir / "evaluation" / f"{name}.parquet"
            for name in EVALUATION_TABLES
        },
        **{name: output_dir / "oracle" / f"{name}.parquet" for name in ORACLE_TABLES},
    }


def _flush(
    buffers: dict[str, list[dict[str, Any]]],
    writers: dict[str, pq.ParquetWriter],
    paths: dict[str, Path],
) -> None:
    for table_name, rows in buffers.items():
        if not rows:
            continue
        table = pa.Table.from_pylist(rows)
        table.validate(full=True)
        writer = writers.get(table_name)
        if writer is None:
            paths[table_name].parent.mkdir(parents=True, exist_ok=True)
            writer = pq.ParquetWriter(
                paths[table_name],
                table.schema,
                compression="zstd",
                use_dictionary=True,
            )
            writers[table_name] = writer
        elif table.schema != writer.schema:
            table = table.cast(writer.schema)
        writer.write_table(table)
        rows.clear()


def generate_bundle(
    *,
    config_path: Path,
    output_dir: Path,
    repo_root: Path,
) -> BundleManifest:
    raw_config = json.loads(config_path.read_text(encoding="utf-8"))
    config = WorldConfig.model_validate(raw_config)
    Draft202012Validator.check_schema(WorldConfig.model_json_schema())
    package_root = Path(__file__).resolve().parents[2]
    inputs = _default_inputs(repo_root, package_root)
    input_files = {
        "menuItems": inputs.menu_items,
        "stores": inputs.stores,
        "modifiers": inputs.modifiers,
        "storeAvailability": inputs.store_availability,
        "promotions": inputs.promotions,
        "sanityPolicies": inputs.sanity_policies,
        "catalogManifest": inputs.catalog_manifest,
    }
    for path in input_files.values():
        if not path.is_file():
            raise FileNotFoundError(path)

    output_dir.mkdir(parents=True, exist_ok=True)
    paths = _table_paths(output_dir)
    writers: dict[str, pq.ParquetWriter] = {}
    buffers = {name: [] for name in (*MODEL_TABLES, *EVALUATION_TABLES, *ORACLE_TABLES)}
    row_counts = {name: 0 for name in buffers}
    try:
        for journey_number, journey_rows in enumerate(
            iter_simulation(config, inputs), 1
        ):
            for table_name, rows in journey_rows.items():
                buffers[table_name].extend(rows)
                row_counts[table_name] += len(rows)
            if journey_number % config.batch_journeys == 0:
                _flush(buffers, writers, paths)
        _flush(buffers, writers, paths)
    finally:
        for writer in writers.values():
            writer.close()

    missing_tables = sorted(set(paths) - set(writers))
    if missing_tables:
        raise ValueError(f"simulation produced empty tables: {missing_tables}")

    schema_dir = output_dir / "schemas"
    schema_dir.mkdir(parents=True, exist_ok=True)
    (schema_dir / "simulator-world-v2.schema.json").write_text(
        json.dumps(WorldConfig.model_json_schema(), indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
    input_hashes = {name: _sha256(path) for name, path in input_files.items()}
    artifact_hashes = {name: _sha256(path) for name, path in paths.items()}
    content_digest = _canonical_hash(
        {
            "configHash": _canonical_hash(raw_config),
            "inputHashes": input_hashes,
            "artifactHashes": artifact_hashes,
            "rowCounts": row_counts,
        }
    )
    manifest = BundleManifest(
        schemaVersion="recommendation-simulator-bundle-v2",
        bundleId=f"{config.world_id}-{content_digest[:12]}",
        generatedAt=datetime.now(UTC).isoformat(),
        worldId=config.world_id,
        configHash=_canonical_hash(raw_config),
        contentDigest=content_digest,
        inputHashes=input_hashes,
        rowCounts=row_counts,
        artifactHashes=artifact_hashes,
        modelVisibleDirectory="model-visible",
        evaluationDirectory="evaluation",
        oracleDirectory="oracle",
    )
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
    paths = _table_paths(bundle_dir)
    failures: list[str] = []
    observed_counts: dict[str, int] = {}
    tables: dict[str, pa.Table] = {}
    for table_name, path in paths.items():
        if not path.is_file():
            failures.append(f"missing table: {table_name}")
            continue
        table = _read_table(path)
        tables[table_name] = table
        observed_counts[table_name] = table.num_rows
        if table_name in MODEL_TABLES:
            leaked_oracle = ORACLE_FORBIDDEN_COLUMNS.intersection(table.column_names)
            leaked_evaluation = EVALUATION_FORBIDDEN_COLUMNS.intersection(
                table.column_names
            )
            if leaked_oracle:
                failures.append(
                    f"{table_name} leaks oracle columns: {sorted(leaked_oracle)}"
                )
            if leaked_evaluation:
                failures.append(
                    f"{table_name} leaks evaluation columns: {sorted(leaked_evaluation)}"
                )

    if observed_counts != manifest.row_counts:
        failures.append(
            f"manifest row counts differ: {manifest.row_counts} != {observed_counts}"
        )

    observed_hashes = {
        name: _sha256(path) for name, path in paths.items() if path.is_file()
    }
    if observed_hashes != manifest.artifact_hashes:
        failures.append("artifact hashes differ from manifest")

    if "impressions" in tables:
        impressions = tables["impressions"].to_pylist()
        if any(not 0 < float(row["action_propensity"]) <= 1 for row in impressions):
            failures.append("impression action propensities must be in (0, 1]")
        randomized_targets = {
            row["candidate_id"]
            for row in impressions
            if row["logging_policy"] == "randomized_exploration"
        }
        if len(randomized_targets) < 2:
            failures.append("randomized exploration did not display varied targets")

    if {"requests", "journeys"}.issubset(tables):
        requests = tables["requests"].to_pylist()
        placements: defaultdict[str, list[str]] = defaultdict(list)
        for row in requests:
            placements[row["journey_id"]].append(row["placement"])
            if row["placement"] == "for_you" and row["prior_completed_orders"] < 1:
                failures.append("for_you request lacks prior completed order")
            if (
                row["placement"] == "local_favorite"
                and row["prior_completed_orders"] > 0
            ):
                failures.append(
                    "returning customer incorrectly received local favorite"
                )
        valid_orders = {
            ("local_favorite", "modifier_upsell", "smart_cross_sell"),
            ("for_you", "modifier_upsell", "smart_cross_sell"),
        }
        if any(tuple(order) not in valid_orders for order in placements.values()):
            failures.append("placement sequence violates starter -> modifier -> cross")

    if {"decisions", "candidates", "impressions", "outcomes"}.issubset(tables):
        decisions = tables["decisions"].to_pylist()
        candidate_ids = {
            (row["request_id"], row["candidate_id"])
            for row in tables["candidates"].to_pylist()
        }
        recommendation_ids = {row["recommendation_id"] for row in decisions}
        for decision in decisions:
            selected = decision["selected_candidate_id"]
            if selected and (decision["request_id"], selected) not in candidate_ids:
                failures.append("decision references unknown candidate")
                break
        impression_ids = {
            row["impression_id"] for row in tables["impressions"].to_pylist()
        }
        if any(
            row["recommendation_id"] not in recommendation_ids
            for row in tables["impressions"].to_pylist()
        ):
            failures.append("impression references unknown recommendation")
        if any(
            row["impression_id"] not in impression_ids
            for row in tables["outcomes"].to_pylist()
        ):
            failures.append("outcome references unknown impression")

    if "evaluation_slices" in tables:
        slices = tables["evaluation_slices"].to_pylist()
        held_stores = {row["store_id"] for row in slices if row["held_out_store"]}
        if not held_stores:
            failures.append("held-out store slice is empty")
        if not any(row["cold_product"] for row in slices):
            failures.append("cold-product slice is empty")
        if not any(row["cold_modifier"] for row in slices):
            failures.append("cold-modifier slice is empty")
        if not any(row["returning_customer"] for row in slices):
            failures.append("returning-customer slice is empty")

    if "policy_effects" in tables:
        effects = {row["effect"] for row in tables["policy_effects"].to_pylist()}
        required = {"snapshot_evaluated", "excluded", "boosted"}
        if not required.issubset(effects):
            failures.append(
                f"policy-effect coverage missing: {sorted(required - effects)}"
            )

    result = {
        "schemaVersion": "recommendation-simulator-audit-v2",
        "status": "pass" if not failures else "fail",
        "bundleId": manifest.bundle_id,
        "contentDigest": manifest.content_digest,
        "checks": {
            "physicalTablesValid": not any(
                failure.startswith("missing table") for failure in failures
            ),
            "modelOracleSeparation": not any(
                "leaks oracle" in failure for failure in failures
            ),
            "modelEvaluationSeparation": not any(
                "leaks evaluation" in failure for failure in failures
            ),
            "propensitiesValid": not any(
                "propensit" in failure or "randomized exploration" in failure
                for failure in failures
            ),
            "stageOrderValid": not any(
                "placement sequence" in failure for failure in failures
            ),
            "forYouHistoryValid": not any(
                "for_you" in failure or "local favorite" in failure
                for failure in failures
            ),
            "eventLinksValid": not any(
                "references unknown" in failure for failure in failures
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
