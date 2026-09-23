"""HTTP-layer tests for `api.routes.projects` (Issue #21).

Unlike `test_projects.py` (the `ProjectSessionService` unit tests), these go
through `TestClient(app)` to exercise routing, status codes, and the
standardized error body (PRD §9.4).
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.projects import ProjectSessionService, get_project_service


@pytest.fixture(autouse=True)
def _reset_dependency_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def project_service() -> ProjectSessionService:
    service = ProjectSessionService(ttl_seconds=3600.0)
    app.dependency_overrides[get_project_service] = lambda: service
    return service


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_create_project_returns_an_empty_model_spec_at_revision_zero(
    client: TestClient, project_service: ProjectSessionService
) -> None:
    response = client.post("/api/projects")

    assert response.status_code == 201
    body = response.json()
    assert body["projectId"].startswith("prj_")
    assert body["revision"] == 0
    assert body["objects"] == []


def test_get_project_returns_the_created_session(
    client: TestClient, project_service: ProjectSessionService
) -> None:
    created = client.post("/api/projects").json()

    response = client.get(f"/api/projects/{created['projectId']}")

    assert response.status_code == 200
    assert response.json()["projectId"] == created["projectId"]


def test_get_unknown_project_returns_standardized_404(
    client: TestClient, project_service: ProjectSessionService
) -> None:
    response = client.get("/api/projects/prj_does_not_exist")

    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "PROJECT_NOT_FOUND"
    assert "correlationId" in body
    assert "Traceback" not in body["message"]


def test_delete_project_removes_it(client: TestClient, project_service: ProjectSessionService) -> None:
    created = client.post("/api/projects").json()

    delete_response = client.delete(f"/api/projects/{created['projectId']}")
    assert delete_response.status_code == 204

    get_response = client.get(f"/api/projects/{created['projectId']}")
    assert get_response.status_code == 404


def test_delete_unknown_project_is_a_no_op(
    client: TestClient, project_service: ProjectSessionService
) -> None:
    response = client.delete("/api/projects/prj_does_not_exist")

    assert response.status_code == 204


def test_create_project_ids_are_distinct(
    client: TestClient, project_service: ProjectSessionService
) -> None:
    first = client.post("/api/projects").json()
    second = client.post("/api/projects").json()

    assert first["projectId"] != second["projectId"]
