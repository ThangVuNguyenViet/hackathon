from __future__ import annotations

import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import duckdb
import pandas as pd

from .feature_contracts import CATEGORICAL_FEATURES, NUMERIC_FEATURES

FEATURE_COLUMNS = (*CATEGORICAL_FEATURES, *NUMERIC_FEATURES)
DERIVED_FEATURE_EXPRESSIONS = (
    "c.modifier_path",
    (
        "greatest(c.feature_budget_vnd - c.feature_cart_subtotal_vnd, 0)"
        " as feature_remaining_budget_vnd"
    ),
    (
        "c.feature_price_delta_vnd"
        " / greatest(c.feature_budget_vnd - c.feature_cart_subtotal_vnd, 1)"
        " as feature_price_to_remaining_budget_ratio"
    ),
)


@dataclass(frozen=True)
class PlacementDataContract:
    placement: str
    cold_column: str
    positive_price_only: bool


PLACEMENT_CONTRACTS = {
    "smart_cross_sell": PlacementDataContract(
        "smart_cross_sell",
        "cold_product",
        False,
    ),
    "modifier_upsell": PlacementDataContract(
        "modifier_upsell",
        "cold_modifier",
        True,
    ),
}


@dataclass(frozen=True)
class BundleData:
    seed: int
    bundle_dir: Path
    journey_count: int


def _parquet(bundle: BundleData, directory: str, table: str) -> str:
    path = (bundle.bundle_dir / directory / f"{table}.parquet").resolve()
    if not path.is_file():
        raise FileNotFoundError(path)
    return str(path).replace("'", "''")


def _fraction_expression() -> str:
    return (
        "cast(regexp_extract(c.journey_id, '([0-9]+)$', 1) as double)"
        " / greatest(? - 1, 1)"
    )


def load_impression_rows(
    bundle: BundleData,
    *,
    split: str,
    tuning_sample: bool = False,
    placement: str = "smart_cross_sell",
) -> pd.DataFrame:
    contract = PLACEMENT_CONTRACTS[placement]
    bounds = {
        "train": (0.0, 0.6),
        "validation": (0.6, 0.8),
        "test": (0.8, 1.0000001),
    }
    lower, upper = bounds[split]
    sample_clause = "and hash(c.request_id) % 20 = 0" if tuning_sample else ""
    query = f"""
        select
          {bundle.seed} as seed,
          c.request_id,
          c.journey_id,
          c.name,
          {", ".join(f"c.{column}" for column in FEATURE_COLUMNS)},
          {", ".join(DERIVED_FEATURE_EXPRESSIONS)},
          i.position,
          i.slate_size,
          i.action_propensity,
          i.joint_prefix_propensity,
          o.customer_selected,
          o.basket_mutation_succeeded,
          o.checked_out,
          o.survived_checkout,
          o.net_incremental_value_vnd,
          e.held_out_store,
          e.{contract.cold_column} as cold_candidate,
          e.{contract.cold_column} as cold_product
        from read_parquet('{_parquet(bundle, "model-visible", "impressions")}') i
        join read_parquet('{_parquet(bundle, "model-visible", "outcomes")}') o
          on o.impression_id = i.impression_id
        join read_parquet('{_parquet(bundle, "model-visible", "candidates")}') c
          on c.request_id = i.request_id
          and c.candidate_id = i.candidate_id
        join read_parquet('{_parquet(bundle, "evaluation", "evaluation_slices")}') e
          on e.request_id = i.request_id
          and e.candidate_id = i.candidate_id
        where i.placement = '{contract.placement}'
          and i.decision_source = 'ranked'
          and not i.policy_modified
          {"and c.feature_price_delta_vnd > 0" if contract.positive_price_only else ""}
          and {_fraction_expression()} >= ?
          and {_fraction_expression()} < ?
          {sample_clause}
    """
    frame = (
        duckdb.connect(config={"threads": 1})
        .execute(
            query,
            [bundle.journey_count, lower, bundle.journey_count, upper],
        )
        .fetch_df()
    )
    frame["success"] = frame["survived_checkout"].astype("int8")
    frame["reward_vnd"] = frame["net_incremental_value_vnd"].astype("float64")
    return frame


def load_candidate_rows(
    bundle: BundleData,
    *,
    split: str,
    tuning_sample: bool = False,
    request_shard: tuple[int, int] | None = None,
    cache_dir: Path | None = None,
    placement: str = "smart_cross_sell",
) -> pd.DataFrame:
    contract = PLACEMENT_CONTRACTS[placement]
    if cache_dir is not None:
        parquet_glob = (
            cache_dir / f"evaluation_shard={request_shard[0]}" / "*.parquet"
            if request_shard is not None
            else cache_dir / "**" / "*.parquet"
        )
        sample_clause = "where hash(request_id) % 20 = 0" if tuning_sample else ""
        query = f"""
            select * exclude (evaluation_shard)
            from read_parquet(
              '{str(parquet_glob.resolve()).replace("'", "''")}',
              hive_partitioning = true
            )
            {sample_clause}
        """
        return duckdb.connect(config={"threads": 1}).execute(query).fetch_df()

    bounds = {
        "validation": (0.6, 0.8),
        "test": (0.8, 1.0000001),
    }
    lower, upper = bounds[split]
    sample_clause = "and hash(c.request_id) % 20 = 0" if tuning_sample else ""
    shard_clause = (
        f"and hash(c.request_id) % {request_shard[1]} = {request_shard[0]}"
        if request_shard is not None
        else ""
    )
    query = f"""
        select
          {bundle.seed} as seed,
          c.request_id,
          c.journey_id,
          c.target_id,
          c.name,
          {", ".join(f"c.{column}" for column in FEATURE_COLUMNS)},
          {", ".join(DERIVED_FEATURE_EXPRESSIONS)},
          e.held_out_store,
          e.{contract.cold_column} as cold_candidate,
          e.{contract.cold_column} as cold_product,
          p.expected_net_merchandise_value_vnd,
          p.expected_net_value_by_position_vnd
        from read_parquet('{_parquet(bundle, "model-visible", "candidates")}') c
        join read_parquet(
          '{_parquet(bundle, "model-visible", "eligibility_decisions")}'
        ) eligibility using (request_id, candidate_id)
        join read_parquet('{_parquet(bundle, "evaluation", "evaluation_slices")}') e
          using (request_id, candidate_id)
        join read_parquet('{_parquet(bundle, "oracle", "potential_outcomes")}') p
          using (request_id, candidate_id)
        where c.placement = '{contract.placement}'
          and eligibility.eligible
          {"and c.feature_price_delta_vnd > 0" if contract.positive_price_only else ""}
          and {_fraction_expression()} >= ?
          and {_fraction_expression()} < ?
          {sample_clause}
          {shard_clause}
    """
    return (
        duckdb.connect(config={"threads": 1})
        .execute(
            query,
            [bundle.journey_count, lower, bundle.journey_count, upper],
        )
        .fetch_df()
    )


def _cache_contract(
    bundle: BundleData,
    *,
    split: str,
    shard_count: int,
    placement: str,
) -> dict[str, int | str]:
    contract = PLACEMENT_CONTRACTS[placement]
    return {
        "seed": bundle.seed,
        "journeyCount": bundle.journey_count,
        "split": split,
        "shardCount": shard_count,
        "placement": contract.placement,
        "coldColumn": contract.cold_column,
        "positivePriceOnly": str(contract.positive_price_only).lower(),
    }


def _materialize_candidate_cache_in_process(
    bundle: BundleData,
    *,
    split: str,
    cache_root: Path,
    shard_count: int,
    placement: str,
) -> Path:
    contract = PLACEMENT_CONTRACTS[placement]
    cache_dir = cache_root / f"seed-{bundle.seed:02d}" / split
    marker = cache_dir / "_complete.json"
    expected = _cache_contract(
        bundle,
        split=split,
        shard_count=shard_count,
        placement=placement,
    )
    if marker.is_file() and json.loads(marker.read_text(encoding="utf-8")) == expected:
        return cache_dir

    building_dir = cache_dir.with_name(f"{cache_dir.name}.building")
    if building_dir.exists():
        shutil.rmtree(building_dir)
    building_dir.mkdir(parents=True)
    bounds = {
        "validation": (0.6, 0.8),
        "test": (0.8, 1.0000001),
    }
    lower, upper = bounds[split]
    destination = str(building_dir.resolve()).replace("'", "''")
    query = f"""
        copy (
          select
            {bundle.seed} as seed,
            c.request_id,
            c.journey_id,
            c.target_id,
            c.name,
            {", ".join(f"c.{column}" for column in FEATURE_COLUMNS)},
            {", ".join(DERIVED_FEATURE_EXPRESSIONS)},
            e.held_out_store,
            e.{contract.cold_column} as cold_candidate,
            e.{contract.cold_column} as cold_product,
            p.expected_net_merchandise_value_vnd,
            p.expected_net_value_by_position_vnd,
            hash(c.request_id) % {shard_count} as evaluation_shard
          from read_parquet('{_parquet(bundle, "model-visible", "candidates")}') c
          join read_parquet(
            '{_parquet(bundle, "model-visible", "eligibility_decisions")}'
          ) eligibility using (request_id, candidate_id)
          join read_parquet(
            '{_parquet(bundle, "evaluation", "evaluation_slices")}'
          ) e using (request_id, candidate_id)
          join read_parquet(
            '{_parquet(bundle, "oracle", "potential_outcomes")}'
          ) p using (request_id, candidate_id)
          where c.placement = '{contract.placement}'
            and eligibility.eligible
            {"and c.feature_price_delta_vnd > 0" if contract.positive_price_only else ""}
            and {_fraction_expression()} >= ?
            and {_fraction_expression()} < ?
        ) to '{destination}' (
          format parquet,
          partition_by (evaluation_shard),
          compression zstd,
          row_group_size 50000
        )
    """
    connection = duckdb.connect(config={"threads": 1})
    connection.execute("set enable_progress_bar = false")
    connection.execute("set memory_limit = '512MB'")
    connection.execute(
        query,
        [bundle.journey_count, lower, bundle.journey_count, upper],
    )
    connection.close()
    marker_path = building_dir / "_complete.json"
    marker_path.write_text(
        json.dumps(expected, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    if cache_dir.exists():
        shutil.rmtree(cache_dir)
    building_dir.rename(cache_dir)
    return cache_dir


def materialize_candidate_cache(
    bundle: BundleData,
    *,
    split: str,
    cache_root: Path,
    shard_count: int,
    placement: str = "smart_cross_sell",
) -> Path:
    cache_dir = cache_root / f"seed-{bundle.seed:02d}" / split
    marker = cache_dir / "_complete.json"
    expected = _cache_contract(
        bundle,
        split=split,
        shard_count=shard_count,
        placement=placement,
    )
    if marker.is_file() and json.loads(marker.read_text(encoding="utf-8")) == expected:
        return cache_dir
    subprocess.run(
        [
            sys.executable,
            "-m",
            "kfc_recommendation_simulator.benchmark_data",
            "materialize-candidate-cache",
            str(bundle.seed),
            str(bundle.journey_count),
            str(bundle.bundle_dir.resolve()),
            split,
            str(cache_root.resolve()),
            str(shard_count),
            placement,
        ],
        check=True,
    )
    if not marker.is_file() or json.loads(marker.read_text(encoding="utf-8")) != expected:
        raise RuntimeError(f"candidate cache did not complete: {cache_dir}")
    return cache_dir


def load_catalog_rows(
    bundle: BundleData,
    *,
    placement: str = "smart_cross_sell",
) -> pd.DataFrame:
    contract = PLACEMENT_CONTRACTS[placement]
    query = f"""
        select distinct candidate_id, name, category
        from read_parquet('{_parquet(bundle, "model-visible", "candidates")}')
        where placement = '{contract.placement}'
          {"and feature_price_delta_vnd > 0" if contract.positive_price_only else ""}
        order by candidate_id
    """
    return duckdb.connect(config={"threads": 1}).execute(query).fetch_df()


def _main() -> None:
    if len(sys.argv) != 9 or sys.argv[1] != "materialize-candidate-cache":
        raise SystemExit(
            "usage: benchmark_data materialize-candidate-cache "
            "SEED JOURNEY_COUNT BUNDLE_DIR SPLIT CACHE_ROOT SHARD_COUNT PLACEMENT"
        )
    _materialize_candidate_cache_in_process(
        BundleData(
            seed=int(sys.argv[2]),
            journey_count=int(sys.argv[3]),
            bundle_dir=Path(sys.argv[4]),
        ),
        split=sys.argv[5],
        cache_root=Path(sys.argv[6]),
        shard_count=int(sys.argv[7]),
        placement=sys.argv[8],
    )


if __name__ == "__main__":
    _main()
