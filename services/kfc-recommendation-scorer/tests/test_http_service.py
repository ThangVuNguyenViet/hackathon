from __future__ import annotations

import http.client
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path

SCORER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCORER_ROOT / "src"))

from kfc_recommendation_scorer.http_server import create_http_server  # noqa: E402
from kfc_recommendation_scorer.service import ScorerApplication  # noqa: E402


class HttpServiceTest(unittest.TestCase):
    def test_unqualified_service_is_unready_and_score_is_typed_503(self) -> None:
        app = ScorerApplication(
            bundle_path=Path(tempfile.gettempdir()) / "missing-kfc-bundle-http",
            expected_bundle_digest="a" * 64,
        )
        server = create_http_server(app, host="127.0.0.1", port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
            connection.request("GET", "/ready")
            ready = connection.getresponse()
            self.assertEqual(ready.status, 503)
            self.assertEqual(
                json.loads(ready.read()),
                {"ready": False, "code": "qualified_bundle_unavailable"},
            )

            connection.request(
                "POST",
                "/v1/score",
                body="{}",
                headers={"content-type": "application/json"},
            )
            scored = connection.getresponse()
            self.assertEqual(scored.status, 503)
            self.assertEqual(
                json.loads(scored.read()),
                {"code": "qualified_bundle_unavailable", "retryable": True},
            )
        finally:
            connection.close()
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
