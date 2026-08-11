from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from typing import Any

import numpy as np
from scipy import sparse

UNKNOWN_CATEGORY = "__UNKNOWN__"
NULL_CATEGORY = "__NULL__"


@dataclass(frozen=True)
class FeatureEncoder:
    categorical_fields: tuple[str, ...]
    numeric_fields: tuple[str, ...]
    categories: dict[str, tuple[str, ...]]
    numeric_scales: dict[str, float] = dataclass_field(default_factory=dict)

    @classmethod
    def fit(
        cls,
        rows: Iterable[Mapping[str, Any]],
        *,
        categorical_fields: tuple[str, ...],
        numeric_fields: tuple[str, ...],
        numeric_scales: Mapping[str, float] | None = None,
    ) -> FeatureEncoder:
        materialized = list(rows)
        categories: dict[str, tuple[str, ...]] = {}
        for field in categorical_fields:
            observed = {
                NULL_CATEGORY if row.get(field) is None else str(row[field])
                for row in materialized
            }
            observed.discard(UNKNOWN_CATEGORY)
            categories[field] = (UNKNOWN_CATEGORY, *sorted(observed))
        scales = {
            field: float((numeric_scales or {}).get(field, 1.0))
            for field in numeric_fields
        }
        if any(scale <= 0 or not np.isfinite(scale) for scale in scales.values()):
            raise ValueError("numeric feature scales must be finite and positive")
        return cls(categorical_fields, numeric_fields, categories, scales)

    @property
    def feature_names(self) -> tuple[str, ...]:
        return self.numeric_fields + tuple(
            f"{field}={category}"
            for field in self.categorical_fields
            for category in self.categories[field]
        )

    def transform(self, rows: Iterable[Mapping[str, Any]]) -> sparse.csr_matrix:
        materialized = list(rows)
        category_offsets: dict[str, int] = {}
        offset = len(self.numeric_fields)
        for field in self.categorical_fields:
            category_offsets[field] = offset
            offset += len(self.categories[field])
        row_indices: list[int] = []
        column_indices: list[int] = []
        values: list[float] = []
        for row_index, row in enumerate(materialized):
            for column_index, field in enumerate(self.numeric_fields):
                value = row.get(field)
                if value is not None:
                    row_indices.append(row_index)
                    column_indices.append(column_index)
                    values.append(float(value) / self.numeric_scales.get(field, 1.0))
            for field in self.categorical_fields:
                raw = NULL_CATEGORY if row.get(field) is None else str(row[field])
                known = self.categories[field]
                category = raw if raw in known else UNKNOWN_CATEGORY
                row_indices.append(row_index)
                column_indices.append(category_offsets[field] + known.index(category))
                values.append(1.0)
        return sparse.csr_matrix(
            (values, (row_indices, column_indices)),
            shape=(len(materialized), offset),
            dtype=np.float64,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": "kfc-feature-encoder-v1",
            "categoricalFields": list(self.categorical_fields),
            "numericFields": list(self.numeric_fields),
            "categories": {
                field: list(values) for field, values in self.categories.items()
            },
            "numericScales": self.numeric_scales,
            "featureNames": list(self.feature_names),
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> FeatureEncoder:
        if value.get("schemaVersion") != "kfc-feature-encoder-v1":
            raise ValueError("unsupported feature encoder schema")
        encoder = cls(
            tuple(value["categoricalFields"]),
            tuple(value["numericFields"]),
            {
                str(field): tuple(categories)
                for field, categories in value["categories"].items()
            },
            {
                str(field): float(scale)
                for field, scale in value.get("numericScales", {}).items()
            },
        )
        if list(encoder.feature_names) != value.get("featureNames"):
            raise ValueError("feature encoder ordering does not match")
        return encoder
