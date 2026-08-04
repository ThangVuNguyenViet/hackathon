from __future__ import annotations

import hashlib
import json
import shutil
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc

from ..loader import _read_manifest, load_training_table
from ..schemas import FEATURE_FIELDS, schema_digest
from .artifacts import emit_consistent_qualified_bundle
from .business import _business_evidence, _business_gate
from .calibration import (
    CalibrationModel,
    enforce_joint_probability_bound,
    fit_calibrator,
)
from .configuration import (
    CATEGORICAL_FIELDS,
    HEAD_LABELS,
    MODEL_FAMILIES,
    NUMERIC_FIELDS,
    NUMERIC_SCALES,
    RECOMMENDATION_TYPES,
    SYNTHETIC_ONLY_DISCLAIMER,
    _base_configuration,
)
from .datasets import (
    load_untouched_candidate_relevance_table,
    load_untouched_model_table,
    load_validation_policy_evaluation,
)
from .evaluation import _evaluate_type, _source_facts
from .features import FeatureEncoder
from .freeze import (
    FrozenConfigurationError,
    freeze_configuration,
    precommit_qualification,
    verify_frozen_configuration,
)
from .metrics import binary_metrics
from .models import (
    FittedBinaryModel,
    NativeModelArtifact,
    fit_binary_model,
    save_native_model,
)
from .selection import (
    CHAMPION_SELECTION_ORDER,
    NoEligibleChallengerError,
    build_selection_candidate,
    select_gate_first_champion,
)
from .validation import evaluate_validation_thresholds
from .weighting import (
    clipped_inverse_propensity_weights,
    effective_sample_size,
)


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


class _TypeSelectionFailure(NoEligibleChallengerError):
    def __init__(self, recommendation_type: str, evidence: dict[str, Any]) -> None:
        super().__init__(
            f"{recommendation_type}: no challenger passed every validation gate"
        )
        self.recommendation_type = recommendation_type
        self.evidence = evidence


def _train_type(
    table: pa.Table,
    recommendation_type: str,
    staging: Path,
    configuration: Mapping[str, Any],
    source_facts: Mapping[str, Mapping[str, Any]],
    validation_baseline: Mapping[str, Mapping[str, Any]],
    validation_candidate_potentials: Mapping[
        tuple[int, str, str], Mapping[str, Any]
    ],
) -> _TrainedType:
    training_rows = _filter_rows(table, recommendation_type, "training")
    calibration_rows = _filter_rows(table, recommendation_type, "calibration")
    validation_rows = _filter_rows(table, recommendation_type, "validation")
    validation_all_rows = _filter_rows(
        table, recommendation_type, "validation", shown_only=False
    )
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
    validation_x = encoder.transform(validation_all_rows)
    validation_shown_indices = [
        index for index, row in enumerate(validation_all_rows) if row["shown"]
    ]
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
                "calibrationEffectiveSampleSize": effective_sample_size(
                    calibration_weights
                ),
                "validationEffectiveSampleSize": effective_sample_size(
                    validation_weights
                ),
                "calibration": calibration_evidence,
                "validation": binary_metrics(
                    validation_y,
                    validation_probability[validation_shown_indices],
                    validation_weights,
                ),
                "modelFormat": (
                    "logistic-coefficients-json"
                    if family == "logistic"
                    else "lightgbm-text"
                    if family == "lightgbm"
                    else "xgboost-json"
                    if family == "xgboost"
                    else "mlp-weights-json"
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
            joint_y,
            probabilities["joint"][validation_shown_indices],
            validation_weights,
        )
        validation_thresholds = evaluate_validation_thresholds(
            recommendation_type=recommendation_type,
            rows=validation_all_rows,
            selection_probability=probabilities["selection"],
            joint_probability=probabilities["joint"],
            thresholds=configuration["thresholdSelection"]["candidates"],
            desired_size_by_journey={
                journey_id: int(facts["desiredSmartSlateSize"])
                for journey_id, facts in source_facts.items()
            },
            maximum_weight=maximum_weight,
            maximum_ece=float(configuration["promotionGates"]["maximumEce"]),
            coverage_fraction=float(
                configuration["promotionGates"]["coverageFractionOfBetterBaseline"]
            ),
            ranking_lower_bound=float(
                configuration["promotionGates"]["rankingPairedLower95MustExceed"]
            ),
            baseline_by_journey=validation_baseline,
            candidate_potentials=validation_candidate_potentials,
            conversion_noninferiority_margin=float(
                configuration["promotionGates"]["conversionNonInferiorityMargin"]
            ),
            abandonment_noninferiority_margin=float(
                configuration["promotionGates"][
                    "abandonmentNonInferiorityMargin"
                ]
            ),
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
                    selection_y,
                    probabilities["selection"][validation_shown_indices],
                    validation_weights,
                )["brier"],
                "validationJointBrier": head_evidence["joint"]["validation"]["brier"],
                "validationThresholds": validation_thresholds,
            },
        )
    selection_candidates = {
        f"{family}@{threshold}": build_selection_candidate(
            threshold_evidence,
            artifact_bytes=challenger.evidence["artifactBytes"],
        )
        for family, challenger in challengers.items()
        for threshold, threshold_evidence in challenger.evidence[
            "validationThresholds"
        ].items()
    }
    selection_evidence = {
        "splitRows": {
            "training": len(training_rows),
            "calibration": len(calibration_rows),
            "validation": len(validation_rows),
            "validationEligible": len(validation_all_rows),
        },
        "featureCount": len(encoder.feature_names),
        "challengers": {
            family: challenger.evidence for family, challenger in challengers.items()
        },
        "championSelectionOrder": list(CHAMPION_SELECTION_ORDER),
        "untouchedTestRowsObservedDuringSelection": 0,
    }
    try:
        champion_key = select_gate_first_champion(selection_candidates)
    except NoEligibleChallengerError as error:
        raise _TypeSelectionFailure(
            recommendation_type,
            selection_evidence
            | {
                "selectionStatus": "failed",
                "champion": None,
                "championCandidate": None,
                "failureReason": str(error),
            },
        ) from error
    champion_family, threshold_text = champion_key.split("@", maxsplit=1)
    champion = challengers[champion_family]
    threshold = float(threshold_text)
    threshold_evidence = champion.evidence["validationThresholds"][
        str(float(threshold))
    ]
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
                "validationPolicyEvidence": threshold_evidence,
            },
            pretty=True,
        )
    )
    evidence = selection_evidence | {
        "featureEncoderSha256": _sha256(encoder_path),
        "selectionStatus": "passed",
        "champion": champion.family,
        "championCandidate": champion_key,
        "championSelectionOrder": list(CHAMPION_SELECTION_ORDER),
        "abstentionThreshold": threshold,
        "thresholdSelection": threshold_evidence,
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



@dataclass(frozen=True)
class QualificationResult:
    status: str
    evidence_path: Path
    selected_configuration_path: Path | None
    frozen_configuration_path: Path | None
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
    selection_failures: dict[str, dict[str, Any]] = {}
    validation_source_facts = _source_facts(world, split="validation")
    validation_relevance, validation_baseline = (
        load_validation_policy_evaluation(world)
    )
    validation_candidate_potentials = {
        (int(row["seed"]), str(row["opportunityId"]), str(row["candidateId"])): row
        for row in validation_relevance.to_pylist()
    }
    try:
        for recommendation_type in RECOMMENDATION_TYPES:
            try:
                trained_types[recommendation_type] = _train_type(
                    training_table,
                    recommendation_type,
                    staging,
                    configuration,
                    validation_source_facts,
                    validation_baseline,
                    validation_candidate_potentials,
                )
            except _TypeSelectionFailure as error:
                selection_failures[recommendation_type] = error.evidence
        if selection_failures:
            type_evidence = {
                recommendation_type: (
                    selection_failures[recommendation_type]
                    if recommendation_type in selection_failures
                    else trained_types[recommendation_type].evidence
                )
                for recommendation_type in RECOMMENDATION_TYPES
            }
            evidence = {
                "schemaVersion": "kfc-model-qualification-evidence-v2",
                "status": "failed_selection",
                "syntheticOnlyDisclaimer": SYNTHETIC_ONLY_DISCLAIMER,
                "profile": manifest["profile"],
                "source": configuration["source"],
                "world": {
                    "worldDigest": manifest["worldDigest"],
                    "manifestSha256": _sha256(
                        world / "manifests" / "synthetic-world.json"
                    ),
                },
                "freeze": {
                    "worldPrecommitVerifiedBeforeSelection": True,
                    "worldPrecommitSha256": precommit.evidence_sha256,
                    "selectedConfigurationWritten": False,
                    "configurationFrozen": False,
                    "untouchedTestOpened": False,
                    "candidateRelevanceOpened": False,
                    "validationPolicyEvaluationOpened": True,
                },
                "libraries": configuration["libraries"],
                "types": type_evidence,
                "gates": {
                    "validationSelection": {
                        recommendation_type: recommendation_type
                        not in selection_failures
                        for recommendation_type in RECOMMENDATION_TYPES
                    },
                    "atomicAllFour": False,
                },
                "artifactInventory": _artifact_evidence(
                    staging.rglob("*"), staging
                ),
                "servingBundleEmitted": False,
                "failureReasons": [
                    f"{recommendation_type}: no family/threshold candidate passed "
                    "every pre-freeze validation gate"
                    for recommendation_type in RECOMMENDATION_TYPES
                    if recommendation_type in selection_failures
                ],
            }
            evidence_path = output / "qualification-evidence.json"
            evidence_path.write_bytes(_canonical_json(evidence, pretty=True))
            status_path = output / "qualification-status.json"
            status_path.write_bytes(
                _canonical_json(
                    {
                        "schemaVersion": "kfc-model-qualification-status-v1",
                        "status": "failed_selection",
                        "bundlePath": None,
                        "evidenceSha256": _sha256(evidence_path),
                        "syntheticOnlyDisclaimer": SYNTHETIC_ONLY_DISCLAIMER,
                    },
                    pretty=True,
                )
            )
            shutil.rmtree(staging)
            return QualificationResult(
                "failed_selection", evidence_path, None, None, None
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
        relevance_table = load_untouched_candidate_relevance_table(
            world, selected_path, frozen
        )
        source_facts = _source_facts(world, split="untouched_test")
        type_gates: dict[str, bool] = {}
        decisions_by_type: dict[str, dict[str, list[dict[str, Any]]]] = {}
        for recommendation_type, trained in trained_types.items():
            test_evidence, model_gate, policy_decisions = _evaluate_type(
                trained, test_table, relevance_table, source_facts, selected
            )
            trained.evidence["untouchedTest"] = test_evidence
            type_gates[recommendation_type] = model_gate
            decisions_by_type[recommendation_type] = policy_decisions
        business = _business_evidence(
            world, source_facts, relevance_table, decisions_by_type
        )
        for recommendation_type in RECOMMENDATION_TYPES:
            comparison = business["combined"][f"{recommendation_type}_vs_ablation"]
            business_pass = _business_gate(comparison, require_positive=False)
            trained_types[recommendation_type].evidence["businessGate"] = {
                "comparison": f"learned_vs_ablate_{recommendation_type}",
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
                "candidateRelevanceArtifactSha256": manifest["artifacts"][
                    "evaluation/candidate-relevance.parquet"
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
                "worldPrecommitVerifiedBeforeSelection": True,
                "worldPrecommitSha256": precommit.evidence_sha256,
                "verifiedBeforeUntouchedTest": True,
                "relevanceOpenedOnlyAfterConfigurationFreeze": True,
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
                *[
                    f"{recommendation_type}: promotion gate failed"
                    for recommendation_type, passed in type_gates.items()
                    if not passed
                ],
                *([] if combined_gate else ["combined: promotion gate failed"]),
            ]
        evidence_path = output / "qualification-evidence.json"
        bundle_path: Path | None = None
        if status == "qualified":
            payload_files: dict[str, Path] = {
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
            bundle_binding = {
                "schemaVersion": "kfc-qualified-model-bundle-v1",
                "syntheticOnlyDisclaimer": SYNTHETIC_ONLY_DISCLAIMER,
                "worldDigest": manifest["worldDigest"],
                "contractDigest": contract_manifest["canonicalDigest"],
                "featureContractDigest": feature_contract_digest,
                "composerContractDigest": composer_contract_digest,
                "configurationDigest": _sha256(selected_path),
                "qualificationRunIds": [
                    f"synthetic-{seed}" for seed in manifest["profile"]["seeds"]
                ],
                "champions": {
                    recommendation_type: trained.champion.family
                    for recommendation_type, trained in trained_types.items()
                },
                "libraries": selected["libraries"],
            }
            bundle_path, _ = emit_consistent_qualified_bundle(
                output / "qualified-model-bundle",
                evidence_path=evidence_path,
                evidence=evidence,
                type_gate_results=type_gates,
                combined_gate_result=combined_gate,
                payload_files=payload_files,
                manifest_binding=bundle_binding,
            )
        else:
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
