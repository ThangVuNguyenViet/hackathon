from __future__ import annotations

import hashlib
import json
import re
import shutil
from collections.abc import Mapping
from pathlib import Path
from typing import Any

MODEL_REPOSITORY_NAME = "kfc-vietnam-recommendation-shadow-20260727"
SPACE_REPOSITORY_NAME = "kfc-vietnam-recommendation-shadow-space-20260727"
SANITY_PROJECT_NAME = "kfc-vietnam-recommendation-poc"
SANITY_DATASET = "production"
SPACE_PUBLICATION_FILES = (
    "Dockerfile",
    "README.md",
    "requirements.txt",
    "serve.py",
)

_COMMIT_PATTERN = re.compile(r"^[a-f0-9]{40,64}$")
_DIGEST_PATTERN = re.compile(r"^[a-f0-9]{64}$")
_REPOSITORY_ID_PATTERN = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$"
)
_SANITY_PROJECT_ID_PATTERN = re.compile(r"^[a-z0-9-]+$")
_SECRET_KEY_PATTERN = re.compile(
    r"(?:^|_)(?:api_?key|token|secret|password|authorization|cookie)(?:$|_)",
    re.IGNORECASE,
)


def _canonical_digest(payload: Mapping[str, Any]) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _assert_no_secret_shaped_keys(value: Any, path: str = "metadata") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            key_text = str(key)
            normalized_key = re.sub(
                r"(?<!^)(?=[A-Z])",
                "_",
                key_text,
            ).lower()
            if _SECRET_KEY_PATTERN.search(normalized_key):
                raise ValueError(f"{path}.{key_text} is secret-shaped")
            _assert_no_secret_shaped_keys(child, f"{path}.{key_text}")
    elif isinstance(value, list | tuple):
        for index, child in enumerate(value):
            _assert_no_secret_shaped_keys(child, f"{path}[{index}]")


def build_file_manifest(
    root: Path,
    *,
    schema_version: str,
    metadata: Mapping[str, Any],
    excluded_paths: frozenset[str] = frozenset(),
) -> dict[str, Any]:
    publication_root = root.resolve()
    if not publication_root.is_dir():
        raise ValueError(f"publication root is not a directory: {root}")
    if not schema_version.strip():
        raise ValueError("schema version is required")
    _assert_no_secret_shaped_keys(metadata)
    files: list[dict[str, Any]] = []
    for path in sorted(publication_root.rglob("*")):
        relative_path = path.relative_to(publication_root).as_posix()
        if relative_path in excluded_paths:
            continue
        if path.is_symlink():
            raise ValueError(f"publication symlink is not allowed: {relative_path}")
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError(f"unsupported publication entry: {relative_path}")
        files.append(
            {
                "path": relative_path,
                "sha256": _sha256(path),
                "sizeBytes": path.stat().st_size,
            }
        )
    if not files:
        raise ValueError("publication contains no files")
    manifest: dict[str, Any] = {
        "schemaVersion": schema_version,
        "metadata": dict(metadata),
        "files": files,
    }
    manifest["contentDigest"] = _canonical_digest(manifest)
    return manifest


def write_file_manifest(
    root: Path,
    *,
    filename: str,
    schema_version: str,
    metadata: Mapping[str, Any],
) -> dict[str, Any]:
    if Path(filename).name != filename:
        raise ValueError("manifest filename must be a single path segment")
    destination = root / filename
    destination.unlink(missing_ok=True)
    manifest = build_file_manifest(
        root,
        schema_version=schema_version,
        metadata=metadata,
        excluded_paths=frozenset({filename}),
    )
    destination.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def verify_file_manifest(manifest_path: Path) -> dict[str, Any]:
    declared = _read_mapping(manifest_path, "publication manifest")
    schema_version = declared.get("schemaVersion")
    metadata = declared.get("metadata")
    if not isinstance(schema_version, str) or not isinstance(metadata, Mapping):
        raise TypeError("publication manifest contract is invalid")
    actual = build_file_manifest(
        manifest_path.parent,
        schema_version=schema_version,
        metadata=metadata,
        excluded_paths=frozenset({manifest_path.name}),
    )
    if actual != declared:
        raise ValueError("publication manifest does not match staged files")
    return actual


def build_space_binding(
    model_repository_id: str,
    model_revision: str,
) -> dict[str, str]:
    _assert_repository_name(
        model_repository_id,
        MODEL_REPOSITORY_NAME,
        "model",
    )
    _assert_commit(model_revision, "model revision")
    return {
        "schemaVersion": "kfc-hugging-face-model-binding-v1",
        "modelRepositoryId": model_repository_id,
        "modelRevision": model_revision,
        "modelPath": "model",
    }


def build_probe_request(
    feature_schemas: Mapping[str, Mapping[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    for placement in ("smart_cross_sell", "modifier_upsell"):
        schema = feature_schemas.get(placement)
        if not isinstance(schema, Mapping):
            raise TypeError(f"missing {placement} feature schema")
        schema_version = schema.get("schemaVersion")
        categorical_features = schema.get("categoricalFeatures")
        numeric_features = schema.get("numericFeatures")
        numeric_means = schema.get("numericMeans")
        vocabularies = schema.get("vocabularies")
        if (
            not isinstance(schema_version, str)
            or not isinstance(categorical_features, list)
            or not isinstance(numeric_features, list)
            or not isinstance(numeric_means, Mapping)
            or not isinstance(vocabularies, Mapping)
        ):
            raise TypeError(f"invalid {placement} feature schema")
        candidate_vocabulary = vocabularies.get("candidate_id")
        if not isinstance(candidate_vocabulary, list) or not candidate_vocabulary:
            raise ValueError(f"{placement} candidate_id vocabulary is empty")
        action_id = candidate_vocabulary[0]
        if not isinstance(action_id, str) or not action_id:
            raise ValueError(f"{placement} candidate_id is invalid")
        row: dict[str, Any] = {
            "placement": placement,
            "feature_schema": schema_version,
            "eligible": True,
            "action_id": action_id,
        }
        for feature in categorical_features:
            if not isinstance(feature, str):
                raise TypeError(f"{placement} categorical feature is invalid")
            vocabulary = vocabularies.get(feature)
            if not isinstance(vocabulary, list) or not vocabulary:
                raise ValueError(f"{placement} vocabulary is empty: {feature}")
            row[feature] = action_id if feature == "candidate_id" else vocabulary[0]
        for feature in numeric_features:
            value = numeric_means.get(feature)
            if not isinstance(feature, str) or not isinstance(value, int | float):
                raise TypeError(f"{placement} numeric mean is invalid: {feature}")
            row[feature] = float(value)
        rows.append(row)
    return {"dataframe_records": rows}


def prepare_model_publication(
    *,
    mlflow_model_path: Path,
    output_directory: Path,
    source_commit: str,
    smart_cross_sell_feature_schema: Path,
    modifier_upsell_feature_schema: Path,
) -> dict[str, Any]:
    _assert_commit(source_commit, "source commit")
    model_source = mlflow_model_path.resolve()
    if not (model_source / "MLmodel").is_file():
        raise ValueError("MLflow model must contain MLmodel")
    bundle_manifest = _read_mapping(
        model_source / "shadow-model-manifest.json",
        "shadow model manifest",
    )
    bundle_digest = bundle_manifest.get("contentDigest")
    qualification_digests = bundle_manifest.get("qualificationResultDigests")
    mlflow_signature = bundle_manifest.get("mlflowSignature")
    if (
        not isinstance(bundle_digest, str)
        or not isinstance(qualification_digests, Mapping)
        or not isinstance(mlflow_signature, Mapping)
    ):
        raise TypeError("shadow model manifest is incomplete")
    _assert_digest(bundle_digest, "model bundle digest")
    for placement in ("smart_cross_sell", "modifier_upsell"):
        digest = qualification_digests.get(placement)
        if not isinstance(digest, str):
            raise TypeError(f"missing {placement} qualification digest")
        _assert_digest(digest, f"{placement} qualification digest")
    output_directory.parent.mkdir(parents=True, exist_ok=True)
    output_directory.mkdir()
    shutil.copytree(model_source, output_directory / "model")
    feature_schemas = {
        "smart_cross_sell": _read_mapping(
            smart_cross_sell_feature_schema,
            "Smart Cross-sell feature schema",
        ),
        "modifier_upsell": _read_mapping(
            modifier_upsell_feature_schema,
            "Modifier Upsell feature schema",
        ),
    }
    probe_request = build_probe_request(feature_schemas)
    _write_json(output_directory / "probe-request.json", probe_request)
    (output_directory / "README.md").write_text(
        (
            "---\n"
            "library_name: mlflow\n"
            "license: other\n"
            "tags:\n"
            "- kfc-vietnam\n"
            "- recommendation\n"
            "- shadow-mode\n"
            "---\n\n"
            "# KFC Vietnam recommendation shadow model\n\n"
            "This public artifact contains the qualified placement-aware MLflow "
            "PyFunc used only for protected shadow scoring. The customer-facing "
            "decision remains deterministic. Qualification results come from a "
            "synthetic behavioral world and are not evidence of real KFC "
            "conversion or AOV uplift.\n"
        ),
        encoding="utf-8",
    )
    return write_file_manifest(
        output_directory,
        filename="publication-manifest.json",
        schema_version="kfc-hugging-face-model-publication-v1",
        metadata={
            "sourceCommit": source_commit,
            "expectedRepositoryName": MODEL_REPOSITORY_NAME,
            "modelBundleDigest": bundle_digest,
            "qualificationResultDigests": dict(qualification_digests),
            "mlflowSignature": dict(mlflow_signature),
            "probePlacements": ["smart_cross_sell", "modifier_upsell"],
        },
    )


def prepare_space_publication(
    *,
    source_directory: Path,
    output_directory: Path,
    source_commit: str,
    model_repository_id: str,
    model_revision: str,
) -> dict[str, Any]:
    _assert_commit(source_commit, "source commit")
    binding = build_space_binding(model_repository_id, model_revision)
    source = source_directory.resolve()
    for filename in SPACE_PUBLICATION_FILES:
        path = source / filename
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"Space source is missing a regular {filename}")
    output_directory.parent.mkdir(parents=True, exist_ok=True)
    output_directory.mkdir()
    for filename in SPACE_PUBLICATION_FILES:
        shutil.copy2(source / filename, output_directory / filename)
    _write_json(output_directory / "model-binding.json", binding)
    return write_file_manifest(
        output_directory,
        filename="space-publication-manifest.json",
        schema_version="kfc-hugging-face-space-publication-v1",
        metadata={
            "sourceCommit": source_commit,
            "expectedRepositoryName": SPACE_REPOSITORY_NAME,
            "modelBinding": binding,
            "healthPath": "/health",
            "inferencePath": "/invocations",
        },
    )


def build_public_provenance(
    *,
    source_commit: str,
    model_repository_id: str,
    model_revision: str,
    model_publication_digest: str,
    space_repository_id: str,
    space_revision: str,
    space_publication_digest: str,
    sanity_project_id: str,
    sanity_dataset: str,
    sanity_snapshot_digest: str,
) -> dict[str, Any]:
    _assert_commit(source_commit, "source commit")
    _assert_repository_name(
        model_repository_id,
        MODEL_REPOSITORY_NAME,
        "model",
    )
    _assert_commit(model_revision, "model revision")
    _assert_digest(model_publication_digest, "model publication digest")
    _assert_repository_name(
        space_repository_id,
        SPACE_REPOSITORY_NAME,
        "Space",
    )
    _assert_commit(space_revision, "Space revision")
    _assert_digest(space_publication_digest, "Space publication digest")
    if not _SANITY_PROJECT_ID_PATTERN.fullmatch(sanity_project_id):
        raise ValueError("Sanity project ID is invalid")
    if sanity_dataset != SANITY_DATASET:
        raise ValueError(f"Sanity dataset must be {SANITY_DATASET}")
    _assert_digest(sanity_snapshot_digest, "Sanity snapshot digest")
    provenance: dict[str, Any] = {
        "schemaVersion": "kfc-recommendation-public-provenance-v1",
        "sourceCommit": source_commit,
        "resources": {
            "huggingFaceModel": {
                "repositoryId": model_repository_id,
                "revision": model_revision,
                "publicationDigest": model_publication_digest,
                "visibility": "public",
            },
            "huggingFaceSpace": {
                "repositoryId": space_repository_id,
                "revision": space_revision,
                "publicationDigest": space_publication_digest,
                "visibility": "public",
            },
            "sanity": {
                "projectId": sanity_project_id,
                "dataset": sanity_dataset,
                "snapshotDigest": sanity_snapshot_digest,
                "visibility": "public",
            },
        },
    }
    provenance["contentDigest"] = _canonical_digest(provenance)
    return provenance


def _read_mapping(path: Path, name: str) -> Mapping[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"{name} is unreadable") from error
    if not isinstance(value, Mapping):
        raise TypeError(f"{name} must be an object")
    return value


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _assert_repository_name(
    repository_id: str,
    expected_name: str,
    resource_name: str,
) -> None:
    if (
        not _REPOSITORY_ID_PATTERN.fullmatch(repository_id)
        or repository_id.split("/", maxsplit=1)[1] != expected_name
    ):
        message = (
            f"{resource_name} must use the exact model repository name"
            if resource_name == "model"
            else f"{resource_name} must use the exact repository name"
        )
        raise ValueError(message)


def _assert_commit(value: str, name: str) -> None:
    if not _COMMIT_PATTERN.fullmatch(value):
        raise ValueError(f"{name} must be an immutable hexadecimal commit")


def _assert_digest(value: str, name: str) -> None:
    if not _DIGEST_PATTERN.fullmatch(value):
        raise ValueError(f"{name} must be a SHA-256 digest")
