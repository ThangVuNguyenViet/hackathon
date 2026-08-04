from __future__ import annotations

import hashlib
import json
from enum import Enum
from pathlib import Path

AUTOMATIC_SCORER_SCHEMA_VERSION = "kfc-automatic-scorer-v1"


class AutomaticRecommendationType(str, Enum):
    LOCAL_FAVORITE = "local_favorite"
    FOR_YOU = "for_you"
    MODIFIER_UPSELL = "modifier_upsell"
    SMART_CROSS_SELL = "smart_cross_sell"


def automatic_recommendation_contract_digest(contract_root: Path) -> str:
    manifest = json.loads((contract_root / "contract-manifest.json").read_text())
    digest = hashlib.sha256()
    for relative_path in manifest["authorityFiles"]:
        digest.update(relative_path.encode("utf-8"))
        digest.update(b"\0")
        digest.update((contract_root / relative_path).read_bytes())
        digest.update(b"\0")

    actual = digest.hexdigest()
    expected = manifest["canonicalDigest"]
    if actual != expected:
        raise ValueError(
            f"automatic recommendation contract digest mismatch: {actual} != {expected}"
        )
    return actual
