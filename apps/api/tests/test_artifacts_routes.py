"""HTTP-layer tests for the standalone HTML artifact endpoint (Issue #11's
HTTP wiring, added for Issue #28's preview iframe).

Mirrors `test_plans_routes.py`'s conventions: error paths that must
short-circuit before any MCP call use a closed-port `mcp_base_url` (if the
endpoint tried to reach it, the request would fail with `MCP_UNAVAILABLE`
instead of the expected code), and the happy path uses the real vendored
`x3d_mcp` server (`x3d_mcp_server` fixture, `conftest.py`).
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import AnyHttpUrl

from api.config import Settings, get_settings
from api.main import app
from api.projects import ProjectSessionService, get_project_service

_CLOSED_PORT_URL = AnyHttpUrl("http://127.0.0.1:1")

_CREATE_CUBE_PLAN = {
    "intent": "create_model",
    "operations": [
        {
            "op": "create_object",
            "name": "Cube",
            "kind": "box",
            "dimensions": {"width": 10, "height": 10, "depth": 10},
            "color": "#ff0000",
        }
    ],
}


@pytest.fixture(autouse=True)
def _reset_dependency_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def project_service() -> ProjectSessionService:
    service = ProjectSessionService(ttl_seconds=3600.0)
    app.dependency_overrides[get_project_service] = lambda: service
    return service


def test_unknown_project_returns_standardized_404(
    project_service: ProjectSessionService,
) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(mcp_base_url=_CLOSED_PORT_URL)
    client = TestClient(app)

    response = client.get("/api/projects/prj_does_not_exist/artifacts/html?revision=0")

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "PROJECT_NOT_FOUND"


def test_mcp_unavailable_maps_to_503(project_service: ProjectSessionService) -> None:
    session = project_service.create_project()
    app.dependency_overrides[get_settings] = lambda: Settings(mcp_base_url=_CLOSED_PORT_URL)
    client = TestClient(app)

    response = client.get(f"/api/projects/{session.project_id}/artifacts/html?revision=0")

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "MCP_UNAVAILABLE"


def test_valid_revision_returns_standalone_html(
    x3d_mcp_server: str, project_service: ProjectSessionService
) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(mcp_base_url=AnyHttpUrl(x3d_mcp_server))
    client = TestClient(app)
    session = project_service.create_project()
    commit = client.post(
        f"/api/projects/{session.project_id}/plans",
        json={"expectedRevision": 0, "plan": _CREATE_CUBE_PLAN},
    )
    assert commit.status_code == 200

    response = client.get(f"/api/projects/{session.project_id}/artifacts/html?revision=1")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "<html" in response.text.lower()


def test_stale_revision_maps_to_404_artifact_unavailable(
    x3d_mcp_server: str, project_service: ProjectSessionService
) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(mcp_base_url=AnyHttpUrl(x3d_mcp_server))
    client = TestClient(app)
    session = project_service.create_project()
    commit = client.post(
        f"/api/projects/{session.project_id}/plans",
        json={"expectedRevision": 0, "plan": _CREATE_CUBE_PLAN},
    )
    assert commit.status_code == 200

    response = client.get(f"/api/projects/{session.project_id}/artifacts/html?revision=0")

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "ARTIFACT_UNAVAILABLE"
