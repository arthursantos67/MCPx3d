from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import AnyHttpUrl

from api.config import Settings, get_settings
from api.main import app
from api.projects import ProjectSessionService, get_project_service


@pytest.fixture
def import_client() -> Iterator[tuple[TestClient, ProjectSessionService]]:
    projects = ProjectSessionService(ttl_seconds=3600)
    app.dependency_overrides[get_project_service] = lambda: projects
    app.dependency_overrides[get_settings] = lambda: Settings(x3d_backend="mcp", mcp_base_url=AnyHttpUrl("http://127.0.0.1:1"))
    yield TestClient(app), projects
    app.dependency_overrides.clear()


def manifest() -> dict[str, object]:
    return {
        "schemaVersion": "1.0", "projectId": "prj_from_another_machine", "revision": 42, "units": "mm",
        "scene": {"title": "Imported bracket", "titleSource": "user", "displayScale": 0.001, "background": "#ffffff"},
        "objects": [{
            "id": "bracket_body", "name": "Body", "kind": "box",
            "dimensions": {"width": 100, "height": 20, "depth": 80},
            "transform": {"position": [0, 10, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]},
            "material": {"color": "#808080"},
        }],
    }


def test_invalid_manifest_version_preserves_project(import_client: tuple[TestClient, ProjectSessionService]) -> None:
    client, projects = import_client
    project = projects.create_project()
    payload = manifest()
    payload["schemaVersion"] = "2.0"
    response = client.post(f"/api/projects/{project.project_id}/import?expectedRevision=0", json=payload)
    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_MANIFEST"
    assert projects.get_project(project.project_id).revision == 0


def test_wrong_primitive_dimensions_are_rejected_before_mcp(import_client: tuple[TestClient, ProjectSessionService]) -> None:
    client, projects = import_client
    project = projects.create_project()
    payload = manifest()
    payload["objects"][0]["dimensions"] = {"radius": 10}  # type: ignore[index]
    response = client.post(f"/api/projects/{project.project_id}/import?expectedRevision=0", json=payload)
    assert response.status_code == 422
    assert response.json()["code"] == "DOMAIN_VALIDATION_FAILED"
    assert projects.get_project(project.project_id).revision == 0


def test_stale_import_does_not_contact_mcp(import_client: tuple[TestClient, ProjectSessionService]) -> None:
    client, projects = import_client
    project = projects.create_project()
    response = client.post(f"/api/projects/{project.project_id}/import?expectedRevision=7", json=manifest())
    assert response.status_code == 409
    assert response.json()["code"] == "REVISION_CONFLICT"


def test_manifest_upload_limit_is_enforced_before_parsing(import_client: tuple[TestClient, ProjectSessionService]) -> None:
    client, projects = import_client
    app.dependency_overrides[get_settings] = lambda: Settings(max_artifact_bytes=100)
    project = projects.create_project()
    response = client.post(f"/api/projects/{project.project_id}/import?expectedRevision=0", content=b"x" * 101)
    assert response.status_code == 413
    assert response.json()["code"] == "COMPLEXITY_LIMIT"
    assert projects.get_project(project.project_id).revision == 0


def test_imported_model_is_revalidated_and_committed(x3d_mcp_server: str, import_client: tuple[TestClient, ProjectSessionService]) -> None:
    client, projects = import_client
    app.dependency_overrides[get_settings] = lambda: Settings(x3d_backend="mcp", mcp_base_url=AnyHttpUrl(x3d_mcp_server))
    project = projects.create_project()
    response = client.post(f"/api/projects/{project.project_id}/import?expectedRevision=0", json=manifest())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["revision"] == 1
    assert body["modelSpec"]["projectId"] == project.project_id
    assert body["modelSpec"]["scene"]["title"] == "Imported bracket"
    assert body["modelSpec"]["objects"][0]["id"] == "bracket_body"
    assert body["validation"]["schemaValid"] is True
    assert body["validation"]["semanticValid"] is True
    assert projects.get_project(project.project_id).validated_x3d[1]
