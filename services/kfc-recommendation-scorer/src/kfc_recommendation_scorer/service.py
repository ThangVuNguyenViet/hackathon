from __future__ import annotations

from contextlib import suppress
from pathlib import Path
from typing import Any

from .bundle import BundleUnavailable, QualifiedBundle, load_qualified_bundle


class ScorerApplication:
    """Fail-closed scorer lifecycle; it never installs a substitute ranker."""

    def __init__(self, *, bundle_path: Path, expected_bundle_digest: str) -> None:
        self._bundle: QualifiedBundle | None = None
        with suppress(BundleUnavailable):
            self._bundle = load_qualified_bundle(
                bundle_path, expected_bundle_digest=expected_bundle_digest
            )

    def readiness(self) -> dict[str, Any]:
        if self._bundle is None:
            return {"ready": False, "code": "qualified_bundle_unavailable"}
        # A manifest alone is insufficient: native predictors and their golden
        # vectors must load before readiness may turn true. Task 4 emitted no
        # bundle, so no serving runtime is installed or substituted here.
        return {"ready": False, "code": "qualified_bundle_runtime_unavailable"}

    def score(self, _request: Any) -> dict[str, Any]:
        if self._bundle is None:
            raise BundleUnavailable("qualified_bundle_unavailable")
        raise BundleUnavailable("qualified_bundle_runtime_not_loaded")
