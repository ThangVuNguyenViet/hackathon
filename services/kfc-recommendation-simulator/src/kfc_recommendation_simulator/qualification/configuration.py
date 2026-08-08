from __future__ import annotations

import hashlib
import json
import subprocess
from collections.abc import Mapping
from importlib.metadata import version
from pathlib import Path
from typing import Any

from ..schemas import FEATURE_FIELDS
from .policy_evaluation import POLICY_OUTCOME_DEFINITION
from .selection import CHAMPION_SELECTION_ORDER

RECOMMENDATION_TYPES = (
    "local_favorite",
    "for_you",
    "modifier_upsell",
    "smart_cross_sell",
)
MODEL_FAMILIES = ("logistic", "lightgbm", "xgboost", "mlp")
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
    "calibrationBrierTolerance": 0.001,
    "conversionNonInferiorityMargin": 0.006,
    "abandonmentNonInferiorityMargin": 0.006,
    "rankingPairedLower95MustExceed": -5000.0,
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
        "configurationRevision": (
            "kfc-model-qualification-v3-regularized-challenger-20260806"
        ),
        "syntheticOnlyDisclaimer": SYNTHETIC_ONLY_DISCLAIMER,
        "source": _source_binding(),
        "worldDigest": manifest["worldDigest"],
        "worldProfile": manifest["profile"],
        "splitStrategy": manifest["splitStrategy"],
        "permittedSelectionSplits": ["training", "calibration", "validation"],
        "untouchedEvaluationSplit": "untouched_test",
        "recommendationTypes": list(RECOMMENDATION_TYPES),
        "heads": dict(HEAD_LABELS),
        "challengerDeclaration": (
            "Predeclared before validation: lower-capacity models with stronger "
            "regularization are evaluated unchanged across all four types and "
            "both heads."
        ),
        "challengers": {
            "logistic": {
                "C": 0.001,
                "max_iter": 1_000,
                "solver": "lbfgs",
            },
            "lightgbm": {
                "n_estimators": 60,
                "learning_rate": 0.05,
                "num_leaves": 15,
                "max_depth": 4,
                "min_child_samples": 20,
                "reg_alpha": 0.1,
                "reg_lambda": 1.0,
            },
            "xgboost": {
                "n_estimators": 60,
                "learning_rate": 0.05,
                "max_depth": 4,
                "min_child_weight": 5,
                "subsample": 1.0,
                "colsample_bytree": 1.0,
                "reg_alpha": 0.1,
                "reg_lambda": 1.0,
                "tree_method": "hist",
            },
            "mlp": {
                "hidden_layer_sizes": [8],
                "activation": "relu",
                "solver": "adam",
                "alpha": 0.01,
                "batch_size": "auto",
                "learning_rate_init": 0.001,
                "max_iter": 150,
                "early_stopping": True,
                "validation_fraction": 0.1,
                "n_iter_no_change": 12,
                "shuffle": True,
            },
        },
        "modelSeed": 2_026_080_7,
        "inversePropensityMaximumWeight": 10.0,
        "calibration": {
            "methods": ["sigmoid", "isotonic"],
            "isotonicMinimumRows": 1_000,
            "isotonicMinimumPositive": 100,
            "isotonicMinimumNegative": 100,
            "isotonicMinimumBrierImprovement": 0.002,
        },
        "thresholdSelection": {
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
