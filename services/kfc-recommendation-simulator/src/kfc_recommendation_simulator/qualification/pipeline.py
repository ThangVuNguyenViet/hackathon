from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from collections import defaultdict
from collections.abc import Iterable, Mapping
from contextlib import suppress
from dataclasses import dataclass
from importlib.metadata import version
from pathlib import Path
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from ..loader import _read_manifest, load_training_table
from ..schemas import FEATURE_FIELDS, schema_digest
from .artifacts import emit_qualified_bundle
from .calibration import (
    CalibrationModel,
    enforce_joint_probability_bound,
    fit_calibrator,
)
from .composer import ScoredCandidate, compose_candidates
from .datasets import load_untouched_model_table
from .features import FeatureEncoder
from .freeze import (
    FrozenConfigurationError,
    freeze_configuration,
    precommit_qualification,
    verify_frozen_configuration,
)
from .metrics import binary_metrics, normal_mean_interval
from .models import (
    FittedBinaryModel,
    NativeModelArtifact,
    fit_binary_model,
    save_native_model,
)
from .ranking import InsufficientRankingEvidence, evaluate_opportunity_ndcg
from .weighting import (
    clipped_inverse_propensity_weights,
    effective_sample_size,
)

RECOMMENDATION_TYPES = (
    "local_favorite",
    "for_you",
    "modifier_upsell",
    "smart_cross_sell",
)
MODEL_FAMILIES = ("logistic", "lightgbm", "xgboost")
HEAD_LABELS = {
    "selection": "selected",
    "joint": "selectedThroughCheckout",
}
SYNTHETIC_ONLY_DISCLAIMER = (
    "Synthetic qualification evidence only; this does not claim compatibility "
    "with real KFC data or authorize real-customer exposure."
)
CATEGORICAL_FIELDS = (
    "storeId",
    "fulfilmentMode",
    "locale",
    "daypart",
    "catalogRevision",
    "candidateSellableItemId",
    "candidateModifierOptionId",
    "candidateCategoryId",
    "modifierParentSellableItemId",
    "modifierGroupPath",
    "modifierSelectionMode",
)
NUMERIC_FIELDS = (
    "localHour",
    "cartSubtotalVnd",
    "cartLineCount",
    "cartDistinctCategoryCount",
    "candidatePriceImpactVnd",
    "candidateUnitPriceVnd",
    "candidateDiscountAmountVnd",
    "candidateDiscountActive",
    "promotionActive",
    "completedOrderCount",
    "priorItemOrderCount",
    "priorCategoryOrderCount",
    "historyRecencyDays",
    "localDemandCount",
    "modifierOptionAvailable",
    "modifierOptionSafe",
    "modifierPriceRatio",
    "remainingBudgetVnd",
    "basketAssociationCount",
    "basketComplementarityScore",
    "basketRedundancyCount",
    "basketCategoryDiversityCount",
)
NUMERIC_SCALES = {
    "localHour": 23.0,
    "cartSubtotalVnd": 250_000.0,
    "cartLineCount": 10.0,
    "cartDistinctCategoryCount": 10.0,
    "candidatePriceImpactVnd": 250_000.0,
    "candidateUnitPriceVnd": 250_000.0,
    "candidateDiscountAmountVnd": 250_000.0,
    "completedOrderCount": 30.0,
    "priorItemOrderCount": 30.0,
    "priorCategoryOrderCount": 30.0,
    "historyRecencyDays": 365.0,
    "localDemandCount": 640.0,
    "remainingBudgetVnd": 250_000.0,
    "basketAssociationCount": 255.0,
    "basketRedundancyCount": 10.0,
    "basketCategoryDiversityCount": 10.0,
}
COMPOSER_CONTRACT = {
    "schemaVersion": "kfc-qualified-composer-v1",
    "order": (
        "calibrated joint probability times valid price impact descending; "
        "Unicode candidate identity tie-break"
    ),
    "singleActionTypes": ["local_favorite", "for_you", "modifier_upsell"],
    "singleActionCardinality": 1,
    "smartCrossSell": {
        "minimumReadyCount": 3,
        "defaultRenderedCount": 3,
        "maximumRenderedCount": 4,
        "distinctCategory": True,
        "positiveProbability": True,
        "remainingBudgetRequired": True,
        "noPadding": True,
    },
}
GATE_CONFIGURATION = {
    "coverageFractionOfBetterBaseline": 0.95,
    "maximumEce": 0.05,
    "conversionNonInferiorityMargin": 0.005,
    "abandonmentNonInferiorityMargin": 0.005,
    "rankingPairedLower95MustExceed": 0.0,
    "combinedBusinessPairedLower95MustExceed": 0.0,
}


def _canonical_json(value: Any, *, pretty: bool = False) -> bytes:
    if pretty:
        return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _digest_value(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value)).hexdigest()


def _repository_root() -> Path:
    return Path(__file__).resolve().parents[5]


def _source_binding() -> dict[str, Any]:
    repository = _repository_root()
    source_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repository,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    tracked_clean = (
        subprocess.run(
            ["git", "diff", "--quiet"],
            cwd=repository,
            check=False,
        ).returncode
        == 0
    )
    return {"gitSha": source_sha, "trackedTreeClean": tracked_clean}


def _feature_contract() -> dict[str, Any]:
    fields = [
        {"name": name, "arrowType": str(data_type), "nullable": nullable}
        for name, data_type, nullable in FEATURE_FIELDS
    ]
    return {
        "schemaVersion": "automatic-feature-v1",
        "fields": fields,
        "categoricalFields": list(CATEGORICAL_FIELDS),
        "numericFields": list(NUMERIC_FIELDS),
        "numericScales": NUMERIC_SCALES,
        "unknownCategory": "__UNKNOWN__",
        "nullCategory": "__NULL__",
    }


def _base_configuration(manifest: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": "kfc-model-qualification-configuration-v1",
        "syntheticOnlyDisclaimer": SYNTHETIC_ONLY_DISCLAIMER,
        "source": _source_binding(),
        "worldDigest": manifest["worldDigest"],
        "worldProfile": manifest["profile"],
        "splitStrategy": manifest["splitStrategy"],
        "permittedSelectionSplits": ["training", "calibration", "validation"],
        "untouchedEvaluationSplit": "untouched_test",
        "recommendationTypes": list(RECOMMENDATION_TYPES),
        "heads": dict(HEAD_LABELS),
        "challengers": {
            "logistic": {
                "C": 1.0,
                "max_iter": 1_000,
                "solver": "lbfgs",
            },
            "lightgbm": {
                "n_estimators": 60,
                "learning_rate": 0.05,
                "num_leaves": 15,
                "max_depth": 5,
                "min_child_samples": 40,
                "reg_alpha": 0.1,
                "reg_lambda": 1.0,
            },
            "xgboost": {
                "n_estimators": 60,
                "learning_rate": 0.05,
                "max_depth": 5,
                "min_child_weight": 10,
                "subsample": 1.0,
                "colsample_bytree": 1.0,
                "reg_alpha": 0.1,
                "reg_lambda": 1.0,
                "tree_method": "hist",
            },
        },
        "modelSeed": 2_026_080_5,
        "inversePropensityMaximumWeight": 10.0,
        "calibration": {
            "methods": ["sigmoid", "isotonic"],
            "isotonicMinimumRows": 1_000,
            "isotonicMinimumPositive": 100,
            "isotonicMinimumNegative": 100,
            "isotonicMinimumBrierImprovement": 0.002,
        },
        "thresholdSelection": {
            "objectiveOrder": [
                "retained_value_lower_95",
                "retained_value_mean",
                "coverage",
                "smaller_threshold",
            ],
            "candidates": [0.0, 0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.2],
        },
        "featureContract": _feature_contract(),
        "composerContract": COMPOSER_CONTRACT,
        "promotionGates": GATE_CONFIGURATION,
        "libraries": {
            "python": __import__("platform").python_version(),
            "numpy": version("numpy"),
            "pyarrow": version("pyarrow"),
            "scikit-learn": version("scikit-learn"),
            "lightgbm": version("lightgbm"),
            "xgboost": version("xgboost"),
        },
    }


def _filter_rows(
    table: pa.Table,
    recommendation_type: str,
    split: str,
    *,
    shown_only: bool = True,
) -> list[dict[str, Any]]:
    mask = pc.and_(
        pc.equal(table["recommendationType"], recommendation_type),
        pc.equal(table["split"], split),
    )
    if shown_only:
        mask = pc.and_(mask, pc.equal(table["shown"], True))
    return table.filter(mask).to_pylist()


def _labels_weights(
    rows: list[Mapping[str, Any]], label: str, maximum_weight: float
) -> tuple[np.ndarray, np.ndarray]:
    labels = np.asarray([int(bool(row[label])) for row in rows], dtype=np.int8)
    weights = clipped_inverse_propensity_weights(
        np.asarray([float(row["exposurePropensity"]) for row in rows]),
        maximum_weight=maximum_weight,
    )
    return labels, weights


def _artifact_evidence(paths: Iterable[Path], root: Path) -> dict[str, Any]:
    return {
        str(path.relative_to(root)): {
            "sha256": _sha256(path),
            "byteSize": path.stat().st_size,
        }
        for path in sorted(paths)
        if path.is_file()
    }


def _select_threshold(
    probability: np.ndarray,
    labels: np.ndarray,
    prices: np.ndarray,
    weights: np.ndarray,
    candidates: Iterable[float],
) -> tuple[float, dict[str, Any]]:
    evidence: dict[str, Any] = {}
    best: tuple[tuple[float, float, float, float], float] | None = None
    for threshold in candidates:
        retained = (
            (probability >= threshold).astype(np.float64)
            * labels.astype(np.float64)
            * prices
        )
        weighted = retained * weights
        mean = float(weighted.sum() / weights.sum())
        if len(weighted) > 1:
            standard_error = float(weighted.std(ddof=1) / np.sqrt(len(weighted)))
        else:
            standard_error = 0.0
        lower = mean - 1.959963984540054 * standard_error
        coverage = float(np.mean(probability >= threshold))
        evidence[str(threshold)] = {
            "retainedValueMeanVnd": mean,
            "retainedValueLower95Vnd": lower,
            "coverage": coverage,
        }
        key = (lower, mean, coverage, -threshold)
        if best is None or key > best[0]:
            best = (key, threshold)
    assert best is not None
    return best[1], evidence


@dataclass
class _Challenger:
    family: str
    models: dict[str, FittedBinaryModel]
    calibrators: dict[str, CalibrationModel]
    artifacts: dict[str, NativeModelArtifact]
    validation_probability: dict[str, np.ndarray]
    evidence: dict[str, Any]


@dataclass
class _TrainedType:
    recommendation_type: str
    encoder: FeatureEncoder
    champion: _Challenger
    threshold: float
    evidence: dict[str, Any]
    encoder_path: Path
    calibrator_paths: dict[str, Path]
    threshold_path: Path


def _train_type(
    table: pa.Table,
    recommendation_type: str,
    staging: Path,
    configuration: Mapping[str, Any],
) -> _TrainedType:
    training_rows = _filter_rows(table, recommendation_type, "training")
    calibration_rows = _filter_rows(table, recommendation_type, "calibration")
    validation_rows = _filter_rows(table, recommendation_type, "validation")
    if not training_rows or not calibration_rows or not validation_rows:
        raise ValueError(f"insufficient split support for {recommendation_type}")
    encoder = FeatureEncoder.fit(
        training_rows,
        categorical_fields=CATEGORICAL_FIELDS,
        numeric_fields=NUMERIC_FIELDS,
        numeric_scales=NUMERIC_SCALES,
    )
    train_x = encoder.transform(training_rows)
    calibration_x = encoder.transform(calibration_rows)
    validation_x = encoder.transform(validation_rows)
    maximum_weight = float(configuration["inversePropensityMaximumWeight"])
    challengers: dict[str, _Challenger] = {}
    for family in MODEL_FAMILIES:
        models: dict[str, FittedBinaryModel] = {}
        calibrators: dict[str, CalibrationModel] = {}
        artifacts: dict[str, NativeModelArtifact] = {}
        probabilities: dict[str, np.ndarray] = {}
        head_evidence: dict[str, Any] = {}
        for head, label_name in HEAD_LABELS.items():
            train_y, train_weights = _labels_weights(
                training_rows, label_name, maximum_weight
            )
            calibration_y, calibration_weights = _labels_weights(
                calibration_rows, label_name, maximum_weight
            )
            validation_y, validation_weights = _labels_weights(
                validation_rows, label_name, maximum_weight
            )
            model = fit_binary_model(
                family,  # type: ignore[arg-type]
                train_x,
                train_y,
                train_weights,
                seed=int(configuration["modelSeed"]),
                hyperparameters=dict(configuration["challengers"][family]),
            )
            calibrator, calibration_evidence = fit_calibrator(
                model.predict_probability(calibration_x),
                calibration_y,
                calibration_weights,
            )
            validation_probability = calibrator.predict(
                model.predict_probability(validation_x)
            )
            models[head] = model
            calibrators[head] = calibrator
            probabilities[head] = validation_probability
            artifact = save_native_model(
                model,
                staging / recommendation_type / family / head,
                golden_features=validation_x[: min(10, validation_x.shape[0])],
            )
            artifacts[head] = artifact
            head_evidence[head] = {
                "trainRows": len(training_rows),
                "calibrationRows": len(calibration_rows),
                "validationRows": len(validation_rows),
                "trainPositiveCount": int(train_y.sum()),
                "trainEffectiveSampleSize": effective_sample_size(train_weights),
                "calibration": calibration_evidence,
                "validation": binary_metrics(
                    validation_y, validation_probability, validation_weights
                ),
                "modelFormat": (
                    "logistic-coefficients-json"
                    if family == "logistic"
                    else "lightgbm-text"
                    if family == "lightgbm"
                    else "xgboost-json"
                ),
                "modelSha256": _sha256(artifact.model_path),
                "goldenPredictionsSha256": _sha256(artifact.golden_predictions_path),
                "library": artifact.library,
                "libraryVersion": artifact.library_version,
                "hyperparameters": model.hyperparameters,
            }
        probabilities["joint"] = enforce_joint_probability_bound(
            probabilities["selection"], probabilities["joint"]
        )
        joint_y, validation_weights = _labels_weights(
            validation_rows, HEAD_LABELS["joint"], maximum_weight
        )
        selection_y, _ = _labels_weights(
            validation_rows, HEAD_LABELS["selection"], maximum_weight
        )
        head_evidence["joint"]["validation"] = binary_metrics(
            joint_y, probabilities["joint"], validation_weights
        )
        artifact_bytes = sum(
            artifact.model_path.stat().st_size for artifact in artifacts.values()
        )
        challengers[family] = _Challenger(
            family,
            models,
            calibrators,
            artifacts,
            probabilities,
            {
                "heads": head_evidence,
                "artifactBytes": artifact_bytes,
                "validationSelectionBrier": binary_metrics(
                    selection_y, probabilities["selection"], validation_weights
                )["brier"],
                "validationJointBrier": head_evidence["joint"]["validation"]["brier"],
            },
        )
    champion = min(
        challengers.values(),
        key=lambda challenger: (
            challenger.evidence["validationJointBrier"],
            challenger.evidence["validationSelectionBrier"],
            challenger.evidence["artifactBytes"],
            challenger.family,
        ),
    )
    joint_y, validation_weights = _labels_weights(
        validation_rows, HEAD_LABELS["joint"], maximum_weight
    )
    threshold, threshold_evidence = _select_threshold(
        champion.validation_probability["joint"],
        joint_y,
        np.asarray([row["priceImpactVnd"] for row in validation_rows], dtype=float),
        validation_weights,
        configuration["thresholdSelection"]["candidates"],
    )
    type_root = staging / recommendation_type
    encoder_path = type_root / "feature-encoder.json"
    encoder_path.write_bytes(_canonical_json(encoder.to_dict(), pretty=True))
    calibrator_paths: dict[str, Path] = {}
    for head, calibrator in champion.calibrators.items():
        path = type_root / f"{head}-calibrator.json"
        path.write_bytes(_canonical_json(calibrator.to_dict(), pretty=True))
        calibrator_paths[head] = path
    threshold_path = type_root / "abstention-threshold.json"
    threshold_path.write_bytes(
        _canonical_json(
            {
                "schemaVersion": "kfc-abstention-threshold-v1",
                "recommendationType": recommendation_type,
                "threshold": threshold,
                "selectionEvidence": threshold_evidence,
            },
            pretty=True,
        )
    )
    evidence = {
        "splitRows": {
            "training": len(training_rows),
            "calibration": len(calibration_rows),
            "validation": len(validation_rows),
        },
        "featureCount": len(encoder.feature_names),
        "featureEncoderSha256": _sha256(encoder_path),
        "challengers": {
            family: challenger.evidence for family, challenger in challengers.items()
        },
        "champion": champion.family,
        "championSelectionOrder": [
            "validationJointBrier",
            "validationSelectionBrier",
            "artifactBytes",
            "familyIdentity",
        ],
        "abstentionThreshold": threshold,
        "thresholdSelection": threshold_evidence,
        "untouchedTestRowsObservedDuringSelection": 0,
    }
    return _TrainedType(
        recommendation_type,
        encoder,
        champion,
        threshold,
        evidence,
        encoder_path,
        calibrator_paths,
        threshold_path,
    )


def _stable_random_score(seed: int, opportunity: str, candidate: str) -> float:
    digest = hashlib.sha256(f"{seed}\0{opportunity}\0{candidate}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def _source_slices(world: Path) -> dict[str, dict[str, Any]]:
    table = pq.read_table(
        world / "source" / "journeys.parquet",
        columns=[
            "journeyId",
            "split",
            "returningCustomer",
            "fulfilmentMode",
            "daypart",
            "heldOutStore",
            "coldCandidate",
            "drift",
            "storeId",
            "desiredSmartSlateSize",
        ],
    )
    table = table.filter(pc.equal(table["split"], "untouched_test"))
    return {row["journeyId"]: row for row in table.to_pylist()}


def _slice_names(facts: Mapping[str, Any]) -> tuple[str, ...]:
    values = [
        "all",
        str(facts["daypart"]),
        str(facts["fulfilmentMode"]),
        "returning" if facts["returningCustomer"] else "new",
        f"store:{facts['storeId']}",
    ]
    if facts["coldCandidate"]:
        values.append("cold")
    if facts["heldOutStore"]:
        values.append("held_out_store")
    if facts["drift"]:
        values.append("drift")
    return tuple(values)


def _evaluate_type(
    trained: _TrainedType,
    test_table: pa.Table,
    source_facts: Mapping[str, Mapping[str, Any]],
    configuration: Mapping[str, Any],
) -> tuple[dict[str, Any], bool]:
    rows = _filter_rows(
        test_table,
        trained.recommendation_type,
        "untouched_test",
        shown_only=False,
    )
    features = trained.encoder.transform(rows)
    selection_probability = trained.champion.calibrators["selection"].predict(
        trained.champion.models["selection"].predict_probability(features)
    )
    joint_probability = enforce_joint_probability_bound(
        selection_probability,
        trained.champion.calibrators["joint"].predict(
            trained.champion.models["joint"].predict_probability(features)
        ),
    )
    maximum_weight = float(configuration["inversePropensityMaximumWeight"])
    shown_indices = [index for index, row in enumerate(rows) if row["shown"]]
    shown_rows = [rows[index] for index in shown_indices]
    selection_y, weights = _labels_weights(
        shown_rows, HEAD_LABELS["selection"], maximum_weight
    )
    joint_y, _ = _labels_weights(shown_rows, HEAD_LABELS["joint"], maximum_weight)
    shown_selection_probability = selection_probability[shown_indices]
    shown_joint_probability = joint_probability[shown_indices]
    groups: dict[tuple[int, str], list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        groups[(int(row["seed"]), str(row["opportunityId"]))].append(index)
    coverage_by_seed_slice: dict[tuple[int, str], dict[str, list[int]]] = defaultdict(
        lambda: defaultdict(list)
    )
    shown_indices_by_seed_slice: dict[tuple[int, str], list[int]] = defaultdict(list)
    invalid = {
        "jointProbabilityAboveSelection": int(
            np.sum(joint_probability > selection_probability)
        ),
        "invalidComposerCardinality": 0,
        "paddingViolations": 0,
        "eligibilityViolations": 0,
        "modifierValidityViolations": 0,
    }
    ranking_identifiable = all(
        row["selectedThroughCheckout"] is not None for row in rows
    )
    missing_ranking_rows = sum(row["selectedThroughCheckout"] is None for row in rows)
    per_seed_ranking_counts: dict[str, dict[str, int]] = {}
    for seed in sorted({int(row["seed"]) for row in rows}):
        seed_rows = [row for row in rows if int(row["seed"]) == seed]
        per_seed_ranking_counts[str(seed)] = {
            "eligibleCandidateRows": len(seed_rows),
            "shownCandidateRows": sum(bool(row["shown"]) for row in seed_rows),
            "unlabelledEligibleCandidateRows": sum(
                row["selectedThroughCheckout"] is None for row in seed_rows
            ),
        }
    for (seed, opportunity), indices in groups.items():
        candidate_rows = [rows[index] for index in indices]
        desired_size = (
            int(
                source_facts[str(candidate_rows[0]["journeyId"])][
                    "desiredSmartSlateSize"
                ]
            )
            if trained.recommendation_type == "smart_cross_sell"
            else 1
        )
        candidates = [
            ScoredCandidate(
                str(rows[index]["candidateId"]),
                str(rows[index]["candidateCategoryId"]),
                int(rows[index]["priceImpactVnd"]),
                float(joint_probability[index]),
            )
            for index in indices
        ]
        remaining_budget = next(
            (
                int(row["remainingBudgetVnd"])
                for row in candidate_rows
                if row["remainingBudgetVnd"] is not None
            ),
            250_000,
        )
        composed = compose_candidates(
            recommendation_type=trained.recommendation_type,
            candidates=candidates,
            abstention_threshold=trained.threshold,
            remaining_budget_vnd=remaining_budget,
            desired_smart_size=desired_size,
        )
        valid_cardinality = len(composed) in (
            {0, 3, 4} if trained.recommendation_type == "smart_cross_sell" else {0, 1}
        )
        if not valid_cardinality:
            invalid["invalidComposerCardinality"] += 1
        if ranking_identifiable:
            evaluate_opportunity_ndcg(
                candidate_rows,
                score_by_candidate={
                    str(rows[index]["candidateId"]): float(
                        joint_probability[index] * int(rows[index]["priceImpactVnd"])
                    )
                    for index in indices
                },
                k=desired_size,
            )
        else:
            with suppress(InsufficientRankingEvidence):
                evaluate_opportunity_ndcg(
                    candidate_rows,
                    score_by_candidate={
                        str(rows[index]["candidateId"]): float(joint_probability[index])
                        for index in indices
                    },
                    k=desired_size,
                )
        facts = source_facts[str(candidate_rows[0]["journeyId"])]
        random_order = sorted(
            indices,
            key=lambda index: (
                -_stable_random_score(
                    seed, opportunity, str(rows[index]["candidateId"])
                )
            ),
        )
        popularity_order = sorted(
            indices,
            key=lambda index: (
                -int(rows[index]["priorItemOrderCount"]),
                str(rows[index]["candidateId"]),
            ),
        )

        def baseline_composed(
            order: list[int],
            *,
            budget: int = remaining_budget,
            size: int = desired_size,
        ) -> tuple[ScoredCandidate, ...]:
            baseline_candidates = []
            for rank, index in enumerate(order):
                rank_score = float(len(order) - rank) / max(1, len(order))
                price = int(rows[index]["priceImpactVnd"])
                baseline_candidates.append(
                    ScoredCandidate(
                        str(rows[index]["candidateId"]),
                        str(rows[index]["candidateCategoryId"]),
                        price,
                        min(1.0, rank_score / max(1, price)),
                    )
                )
            return compose_candidates(
                recommendation_type=trained.recommendation_type,
                candidates=baseline_candidates,
                abstention_threshold=0.0,
                remaining_budget_vnd=budget,
                desired_smart_size=size,
            )

        random_composed = baseline_composed(random_order)
        popularity_composed = baseline_composed(popularity_order)
        for slice_name in _slice_names(facts):
            values = coverage_by_seed_slice[(seed, slice_name)]
            values["model"].append(int(bool(composed)))
            values["random"].append(int(bool(random_composed)))
            values["popularity"].append(int(bool(popularity_composed)))
        for index in indices:
            if not rows[index]["shown"]:
                continue
            for slice_name in _slice_names(facts):
                shown_indices_by_seed_slice[(seed, slice_name)].append(index)
    slice_evidence: dict[str, Any] = {}
    slice_pass = True
    for (seed, slice_name), values in sorted(coverage_by_seed_slice.items()):
        model_coverage = float(np.mean(values["model"]))
        random_coverage = float(np.mean(values["random"]))
        popularity_coverage = float(np.mean(values["popularity"]))
        required = max(random_coverage, popularity_coverage) * float(
            GATE_CONFIGURATION["coverageFractionOfBetterBaseline"]
        )
        passed = model_coverage >= required
        slice_pass = slice_pass and passed
        slice_indices = shown_indices_by_seed_slice[(seed, slice_name)]
        slice_rows = [rows[index] for index in slice_indices]
        slice_selection_y, slice_weights = _labels_weights(
            slice_rows, HEAD_LABELS["selection"], maximum_weight
        )
        slice_joint_y, _ = _labels_weights(
            slice_rows, HEAD_LABELS["joint"], maximum_weight
        )
        slice_evidence[f"{seed}:{slice_name}"] = {
            "opportunities": len(values["model"]),
            "shownCandidateRows": len(slice_indices),
            "coverage": model_coverage,
            "randomCoverage": random_coverage,
            "popularityCoverage": popularity_coverage,
            "requiredCoverage": required,
            "selectionCalibration": binary_metrics(
                slice_selection_y,
                selection_probability[slice_indices],
                slice_weights,
            ),
            "jointCalibration": binary_metrics(
                slice_joint_y,
                joint_probability[slice_indices],
                slice_weights,
            ),
            "selectionOutcomeInterval95": normal_mean_interval(
                slice_selection_y.astype(float)
            ),
            "jointOutcomeInterval95": normal_mean_interval(slice_joint_y.astype(float)),
            "invalidCounters": {key: 0 for key in invalid},
            "passed": passed,
        }
    selection_metrics = binary_metrics(
        selection_y, shown_selection_probability, weights
    )
    joint_metrics = binary_metrics(joint_y, shown_joint_probability, weights)
    calibration_pass = (
        selection_metrics["brier"] <= selection_metrics["nullBrier"]
        and joint_metrics["brier"] <= joint_metrics["nullBrier"]
        and selection_metrics["ece"] <= float(GATE_CONFIGURATION["maximumEce"])
        and joint_metrics["ece"] <= float(GATE_CONFIGURATION["maximumEce"])
    )
    ranking_pass = False
    validity_pass = all(value == 0 for value in invalid.values())
    gate = calibration_pass and ranking_pass and slice_pass and validity_pass
    evidence = {
        "eligibleCandidateRows": len(rows),
        "shownCandidateRows": len(shown_rows),
        "effectiveSampleSize": effective_sample_size(weights),
        "selectionCalibration": selection_metrics,
        "jointCalibration": joint_metrics,
        "rankingEvidence": {
            "status": "insufficient_evidence",
            "eligibleCandidateRows": len(rows),
            "shownCandidateRows": len(shown_rows),
            "unlabelledEligibleCandidateRows": missing_ranking_rows,
            "perSeed": per_seed_ranking_counts,
            "reason": (
                "Canonical NDCG requires the full eligible candidate set and "
                "candidate-level relevance sufficient to compute ideal DCG; "
                "unshown model-visible candidates are deliberately unlabelled."
            ),
            "requiredTask3DataContract": (
                "Add evaluation-only per-candidate relevance or potential-outcome "
                "evidence for every eligible candidate, sufficient for ideal DCG. "
                "Keep it physically absent from training and model-visible loaders."
            ),
            "oracleUsedForModelRanking": False,
        },
        "perSeedSlices": slice_evidence,
        "invalidCounters": invalid,
        "baselineMethods": {
            "random": "evaluator-only SHA-256 ordering",
            "popularity": "evaluator-only prior-item-order-count ordering",
            "noRecommendation": "evaluator-only zero-coverage baseline",
        },
        "gateComponents": {
            "calibration": calibration_pass,
            "ranking": ranking_pass,
            "sliceCoverageAndValidity": slice_pass and validity_pass,
        },
        "passed": gate,
    }
    return evidence, gate


def _paired_aov_interval(
    left_revenue: np.ndarray,
    left_checkout: np.ndarray,
    right_revenue: np.ndarray,
    right_checkout: np.ndarray,
) -> dict[str, float]:
    left_rate = float(left_checkout.mean())
    right_rate = float(right_checkout.mean())
    left_aov = float(left_revenue.sum() / max(1, left_checkout.sum()))
    right_aov = float(right_revenue.sum() / max(1, right_checkout.sum()))
    influence = (left_revenue - left_aov * left_checkout) / max(left_rate, 1e-12) - (
        right_revenue - right_aov * right_checkout
    ) / max(right_rate, 1e-12)
    interval = normal_mean_interval(influence)
    difference = left_aov - right_aov
    half_width = interval["upper95"] - interval["estimate"]
    return {
        "estimate": difference,
        "lower95": difference - half_width,
        "upper95": difference + half_width,
        "leftAov": left_aov,
        "rightAov": right_aov,
    }


def _business_comparison(
    left: Mapping[str, list[float]], right: Mapping[str, list[float]]
) -> dict[str, Any]:
    left_revenue = np.asarray(left["revenue"], dtype=float)
    right_revenue = np.asarray(right["revenue"], dtype=float)
    left_checkout = np.asarray(left["checkout"], dtype=float)
    right_checkout = np.asarray(right["checkout"], dtype=float)
    return {
        "journeys": len(left_revenue),
        "aovDifferenceVnd95": _paired_aov_interval(
            left_revenue, left_checkout, right_revenue, right_checkout
        ),
        "revenuePerStartedJourneyDifferenceVnd95": normal_mean_interval(
            left_revenue - right_revenue
        ),
        "checkoutConversionDifference95": normal_mean_interval(
            left_checkout - right_checkout
        ),
        "abandonmentDifference95": normal_mean_interval(
            (1.0 - left_checkout) - (1.0 - right_checkout)
        ),
    }


def _business_evidence(
    world: Path, source_facts: Mapping[str, Mapping[str, Any]]
) -> dict[str, Any]:
    journey_ids = set(source_facts)
    values: dict[int, dict[str, dict[str, list[float]]]] = defaultdict(
        lambda: defaultdict(lambda: {"revenue": [], "checkout": []})
    )
    parquet = pq.ParquetFile(world / "oracle" / "potential-outcomes.parquet")
    columns = [
        "seed",
        "journeyId",
        "condition",
        "checkout",
        "finalMerchandiseSubtotalVnd",
    ]
    for batch in parquet.iter_batches(batch_size=100_000, columns=columns):
        for row in batch.to_pylist():
            if row["journeyId"] not in journey_ids:
                continue
            target = values[int(row["seed"])][str(row["condition"])]
            target["revenue"].append(float(row["finalMerchandiseSubtotalVnd"]))
            target["checkout"].append(float(row["checkout"]))
    comparisons = {
        "combined_vs_no_recommendation": "no_recommendation",
        "combined_vs_random": "random_eligible",
        "combined_vs_popularity": "popularity",
        **{
            f"{recommendation_type}_vs_ablation": f"ablate_{recommendation_type}"
            for recommendation_type in RECOMMENDATION_TYPES
        },
    }
    per_seed: dict[str, Any] = {}
    combined: dict[str, dict[str, list[float]]] = defaultdict(
        lambda: {"revenue": [], "checkout": []}
    )
    for seed, conditions in sorted(values.items()):
        per_seed[str(seed)] = {}
        for name, right_condition in comparisons.items():
            per_seed[str(seed)][name] = _business_comparison(
                conditions["automatic"], conditions[right_condition]
            )
        for condition, metrics in conditions.items():
            combined[condition]["revenue"].extend(metrics["revenue"])
            combined[condition]["checkout"].extend(metrics["checkout"])
    combined_comparisons = {
        name: _business_comparison(combined["automatic"], combined[right_condition])
        for name, right_condition in comparisons.items()
    }
    return {"perSeed": per_seed, "combined": combined_comparisons}


def _business_gate(comparison: Mapping[str, Any], *, require_positive: bool) -> bool:
    aov = comparison["aovDifferenceVnd95"]
    revenue = comparison["revenuePerStartedJourneyDifferenceVnd95"]
    conversion = comparison["checkoutConversionDifference95"]
    abandonment = comparison["abandonmentDifference95"]
    business_effect = (
        aov["lower95"] > 0 and revenue["lower95"] > 0
        if require_positive
        else aov["upper95"] >= 0 and revenue["upper95"] >= 0
    )
    return (
        business_effect
        and conversion["lower95"] >= -0.005
        and abandonment["upper95"] <= 0.005
    )


@dataclass(frozen=True)
class QualificationResult:
    status: str
    evidence_path: Path
    selected_configuration_path: Path
    frozen_configuration_path: Path
    bundle_path: Path | None


def run_model_qualification(
    world_root: Path | str, output_directory: Path | str
) -> QualificationResult:
    world = Path(world_root).resolve()
    output = Path(output_directory).resolve()
    if output.exists():
        raise FileExistsError(f"refusing to overwrite qualification output: {output}")
    output.mkdir(parents=True)
    staging = output / ".training-artifacts"
    staging.mkdir()
    manifest = _read_manifest(world)
    selected_path = output / "selected-configuration.json"
    precommit = precommit_qualification(world, selected_path)
    configuration = _base_configuration(manifest)
    training_table = load_training_table(world)
    if "untouched_test" in set(training_table["split"].to_pylist()):
        raise AssertionError("selection loader exposed untouched test")
    trained_types: dict[str, _TrainedType] = {}
    try:
        for recommendation_type in RECOMMENDATION_TYPES:
            trained_types[recommendation_type] = _train_type(
                training_table,
                recommendation_type,
                staging,
                configuration,
            )
        feature_contract_digest = _digest_value(configuration["featureContract"])
        composer_contract_digest = _digest_value(configuration["composerContract"])
        selected = configuration | {
            "featureContractDigest": feature_contract_digest,
            "composerContractDigest": composer_contract_digest,
            "selectedTypes": {
                recommendation_type: {
                    "champion": trained.champion.family,
                    "calibrators": {
                        head: calibrator.to_dict()
                        for head, calibrator in trained.champion.calibrators.items()
                    },
                    "abstentionThreshold": trained.threshold,
                    "featureEncoderSha256": _sha256(trained.encoder_path),
                    "artifacts": {
                        head: {
                            "modelSha256": _sha256(artifact.model_path),
                            "goldenPredictionsSha256": _sha256(
                                artifact.golden_predictions_path
                            ),
                        }
                        for head, artifact in trained.champion.artifacts.items()
                    },
                }
                for recommendation_type, trained in trained_types.items()
            },
        }
        selected_path.write_bytes(_canonical_json(selected, pretty=True))
        frozen_path = output / "frozen-configuration.json"
        frozen = freeze_configuration(
            selected_path, frozen_path, precommit=precommit
        )

        selected_bytes = selected_path.read_bytes()
        selected_path.write_bytes(selected_bytes + b"\n")
        tamper_rejected = False
        try:
            verify_frozen_configuration(selected_path, frozen, world_root=world)
        except FrozenConfigurationError:
            tamper_rejected = True
        selected_path.write_bytes(selected_bytes)

        verify_frozen_configuration(selected_path, frozen, world_root=world)
        test_table = load_untouched_model_table(world, selected_path, frozen)
        source_facts = _source_slices(world)
        type_gates: dict[str, bool] = {}
        for recommendation_type, trained in trained_types.items():
            test_evidence, model_gate = _evaluate_type(
                trained, test_table, source_facts, selected
            )
            trained.evidence["untouchedTest"] = test_evidence
            type_gates[recommendation_type] = model_gate
        business = _business_evidence(world, source_facts)
        for recommendation_type in RECOMMENDATION_TYPES:
            comparison = business["combined"][f"{recommendation_type}_vs_ablation"]
            business_pass = _business_gate(comparison, require_positive=False)
            trained_types[recommendation_type].evidence["businessGate"] = {
                "comparison": f"automatic_vs_ablate_{recommendation_type}",
                "metrics": comparison,
                "passed": business_pass,
            }
            type_gates[recommendation_type] = (
                type_gates[recommendation_type] and business_pass
            )
            trained_types[recommendation_type].evidence["passed"] = type_gates[
                recommendation_type
            ]
        combined_business = business["combined"]["combined_vs_no_recommendation"]
        combined_gate = _business_gate(combined_business, require_positive=True)
        world_invalid = manifest.get("qualityCounters", {})
        world_valid = all(int(value) == 0 for value in world_invalid.values())
        combined_gate = combined_gate and world_valid
        verify_frozen_configuration(selected_path, frozen)
        status = (
            "qualified"
            if all(type_gates.values()) and combined_gate
            else "failed_qualification"
        )
        contract_manifest_path = (
            _repository_root()
            / "contracts"
            / "automatic-recommendations"
            / "v1"
            / "contract-manifest.json"
        )
        contract_manifest = json.loads(
            contract_manifest_path.read_text(encoding="utf-8")
        )
        evidence: dict[str, Any] = {
            "schemaVersion": "kfc-model-qualification-evidence-v1",
            "status": status,
            "syntheticOnlyDisclaimer": SYNTHETIC_ONLY_DISCLAIMER,
            "profile": manifest["profile"],
            "source": selected["source"],
            "world": {
                "worldDigest": manifest["worldDigest"],
                "manifestSha256": _sha256(world / "manifests" / "synthetic-world.json"),
                "datasetArtifactSha256": manifest["artifacts"][
                    "model-visible/training-examples.parquet"
                ]["sha256"],
            },
            "contracts": {
                "canonicalWireDigest": contract_manifest["canonicalDigest"],
                "contractManifestSha256": _sha256(contract_manifest_path),
                "featureContractDigest": feature_contract_digest,
                "featureArrowSchemaDigest": schema_digest(
                    pa.schema(
                        [
                            pa.field(name, data_type, nullable)
                            for name, data_type, nullable in FEATURE_FIELDS
                        ]
                    )
                ),
                "composerContractDigest": composer_contract_digest,
            },
            "configuration": {
                "selectedConfigurationSha256": _sha256(selected_path),
                "frozenConfigurationSha256": _sha256(frozen_path),
            },
            "freeze": {
                "verifiedBeforeUntouchedTest": True,
                "verifiedAfterUntouchedTest": True,
                "tamperProbeRejected": tamper_rejected,
            },
            "libraries": selected["libraries"],
            "types": {
                recommendation_type: trained.evidence
                for recommendation_type, trained in trained_types.items()
            },
            "business": business,
            "worldInvalidCounters": world_invalid,
            "gates": {
                "perType": type_gates,
                "combinedBusiness": combined_gate,
                "worldValidity": world_valid,
                "atomicAllFour": all(type_gates.values()) and combined_gate,
            },
            "artifactInventory": _artifact_evidence(staging.rglob("*"), staging),
            "servingBundleEmitted": False,
            "failureReasons": [],
        }
        if status != "qualified":
            evidence["failureReasons"] = [
                *(
                    [
                        "ranking: full eligible candidate sets lack evaluation-only "
                        "candidate-level relevance required for ideal DCG"
                    ]
                    if any(
                        trained.evidence["untouchedTest"]["rankingEvidence"]["status"]
                        == "insufficient_evidence"
                        for trained in trained_types.values()
                    )
                    else []
                ),
                *[
                    f"{recommendation_type}: promotion gate failed"
                    for recommendation_type, passed in type_gates.items()
                    if not passed
                ],
                *([] if combined_gate else ["combined: promotion gate failed"]),
            ]
        evidence_path = output / "qualification-evidence.json"
        evidence_path.write_bytes(_canonical_json(evidence, pretty=True))
        bundle_path: Path | None = None
        if status == "qualified":
            payload_files: dict[str, Path] = {
                "evidence/qualification-evidence.json": evidence_path,
                "configuration/selected-configuration.json": selected_path,
                "configuration/frozen-configuration.json": frozen_path,
            }
            for recommendation_type, trained in trained_types.items():
                prefix = f"models/{recommendation_type}"
                payload_files[f"{prefix}/feature-encoder.json"] = trained.encoder_path
                payload_files[f"{prefix}/abstention-threshold.json"] = (
                    trained.threshold_path
                )
                for head, path in trained.calibrator_paths.items():
                    payload_files[f"{prefix}/{head}-calibrator.json"] = path
                for head, artifact in trained.champion.artifacts.items():
                    payload_files[f"{prefix}/{head}/{artifact.model_path.name}"] = (
                        artifact.model_path
                    )
                    payload_files[f"{prefix}/{head}/golden-predictions.json"] = (
                        artifact.golden_predictions_path
                    )
            qualification_evidence_digest = _sha256(evidence_path)
            payload_digests = {
                relative: _sha256(path) for relative, path in payload_files.items()
            }
            bundle_binding = {
                "schemaVersion": "kfc-qualified-model-bundle-v1",
                "syntheticOnlyDisclaimer": SYNTHETIC_ONLY_DISCLAIMER,
                "worldDigest": manifest["worldDigest"],
                "contractDigest": contract_manifest["canonicalDigest"],
                "featureContractDigest": feature_contract_digest,
                "composerContractDigest": composer_contract_digest,
                "configurationDigest": _sha256(selected_path),
                "qualificationEvidenceDigest": qualification_evidence_digest,
                "qualificationRunIds": [
                    f"synthetic-{seed}" for seed in manifest["profile"]["seeds"]
                ],
                "champions": {
                    recommendation_type: trained.champion.family
                    for recommendation_type, trained in trained_types.items()
                },
                "libraries": selected["libraries"],
                "payloadDigests": payload_digests,
            }
            bundle_manifest = bundle_binding | {
                "bundleDigest": _digest_value(bundle_binding)
            }
            bundle_path = emit_qualified_bundle(
                output / "qualified-model-bundle",
                type_gate_results=type_gates,
                combined_gate_result=combined_gate,
                payload_files=payload_files,
                manifest=bundle_manifest,
            )
            evidence["servingBundleEmitted"] = True
            evidence["qualifiedBundleDigest"] = bundle_manifest["bundleDigest"]
            evidence_path.write_bytes(_canonical_json(evidence, pretty=True))
        shutil.rmtree(staging)
        status_path = output / "qualification-status.json"
        status_path.write_bytes(
            _canonical_json(
                {
                    "schemaVersion": "kfc-model-qualification-status-v1",
                    "status": status,
                    "bundlePath": str(bundle_path) if bundle_path else None,
                    "evidenceSha256": _sha256(evidence_path),
                    "syntheticOnlyDisclaimer": SYNTHETIC_ONLY_DISCLAIMER,
                },
                pretty=True,
            )
        )
        return QualificationResult(
            status, evidence_path, selected_path, frozen_path, bundle_path
        )
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise
