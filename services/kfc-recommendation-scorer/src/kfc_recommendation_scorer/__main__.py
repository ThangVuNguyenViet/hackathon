from __future__ import annotations

import os
from pathlib import Path

from .http_server import create_http_server
from .service import ScorerApplication


def main() -> None:
    application = ScorerApplication(
        bundle_path=Path(os.environ.get("QUALIFIED_BUNDLE_PATH", "/opt/kfc/bundle")),
        expected_bundle_digest=os.environ.get("QUALIFIED_BUNDLE_DIGEST", ""),
    )
    server = create_http_server(
        application,
        host="127.0.0.1",
        port=int(os.environ.get("SCORER_PORT", "8081")),
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
