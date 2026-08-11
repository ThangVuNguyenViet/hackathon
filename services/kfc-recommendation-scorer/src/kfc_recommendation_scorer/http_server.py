from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .bundle import BundleUnavailable
from .service import ScorerApplication


def _handler(application: ScorerApplication) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _json(self, status: int, value: dict[str, Any]) -> None:
            body = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path != "/ready":
                self._json(HTTPStatus.NOT_FOUND, {"code": "not_found"})
                return
            readiness = application.readiness()
            self._json(
                HTTPStatus.OK if readiness["ready"] else HTTPStatus.SERVICE_UNAVAILABLE,
                readiness,
            )

        def do_POST(self) -> None:
            if self.path != "/v1/score":
                self._json(HTTPStatus.NOT_FOUND, {"code": "not_found"})
                return
            try:
                length = int(self.headers.get("content-length", "0"))
                if length <= 0 or length > 1_048_576:
                    raise ValueError("invalid content length")
                request = json.loads(self.rfile.read(length))
                self._json(HTTPStatus.OK, application.score(request))
            except (ValueError, json.JSONDecodeError):
                self._json(
                    HTTPStatus.BAD_REQUEST,
                    {"code": "invalid_scorer_request", "retryable": False},
                )
            except BundleUnavailable as error:
                self._json(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    {"code": str(error), "retryable": True},
                )

        def log_message(self, _format: str, *_args: object) -> None:
            return

    return Handler


def create_http_server(
    application: ScorerApplication, *, host: str, port: int
) -> ThreadingHTTPServer:
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("scorer must bind only to localhost")
    return ThreadingHTTPServer((host, port), _handler(application))
