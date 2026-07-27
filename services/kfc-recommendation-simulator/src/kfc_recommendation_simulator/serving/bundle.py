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
    QualifiedShadowModel,
    _artifact_identity,
    _file_digest,
    build_serving_signature,
    verify_qualification_result,
)

BUNDLE_SCHEMA_VERSION = "kfc-qualified-shadow-model-bundle-v1"


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
    required_files = (
        result_path,
        ranker_manifest_path,
        feature_schema_path,
        model_file,
        calibration_file,
    )
    for path in required_files:
        if not path.is_file():
            raise FileNotFoundError(path)
    if ranker_manifest.get("ranker") != required_ranker:
        raise ValueError(f"{placement} ranker manifest must name {required_ranker}")
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
        "files": {
            str(path.relative_to(qualification_directory)): _file_digest(path)
            for path in required_files
        },
    }


@contextmanager
def stage_qualification_results(
    qualifications: Mapping[str, Path],
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
    model_artifacts = {
        f"{placement}_model": str(directory / "models" / QUALIFIED_RANKERS[placement])
        for placement, directory in qualifications.items()
    }
    with stage_qualification_results(qualifications) as result_artifacts:
        mlflow.pyfunc.save_model(
            path=output_directory,
            python_model=QualifiedShadowModel(),
            artifacts={**result_artifacts, **model_artifacts},
            signature=build_serving_signature(),
            code_paths=[str(Path(__file__).resolve().parents[2])],
        )
    signature = build_serving_signature().to_dict()
    manifest = {
        "schemaVersion": BUNDLE_SCHEMA_VERSION,
        "qualificationResultDigests": QUALIFICATION_RESULT_DIGESTS,
        "placements": placements,
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
