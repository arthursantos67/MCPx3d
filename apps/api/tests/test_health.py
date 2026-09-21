import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi.testclient import TestClient
from pydantic import AnyHttpUrl

from api.config import Settings, get_settings
from api.main import app


class _PulseHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/pulse":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format: str, *args: object) -> None:  # silence stdout noise
        pass


@pytest.fixture
def stub_mcp_server() -> Iterator[str]:
    server = HTTPServer(("127.0.0.1", 0), _PulseHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        thread.join()


@pytest.fixture(autouse=True)
def _reset_dependency_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.clear()


def test_health_returns_ok() -> None:
    client = TestClient(app)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_mcp_health_reports_unreachable_for_closed_port() -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(mcp_base_url=AnyHttpUrl("http://127.0.0.1:1"))
    client = TestClient(app)

    response = client.get("/api/health/mcp")

    assert response.status_code == 200
    body = response.json()
    assert body["reachable"] is False
    assert "Traceback" not in body["detail"]


def test_mcp_health_reports_reachable(stub_mcp_server: str) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(mcp_base_url=AnyHttpUrl(stub_mcp_server))
    client = TestClient(app)

    response = client.get("/api/health/mcp")

    assert response.status_code == 200
    assert response.json() == {"reachable": True, "detail": None}
