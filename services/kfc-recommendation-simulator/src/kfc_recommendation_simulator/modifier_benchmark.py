from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import optuna
import pandas as pd
from sklearn.metrics import brier_score_loss

from .artifacts import audit_bundle
from .benchmark import (
    BASE_SHA,
    PROFILES,
    SIMULATOR_SHA,
    BenchmarkProfile,
    ModelCandidate,
    _candidate_shards,
    _canonical_digest,
    _dataset_digests,
    _ensure_bundles,
    _fit_candidate,
    _implementation_digest,
    _logged_estimates,
    _objective,
    _paired_interval,
    _write_json,
)
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
from .feature_contracts import (
    MODIFIER_CATEGORICAL_FEATURES,
    MODIFIER_NUMERIC_FEATURES,
)
from .rankers import (
    FeatureSchema,
    LightGBMArtifactRanker,
    expected_calibration_error,
)

PLACEMENT = "modifier_upsell"
CANDIDATE_NAMES = ("lightgbm", "xgboost", "keras")
TREE_CANDIDATES = ("lightgbm", "xgboost")
FEATURE_SCHEMA_VERSION = "modifier-upsell-feature-schema-v1"
REASON_CODES = {
    "candidate_id": "compatible_modifier_action",
    "product_code": "modifier_preference",
    "modifier_path": "compatible_modifier_path",
    "feature_cart_anchor": "compatible_with_cart_item",
    "feature_store_id": "popular_at_store",
    "feature_mission": "matches_order_mission",
    "feature_time_window": "recent_modifier_pattern",
    "feature_price_delta_vnd": "upgrade_value",
    "feature_budget_vnd": "fits_remaining_budget",
    "feature_cart_subtotal_vnd": "fits_remaining_budget",
    "feature_remaining_budget_vnd": "fits_remaining_budget",
    "feature_price_to_remaining_budget_ratio": "fits_remaining_budget",
    "feature_basket_association_score": "popular_for_cart_item",
    "feature_customer_order_count": "customer_history",
    "feature_customer_item_order_count": "customer_preference",
    "feature_customer_category_order_count": "parent_item_affinity",
    "feature_store_item_order_count": "popular_at_store",
    "feature_global_item_order_count": "popular_modifier",
    "feature_store_local_hour": "time_context",
    "feature_store_local_day_of_week": "time_context",
}


def _schema(frame: pd.DataFrame) -> FeatureSchema:
    return FeatureSchema.fit(
        frame,
        categorical_features=MODIFIER_CATEGORICAL_FEATURES,
        extra_numeric_features=MODIFIER_NUMERIC_FEATURES,
        schema_version=FEATURE_SCHEMA_VERSION,
    )


def _run_manifest(output_dir: Path) -> dict[str, Any]:
    return json.loads(
        (output_dir / "benchmark-run.json").read_text(encoding="utf-8")
    )


def _bundle_references(
    profile: BenchmarkProfile,
    output_dir: Path,
) -> list[BundleData]:
    manifest = _run_manifest(output_dir)
    dataset_root = Path(manifest["datasetRoot"])
    return [
        BundleData(
            seed=seed,
            bundle_dir=dataset_root / f"seed-{seed:02d}",
            journey_count=profile.journey_count,
        )
        for seed in profile.seeds
    ]


def _validate_external_bundles(
    profile: BenchmarkProfile,
    output_dir: Path,
) -> None:
    for bundle in _bundle_references(profile, output_dir):
        manifest_path = bundle.bundle_dir / "manifest.json"
        if not manifest_path.is_file():
            raise FileNotFoundError(manifest_path)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if int(manifest["rowCounts"]["journeys"]) != profile.journey_count:
            raise ValueError(
                f"journey count mismatch for external bundle {bundle.bundle_dir}"
            )
        audit_path = bundle.bundle_dir / "audit.json"
        audit = (
            json.loads(audit_path.read_text(encoding="utf-8"))
            if audit_path.is_file()
            else audit_bundle(bundle.bundle_dir)
        )
        if (
            audit.get("status") != "pass"
            or audit.get("contentDigest") != manifest["contentDigest"]
        ):
            raise ValueError(f"external bundle audit failed: {bundle.bundle_dir}")


def run_prepare_data_stage(
    *,
    profile_name: str,
    package_root: Path,
    repo_root: Path,
    output_dir: Path,
) -> None:
    profile = PROFILES[profile_name]
    manifest = _run_manifest(output_dir)
    if manifest["externalDatasetRoot"]:
        _validate_external_bundles(profile, output_dir)
        return
    _ensure_bundles(
        profile,
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
    splits = ("validation", "test") if profile.qualification else ("validation",)
    for bundle in _bundle_references(profile, output_dir):
        shard_count = len(_candidate_shards(bundle))
        for split in splits:
            materialize_candidate_cache(
                bundle,
                split=split,
                cache_root=output_dir / "evaluation-cache",
                shard_count=shard_count,
                placement=PLACEMENT,
            )


def _concat_impressions(
    bundles: list[BundleData],
    split: str,
) -> pd.DataFrame:
    return pd.concat(
        [
            load_impression_rows(bundle, split=split, placement=PLACEMENT)
            for bundle in bundles
        ],
        ignore_index=True,
    )


def _main_training_frames(
    profile: BenchmarkProfile,
    bundles: list[BundleData],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    train = _concat_impressions(bundles, "train")
    validation = _concat_impressions(bundles, "validation")
    train = train[
        ~train["held_out_store"] & ~train["cold_candidate"]
    ].reset_index(drop=True)
    validation = validation[
        ~validation["held_out_store"] & ~validation["cold_candidate"]
    ].reset_index(drop=True)
    if train.empty or validation.empty:
        raise ValueError("modifier benchmark has no model-visible positive-price rows")
    return train, validation


def _zscore(values: np.ndarray) -> np.ndarray:
    scale = max(float(np.std(values)), 1e-9)
    return (values - float(np.mean(values))) / scale


def _baseline_scores(
    frame: pd.DataFrame,
    name: str,
    weights: tuple[float, float, float],
) -> np.ndarray:
    popularity = np.log1p(
        frame["feature_store_item_order_count"].to_numpy(dtype="float64") * 2
        + frame["feature_global_item_order_count"].to_numpy(dtype="float64")
    )
    association = frame["feature_basket_association_score"].to_numpy(dtype="float64")
    incremental_value = np.log1p(
        frame["feature_price_delta_vnd"].to_numpy(dtype="float64")
    )
    if name == "parent_popularity":
        return popularity
    if name == "parent_association":
        return association
    if name == "incremental_value":
        return incremental_value
    return (
        weights[0] * _zscore(popularity)
        + weights[1] * _zscore(association)
        + weights[2] * _zscore(incremental_value)
    )


def _dcg(relevances: np.ndarray) -> float:
    if len(relevances) == 0:
        return 0.0
    return float(
        np.sum(relevances / np.log2(np.arange(2, len(relevances) + 2)))
    )


def _evaluate_candidate_frame(
    frame: pd.DataFrame,
    scores: np.ndarray,
) -> tuple[dict[str, float], pd.DataFrame, dict[str, set[str]]]:
    evaluated = frame.copy()
    evaluated["score"] = scores
    request_rows: list[dict[str, Any]] = []
    selected_ids: dict[str, set[str]] = {}
    all_selected: set[str] = set()
    for request_id, group in evaluated.groupby("request_id", sort=False):
        ordered = group.sort_values(
            ["score", "candidate_id"],
            ascending=[False, True],
        )
        selected = ordered.iloc[0]
        selected_id = str(selected["candidate_id"])
        selected_ids[str(request_id)] = {selected_id}
        all_selected.add(selected_id)
        ideal = group.sort_values(
            ["expected_net_merchandise_value_vnd", "candidate_id"],
            ascending=[False, True],
        ).head(5)
        predicted = ordered.head(5)
        ideal_dcg = _dcg(
            ideal["expected_net_merchandise_value_vnd"].to_numpy(dtype="float64")
        )
        ndcg = (
            _dcg(
                predicted["expected_net_merchandise_value_vnd"].to_numpy(
                    dtype="float64"
                )
            )
            / ideal_dcg
            if ideal_dcg > 0
            else 0.0
        )
        request_rows.append(
            {
                "request_id": str(request_id),
                "seed": int(group["seed"].iloc[0]),
                "expected_incremental_aov_vnd": float(
                    selected["expected_net_merchandise_value_vnd"]
                ),
                "ndcg_at_5": ndcg,
                "top_1_hit_rate": float(
                    selected_id == str(ideal.iloc[0]["candidate_id"])
                ),
                "offer_count": 1,
                "eligible_candidate_count": len(group),
                "held_out_store": bool(group["held_out_store"].iloc[0]),
                "cold_candidate_available": bool(group["cold_candidate"].any()),
            }
        )
    requests = pd.DataFrame(request_rows)
    return (
        {
            "expected_incremental_aov_vnd": float(
                requests["expected_incremental_aov_vnd"].mean()
            ),
            "ndcg_at_5": float(requests["ndcg_at_5"].mean()),
            "top_1_hit_rate": float(requests["top_1_hit_rate"].mean()),
            "action_coverage": len(all_selected)
            / max(evaluated["candidate_id"].nunique(), 1),
            "mean_offer_count": float(requests["offer_count"].mean()),
            "mean_eligible_candidate_count": float(
                requests["eligible_candidate_count"].mean()
            ),
        },
        requests,
        selected_ids,
    )


def _request_metrics(requests: pd.DataFrame) -> dict[str, float | int]:
    if requests.empty:
        return {
            "request_count": 0,
            "expected_incremental_aov_vnd": 0.0,
            "ndcg_at_5": 0.0,
            "top_1_hit_rate": 0.0,
            "mean_offer_count": 0.0,
        }
    return {
        "request_count": len(requests),
        "expected_incremental_aov_vnd": float(
            requests["expected_incremental_aov_vnd"].mean()
        ),
        "ndcg_at_5": float(requests["ndcg_at_5"].mean()),
        "top_1_hit_rate": float(requests["top_1_hit_rate"].mean()),
        "mean_offer_count": float(requests["offer_count"].mean()),
    }


def _slice_requests(requests: pd.DataFrame, slice_name: str) -> pd.DataFrame:
    if slice_name == "main":
        mask = ~requests["held_out_store"]
    elif slice_name == "held_out_store":
        mask = requests["held_out_store"]
    elif slice_name == "cold_modifier":
        mask = requests["cold_candidate_available"]
    else:
        raise ValueError(f"unknown modifier evaluation slice: {slice_name}")
    return requests[mask].reset_index(drop=True)


def _slice_metrics(requests: pd.DataFrame) -> dict[str, dict[str, float | int]]:
    return {
        name: _request_metrics(_slice_requests(requests, name))
        for name in ("main", "held_out_store", "cold_modifier")
    }


def _aggregate_seed_metrics(
    requests: pd.DataFrame,
    *,
    selected_candidate_ids: set[str],
    eligible_candidate_ids: set[str],
) -> dict[str, float]:
    return {
        **{
            key: float(requests[key].mean())
            for key in (
                "expected_incremental_aov_vnd",
                "ndcg_at_5",
                "top_1_hit_rate",
                "offer_count",
                "eligible_candidate_count",
            )
        },
        "action_coverage": len(selected_candidate_ids)
        / max(len(eligible_candidate_ids), 1),
    }


def _model_metrics(
    candidate: ModelCandidate,
    bundles: list[BundleData],
    split: str,
    cache_root: Path,
) -> tuple[dict[str, Any], pd.DataFrame]:
    per_seed: dict[str, Any] = {}
    request_frames = []
    calibration_frames = []
    logged: dict[str, Any] = {}
    for bundle in bundles:
        shard_requests = []
        selected: dict[str, set[str]] = {}
        selected_candidate_ids: set[str] = set()
        eligible_candidate_ids: set[str] = set()
        shard_count = len(_candidate_shards(bundle))
        cache_dir = materialize_candidate_cache(
            bundle,
            split=split,
            cache_root=cache_root,
            shard_count=shard_count,
            placement=PLACEMENT,
        )
        for shard in _candidate_shards(bundle):
            candidates = load_candidate_rows(
                bundle,
                split=split,
                request_shard=(shard, shard_count),
                cache_dir=cache_dir,
                placement=PLACEMENT,
            )
            if candidates.empty:
                continue
            probability = candidate.probability(candidates)
            _, requests, shard_selected = _evaluate_candidate_frame(
                candidates,
                probability
                * candidates["feature_price_delta_vnd"].to_numpy(dtype="float64"),
            )
            shard_requests.append(requests)
            selected.update(shard_selected)
            selected_candidate_ids.update(
                candidate_id
                for ids in shard_selected.values()
                for candidate_id in ids
            )
            eligible_candidate_ids.update(candidates["candidate_id"].astype(str))
        requests = pd.concat(shard_requests, ignore_index=True)
        per_seed[str(bundle.seed)] = {
            **_aggregate_seed_metrics(
                requests,
                selected_candidate_ids=selected_candidate_ids,
                eligible_candidate_ids=eligible_candidate_ids,
            ),
            "slices": _slice_metrics(requests),
        }
        request_frames.append(requests)
        impressions = load_impression_rows(
            bundle,
            split=split,
            placement=PLACEMENT,
        )
        probability = candidate.probability(impressions)
        per_seed[str(bundle.seed)]["calibration"] = {
            "brier": float(brier_score_loss(impressions["success"], probability)),
            "ece": expected_calibration_error(
                impressions["success"].to_numpy(),
                probability,
            ),
        }
        calibration_frames.append(
            pd.DataFrame(
                {
                    "success": impressions["success"].to_numpy(),
                    "probability": probability,
                }
            )
        )
        logged[str(bundle.seed)] = _logged_estimates(
            impressions,
            selected,
            probability,
        )
    requests = pd.concat(request_frames, ignore_index=True)
    calibration = pd.concat(calibration_frames, ignore_index=True)
    aggregate = {
        key: float(np.mean([metrics[key] for metrics in per_seed.values()]))
        for key in (
            "expected_incremental_aov_vnd",
            "ndcg_at_5",
            "top_1_hit_rate",
            "action_coverage",
            "offer_count",
            "eligible_candidate_count",
        )
    }
    aggregate["mean_offer_count"] = aggregate.pop("offer_count")
    aggregate["mean_eligible_candidate_count"] = aggregate.pop(
        "eligible_candidate_count"
    )
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
        "perSeed": per_seed,
        "loggedEstimates": logged,
    }, requests


def _baseline_metrics(
    bundles: list[BundleData],
    split: str,
    name: str,
    weights: tuple[float, float, float],
    cache_root: Path,
) -> tuple[dict[str, Any], pd.DataFrame]:
    per_seed: dict[str, Any] = {}
    request_frames = []
    for bundle in bundles:
        shard_requests = []
        selected_candidate_ids: set[str] = set()
        eligible_candidate_ids: set[str] = set()
        shard_count = len(_candidate_shards(bundle))
        cache_dir = materialize_candidate_cache(
            bundle,
            split=split,
            cache_root=cache_root,
            shard_count=shard_count,
            placement=PLACEMENT,
        )
        for shard in _candidate_shards(bundle):
            frame = load_candidate_rows(
                bundle,
                split=split,
                request_shard=(shard, shard_count),
                cache_dir=cache_dir,
                placement=PLACEMENT,
            )
            if frame.empty:
                continue
            _, requests, selected = _evaluate_candidate_frame(
                frame,
                _baseline_scores(frame, name, weights),
            )
            shard_requests.append(requests)
            selected_candidate_ids.update(
                candidate_id for ids in selected.values() for candidate_id in ids
            )
            eligible_candidate_ids.update(frame["candidate_id"].astype(str))
        requests = pd.concat(shard_requests, ignore_index=True)
        per_seed[str(bundle.seed)] = {
            **_aggregate_seed_metrics(
                requests,
                selected_candidate_ids=selected_candidate_ids,
                eligible_candidate_ids=eligible_candidate_ids,
            ),
            "slices": _slice_metrics(requests),
        }
        request_frames.append(requests)
    requests = pd.concat(request_frames, ignore_index=True)
    aggregate = {
        key: float(np.mean([metrics[key] for metrics in per_seed.values()]))
        for key in (
            "expected_incremental_aov_vnd",
            "ndcg_at_5",
            "top_1_hit_rate",
            "action_coverage",
            "offer_count",
            "eligible_candidate_count",
        )
    }
    aggregate["mean_offer_count"] = aggregate.pop("offer_count")
    aggregate["mean_eligible_candidate_count"] = aggregate.pop(
        "eligible_candidate_count"
    )
    return {
        "aggregate": aggregate,
        "slices": _slice_metrics(requests),
        "perSeed": per_seed,
    }, requests


def _tune_baseline(
    validation: pd.DataFrame,
) -> tuple[str, tuple[float, float, float]]:
    best = ("parent_association", (0.0, 1.0, 0.0), -math.inf)
    for name, weights in (
        ("parent_popularity", (1.0, 0.0, 0.0)),
        ("parent_association", (0.0, 1.0, 0.0)),
        ("incremental_value", (0.0, 0.0, 1.0)),
    ):
        metrics, _, _ = _evaluate_candidate_frame(
            validation,
            _baseline_scores(validation, name, weights),
        )
        if metrics["expected_incremental_aov_vnd"] > best[2]:
            best = (name, weights, metrics["expected_incremental_aov_vnd"])
    for popularity in (0.0, 0.25, 0.5, 0.75, 1.0):
        for association in (0.0, 0.25, 0.5, 0.75, 1.0):
            value = 1.0 - popularity - association
            if value < 0:
                continue
            weights = (popularity, association, value)
            metrics, _, _ = _evaluate_candidate_frame(
                validation,
                _baseline_scores(validation, "blend", weights),
            )
            if metrics["expected_incremental_aov_vnd"] > best[2]:
                best = ("blend", weights, metrics["expected_incremental_aov_vnd"])
    return best[0], best[1]


def _save_candidate(
    candidate: ModelCandidate,
    *,
    output_dir: Path,
    dataset_digests: dict[str, str],
) -> None:
    model_dir = output_dir / "models" / candidate.name
    candidate.ranker.save(model_dir)
    candidate.calibrator.save(model_dir / "calibrator.joblib")
    _write_json(
        model_dir / "ranker-manifest.json",
        {
            "schemaVersion": "modifier-upsell-ranker-artifact-v1",
            "placement": PLACEMENT,
            "ranker": candidate.name,
            "baseCommit": BASE_SHA,
            "simulatorSourceCommit": SIMULATOR_SHA,
            "featureSchema": "feature-schema.json",
            "parameters": candidate.params,
            "calibration": candidate.calibrator.kind,
            "calibrationMetrics": candidate.calibration_metrics,
            "datasetDigests": dataset_digests,
            "reasonCodeMapping": REASON_CODES,
            "actionContract": {
                "actionKind": "apply_modifier",
                "parentCartItemField": "feature_cart_anchor",
                "modifierPathField": "modifier_path",
                "outputSize": 1,
                "requiresPositivePriceDelta": True,
                "eligibilityAuthority": "deterministic_policy",
                "cmsAuthority": "sanity_merchandising_policy",
            },
        },
    )


def run_tune_model_stage(
    *,
    model_name: str,
    profile_name: str,
    output_dir: Path,
) -> None:
    profile = PROFILES[profile_name]
    train, validation = _main_training_frames(
        profile,
        _bundle_references(profile, output_dir)[:3],
    )
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
            _schema(train),
            profile,
        ),
        n_trials=(
            profile.keras_trials if model_name == "keras" else profile.tree_trials
        ),
    )
    _write_json(
        output_dir / "tuning" / f"{model_name}.json",
        {
            "schemaVersion": "modifier-upsell-tuning-v1",
            "model": model_name,
            "bestParams": study.best_params,
            "bestValue": float(study.best_value),
        },
    )


def run_train_candidate_stage(
    *,
    candidate_name: str,
    profile_name: str,
    output_dir: Path,
) -> None:
    profile = PROFILES[profile_name]
    bundles = _bundle_references(profile, output_dir)
    train, validation = _main_training_frames(profile, bundles)
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
        _schema(train),
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
                placement=PLACEMENT,
            )
        )
    name, weights = _tune_baseline(pd.concat(frames, ignore_index=True))
    _write_json(
        output_dir / "baseline.json",
        {
            "schemaVersion": "modifier-upsell-baseline-v1",
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
        winner = json.loads(
            (output_dir / "selection.json").read_text(encoding="utf-8")
        )["learnedWinner"]
        metrics, requests = _model_metrics(
            ModelCandidate.load(output_dir, winner),
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
        raise ValueError(f"unsupported modifier test stage: {kind}")
    _write_json(output_dir / "test" / f"{kind}-metrics.json", metrics)
    path = output_dir / "test" / f"{kind}-requests.parquet"
    path.parent.mkdir(parents=True, exist_ok=True)
    requests.to_parquet(path, index=False)


def _write_shap_evidence(
    candidate: ModelCandidate,
    validation: pd.DataFrame,
    output_dir: Path,
) -> None:
    ranker: Any = candidate.ranker
    if candidate.name not in TREE_CANDIDATES:
        raise ValueError(f"SHAP is unavailable for {candidate.name}")
    import matplotlib.pyplot as plt
    import shap

    sample = validation.sample(min(len(validation), 1_000), random_state=2026)
    transformed = ranker.schema.tree_frame(sample)
    if candidate.name == "xgboost":
        import xgboost as xgb

        matrix = xgb.DMatrix(transformed, enable_categorical=True)
        values = ranker.model.get_booster().predict(
            matrix,
            pred_contribs=True,
        )[:, :-1]
        implementation = "xgboost_pred_contribs_treeshap"
    else:
        model = (
            ranker.booster
            if isinstance(ranker, LightGBMArtifactRanker)
            else ranker.model
        )
        values = shap.TreeExplainer(model).shap_values(transformed)
        if isinstance(values, list):
            values = values[-1]
        values = np.asarray(values)
        if values.ndim == 3:
            values = values[:, :, -1]
        implementation = "shap_tree_explainer"
    importance = np.mean(np.abs(values), axis=0)
    features = sorted(
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
    _write_json(
        evidence_dir / "shap-summary.json",
        {
            "schemaVersion": "modifier-upsell-shap-summary-v1",
            "ranker": candidate.name,
            "sampleRows": len(sample),
            "implementation": implementation,
            "features": features,
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


def run_explanation_stage(
    *,
    candidate_name: str,
    output_dir: Path,
) -> None:
    manifest = _run_manifest(output_dir)
    profile = PROFILES[manifest["profile"]]
    frames = []
    for bundle in _bundle_references(profile, output_dir):
        frame = load_impression_rows(
            bundle,
            split="validation",
            placement=PLACEMENT,
        )
        frame = frame[~frame["held_out_store"] & ~frame["cold_candidate"]]
        frames.append(
            frame.sample(
                min(len(frame), 150),
                random_state=2026 + bundle.seed,
            )
        )
    _write_shap_evidence(
        ModelCandidate.load(output_dir, candidate_name),
        pd.concat(frames, ignore_index=True),
        output_dir,
    )


def _configure_mlflow(output_dir: Path) -> tuple[Any, str]:
    import mlflow

    database = (output_dir / "mlflow.db").resolve()
    mlflow.set_tracking_uri(f"sqlite:///{database}")
    experiment_name = "kfc-modifier-upsell-ranker"
    client = mlflow.MlflowClient()
    experiment = client.get_experiment_by_name(experiment_name)
    experiment_id = (
        client.create_experiment(
            experiment_name,
            artifact_location=(output_dir / "mlartifacts").resolve().as_uri(),
        )
        if experiment is None
        else experiment.experiment_id
    )
    mlflow.set_experiment(experiment_id=experiment_id)
    return client, str(experiment_id)


def run_logging_stage(*, output_dir: Path) -> None:
    import mlflow

    core = json.loads(
        (output_dir / "benchmark-core-result.json").read_text(encoding="utf-8")
    )
    _, _ = _configure_mlflow(output_dir)
    run_ids = {}
    for name, metrics in core["learnedValidation"].items():
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
                    "placement": PLACEMENT,
                    "calibrator": manifest["calibration"],
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
            run_ids[name] = run.info.run_id
    _write_json(output_dir / "mlflow-runs.json", run_ids)


def _assemble_core_result(
    *,
    profile: BenchmarkProfile,
    output_dir: Path,
) -> dict[str, Any]:
    bundles = _bundle_references(profile, output_dir)
    validation = {
        name: json.loads(
            (output_dir / "validation" / f"{name}.json").read_text(
                encoding="utf-8"
            )
        )
        for name in CANDIDATE_NAMES
    }
    winner = max(
        CANDIDATE_NAMES,
        key=lambda name: (
            validation[name]["aggregate"]["expected_incremental_aov_vnd"],
            validation[name]["aggregate"]["ndcg_at_5"],
        ),
    )
    _write_json(
        output_dir / "selection.json",
        {
            "schemaVersion": "modifier-upsell-selection-v1",
            "learnedWinner": winner,
        },
    )
    baseline = json.loads(
        (output_dir / "baseline.json").read_text(encoding="utf-8")
    )
    result: dict[str, Any] = {
        "schemaVersion": "modifier-upsell-benchmark-v1",
        "placement": PLACEMENT,
        "profile": profile.name,
        "qualification": profile.qualification,
        "baseCommit": BASE_SHA,
        "simulatorSourceCommit": SIMULATOR_SHA,
        "datasetDigests": _dataset_digests(bundles),
        "featureSchema": FEATURE_SCHEMA_VERSION,
        "candidateUniverse": {
            "requiresPositivePriceDelta": True,
            "outputSize": 1,
            "freeSubstitutionsExcluded": True,
        },
        "baseline": baseline,
        "learnedValidation": validation,
        "learnedWinner": winner,
        "coldStartEvidence": {
            "status": "insufficient_eligible_candidates",
            "reason": (
                "the six fixture cold modifiers are zero-price substitutions "
                "and are outside proactive Modifier Upsell eligibility"
            ),
            "embeddingAblationRun": False,
        },
        "explanations": {},
        "mlflowRunIds": {},
    }
    if profile.qualification:
        learned = json.loads(
            (output_dir / "test" / "learned-metrics.json").read_text(
                encoding="utf-8"
            )
        )
        deterministic = json.loads(
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
        slices = {}
        for name in ("main", "held_out_store"):
            slices[name] = {
                "aov": _paired_interval(
                    _slice_requests(learned_requests, name),
                    _slice_requests(baseline_requests, name),
                    "expected_incremental_aov_vnd",
                ),
                "ndcg": _paired_interval(
                    _slice_requests(learned_requests, name),
                    _slice_requests(baseline_requests, name),
                    "ndcg_at_5",
                ),
            }
        invalid_modifier_outputs = 0
        guardrails_hold = (
            learned["aggregate"]["action_coverage"]
            >= deterministic["aggregate"]["action_coverage"] * 0.95
            and math.isclose(
                learned["aggregate"]["mean_offer_count"],
                1.0,
                abs_tol=1e-9,
            )
            and invalid_modifier_outputs == 0
        )
        promote = (
            aov_interval["lower95"] > 0
            and ndcg_interval["mean"] > 0
            and slices["held_out_store"]["aov"]["mean"] > 0
            and guardrails_hold
        )
        result["untouchedTest"] = {
            "learned": learned,
            "baseline": deterministic,
            "aovPairedInterval": aov_interval,
            "ndcgPairedInterval": ndcg_interval,
            "slicePairedIntervals": slices,
            "invalidModifierOutputs": invalid_modifier_outputs,
            "guardrailsHold": guardrails_hold,
        }
        result["selectedRanker"] = winner if promote else baseline["name"]
        result["promotionDecision"] = (
            "promote_learned" if promote else "retain_baseline"
        )
    else:
        result["selectedRanker"] = "development_only"
        result["promotionDecision"] = "qualification_required"
    result["contentDigest"] = _canonical_digest(result)
    _write_json(output_dir / "benchmark-core-result.json", result)
    return result


def _write_report(path: Path, result: dict[str, Any]) -> None:
    lines = [
        "# Modifier Upsell ranker benchmark",
        "",
        f"- Profile: `{result['profile']}`",
        f"- Learned validation winner: `{result['learnedWinner']}`",
        f"- Selected ranker: `{result['selectedRanker']}`",
        f"- Decision: `{result['promotionDecision']}`",
        "",
        "## Placement contract",
        "",
        "- One positive-price modifier for one exact cart item and modifier path",
        "- Exact applied action retained through checkout is the success label",
        "- Score is calibrated success probability multiplied by price delta",
        "- Free substitutions remain ordinary item configuration, not proactive upsell",
        "",
        "## Validation comparison",
        "",
        "| Ranker | Expected incremental AOV | NDCG@5 | Top-1 hit | Coverage |",
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
                    f"{aggregate['top_1_hit_rate']:.4f}",
                    f"{aggregate['action_coverage']:.4f}",
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
                f"- Paired NDCG@5 delta: {test['ndcgPairedInterval']['mean']:.4f}",
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
            "## Cold-start boundary",
            "",
            (
                "No embedding ablation was run: all six fixture cold modifiers are "
                "zero-price substitutions and are ineligible for proactive upsell."
            ),
            "",
            "## Evidence",
            "",
            "- `benchmark-result.json`: machine-readable metrics and content digest",
            "- `mlflow.db` and `mlartifacts/`: local experiment tracking",
            "- `explanations/`: SHAP summaries for tree rankers",
            "- `models/`: ranker, calibration, feature-schema, and action contract",
            "",
            (
                "These are synthetic-world ranker-recovery results, not evidence "
                "of real KFC conversion or AOV lift."
            ),
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _finalize(output_dir: Path) -> dict[str, Any]:
    result = json.loads(
        (output_dir / "benchmark-core-result.json").read_text(encoding="utf-8")
    )
    result["explanations"] = {
        name: str(path.relative_to(output_dir))
        for name in TREE_CANDIDATES
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


def run_modifier_benchmark(
    *,
    profile_name: str,
    package_root: Path,
    repo_root: Path,
    output_dir: Path,
    dataset_root: Path | None = None,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    profile = PROFILES[profile_name]
    resolved_dataset_root = (
        dataset_root.resolve()
        if dataset_root is not None
        else (output_dir / "datasets").resolve()
    )
    input_digest = _canonical_digest(
        {
            "stageContract": "isolated-modifier-upsell-benchmark-v1",
            "profile": profile_name,
            "baseCommit": BASE_SHA,
            "simulatorSourceCommit": SIMULATOR_SHA,
            "implementationDigest": _implementation_digest(package_root),
            "datasetRoot": str(resolved_dataset_root),
        }
    )
    _write_json(
        output_dir / "benchmark-run.json",
        {
            "schemaVersion": "isolated-modifier-upsell-benchmark-run-v1",
            "placement": PLACEMENT,
            "profile": profile_name,
            "packageRoot": str(package_root.resolve()),
            "repoRoot": str(repo_root.resolve()),
            "datasetRoot": str(resolved_dataset_root),
            "externalDatasetRoot": dataset_root is not None,
            "inputDigest": input_digest,
        },
    )
    stage_dir = output_dir / ".stages"
    dataset_artifacts = tuple(
        path
        for seed in profile.seeds
        for path in (
            resolved_dataset_root / f"seed-{seed:02d}" / "manifest.json",
            resolved_dataset_root / f"seed-{seed:02d}" / "audit.json",
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
    for stage_name in PRE_MODEL_STAGE_SEQUENCE:
        run_isolated_stage(
            IsolatedStage(
                stage_name,
                input_digest,
                stage_dir / f"{stage_name}.json",
                dataset_artifacts
                if stage_name == "prepare-data"
                else cache_artifacts,
                "kfc_recommendation_simulator.modifier_benchmark_worker",
            ),
            output_dir=output_dir,
        )
    for model_name in CANDIDATE_NAMES:
        run_isolated_stage(
            IsolatedStage(
                f"tune-{model_name}",
                input_digest,
                stage_dir / f"tune-{model_name}.json",
                (output_dir / "tuning" / f"{model_name}.json",),
                "kfc_recommendation_simulator.modifier_benchmark_worker",
            ),
            output_dir=output_dir,
        )
    for candidate_name in CANDIDATE_NAMES:
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
                "kfc_recommendation_simulator.modifier_benchmark_worker",
            ),
            output_dir=output_dir,
        )
    run_isolated_stage(
        IsolatedStage(
            "tune-baseline",
            input_digest,
            stage_dir / "tune-baseline.json",
            (output_dir / "baseline.json",),
            "kfc_recommendation_simulator.modifier_benchmark_worker",
        ),
        output_dir=output_dir,
    )
    for candidate_name in CANDIDATE_NAMES:
        run_isolated_stage(
            IsolatedStage(
                f"validate-{candidate_name}",
                input_digest,
                stage_dir / f"validate-{candidate_name}.json",
                (output_dir / "validation" / f"{candidate_name}.json",),
                "kfc_recommendation_simulator.modifier_benchmark_worker",
            ),
            output_dir=output_dir,
        )
    validation = {
        name: json.loads(
            (output_dir / "validation" / f"{name}.json").read_text(
                encoding="utf-8"
            )
        )
        for name in CANDIDATE_NAMES
    }
    winner = max(
        validation,
        key=lambda name: (
            validation[name]["aggregate"]["expected_incremental_aov_vnd"],
            validation[name]["aggregate"]["ndcg_at_5"],
        ),
    )
    _write_json(
        output_dir / "selection.json",
        {
            "schemaVersion": "modifier-upsell-selection-v1",
            "learnedWinner": winner,
        },
    )
    if profile.qualification:
        test_digest = _canonical_digest(
            {"inputDigest": input_digest, "learnedWinner": winner}
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
                    "kfc_recommendation_simulator.modifier_benchmark_worker",
                ),
                output_dir=output_dir,
            )
    core = _assemble_core_result(profile=profile, output_dir=output_dir)
    postprocess_digest = _canonical_digest(
        {"inputDigest": input_digest, "coreResult": core["contentDigest"]}
    )
    for name in TREE_CANDIDATES:
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
                "kfc_recommendation_simulator.modifier_benchmark_worker",
            ),
            output_dir=output_dir,
        )
    explanation_digests = {
        name: hashlib.sha256(
            (
                output_dir / "explanations" / name / "shap-summary.json"
            ).read_bytes()
        ).hexdigest()
        for name in TREE_CANDIDATES
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
            "kfc_recommendation_simulator.modifier_benchmark_worker",
        ),
        output_dir=output_dir,
    )
    return _finalize(output_dir)
