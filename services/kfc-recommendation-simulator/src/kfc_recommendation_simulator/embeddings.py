from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import onnxruntime as ort
import pandas as pd
from huggingface_hub import hf_hub_download
from sklearn.decomposition import PCA
from transformers import AutoTokenizer

MODEL_ID = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MODEL_REVISION = "e8f8c211226b894fcb81acc59f3b34ba3efd5f42"
MODEL_ARTIFACT = "onnx/model_qint8_arm64.onnx"
EMBEDDING_FEATURES = tuple(f"feature_text_embedding_{index:02d}" for index in range(16))


def _mean_pool(token_embeddings: np.ndarray, attention_mask: np.ndarray) -> np.ndarray:
    expanded_mask = attention_mask[..., None].astype("float32")
    summed = np.sum(token_embeddings * expanded_mask, axis=1)
    counts = np.clip(np.sum(expanded_mask, axis=1), 1e-9, None)
    pooled = summed / counts
    norms = np.clip(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-9, None)
    return pooled / norms


@dataclass
class CatalogEmbeddingProjector:
    vectors: dict[str, np.ndarray]
    pca: PCA

    @classmethod
    def fit(cls, catalog: pd.DataFrame) -> CatalogEmbeddingProjector:
        items = (
            catalog[["candidate_id", "name", "category"]]
            .drop_duplicates("candidate_id")
            .sort_values("candidate_id")
        )
        tokenizer = AutoTokenizer.from_pretrained(
            MODEL_ID,
            revision=MODEL_REVISION,
        )
        model_path = hf_hub_download(
            MODEL_ID,
            MODEL_ARTIFACT,
            revision=MODEL_REVISION,
        )
        session_options = ort.SessionOptions()
        session_options.intra_op_num_threads = 1
        session_options.inter_op_num_threads = 1
        session = ort.InferenceSession(
            model_path,
            sess_options=session_options,
            providers=["CPUExecutionProvider"],
        )
        texts = [
            f"{name}. Category: {category}."
            for name, category in zip(items["name"], items["category"], strict=True)
        ]
        encoded = tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=64,
            return_tensors="np",
        )
        outputs = session.run(
            ["last_hidden_state"],
            {
                model_input.name: encoded[model_input.name].astype("int64")
                for model_input in session.get_inputs()
            },
        )
        pooled = _mean_pool(outputs[0], encoded["attention_mask"])
        components = min(len(EMBEDDING_FEATURES), len(items), pooled.shape[1])
        pca = PCA(n_components=components, random_state=2026)
        projected = pca.fit_transform(pooled).astype("float32")
        if components < len(EMBEDDING_FEATURES):
            projected = np.pad(
                projected,
                ((0, 0), (0, len(EMBEDDING_FEATURES) - components)),
            )
        vectors = {
            str(candidate_id): vector
            for candidate_id, vector in zip(
                items["candidate_id"],
                projected,
                strict=True,
            )
        }
        return cls(vectors, pca)

    def transform(self, frame: pd.DataFrame) -> pd.DataFrame:
        transformed = frame.copy()
        matrix = np.vstack(
            [
                self.vectors.get(
                    str(candidate_id),
                    np.zeros(len(EMBEDDING_FEATURES), dtype="float32"),
                )
                for candidate_id in frame["candidate_id"]
            ]
        )
        for index, column in enumerate(EMBEDDING_FEATURES):
            transformed[column] = matrix[:, index]
        return transformed

    def save(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {
                "modelId": MODEL_ID,
                "modelRevision": MODEL_REVISION,
                "modelArtifact": MODEL_ARTIFACT,
                "pca": self.pca,
                "catalogVectors": self.vectors,
            },
            directory / "catalog-embedding-projector.joblib",
        )

    @classmethod
    def load(cls, directory: Path) -> CatalogEmbeddingProjector:
        payload = joblib.load(directory / "catalog-embedding-projector.joblib")
        return cls(payload["catalogVectors"], payload["pca"])


@dataclass
class FrozenEmbeddingRanker:
    name: str
    ranker: object
    projector: CatalogEmbeddingProjector

    def predict_probability(self, frame: pd.DataFrame) -> np.ndarray:
        return self.ranker.predict_probability(self.projector.transform(frame))

    def save(self, directory: Path) -> None:
        self.ranker.save(directory)
        self.projector.save(directory)
