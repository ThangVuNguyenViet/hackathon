from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb
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
    "attention_probability_by_position",
    "expected_net_value_by_position_vnd",
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
    (schema_dir / "simulator-world-v3.schema.json").write_text(
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
        schemaVersion="recommendation-simulator-bundle-v3",
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


def audit_bundle(bundle_dir: Path) -> dict[str, Any]:
    manifest = BundleManifest.model_validate_json(
        (bundle_dir / "manifest.json").read_text(encoding="utf-8")
    )
    paths = _table_paths(bundle_dir)
    failures: list[str] = []
    observed_counts: dict[str, int] = {}
    schemas: dict[str, set[str]] = {}
    for table_name, path in paths.items():
        if not path.is_file():
            failures.append(f"missing table: {table_name}")
            continue
        parquet = pq.ParquetFile(path)
        observed_counts[table_name] = parquet.metadata.num_rows
        schemas[table_name] = set(parquet.schema_arrow.names)
        if table_name in MODEL_TABLES:
            leaked_oracle = ORACLE_FORBIDDEN_COLUMNS.intersection(schemas[table_name])
            leaked_evaluation = EVALUATION_FORBIDDEN_COLUMNS.intersection(
                schemas[table_name]
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

    connection = duckdb.connect(config={"threads": 1, "memory_limit": "512MB"})
    try:
        for table_name, path in paths.items():
            if path.is_file():
                escaped = str(path.resolve()).replace("'", "''")
                connection.execute(
                    f"create view {table_name} as "
                    f"select * from read_parquet('{escaped}')"
                )

        def count(query: str) -> int:
            return int(connection.execute(query).fetchone()[0])

        if "impressions" in schemas:
            if count(
                """
                select count(*) from impressions
                where action_propensity <= 0 or action_propensity > 1
                """
            ):
                failures.append("impression action propensities must be in (0, 1]")
            randomized_targets = count(
                """
                select count(distinct candidate_id) from impressions
                where logging_policy = 'randomized_exploration'
                """
            )
            if randomized_targets < 2:
                failures.append("randomized exploration did not display varied targets")

        if {"requests", "journeys"}.issubset(schemas):
            if count(
                """
                select count(*) from requests
                where placement = 'for_you' and prior_completed_orders < 1
                """
            ):
                failures.append("for_you request lacks prior completed order")
            if count(
                """
                select count(*) from requests
                where placement = 'local_favorite' and prior_completed_orders > 0
                """
            ):
                failures.append(
                    "returning customer incorrectly received local favorite"
                )
            if count(
                """
                select count(*) from (
                  select
                    journey_id,
                    string_agg(placement, ',' order by stage_index) as sequence
                  from requests
                  group by journey_id
                )
                where sequence not in (
                  'local_favorite,modifier_upsell,smart_cross_sell',
                  'for_you,modifier_upsell,smart_cross_sell'
                )
                """
            ):
                failures.append(
                    "placement sequence violates starter -> modifier -> cross"
                )

        required_event_tables = {
            "decisions",
            "candidates",
            "impressions",
            "outcomes",
        }
        if required_event_tables.issubset(schemas):
            if count(
                """
                select count(*) from decisions
                where len(selected_candidate_ids)
                    != len(list_distinct(selected_candidate_ids))
                """
            ):
                failures.append("decision slate contains duplicate candidates")
            if count(
                """
                select count(*) from decisions
                where slate_size != len(selected_candidate_ids)
                """
            ):
                failures.append("decision slate size differs from selected candidates")
            if count("select count(*) from decisions where slate_size > 4"):
                failures.append("decision slate exceeds four candidates")
            if count(
                """
                select count(*) from decisions
                where placement = 'smart_cross_sell'
                  and status = 'recommended'
                  and decision_source = 'ranked'
                  and slate_size not in (3, 4)
                """
            ):
                failures.append(
                    "ranked smart-cross-sell slate must contain 3 or 4 items"
                )
            if count(
                """
                select count(*)
                from decisions d
                cross join unnest(d.selected_candidate_ids) s(candidate_id)
                left join candidates c
                  on c.request_id = d.request_id
                 and c.candidate_id = s.candidate_id
                where c.candidate_id is null
                """
            ):
                failures.append("decision references unknown candidate")
            if count(
                """
                select count(*) from (
                  select
                    slate_id,
                    min(position) as first_position,
                    max(position) as last_position,
                    count(*) as impression_count,
                    count(distinct position) as distinct_positions
                  from impressions
                  group by slate_id
                )
                where first_position != 1
                   or last_position != impression_count
                   or distinct_positions != impression_count
                """
            ):
                failures.append("slate impression positions are not contiguous")
            if count(
                """
                select count(*) from (
                  select
                    joint_prefix_propensity,
                    lag(joint_prefix_propensity) over (
                      partition by slate_id order by position
                    ) as previous_propensity
                  from impressions
                )
                where joint_prefix_propensity > previous_propensity
                """
            ):
                failures.append(
                    "joint slate propensity increases after another position"
                )
            if count(
                """
                select count(*) from (
                  select i.slate_id, c.category, count(*) as category_count
                  from impressions i
                  join candidates c using (request_id, candidate_id)
                  where i.placement = 'smart_cross_sell'
                  group by i.slate_id, c.category
                )
                where category_count > 2
                """
            ):
                failures.append("smart-cross-sell slate repeats a category over twice")
            if count(
                """
                select count(*)
                from impressions fourth
                join candidates fourth_candidate
                  using (request_id, candidate_id)
                where fourth.placement = 'smart_cross_sell'
                  and fourth.position = 4
                  and exists (
                    select 1
                    from impressions earlier
                    join candidates earlier_candidate
                      using (request_id, candidate_id)
                    where earlier.slate_id = fourth.slate_id
                      and earlier.position < 4
                      and earlier_candidate.category = fourth_candidate.category
                  )
                """
            ):
                failures.append("fourth smart-cross-sell item lacks category diversity")
            if count(
                """
                select count(*)
                from impressions i
                left join decisions d using (recommendation_id)
                where d.recommendation_id is null
                """
            ):
                failures.append("impression references unknown recommendation")
            if count(
                """
                select count(*)
                from outcomes o
                left join impressions i using (impression_id)
                where i.impression_id is null
                """
            ):
                failures.append("outcome references unknown impression")

        if "evaluation_slices" in schemas:
            if not count(
                """
                select count(distinct store_id) from evaluation_slices
                where held_out_store
                """
            ):
                failures.append("held-out store slice is empty")
            if not count("select count(*) from evaluation_slices where cold_product"):
                failures.append("cold-product slice is empty")
            if not count("select count(*) from evaluation_slices where cold_modifier"):
                failures.append("cold-modifier slice is empty")
            if not count(
                "select count(*) from evaluation_slices where returning_customer"
            ):
                failures.append("returning-customer slice is empty")

        if "policy_effects" in schemas:
            effects = {
                str(row[0])
                for row in connection.execute(
                    "select distinct effect from policy_effects"
                ).fetchall()
            }
            required = {"snapshot_evaluated", "excluded", "boosted"}
            if not required.issubset(effects):
                failures.append(
                    f"policy-effect coverage missing: {sorted(required - effects)}"
                )
    finally:
        connection.close()

    result = {
        "schemaVersion": "recommendation-simulator-audit-v3",
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
            "slateContractValid": not any(
                "slate" in failure or "fourth smart-cross-sell" in failure
                for failure in failures
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
