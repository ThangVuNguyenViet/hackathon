from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

TYPES = ("local_favorite", "for_you", "modifier_upsell", "smart_cross_sell")


def _bytes(value: Any, *, pretty: bool = True) -> bytes:
    if pretty:
        return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode()


def _write(root: Path, relative: str, value: Any) -> str:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_bytes(value))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_test_qualified_bundle(
    root: Path,
    *,
    contract_digest: str,
    feature_digest: str,
    composer_digest: str,
) -> dict[str, Any]:
    """Build a test-only qualified fixture; never usable as release evidence."""
    payloads: dict[str, str] = {}
    probability = 1.0 / (1.0 + math.exp(-1.0))
    for recommendation_type in TYPES:
        prefix = f"models/{recommendation_type}"
        payloads[f"{prefix}/feature-encoder.json"] = _write(
            root,
            f"{prefix}/feature-encoder.json",
            {
                "schemaVersion": "kfc-feature-encoder-v1",
                "categoricalFields": [],
                "numericFields": ["candidatePriceImpactVnd"],
                "categories": {},
                "numericScales": {"candidatePriceImpactVnd": 10000.0},
                "featureNames": ["candidatePriceImpactVnd"],
            },
        )
        payloads[f"{prefix}/abstention-threshold.json"] = _write(
            root,
            f"{prefix}/abstention-threshold.json",
            {
                "schemaVersion": "kfc-abstention-threshold-v1",
                "recommendationType": recommendation_type,
                "threshold": 0.1,
                "validationPolicyEvidence": {"testOnly": True},
            },
        )
        for head in ("selection", "joint"):
            payloads[f"{prefix}/{head}-calibrator.json"] = _write(
                root,
                f"{prefix}/{head}-calibrator.json",
                {
                    "schemaVersion": "kfc-probability-calibrator-v1",
                    "method": "sigmoid",
                    "parameters": {"slope": 1.0, "intercept": 0.0},
                },
            )
            payloads[f"{prefix}/{head}/model.json"] = _write(
                root,
                f"{prefix}/{head}/model.json",
                {
                    "schemaVersion": "kfc-logistic-model-v1",
                    "library": "scikit-learn",
                    "libraryVersion": "test-only",
                    "coefficients": [1.0],
                    "intercept": 0.0,
                    "classes": [0, 1],
                    "hyperparameters": {},
                },
            )
            payloads[f"{prefix}/{head}/golden-predictions.json"] = _write(
                root,
                f"{prefix}/{head}/golden-predictions.json",
                {
                    "schemaVersion": "kfc-model-golden-predictions-v1",
                    "libraryFamily": "logistic",
                    "library": "scikit-learn",
                    "libraryVersion": "test-only",
                    "featureRows": [[1.0]],
                    "probabilities": [probability],
                },
            )
    evidence = {
        "schemaVersion": "kfc-model-qualification-evidence-v1",
        "status": "qualified",
        "servingBundleEmitted": True,
        "syntheticOnlyDisclaimer": "TEST ONLY - not production qualification",
    }
    evidence_digest = _write(root, "evidence/qualification-evidence.json", evidence)
    payloads["evidence/qualification-evidence.json"] = evidence_digest
    binding = {
        "schemaVersion": "kfc-qualified-model-bundle-v1",
        "syntheticOnlyDisclaimer": "TEST ONLY - not production qualification",
        "worldDigest": "1" * 64,
        "contractDigest": contract_digest,
        "featureContractDigest": feature_digest,
        "composerContractDigest": composer_digest,
        "configurationDigest": "2" * 64,
        "qualificationRunIds": ["test-only-qualified-fixture"],
        "champions": {name: "logistic" for name in TYPES},
        "libraries": {"scikit-learn": "test-only"},
        "qualificationEvidenceDigest": evidence_digest,
        "payloadDigests": dict(sorted(payloads.items())),
    }
    manifest = binding | {
        "bundleDigest": hashlib.sha256(_bytes(binding, pretty=False)).hexdigest()
    }
    (root / "bundle-manifest.json").write_bytes(_bytes(manifest))
    return manifest
