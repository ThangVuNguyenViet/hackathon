from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def _load_shadow_runtime():
    path = (
        Path(__file__).resolve().parents[2]
        / "kfc-recommendation-shadow-runtime"
        / "serve.py"
    )
    spec = importlib.util.spec_from_file_location("kfc_shadow_runtime_serve", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Shadow runtime module is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ShadowRuntimeTest(unittest.TestCase):
    def test_local_container_override_requires_a_real_mlflow_model(self) -> None:
        runtime = _load_shadow_runtime()
        with tempfile.TemporaryDirectory() as temporary_directory:
            model = Path(temporary_directory)
            (model / "MLmodel").write_text("model\n", encoding="utf-8")
            with patch.dict(
                os.environ,
                {"KFC_MODEL_LOCAL_PATH": str(model)},
                clear=True,
            ):
                self.assertEqual(runtime.resolve_model_path(), model.resolve())

            missing = model / "missing"
            with patch.dict(
                os.environ,
                {"KFC_MODEL_LOCAL_PATH": str(missing)},
                clear=True,
            ), self.assertRaisesRegex(RuntimeError, "MLflow model"):
                runtime.resolve_model_path()

    def test_public_runtime_requires_a_pinned_model_binding(self) -> None:
        runtime = _load_shadow_runtime()
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            binding = root / "model-binding.json"
            binding.write_text(
                json.dumps(
                    {
                        "schemaVersion": "kfc-shadow-runtime-model-binding-v1",
                        "runtimeProfile": "local_docker_cloudflare_tunnel",
                        "modelRepositoryId": (
                            "verified-owner/"
                            "kfc-vietnam-recommendation-shadow-20260727"
                        ),
                        "modelRevision": "a" * 40,
                        "modelPath": "model",
                    }
                ),
                encoding="utf-8",
            )
            download = root / "download"
            (download / "model").mkdir(parents=True)
            (download / "model" / "MLmodel").write_text(
                "model\n",
                encoding="utf-8",
            )

            calls: list[tuple[str, str, Path]] = []

            def snapshot_download(
                *,
                repo_id: str,
                revision: str,
                local_dir: Path,
            ) -> str:
                calls.append((repo_id, revision, local_dir))
                return str(download)

            with (
                patch.dict(os.environ, {}, clear=True),
                patch.object(runtime, "BINDING_PATH", binding),
            ):
                model_path = runtime.resolve_model_path(
                    snapshot_download=snapshot_download,
                )

            self.assertEqual(model_path, (download / "model").resolve())
            self.assertEqual(
                calls,
                [
                    (
                        (
                            "verified-owner/"
                            "kfc-vietnam-recommendation-shadow-20260727"
                        ),
                        "a" * 40,
                        runtime.MODEL_CACHE,
                    )
                ],
            )

    def test_mlflow_command_binds_the_runtime_port_without_environment_creation(
        self,
    ) -> None:
        runtime = _load_shadow_runtime()
        self.assertEqual(
            runtime.mlflow_command(Path("/model")),
            [
                "mlflow",
                "models",
                "serve",
                "--model-uri",
                "/model",
                "--host",
                "0.0.0.0",
                "--port",
                "7860",
                "--env-manager",
                "local",
            ],
        )
