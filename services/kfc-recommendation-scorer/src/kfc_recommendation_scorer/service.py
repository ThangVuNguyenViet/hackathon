from __future__ import annotations

from contextlib import suppress
from pathlib import Path
from typing import Any

from .bundle import BundleUnavailable, QualifiedBundle, load_qualified_bundle
from .native_runtime import QualifiedBundleRuntime


class ScorerApplication:
    """Fail-closed scorer lifecycle; it never installs a substitute ranker."""

    def __init__(
        self,
        *,
        bundle_path: Path,
        expected_bundle_digest: str,
        expected_contract_digest: str = "",
        expected_feature_digest: str = "",
        expected_composer_digest: str = "",
    ) -> None:
        self._bundle: QualifiedBundle | None = None
        self._runtime: QualifiedBundleRuntime | None = None
        with suppress(BundleUnavailable):
            self._bundle = load_qualified_bundle(
                bundle_path,
                expected_bundle_digest=expected_bundle_digest,
                expected_contract_digest=expected_contract_digest,
                expected_feature_digest=expected_feature_digest,
                expected_composer_digest=expected_composer_digest,
            )
            self._runtime = QualifiedBundleRuntime(self._bundle)

    def readiness(self) -> dict[str, Any]:
        if self._bundle is None or self._runtime is None:
            return {"ready": False, "code": "qualified_bundle_unavailable"}
        return {"ready": True, "bundleDigest": self._bundle.digest}

    def model_binding(self, recommendation_type: str) -> dict[str, str]:
        if self._bundle is None or self._runtime is None:
            raise BundleUnavailable("qualified_bundle_unavailable")
        return self._bundle.model_binding(recommendation_type)

    def score(self, _request: Any) -> dict[str, Any]:
        if self._bundle is None or self._runtime is None:
            raise BundleUnavailable("qualified_bundle_unavailable")
        return self._runtime.score(_request)
