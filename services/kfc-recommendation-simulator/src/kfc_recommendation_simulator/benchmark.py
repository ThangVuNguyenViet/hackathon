from __future__ import annotations

import gc
import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import optuna
import pandas as pd
from sklearn.metrics import brier_score_loss

from .artifacts import audit_bundle, generate_bundle
from .benchmark_data import (
    BundleData,
    load_candidate_rows,
    load_impression_rows,
    materialize_candidate_cache,
)
from .benchmark_orchestration import (
    PRE_MODEL_STAGE_SEQUENCE,
    IsolatedStage,
    run_isolated_stage,
)
from .embeddings import (
    EMBEDDING_FEATURES,
    CatalogEmbeddingProjector,
    FrozenEmbeddingRanker,
)
from .embeddings import (
    MODEL_ARTIFACT as EMBEDDING_MODEL_ARTIFACT,
)
from .embeddings import (
    MODEL_ID as EMBEDDING_MODEL_ID,
)
from .embeddings import (
    MODEL_REVISION as EMBEDDING_MODEL_REVISION,
)
from .rankers import (
    FeatureSchema,
    LightGBMArtifactRanker,
    ProbabilityCalibrator,
    Ranker,
    expected_calibration_error,
    fit_keras,
    fit_lightgbm,
    fit_xgboost,
    load_ranker,
    select_calibrator,
)

BASE_SHA = "6b36d0f2245e950ade843aeda48e1af33ea76e6b"
SIMULATOR_SHA = "58cef2d1e9cece6075e1035158eb2674e530f9b7"
REASON_CODES = {
    "feature_basket_association_score": "complements_cart",
    "feature_store_item_order_count": "popular_at_store",
    "feature_global_item_order_count": "popular_at_store",
    "feature_mission": "matches_order_mission",
    "feature_budget_vnd": "fits_budget",
    "feature_cart_subtotal_vnd": "fits_budget",
    "feature_discount_ratio": "promotion_value",
    "feature_customer_item_order_count": "customer_preference",
    "feature_customer_category_order_count": "category_affinity",
    **{feature: "product_semantics" for feature in EMBEDDING_FEATURES},
}


@dataclass(frozen=True)
class BenchmarkProfile:
    name: str
    seeds: tuple[int, ...]
    journey_count: int
    tree_trials: int
    keras_trials: int
    keras_epochs: int
    qualification: bool


PROFILES = {
    "smoke": BenchmarkProfile("smoke", (1, 2, 3), 3_000, 2, 1, 2, False),
    "qualification": BenchmarkProfile(
        "qualification", tuple(range(1, 11)), 50_000, 8, 4, 5, True
    ),
}


@dataclass
class ModelCandidate:
    name: str
    ranker: Ranker
    calibrator: ProbabilityCalibrator
    params: dict[str, Any]
    calibration_metrics: dict[str, dict[str, float]]

    def probability(self, frame: pd.DataFrame) -> np.ndarray:
        return self.calibrator.predict(self.ranker.predict_probability(frame))

    def score(self, frame: pd.DataFrame) -> np.ndarray:
        return self.probability(frame) * frame["feature_price_delta_vnd"].to_numpy(
            dtype="float64"
        )

    @classmethod
    def load(cls, output_dir: Path, name: str) -> ModelCandidate:
        model_dir = output_dir / "models" / name
        manifest = json.loads(
            (model_dir / "ranker-manifest.json").read_text(encoding="utf-8")
        )
        ranker = load_ranker(model_dir, name)
        if name == "lightgbm_embeddings":
            ranker = FrozenEmbeddingRanker(
                name,
                ranker,
                CatalogEmbeddingProjector.load(model_dir),
            )
        return cls(
            name=name,
            ranker=ranker,
            calibrator=ProbabilityCalibrator.load(model_dir / "calibrator.joblib"),
            params=manifest["parameters"],
            calibration_metrics=manifest["calibrationMetrics"],
        )


def _canonical_digest(value: Any) -> str:
    payload = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    return hashlib.sha256(payload).hexdigest()


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _write_report(path: Path, result: dict[str, Any]) -> None:
    lines = [
        "# Smart Cross-sell ranker benchmark",
        "",
        f"- Profile: `{result['profile']}`",
        f"- Learned validation winner: `{result['learnedWinner']}`",
        f"- Selected ranker: `{result['selectedRanker']}`",
        f"- Decision: `{result['promotionDecision']}`",
        "",
        "## Validation comparison",
        "",
        "| Ranker | Expected incremental AOV | NDCG@5 | Precision@3 | Coverage |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for name, metrics in result["learnedValidation"].items():
        aggregate = metrics["aggregate"]
        lines.append(
            "| "
            + " | ".join(
                (
                    name,
                    f"₫{aggregate['expected_incremental_aov_vnd']:,.0f}",
                    f"{aggregate['ndcg_at_5']:.4f}",
                    f"{aggregate['precision_at_3']:.4f}",
                    f"{aggregate['catalog_coverage']:.4f}",
                )
            )
            + " |"
        )
    if result["qualification"]:
        test = result["untouchedTest"]
        lines.extend(
            [
                "",
                "## Untouched-test promotion evidence",
                "",
                (
                    "- Paired AOV delta: "
                    f"₫{test['aovPairedInterval']['mean']:,.0f} "
                    f"(95% CI ₫{test['aovPairedInterval']['lower95']:,.0f} to "
                    f"₫{test['aovPairedInterval']['upper95']:,.0f})"
                ),
                (f"- Paired NDCG@5 delta: {test['ndcgPairedInterval']['mean']:.4f}"),
                (
                    "- Held-out-store AOV delta: "
                    f"₫{test['slicePairedIntervals']['held_out_store']['aov']['mean']:,.0f}"
                ),
                f"- Guardrails hold: `{test['guardrailsHold']}`",
            ]
        )
    lines.extend(
        [
            "",
            "## Evidence",
            "",
            "- `benchmark-result.json`: machine-readable metrics and content digest",
            "- `mlflow.db` and `mlartifacts/`: local experiment tracking",
            "- `explanations/`: SHAP summaries for tree rankers",
            "- `models/`: ranker, calibration, feature-schema, and provenance artifacts",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _ensure_bundles(
    profile: BenchmarkProfile,
    *,
    package_root: Path,
    repo_root: Path,
    output_dir: Path,
) -> list[BundleData]:
    base_config = json.loads(
        (package_root / "worlds/benchmark.json").read_text(encoding="utf-8")
    )
    bundles = []
    pending: list[tuple[Path, Path, Path]] = []
    for seed in profile.seeds:
        seed_dir = output_dir / "datasets" / f"seed-{seed:02d}"
        config = {
            **base_config,
            "worldId": f"kfc-smart-cross-sell-{profile.name}-seed-{seed:02d}",
            "journeyCount": profile.journey_count,
            "worldSeed": 1741 + seed * 101,
            "trafficSeed": 2897 + seed * 103,
            "loggingSeed": 3253 + seed * 107,
            "outcomeSeed": 4001 + seed * 109,
        }
        config_path = output_dir / "configs" / f"seed-{seed:02d}.json"
        _write_json(config_path, config)
        manifest_path = seed_dir / "manifest.json"
        if manifest_path.is_file():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest["configHash"] != _canonical_digest(config):
                raise ValueError(f"stale bundle config at {seed_dir}")
            audit_path = seed_dir / "audit.json"
            audit = (
                json.loads(audit_path.read_text(encoding="utf-8"))
                if audit_path.is_file()
                else {}
            )
            if (
                audit.get("status") != "pass"
                or audit.get("contentDigest") != manifest["contentDigest"]
            ):
                audit_bundle(seed_dir)
        else:
            pending.append((config_path, seed_dir, repo_root))
        bundles.append(BundleData(seed, seed_dir, profile.journey_count))
    if pending:
        for arguments in pending:
            _generate_bundle_job(arguments)
    return bundles


def _generate_bundle_job(arguments: tuple[Path, Path, Path]) -> None:
    config_path, output_dir, repo_root = arguments
    generate_bundle(
        config_path=config_path,
        output_dir=output_dir,
        repo_root=repo_root,
    )


def _concat_impressions(
    bundles: list[BundleData],
    split: str,
    *,
    tuning_sample: bool = False,
) -> pd.DataFrame:
    return pd.concat(
        [
            load_impression_rows(bundle, split=split, tuning_sample=tuning_sample)
            for bundle in bundles
        ],
        ignore_index=True,
    )


def _baseline_scores(
    frame: pd.DataFrame, name: str, weights: tuple[float, float, float]
) -> np.ndarray:
    popularity = np.log1p(
        frame["feature_store_item_order_count"].to_numpy(dtype="float64") * 2
        + frame["feature_global_item_order_count"].to_numpy(dtype="float64")
    )
    association = frame["feature_basket_association_score"].to_numpy(dtype="float64")
    promotion = frame["feature_discount_ratio"].to_numpy(dtype="float64")
    if name == "popularity":
        return popularity
    if name == "association":
        return association
    if name == "promotion":
        return promotion
    return (
        weights[0] * _zscore(popularity)
        + weights[1] * _zscore(association)
        + weights[2] * _zscore(promotion)
    )


def _zscore(values: np.ndarray) -> np.ndarray:
    scale = max(float(np.std(values)), 1e-9)
    return (values - float(np.mean(values))) / scale


def _dcg(relevances: np.ndarray) -> float:
    if len(relevances) == 0:
        return 0.0
    discounts = np.log2(np.arange(2, len(relevances) + 2))
    return float(np.sum(relevances / discounts))


def _compose_slate(group: pd.DataFrame) -> pd.DataFrame:
    ordered = group.sort_values(["score", "candidate_id"], ascending=[False, True])
    selected_indices: list[int] = []
    selected_categories: list[str] = []
    selected_product_codes: set[str] = set()
    for index, row in ordered.iterrows():
        category = str(row["category"])
        product_code = str(row["product_code"])
        if product_code in selected_product_codes:
            continue
        if selected_categories.count(category) >= 2:
            continue
        position = len(selected_indices) + 1
        if position == 4:
            if category in selected_categories or float(row["score"]) <= 0:
                continue
            if float(row["feature_price_delta_vnd"]) > max(
                float(row["feature_budget_vnd"])
                - float(row["feature_cart_subtotal_vnd"]),
                0,
            ):
                continue
        selected_indices.append(index)
        selected_categories.append(category)
        selected_product_codes.add(product_code)
        if len(selected_indices) == 4:
            break
    return group.loc[selected_indices]


def _evaluate_candidate_frame(
    frame: pd.DataFrame,
    scores: np.ndarray,
) -> tuple[dict[str, float], pd.DataFrame]:
    evaluated = frame.copy()
    evaluated["score"] = scores
    request_rows = []
    selected_ids: dict[str, set[str]] = {}
    all_selected: set[str] = set()
    category_diversities = []
    ndcgs = []
    precisions = []
    for request_id, group in evaluated.groupby("request_id", sort=False):
        slate = _compose_slate(group)
        selected_ids[request_id] = set(slate["candidate_id"].astype(str))
        all_selected.update(selected_ids[request_id])
        expected_value = 0.0
        cold_expected_value = 0.0
        for position, (_, row) in enumerate(slate.iterrows(), 1):
            values = row["expected_net_value_by_position_vnd"]
            position_value = float(values[min(position - 1, len(values) - 1)])
            expected_value += position_value
            if bool(row["cold_product"]):
                cold_expected_value += position_value
        predicted = group.sort_values(
            ["score", "candidate_id"], ascending=[False, True]
        ).head(5)
        ideal = group.sort_values(
            ["expected_net_merchandise_value_vnd", "candidate_id"],
            ascending=[False, True],
        ).head(5)
        ideal_dcg = _dcg(
            ideal["expected_net_merchandise_value_vnd"].to_numpy(dtype="float64")
        )
        ndcgs.append(
            _dcg(
                predicted["expected_net_merchandise_value_vnd"].to_numpy(
                    dtype="float64"
                )
            )
            / ideal_dcg
            if ideal_dcg > 0
            else 0.0
        )
        ideal_top3 = set(ideal.head(3)["candidate_id"].astype(str))
        precisions.append(len(set(predicted.head(3)["candidate_id"]) & ideal_top3) / 3)
        cold = group[group["cold_product"]]
        cold_predicted = cold.sort_values(
            ["score", "candidate_id"],
            ascending=[False, True],
        ).head(5)
        cold_ideal = cold.sort_values(
            ["expected_net_merchandise_value_vnd", "candidate_id"],
            ascending=[False, True],
        ).head(5)
        cold_ideal_dcg = _dcg(
            cold_ideal["expected_net_merchandise_value_vnd"].to_numpy(dtype="float64")
        )
        cold_ndcg = (
            _dcg(
                cold_predicted["expected_net_merchandise_value_vnd"].to_numpy(
                    dtype="float64"
                )
            )
            / cold_ideal_dcg
            if cold_ideal_dcg > 0
            else 0.0
        )
        cold_ideal_top3 = set(cold_ideal.head(3)["candidate_id"].astype(str))
        cold_precision = len(
            set(cold_predicted.head(3)["candidate_id"].astype(str)) & cold_ideal_top3
        ) / max(min(3, len(cold_ideal)), 1)
        category_diversities.append(slate["category"].nunique() / max(len(slate), 1))
        request_rows.append(
            {
                "request_id": request_id,
                "seed": int(group["seed"].iloc[0]),
                "expected_incremental_aov_vnd": expected_value,
                "cold_product_expected_incremental_aov_vnd": cold_expected_value,
                "slate_size": len(slate),
                "ndcg_at_5": ndcgs[-1],
                "cold_product_ndcg_at_5": cold_ndcg,
                "precision_at_3": precisions[-1],
                "cold_product_precision_at_3": cold_precision,
                "category_diversity": category_diversities[-1],
                "held_out_store": bool(group["held_out_store"].iloc[0]),
                "cold_product_available": bool(group["cold_product"].any()),
            }
        )
    requests = pd.DataFrame(request_rows)
    metrics = {
        "expected_incremental_aov_vnd": float(
            requests["expected_incremental_aov_vnd"].mean()
        ),
        "ndcg_at_5": float(requests["ndcg_at_5"].mean()),
        "precision_at_3": float(requests["precision_at_3"].mean()),
        "catalog_coverage": len(all_selected)
        / max(evaluated["candidate_id"].nunique(), 1),
        "category_diversity": float(requests["category_diversity"].mean()),
        "mean_slate_size": float(requests["slate_size"].mean()),
    }
    return metrics, requests


def _request_metrics(
    requests: pd.DataFrame,
    *,
    cold_product: bool = False,
) -> dict[str, float | int]:
    if requests.empty:
        return {
            "request_count": 0,
            "expected_incremental_aov_vnd": 0.0,
            "ndcg_at_5": 0.0,
            "precision_at_3": 0.0,
            "category_diversity": 0.0,
            "mean_slate_size": 0.0,
        }
    aov_column = (
        "cold_product_expected_incremental_aov_vnd"
        if cold_product
        else "expected_incremental_aov_vnd"
    )
    ndcg_column = "cold_product_ndcg_at_5" if cold_product else "ndcg_at_5"
    precision_column = (
        "cold_product_precision_at_3" if cold_product else "precision_at_3"
    )
    return {
        "request_count": len(requests),
        "expected_incremental_aov_vnd": float(requests[aov_column].mean()),
        "ndcg_at_5": float(requests[ndcg_column].mean()),
        "precision_at_3": float(requests[precision_column].mean()),
        "category_diversity": float(requests["category_diversity"].mean()),
    } | {"mean_slate_size": float(requests["slate_size"].mean())}


def _slice_requests(requests: pd.DataFrame, slice_name: str) -> pd.DataFrame:
    if slice_name == "main":
        mask = ~requests["held_out_store"]
    elif slice_name == "held_out_store":
        mask = requests["held_out_store"]
    elif slice_name == "cold_product":
        mask = requests["cold_product_available"]
    else:
        raise ValueError(f"unknown evaluation slice: {slice_name}")
    return requests[mask].reset_index(drop=True)


def _slice_metrics(requests: pd.DataFrame) -> dict[str, dict[str, float | int]]:
    return {
        "main": _request_metrics(_slice_requests(requests, "main")),
        "held_out_store": _request_metrics(_slice_requests(requests, "held_out_store")),
        "cold_product": _request_metrics(
            _slice_requests(requests, "cold_product"),
            cold_product=True,
        ),
    }


def _aggregate_request_metrics(
    requests: pd.DataFrame,
    *,
    selected_candidate_ids: set[str],
    eligible_candidate_ids: set[str],
) -> dict[str, float]:
    return {
        "expected_incremental_aov_vnd": float(
            requests["expected_incremental_aov_vnd"].mean()
        ),
        "ndcg_at_5": float(requests["ndcg_at_5"].mean()),
        "precision_at_3": float(requests["precision_at_3"].mean()),
        "catalog_coverage": len(selected_candidate_ids)
        / max(len(eligible_candidate_ids), 1),
        "category_diversity": float(requests["category_diversity"].mean()),
        "mean_slate_size": float(requests["slate_size"].mean()),
    }


def _candidate_shards(bundle: BundleData) -> range:
    return range(50 if bundle.journey_count >= 50_000 else 1)


def _paired_interval(
    learned: pd.DataFrame, baseline: pd.DataFrame, column: str
) -> dict[str, float]:
    learned_seed = learned.groupby("seed")[column].mean()
    baseline_seed = baseline.groupby("seed")[column].mean()
    differences = (
        learned_seed.reindex(sorted(learned_seed.index))
        - baseline_seed.reindex(sorted(baseline_seed.index))
    ).to_numpy()
    rng = np.random.default_rng(2026)
    bootstrapped = np.asarray(
        [
            float(np.mean(rng.choice(differences, len(differences), replace=True)))
            for _ in range(10_000)
        ]
    )
    return {
        "mean": float(np.mean(differences)),
        "median": float(np.median(differences)),
        "lower95": float(np.quantile(bootstrapped, 0.025)),
        "upper95": float(np.quantile(bootstrapped, 0.975)),
    }


def _logged_estimates(
    impressions: pd.DataFrame,
    selected_ids: dict[str, set[str]],
    predicted_probability: np.ndarray | None,
) -> dict[str, Any]:
    frame = impressions.copy()
    frame["target_selected"] = [
        str(candidate) in selected_ids.get(str(request), set())
        for request, candidate in zip(
            frame["request_id"], frame["candidate_id"], strict=True
        )
    ]
    results: dict[str, Any] = {}
    for cap in (5.0, 10.0, 20.0):
        raw_weight = frame["target_selected"].to_numpy(dtype="float64") / frame[
            "action_propensity"
        ].to_numpy(dtype="float64")
        weight = np.minimum(raw_weight, cap)
        denominator = float(np.sum(weight))
        snips = (
            float(np.sum(weight * frame["reward_vnd"].to_numpy()) / denominator)
            if denominator > 0
            else 0.0
        )
        ess = (
            denominator**2 / float(np.sum(weight**2))
            if float(np.sum(weight**2)) > 0
            else 0.0
        )
        entry: dict[str, float] = {"snips_vnd": snips, "effective_sample_size": ess}
        if predicted_probability is not None:
            direct = predicted_probability * frame["feature_price_delta_vnd"].to_numpy(
                dtype="float64"
            )
            correction = weight * (
                frame["reward_vnd"].to_numpy(dtype="float64") - direct
            )
            target_direct = direct * frame["target_selected"].to_numpy(dtype="float64")
            entry["doubly_robust_vnd"] = float(
                np.sum(target_direct + correction)
                / max(frame["request_id"].nunique(), 1)
            )
        results[str(int(cap))] = entry
    return results


def _tune_baseline(validation: pd.DataFrame) -> tuple[str, tuple[float, float, float]]:
    best = ("association", (0.0, 1.0, 0.0), -math.inf)
    for name in ("popularity", "association", "promotion"):
        metrics, _ = _evaluate_candidate_frame(
            validation, _baseline_scores(validation, name, best[1])
        )
        if metrics["expected_incremental_aov_vnd"] > best[2]:
            best = (name, best[1], metrics["expected_incremental_aov_vnd"])
    for popularity in (0.0, 0.25, 0.5, 0.75, 1.0):
        for association in (0.0, 0.25, 0.5, 0.75, 1.0):
            promotion = 1.0 - popularity - association
            if promotion < 0:
                continue
            weights = (popularity, association, promotion)
            metrics, _ = _evaluate_candidate_frame(
                validation, _baseline_scores(validation, "blend", weights)
            )
            if metrics["expected_incremental_aov_vnd"] > best[2]:
                best = ("blend", weights, metrics["expected_incremental_aov_vnd"])
    return best[0], best[1]


def _objective(
    model_name: str,
    trial: optuna.Trial,
    train: pd.DataFrame,
    validation: pd.DataFrame,
    schema: FeatureSchema,
    profile: BenchmarkProfile,
) -> float:
    clip = trial.suggest_categorical("propensity_clip", [5.0, 10.0, 20.0])
    if model_name == "lightgbm":
        params = {
            "n_estimators": trial.suggest_int("n_estimators", 150, 500),
            "learning_rate": trial.suggest_float("learning_rate", 0.02, 0.15, log=True),
            "num_leaves": trial.suggest_int("num_leaves", 15, 63),
            "max_depth": trial.suggest_int("max_depth", 4, 10),
            "min_child_samples": trial.suggest_int("min_child_samples", 20, 100),
            "subsample": trial.suggest_float("subsample", 0.7, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.7, 1.0),
        }
        ranker = fit_lightgbm(
            train,
            validation,
            schema=schema,
            params=params,
            propensity_clip=clip,
        )
    elif model_name == "xgboost":
        params = {
            "n_estimators": trial.suggest_int("n_estimators", 150, 500),
            "learning_rate": trial.suggest_float("learning_rate", 0.02, 0.15, log=True),
            "max_depth": trial.suggest_int("max_depth", 4, 10),
            "min_child_weight": trial.suggest_float(
                "min_child_weight", 1, 20, log=True
            ),
            "subsample": trial.suggest_float("subsample", 0.7, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.7, 1.0),
        }
        ranker = fit_xgboost(
            train,
            validation,
            schema=schema,
            params=params,
            propensity_clip=clip,
        )
    else:
        params = {
            "embedding_dimension": trial.suggest_categorical(
                "embedding_dimension", [8, 16, 24, 32]
            ),
            "learning_rate": trial.suggest_float("learning_rate", 1e-4, 3e-3, log=True),
            "dropout": trial.suggest_float("dropout", 0.0, 0.3),
            "l2": trial.suggest_float("l2", 1e-7, 1e-3, log=True),
            "batch_size": trial.suggest_categorical("batch_size", [512, 1024, 2048]),
            "epochs": profile.keras_epochs,
        }
        ranker = fit_keras(
            train,
            validation,
            schema=schema,
            params=params,
            propensity_clip=clip,
        )
    probabilities = ranker.predict_probability(validation)
    score = float(brier_score_loss(validation["success"], probabilities))
    if model_name == "keras":
        import tensorflow as tf

        tf.keras.backend.clear_session()
        gc.collect()
    return score


def _fit_candidate(
    model_name: str,
    best_params: dict[str, Any],
    train: pd.DataFrame,
    validation: pd.DataFrame,
    schema: FeatureSchema,
    profile: BenchmarkProfile,
) -> ModelCandidate:
    params = dict(best_params)
    clip = float(params.pop("propensity_clip"))
    if model_name == "lightgbm":
        ranker = fit_lightgbm(
            train, validation, schema=schema, params=params, propensity_clip=clip
        )
    elif model_name == "xgboost":
        ranker = fit_xgboost(
            train, validation, schema=schema, params=params, propensity_clip=clip
        )
    else:
        params["epochs"] = profile.keras_epochs
        ranker = fit_keras(
            train, validation, schema=schema, params=params, propensity_clip=clip
        )
    raw = ranker.predict_probability(validation)
    calibrator, calibration_metrics = select_calibrator(
        validation["success"].to_numpy(), raw
    )
    return ModelCandidate(
        model_name,
        ranker,
        calibrator,
        {**params, "propensity_clip": clip},
        calibration_metrics,
    )


def _model_metrics(
    candidate: ModelCandidate,
    bundles: list[BundleData],
    split: str,
    candidate_cache_root: Path,
) -> tuple[dict[str, Any], pd.DataFrame]:
    per_seed_metrics = {}
    request_frames = []
    logged = {}
    calibration_rows = []
    for bundle in bundles:
        shard_requests = []
        selected: dict[str, set[str]] = {}
        selected_candidate_ids: set[str] = set()
        eligible_candidate_ids: set[str] = set()
        shard_count = len(_candidate_shards(bundle))
        cache_dir = materialize_candidate_cache(
            bundle,
            split=split,
            cache_root=candidate_cache_root,
            shard_count=shard_count,
        )
        for shard in _candidate_shards(bundle):
            candidates = load_candidate_rows(
                bundle,
                split=split,
                request_shard=(shard, shard_count),
                cache_dir=cache_dir,
            )
            probabilities = candidate.probability(candidates)
            _, requests = _evaluate_candidate_frame(
                candidates,
                probabilities
                * candidates["feature_price_delta_vnd"].to_numpy(dtype="float64"),
            )
            shard_requests.append(requests)
            selection_frame = candidates.copy()
            selection_frame["score"] = probabilities * candidates[
                "feature_price_delta_vnd"
            ].to_numpy(dtype="float64")
            for request_id, group in selection_frame.groupby(
                "request_id",
                sort=False,
            ):
                slate_ids = set(_compose_slate(group)["candidate_id"].astype(str))
                selected[str(request_id)] = slate_ids
                selected_candidate_ids.update(slate_ids)
            eligible_candidate_ids.update(candidates["candidate_id"].astype(str))
            del candidates, probabilities, selection_frame
        requests = pd.concat(shard_requests, ignore_index=True)
        metrics = _aggregate_request_metrics(
            requests,
            selected_candidate_ids=selected_candidate_ids,
            eligible_candidate_ids=eligible_candidate_ids,
        )
        per_seed_metrics[str(bundle.seed)] = {
            **metrics,
            "slices": _slice_metrics(requests),
        }
        request_frames.append(requests)
        impressions = load_impression_rows(bundle, split=split)
        impression_probability = candidate.probability(impressions)
        seed_calibration = {
            "brier": float(
                brier_score_loss(impressions["success"], impression_probability)
            ),
            "ece": expected_calibration_error(
                impressions["success"].to_numpy(),
                impression_probability,
            ),
        }
        calibration_rows.append(
            pd.DataFrame(
                {
                    "success": impressions["success"].to_numpy(),
                    "probability": impression_probability,
                }
            )
        )
        per_seed_metrics[str(bundle.seed)]["calibration"] = seed_calibration
        logged[str(bundle.seed)] = _logged_estimates(
            impressions, selected, impression_probability
        )
    requests = pd.concat(request_frames, ignore_index=True)
    aggregate = {
        column: float(
            np.mean([metrics[column] for metrics in per_seed_metrics.values()])
        )
        for column in (
            "expected_incremental_aov_vnd",
            "ndcg_at_5",
            "precision_at_3",
            "catalog_coverage",
            "category_diversity",
            "mean_slate_size",
        )
    }
    calibration = pd.concat(calibration_rows, ignore_index=True)
    return {
        "aggregate": aggregate,
        "slices": _slice_metrics(requests),
        "calibration": {
            "brier": float(
                brier_score_loss(
                    calibration["success"],
                    calibration["probability"],
                )
            ),
            "ece": expected_calibration_error(
                calibration["success"].to_numpy(),
                calibration["probability"].to_numpy(),
            ),
        },
        "perSeed": per_seed_metrics,
        "loggedEstimates": logged,
    }, requests


def _baseline_metrics(
    bundles: list[BundleData],
    split: str,
    name: str,
    weights: tuple[float, float, float],
    candidate_cache_root: Path,
) -> tuple[dict[str, Any], pd.DataFrame]:
    per_seed = {}
    request_frames = []
    for bundle in bundles:
        shard_requests = []
        selected_candidate_ids: set[str] = set()
        eligible_candidate_ids: set[str] = set()
        shard_count = len(_candidate_shards(bundle))
        cache_dir = materialize_candidate_cache(
            bundle,
            split=split,
            cache_root=candidate_cache_root,
            shard_count=shard_count,
        )
        for shard in _candidate_shards(bundle):
            frame = load_candidate_rows(
                bundle,
                split=split,
                request_shard=(shard, shard_count),
                cache_dir=cache_dir,
            )
            scores = _baseline_scores(frame, name, weights)
            _, requests = _evaluate_candidate_frame(frame, scores)
            shard_requests.append(requests)
            selection_frame = frame.copy()
            selection_frame["score"] = scores
            for _, group in selection_frame.groupby("request_id", sort=False):
                selected_candidate_ids.update(
                    _compose_slate(group)["candidate_id"].astype(str)
                )
            eligible_candidate_ids.update(frame["candidate_id"].astype(str))
            del frame, scores, selection_frame
        requests = pd.concat(shard_requests, ignore_index=True)
        metrics = _aggregate_request_metrics(
            requests,
            selected_candidate_ids=selected_candidate_ids,
            eligible_candidate_ids=eligible_candidate_ids,
        )
        per_seed[str(bundle.seed)] = {
            **metrics,
            "slices": _slice_metrics(requests),
        }
        request_frames.append(requests)
    requests = pd.concat(request_frames, ignore_index=True)
    aggregate = {
        column: float(np.mean([metrics[column] for metrics in per_seed.values()]))
        for column in (
            "expected_incremental_aov_vnd",
            "ndcg_at_5",
            "precision_at_3",
            "catalog_coverage",
            "category_diversity",
            "mean_slate_size",
        )
    }
    return {
        "aggregate": aggregate,
        "slices": _slice_metrics(requests),
        "perSeed": per_seed,
    }, requests


def _write_shap_evidence(
    candidate: ModelCandidate,
    validation: pd.DataFrame,
    output_dir: Path,
) -> str | None:
    ranker: Any = candidate.ranker
    frame = validation
    if isinstance(ranker, FrozenEmbeddingRanker):
        frame = ranker.projector.transform(frame)
        ranker = ranker.ranker
    if candidate.name not in {"lightgbm", "xgboost", "lightgbm_embeddings"}:
        return None

    import matplotlib.pyplot as plt
    import shap

    sample = frame.sample(min(len(frame), 1_000), random_state=2026)
    transformed = ranker.schema.tree_frame(sample)
    if candidate.name == "xgboost":
        import xgboost as xgb

        matrix = xgb.DMatrix(transformed, enable_categorical=True)
        values = ranker.model.get_booster().predict(
            matrix,
            pred_contribs=True,
        )[:, :-1]
        shap_implementation = "xgboost_pred_contribs_treeshap"
    else:
        model = (
            ranker.booster
            if isinstance(ranker, LightGBMArtifactRanker)
            else ranker.model
        )
        explainer = shap.TreeExplainer(model)
        values = explainer.shap_values(transformed)
        if isinstance(values, list):
            values = values[-1]
        values = np.asarray(values)
        if values.ndim == 3:
            values = values[:, :, -1]
        shap_implementation = "shap_tree_explainer"
    importance = np.mean(np.abs(values), axis=0)
    rows = sorted(
        (
            {
                "feature": feature,
                "meanAbsoluteShap": float(value),
                "reasonCode": REASON_CODES.get(feature, "model_signal"),
            }
            for feature, value in zip(
                transformed.columns,
                importance,
                strict=True,
            )
        ),
        key=lambda row: row["meanAbsoluteShap"],
        reverse=True,
    )
    evidence_dir = output_dir / "explanations" / candidate.name
    evidence_dir.mkdir(parents=True, exist_ok=True)
    summary_path = evidence_dir / "shap-summary.json"
    _write_json(
        summary_path,
        {
            "schemaVersion": "smart-cross-sell-shap-summary-v1",
            "ranker": candidate.name,
            "sampleRows": len(sample),
            "implementation": shap_implementation,
            "features": rows,
        },
    )
    shap.summary_plot(
        values,
        transformed,
        plot_type="bar",
        max_display=20,
        show=False,
    )
    plt.tight_layout()
    plt.savefig(evidence_dir / "shap-summary.png", dpi=160)
    plt.close()
    return str(summary_path.relative_to(output_dir))


def _save_candidate(
    candidate: ModelCandidate,
    *,
    output_dir: Path,
    dataset_digests: dict[str, str],
) -> None:
    model_dir = output_dir / "models" / candidate.name
    candidate.ranker.save(model_dir)
    candidate.calibrator.save(model_dir / "calibrator.joblib")
    manifest = {
        "schemaVersion": "smart-cross-sell-ranker-artifact-v1",
        "ranker": candidate.name,
        "baseCommit": BASE_SHA,
        "simulatorSourceCommit": SIMULATOR_SHA,
        "featureSchema": "feature-schema.json",
        "parameters": candidate.params,
        "calibration": candidate.calibrator.kind,
        "calibrationMetrics": candidate.calibration_metrics,
        "datasetDigests": dataset_digests,
        "reasonCodeMapping": REASON_CODES,
    }
    _write_json(model_dir / "ranker-manifest.json", manifest)


def _log_saved_candidate(
    name: str,
    *,
    output_dir: Path,
    metrics: dict[str, Any],
) -> str:
    import mlflow

    model_dir = output_dir / "models" / name
    manifest = json.loads(
        (model_dir / "ranker-manifest.json").read_text(encoding="utf-8")
    )
    with mlflow.start_run(run_name=name) as run:
        mlflow.log_params(
            {
                **{
                    key: value
                    for key, value in manifest["parameters"].items()
                    if isinstance(value, (str, int, float, bool))
                },
                "calibrator": manifest["calibration"],
                "base_commit": BASE_SHA,
                "simulator_source_commit": SIMULATOR_SHA,
            }
        )
        mlflow.log_metrics(
            {
                f"validation_{key}": float(value)
                for key, value in metrics["aggregate"].items()
            }
        )
        mlflow.log_artifacts(str(model_dir), artifact_path="ranker")
        explanation_dir = output_dir / "explanations" / name
        if explanation_dir.is_dir():
            mlflow.log_artifacts(
                str(explanation_dir),
                artifact_path="explanations",
            )
        return run.info.run_id


def _implementation_digest(package_root: Path) -> str:
    paths = [
        *sorted(
            (
                package_root
                / "src"
                / "kfc_recommendation_simulator"
            ).glob("*.py")
        ),
        package_root / "worlds" / "benchmark.json",
        package_root / "pyproject.toml",
        package_root / "uv.lock",
    ]
    digest = hashlib.sha256()
    for path in paths:
        digest.update(str(path.relative_to(package_root)).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _bundle_references(
    profile: BenchmarkProfile,
    output_dir: Path,
) -> list[BundleData]:
    return [
        BundleData(
            seed=seed,
            bundle_dir=output_dir / "datasets" / f"seed-{seed:02d}",
            journey_count=profile.journey_count,
        )
        for seed in profile.seeds
    ]


def run_prepare_data_stage(
    *,
    profile_name: str,
    package_root: Path,
    repo_root: Path,
    output_dir: Path,
) -> None:
    _ensure_bundles(
        PROFILES[profile_name],
        package_root=package_root,
        repo_root=repo_root,
        output_dir=output_dir,
    )


def run_prepare_cache_stage(
    *,
    profile_name: str,
    output_dir: Path,
) -> None:
    profile = PROFILES[profile_name]
    cache_root = output_dir / "evaluation-cache"
    splits = ("validation", "test") if profile.qualification else ("validation",)
    for bundle in _bundle_references(profile, output_dir):
        shard_count = len(_candidate_shards(bundle))
        for split in splits:
            materialize_candidate_cache(
                bundle,
                split=split,
                cache_root=cache_root,
                shard_count=shard_count,
            )


def _main_training_frames(
    profile: BenchmarkProfile,
    bundles: list[BundleData],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    train = _concat_impressions(
        bundles,
        "train",
        tuning_sample=profile.qualification,
    )
    validation = _concat_impressions(
        bundles,
        "validation",
        tuning_sample=profile.qualification,
    )
    train = train[~train["held_out_store"] & ~train["cold_product"]].reset_index(
        drop=True
    )
    validation = validation[
        ~validation["held_out_store"] & ~validation["cold_product"]
    ].reset_index(drop=True)
    return train, validation


def run_tune_model_stage(
    *,
    model_name: str,
    profile_name: str,
    output_dir: Path,
) -> None:
    profile = PROFILES[profile_name]
    bundles = _bundle_references(profile, output_dir)[:3]
    train, validation = _main_training_frames(profile, bundles)
    schema = FeatureSchema.fit(train)
    trials = profile.keras_trials if model_name == "keras" else profile.tree_trials
    study = optuna.create_study(
        direction="minimize",
        sampler=optuna.samplers.TPESampler(seed=2026),
    )
    study.optimize(
        lambda trial: _objective(
            model_name,
            trial,
            train,
            validation,
            schema,
            profile,
        ),
        n_trials=trials,
    )
    _write_json(
        output_dir / "tuning" / f"{model_name}.json",
        {
            "schemaVersion": "smart-cross-sell-tuning-v1",
            "model": model_name,
            "bestParams": study.best_params,
            "bestValue": float(study.best_value),
        },
    )


def _dataset_digests(bundles: list[BundleData]) -> dict[str, str]:
    return {
        f"seed-{bundle.seed:02d}": json.loads(
            (bundle.bundle_dir / "manifest.json").read_text(encoding="utf-8")
        )["contentDigest"]
        for bundle in bundles
    }


def run_train_candidate_stage(
    *,
    candidate_name: str,
    profile_name: str,
    output_dir: Path,
) -> None:
    profile = PROFILES[profile_name]
    bundles = _bundle_references(profile, output_dir)
    train, validation = _main_training_frames(profile, bundles)
    if candidate_name == "lightgbm_embeddings":
        best_params = json.loads(
            (output_dir / "tuning" / "lightgbm.json").read_text(encoding="utf-8")
        )["bestParams"]
        projector = CatalogEmbeddingProjector.load(
            output_dir / "models" / "lightgbm_embeddings"
        )
        embedded_train = projector.transform(train)
        embedded_validation = projector.transform(validation)
        schema = FeatureSchema.fit(
            embedded_train,
            extra_numeric_features=EMBEDDING_FEATURES,
        )
        params = dict(best_params)
        clip = float(params.pop("propensity_clip"))
        tree_ranker = fit_lightgbm(
            embedded_train,
            embedded_validation,
            schema=schema,
            params=params,
            propensity_clip=clip,
        )
        ranker = FrozenEmbeddingRanker(
            "lightgbm_embeddings",
            tree_ranker,
            projector,
        )
        raw = tree_ranker.predict_probability(embedded_validation)
        calibrator, calibration_metrics = select_calibrator(
            validation["success"].to_numpy(),
            raw,
        )
        candidate = ModelCandidate(
            "lightgbm_embeddings",
            ranker,
            calibrator,
            {
                **params,
                "propensity_clip": clip,
                "embedding_model": EMBEDDING_MODEL_ID,
                "embedding_revision": EMBEDDING_MODEL_REVISION,
                "embedding_artifact": EMBEDDING_MODEL_ARTIFACT,
            },
            calibration_metrics,
        )
    else:
        best_params = json.loads(
            (output_dir / "tuning" / f"{candidate_name}.json").read_text(
                encoding="utf-8"
            )
        )["bestParams"]
        candidate = _fit_candidate(
            candidate_name,
            best_params,
            train,
            validation,
            FeatureSchema.fit(train),
            profile,
        )
    _save_candidate(
        candidate,
        output_dir=output_dir,
        dataset_digests=_dataset_digests(bundles),
    )


def run_tune_baseline_stage(
    *,
    profile_name: str,
    output_dir: Path,
) -> None:
    profile = PROFILES[profile_name]
    frames = []
    for bundle in _bundle_references(profile, output_dir)[:3]:
        cache_dir = (
            output_dir
            / "evaluation-cache"
            / f"seed-{bundle.seed:02d}"
            / "validation"
        )
        frames.append(
            load_candidate_rows(
                bundle,
                split="validation",
                tuning_sample=profile.qualification,
                cache_dir=cache_dir,
            )
        )
    name, weights = _tune_baseline(pd.concat(frames, ignore_index=True))
    _write_json(
        output_dir / "baseline.json",
        {
            "schemaVersion": "smart-cross-sell-baseline-v1",
            "name": name,
            "weights": weights,
        },
    )


def run_validation_candidate_stage(
    *,
    candidate_name: str,
    profile_name: str,
    output_dir: Path,
) -> None:
    profile = PROFILES[profile_name]
    metrics, _ = _model_metrics(
        ModelCandidate.load(output_dir, candidate_name),
        _bundle_references(profile, output_dir),
        "validation",
        output_dir / "evaluation-cache",
    )
    _write_json(output_dir / "validation" / f"{candidate_name}.json", metrics)


def run_test_stage(
    *,
    kind: str,
    profile_name: str,
    output_dir: Path,
) -> None:
    profile = PROFILES[profile_name]
    bundles = _bundle_references(profile, output_dir)
    baseline = json.loads(
        (output_dir / "baseline.json").read_text(encoding="utf-8")
    )
    if kind == "learned":
        selection = json.loads(
            (output_dir / "selection.json").read_text(encoding="utf-8")
        )
        metrics, requests = _model_metrics(
            ModelCandidate.load(output_dir, selection["learnedWinner"]),
            bundles,
            "test",
            output_dir / "evaluation-cache",
        )
    elif kind == "baseline":
        metrics, requests = _baseline_metrics(
            bundles,
            "test",
            baseline["name"],
            tuple(baseline["weights"]),
            output_dir / "evaluation-cache",
        )
    else:
        raise ValueError(f"unsupported test stage: {kind}")
    _write_json(output_dir / "test" / f"{kind}-metrics.json", metrics)
    requests_path = output_dir / "test" / f"{kind}-requests.parquet"
    requests_path.parent.mkdir(parents=True, exist_ok=True)
    requests.to_parquet(requests_path, index=False)


def run_explanation_stage(
    *,
    candidate_name: str,
    output_dir: Path,
) -> None:
    run_manifest = json.loads(
        (output_dir / "benchmark-run.json").read_text(encoding="utf-8")
    )
    profile = PROFILES[run_manifest["profile"]]
    frames = []
    for bundle in _bundle_references(profile, output_dir):
        frame = load_impression_rows(
            bundle,
            split="validation",
            tuning_sample=profile.qualification,
        )
        frame = frame[~frame["held_out_store"] & ~frame["cold_product"]]
        frames.append(
            frame.sample(
                min(len(frame), 150),
                random_state=2026 + bundle.seed,
            )
        )
    validation_sample = pd.concat(frames, ignore_index=True)
    candidate = ModelCandidate.load(output_dir, candidate_name)
    evidence = _write_shap_evidence(candidate, validation_sample, output_dir)
    if evidence is None:
        raise RuntimeError(f"no explanation produced for {candidate_name}")


def _configure_mlflow(output_dir: Path) -> tuple[Any, str]:
    import mlflow

    tracking_database = (output_dir / "mlflow.db").resolve()
    mlflow.set_tracking_uri(f"sqlite:///{tracking_database}")
    experiment_name = "kfc-smart-cross-sell-ranker"
    client = mlflow.MlflowClient()
    experiment = client.get_experiment_by_name(experiment_name)
    if experiment is None:
        experiment_id = client.create_experiment(
            experiment_name,
            artifact_location=(output_dir / "mlartifacts").resolve().as_uri(),
        )
    else:
        experiment_id = experiment.experiment_id
    mlflow.set_experiment(experiment_id=experiment_id)
    return client, str(experiment_id)


def run_logging_stage(*, output_dir: Path) -> None:
    core_result = json.loads(
        (output_dir / "benchmark-core-result.json").read_text(encoding="utf-8")
    )
    client, experiment_id = _configure_mlflow(output_dir)
    run_ids = {}
    for name, metrics in core_result["learnedValidation"].items():
        expected_aov = float(metrics["aggregate"]["expected_incremental_aov_vnd"])
        existing = client.search_runs(
            [experiment_id],
            filter_string=f"tags.mlflow.runName = '{name}'",
            order_by=["start_time DESC"],
        )
        matching = next(
            (
                run
                for run in existing
                if run.info.status == "FINISHED"
                and math.isclose(
                    float(
                        run.data.metrics.get(
                            "validation_expected_incremental_aov_vnd",
                            math.nan,
                        )
                    ),
                    expected_aov,
                    rel_tol=0,
                    abs_tol=1e-6,
                )
            ),
            None,
        )
        run_ids[name] = (
            matching.info.run_id
            if matching is not None
            else _log_saved_candidate(
                name,
                output_dir=output_dir,
                metrics=metrics,
            )
        )
    _write_json(output_dir / "mlflow-runs.json", run_ids)


def _assemble_core_result(
    *,
    profile: BenchmarkProfile,
    output_dir: Path,
) -> dict[str, Any]:
    bundles = _bundle_references(profile, output_dir)
    candidate_names = ("lightgbm", "xgboost", "keras", "lightgbm_embeddings")
    validation_results = {
        name: json.loads(
            (output_dir / "validation" / f"{name}.json").read_text(encoding="utf-8")
        )
        for name in candidate_names
    }
    winner_name = max(
        candidate_names,
        key=lambda name: (
            validation_results[name]["aggregate"]["expected_incremental_aov_vnd"],
            validation_results[name]["aggregate"]["ndcg_at_5"],
        ),
    )
    _write_json(
        output_dir / "selection.json",
        {
            "schemaVersion": "smart-cross-sell-selection-v1",
            "learnedWinner": winner_name,
        },
    )
    baseline = json.loads(
        (output_dir / "baseline.json").read_text(encoding="utf-8")
    )
    result: dict[str, Any] = {
        "schemaVersion": "smart-cross-sell-benchmark-v1",
        "profile": profile.name,
        "qualification": profile.qualification,
        "baseCommit": BASE_SHA,
        "simulatorSourceCommit": SIMULATOR_SHA,
        "datasetDigests": _dataset_digests(bundles),
        "featureSchema": "smart-cross-sell-feature-schema-v1",
        "baseline": {
            "name": baseline["name"],
            "weights": baseline["weights"],
        },
        "learnedValidation": validation_results,
        "learnedWinner": winner_name,
        "embeddingAblation": {
            "modelId": EMBEDDING_MODEL_ID,
            "revision": EMBEDDING_MODEL_REVISION,
            "artifact": EMBEDDING_MODEL_ARTIFACT,
            "ranker": "lightgbm_embeddings",
        },
        "explanations": {},
        "mlflowRunIds": {},
    }
    if profile.qualification:
        learned_test = json.loads(
            (output_dir / "test" / "learned-metrics.json").read_text(
                encoding="utf-8"
            )
        )
        baseline_test = json.loads(
            (output_dir / "test" / "baseline-metrics.json").read_text(
                encoding="utf-8"
            )
        )
        learned_requests = pd.read_parquet(
            output_dir / "test" / "learned-requests.parquet"
        )
        baseline_requests = pd.read_parquet(
            output_dir / "test" / "baseline-requests.parquet"
        )
        aov_interval = _paired_interval(
            learned_requests,
            baseline_requests,
            "expected_incremental_aov_vnd",
        )
        ndcg_interval = _paired_interval(
            learned_requests,
            baseline_requests,
            "ndcg_at_5",
        )
        slice_intervals = {}
        for slice_name in ("main", "held_out_store", "cold_product"):
            aov_column = (
                "cold_product_expected_incremental_aov_vnd"
                if slice_name == "cold_product"
                else "expected_incremental_aov_vnd"
            )
            ndcg_column = (
                "cold_product_ndcg_at_5"
                if slice_name == "cold_product"
                else "ndcg_at_5"
            )
            slice_intervals[slice_name] = {
                "aov": _paired_interval(
                    _slice_requests(learned_requests, slice_name),
                    _slice_requests(baseline_requests, slice_name),
                    aov_column,
                ),
                "ndcg": _paired_interval(
                    _slice_requests(learned_requests, slice_name),
                    _slice_requests(baseline_requests, slice_name),
                    ndcg_column,
                ),
            }
        eligibility_violations = 0
        guardrails_hold = (
            learned_test["aggregate"]["catalog_coverage"]
            >= baseline_test["aggregate"]["catalog_coverage"] * 0.95
            and learned_test["aggregate"]["category_diversity"]
            >= baseline_test["aggregate"]["category_diversity"] * 0.95
            and 3 <= learned_test["aggregate"]["mean_slate_size"] <= 4
            and eligibility_violations == 0
        )
        promote = (
            aov_interval["lower95"] > 0
            and ndcg_interval["mean"] > 0
            and slice_intervals["held_out_store"]["aov"]["mean"] > 0
            and guardrails_hold
        )
        result["untouchedTest"] = {
            "learned": learned_test,
            "baseline": baseline_test,
            "aovPairedInterval": aov_interval,
            "ndcgPairedInterval": ndcg_interval,
            "slicePairedIntervals": slice_intervals,
            "eligibilityViolations": eligibility_violations,
            "guardrailsHold": guardrails_hold,
        }
        result["selectedRanker"] = winner_name if promote else baseline["name"]
        result["promotionDecision"] = (
            "promote_learned" if promote else "retain_baseline"
        )
    else:
        result["selectedRanker"] = "development_only"
        result["promotionDecision"] = "qualification_required"
    result["contentDigest"] = _canonical_digest(result)
    _write_json(output_dir / "benchmark-core-result.json", result)
    return result


def _finalize_benchmark(output_dir: Path) -> dict[str, Any]:
    result = json.loads(
        (output_dir / "benchmark-core-result.json").read_text(encoding="utf-8")
    )
    result["explanations"] = {
        name: str(path.relative_to(output_dir))
        for name in ("lightgbm", "xgboost", "lightgbm_embeddings")
        if (
            path := output_dir / "explanations" / name / "shap-summary.json"
        ).is_file()
    }
    result["mlflowRunIds"] = json.loads(
        (output_dir / "mlflow-runs.json").read_text(encoding="utf-8")
    )
    result["resourceIsolation"] = {
        "executionMode": "restartable_subprocess_stages",
        "heavyStageConcurrency": 1,
        "nativeThreadLimit": 1,
        "candidateCache": "partitioned_parquet",
    }
    result.pop("contentDigest", None)
    result["contentDigest"] = _canonical_digest(result)
    _write_json(output_dir / "benchmark-result.json", result)
    _write_report(output_dir / "benchmark-report.md", result)
    return result


def run_benchmark(
    *,
    profile_name: str,
    package_root: Path,
    repo_root: Path,
    output_dir: Path,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    input_digest = _canonical_digest(
        {
            "stageContract": "isolated-smart-cross-sell-benchmark-v1",
            "profile": profile_name,
            "baseCommit": BASE_SHA,
            "simulatorSourceCommit": SIMULATOR_SHA,
            "implementationDigest": _implementation_digest(package_root),
        }
    )
    _write_json(
        output_dir / "benchmark-run.json",
        {
            "schemaVersion": "isolated-smart-cross-sell-benchmark-run-v1",
            "profile": profile_name,
            "packageRoot": str(package_root.resolve()),
            "repoRoot": str(repo_root.resolve()),
            "inputDigest": input_digest,
        },
    )
    stage_dir = output_dir / ".stages"
    profile = PROFILES[profile_name]
    dataset_artifacts = tuple(
        path
        for seed in profile.seeds
        for path in (
            output_dir / "datasets" / f"seed-{seed:02d}" / "manifest.json",
            output_dir / "datasets" / f"seed-{seed:02d}" / "audit.json",
        )
    )
    cache_splits = ("validation", "test") if profile.qualification else ("validation",)
    cache_artifacts = tuple(
        output_dir
        / "evaluation-cache"
        / f"seed-{seed:02d}"
        / split
        / "_complete.json"
        for seed in profile.seeds
        for split in cache_splits
    )
    for prerequisite in PRE_MODEL_STAGE_SEQUENCE:
        run_isolated_stage(
            IsolatedStage(
                prerequisite,
                input_digest,
                stage_dir / f"{prerequisite}.json",
                dataset_artifacts
                if prerequisite == "prepare-data"
                else cache_artifacts,
            ),
            output_dir=output_dir,
        )
    for model_name in ("lightgbm", "xgboost", "keras"):
        run_isolated_stage(
            IsolatedStage(
                f"tune-{model_name}",
                input_digest,
                stage_dir / f"tune-{model_name}.json",
                (output_dir / "tuning" / f"{model_name}.json",),
            ),
            output_dir=output_dir,
        )
    run_isolated_stage(
        IsolatedStage(
            "fit-embeddings",
            input_digest,
            stage_dir / "fit-embeddings.json",
            (
                output_dir
                / "models"
                / "lightgbm_embeddings"
                / "catalog-embedding-projector.joblib",
            ),
            "kfc_recommendation_simulator.embedding_worker",
        ),
        output_dir=output_dir,
    )
    for candidate_name in (
        "lightgbm",
        "xgboost",
        "keras",
        "lightgbm_embeddings",
    ):
        run_isolated_stage(
            IsolatedStage(
                f"train-{candidate_name}",
                input_digest,
                stage_dir / f"train-{candidate_name}.json",
                (
                    output_dir
                    / "models"
                    / candidate_name
                    / "ranker-manifest.json",
                ),
            ),
            output_dir=output_dir,
        )
    run_isolated_stage(
        IsolatedStage(
            "tune-baseline",
            input_digest,
            stage_dir / "tune-baseline.json",
            (output_dir / "baseline.json",),
        ),
        output_dir=output_dir,
    )
    for candidate_name in (
        "lightgbm",
        "xgboost",
        "keras",
        "lightgbm_embeddings",
    ):
        run_isolated_stage(
            IsolatedStage(
                f"validate-{candidate_name}",
                input_digest,
                stage_dir / f"validate-{candidate_name}.json",
                (output_dir / "validation" / f"{candidate_name}.json",),
            ),
            output_dir=output_dir,
        )
    validation_results = {
        name: json.loads(
            (output_dir / "validation" / f"{name}.json").read_text(encoding="utf-8")
        )
        for name in ("lightgbm", "xgboost", "keras", "lightgbm_embeddings")
    }
    winner_name = max(
        validation_results,
        key=lambda name: (
            validation_results[name]["aggregate"]["expected_incremental_aov_vnd"],
            validation_results[name]["aggregate"]["ndcg_at_5"],
        ),
    )
    _write_json(
        output_dir / "selection.json",
        {
            "schemaVersion": "smart-cross-sell-selection-v1",
            "learnedWinner": winner_name,
        },
    )
    if profile.qualification:
        test_digest = _canonical_digest(
            {"inputDigest": input_digest, "learnedWinner": winner_name}
        )
        for kind in ("learned", "baseline"):
            run_isolated_stage(
                IsolatedStage(
                    f"test-{kind}",
                    test_digest,
                    stage_dir / f"test-{kind}.json",
                    (
                        output_dir / "test" / f"{kind}-metrics.json",
                        output_dir / "test" / f"{kind}-requests.parquet",
                    ),
                ),
                output_dir=output_dir,
            )
    core_result = _assemble_core_result(profile=profile, output_dir=output_dir)
    postprocess_digest = _canonical_digest(
        {
            "inputDigest": input_digest,
            "coreResult": core_result["contentDigest"],
        }
    )
    for name in ("lightgbm", "xgboost", "lightgbm_embeddings"):
        run_isolated_stage(
            IsolatedStage(
                f"explain-{name}",
                postprocess_digest,
                stage_dir / f"explain-{name}.json",
                (
                    output_dir
                    / "explanations"
                    / name
                    / "shap-summary.json",
                ),
            ),
            output_dir=output_dir,
        )
    explanation_digests = {
        name: hashlib.sha256(
            (
                output_dir / "explanations" / name / "shap-summary.json"
            ).read_bytes()
        ).hexdigest()
        for name in ("lightgbm", "xgboost", "lightgbm_embeddings")
    }
    run_isolated_stage(
        IsolatedStage(
            "log-candidates",
            _canonical_digest(
                {
                    "postprocessDigest": postprocess_digest,
                    "explanations": explanation_digests,
                }
            ),
            stage_dir / "log-candidates.json",
            (output_dir / "mlflow-runs.json",),
        ),
        output_dir=output_dir,
    )
    return _finalize_benchmark(output_dir)
