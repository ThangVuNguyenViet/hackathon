from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import mlflow.pyfunc

from .model import (
    QUALIFICATION_RESULT_DIGESTS,
    QUALIFIED_RANKERS,
    TRUSTED_ARTIFACT_MANIFEST_SCHEMA,
    QualifiedShadowModel,
    _artifact_identity,
    _canonical_digest,
    _file_digest,
    build_serving_signature,
    verify_qualification_result,
)

BUNDLE_SCHEMA_VERSION = "kfc-qualified-shadow-model-bundle-v1"
QUALIFIED_ARTIFACT_DIGESTS = {
    "smart_cross_sell": {
        "benchmark-result.json": (
            "c24de9dd1a86e0a60446a84239b8a1ec45f13342dc328b7fcff795e7f697cbb7"
        ),
        "ranker-manifest.json": (
            "ca48957a45461f98a73b2a9c2178f1c73ecb490f6f5fdd8a3c154de9db87d86d"
        ),
        "feature-schema.json": (
            "fb0013276eebd0de4b0f7be1552f8b1565a018793b7d66ca4576d4ecb7fd27da"
        ),
        "model.lightgbm.txt": (
            "873cafdc6a6a0a9fa2336c3c20295d0f10ccaf5b15d67555999c51d7ae128f98"
        ),
        "calibrator.joblib": (
            "9c9c55e026c5a193f2576e4c99660d767e45ac0e0f9b13a587b9340b8f361962"
        ),
    },
    "modifier_upsell": {
        "benchmark-result.json": (
            "6ca6818d23e30019b49459bc4b45705ebdfc0072bd129f0910bd230a2f238073"
        ),
        "ranker-manifest.json": (
            "8d0dcbbfe8285a491bd7d43bcedd1165897f6e921013c638c097e3bc8e81d7a4"
        ),
        "feature-schema.json": (
            "db6b61c127a48cb73d32d91664c89081db5788e6004fdfd6c906f2ec9cd0fa76"
        ),
        "model.keras": (
            "76b1e4388f687857d6be21a4298007ffa09f82ad2330e25fa031da3e8be530e4"
        ),
        "calibrator.joblib": (
            "c0b6e02e02ca54378edf1c87c187363b3214dca8fe8678972f45bf8626611a3a"
        ),
    },
}


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _placement_metadata(
    placement: str,
    qualification_directory: Path,
) -> dict[str, Any]:
    result_path = qualification_directory / "benchmark-result.json"
    result = verify_qualification_result(
        result_path,
        QUALIFICATION_RESULT_DIGESTS[placement],
    )
    required_ranker = QUALIFIED_RANKERS[placement]
    if result.get("profile") != "qualification" or not result.get("qualification"):
        raise ValueError(f"{placement} result is not a qualification result")
    if result.get("learnedWinner") != required_ranker:
        raise ValueError(
            f"{placement} requires learned winner {required_ranker}, "
            f"found {result.get('learnedWinner')}"
        )
    model_directory = qualification_directory / "models" / required_ranker
    ranker_manifest_path = model_directory / "ranker-manifest.json"
    feature_schema_path = model_directory / "feature-schema.json"
    ranker_manifest = json.loads(ranker_manifest_path.read_text(encoding="utf-8"))
    feature_schema = json.loads(feature_schema_path.read_text(encoding="utf-8"))
    model_file = (
        model_directory / "model.lightgbm.txt"
        if placement == "smart_cross_sell"
        else model_directory / "model.keras"
    )
    calibration_file = model_directory / "calibrator.joblib"
    required_files = {
        "benchmark-result.json": result_path,
        "ranker-manifest.json": ranker_manifest_path,
        "feature-schema.json": feature_schema_path,
        model_file.name: model_file,
        "calibrator.joblib": calibration_file,
    }
    for path in required_files.values():
        if not path.is_file():
            raise FileNotFoundError(path)
    if ranker_manifest.get("ranker") != required_ranker:
        raise ValueError(f"{placement} ranker manifest must name {required_ranker}")
    file_digests = {
        filename: _file_digest(path) for filename, path in required_files.items()
    }
    if file_digests != QUALIFIED_ARTIFACT_DIGESTS[placement]:
        raise ValueError(
            f"{placement} qualified artifact digest mismatch: "
            f"required {QUALIFIED_ARTIFACT_DIGESTS[placement]}, actual {file_digests}"
        )
    return {
        "placement": placement,
        "qualificationResultDigest": QUALIFICATION_RESULT_DIGESTS[placement],
        "featureSchema": feature_schema["schemaVersion"],
        "modelArtifactId": _artifact_identity(
            f"{placement}-{required_ranker}",
            model_file,
        ),
        "calibrationId": _artifact_identity(
            f"{placement}-{ranker_manifest['calibration']}-calibration",
            calibration_file,
        ),
        "ranker": required_ranker,
        "fileDigests": file_digests,
    }


def _trusted_artifact_manifest(
    placements: Mapping[str, dict[str, Any]],
) -> dict[str, Any]:
    manifest = {
        "schemaVersion": TRUSTED_ARTIFACT_MANIFEST_SCHEMA,
        "qualificationResultDigests": QUALIFICATION_RESULT_DIGESTS,
        "placements": dict(placements),
    }
    manifest["contentDigest"] = _canonical_digest(manifest)
    return manifest


@contextmanager
def stage_qualification_results(
    qualifications: Mapping[str, Path],
    *,
    trusted_manifest: Mapping[str, Any] | None = None,
) -> Iterator[dict[str, str]]:
    with tempfile.TemporaryDirectory(
        prefix="kfc-qualified-shadow-results-"
    ) as temporary_directory:
        staging_directory = Path(temporary_directory)
        staged: dict[str, str] = {}
        for placement, qualification_directory in qualifications.items():
            destination = staging_directory / f"{placement}-benchmark-result.json"
            shutil.copy2(
                qualification_directory / "benchmark-result.json",
                destination,
            )
            staged[f"{placement}_result"] = str(destination)
        if trusted_manifest is not None:
            manifest_path = staging_directory / "trusted-artifact-manifest.json"
            _write_json(manifest_path, trusted_manifest)
            staged["trusted_manifest"] = str(manifest_path)
        yield staged


def save_qualified_shadow_model(
    *,
    smart_cross_sell_qualification: Path,
    modifier_upsell_qualification: Path,
    output_directory: Path,
) -> dict[str, Any]:
    qualifications = {
        "smart_cross_sell": smart_cross_sell_qualification.resolve(),
        "modifier_upsell": modifier_upsell_qualification.resolve(),
    }
    placements = {
        placement: _placement_metadata(placement, directory)
        for placement, directory in qualifications.items()
    }
    trusted_manifest = _trusted_artifact_manifest(placements)
    model_artifacts = {
        f"{placement}_model": str(directory / "models" / QUALIFIED_RANKERS[placement])
        for placement, directory in qualifications.items()
    }
    with stage_qualification_results(
        qualifications,
        trusted_manifest=trusted_manifest,
    ) as result_artifacts:
        mlflow.pyfunc.save_model(
            path=output_directory,
            python_model=QualifiedShadowModel(
                trusted_manifest_digest=trusted_manifest["contentDigest"],
            ),
            artifacts={**result_artifacts, **model_artifacts},
            signature=build_serving_signature(),
            code_paths=[str(Path(__file__).resolve().parents[2])],
        )
    signature = build_serving_signature().to_dict()
    manifest = {
        "schemaVersion": BUNDLE_SCHEMA_VERSION,
        "qualificationResultDigests": QUALIFICATION_RESULT_DIGESTS,
        "placements": placements,
        "trustedArtifactManifestDigest": trusted_manifest["contentDigest"],
        "mlflowSignature": signature,
        "syntheticEvidenceDisclaimer": (
            "These are synthetic-world ranker-recovery results, not evidence "
            "of real KFC conversion or AOV lift."
        ),
    }
    manifest_payload = json.dumps(
        manifest,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    manifest["contentDigest"] = hashlib.sha256(manifest_payload).hexdigest()
    _write_json(output_directory / "shadow-model-manifest.json", manifest)
    return manifest
