import json
from collections.abc import Iterator
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest
from fastapi.testclient import TestClient

from api.config import Settings, get_settings
from api.main import app
from api.projects import ProjectSessionService, get_project_service
from api.recipes import RecipeStore
from api.routes.recipes import get_recipe_store
from api.x3d_backend import LocalX3DBackend
from api.x3d_validation import validate_scene_content


@pytest.fixture
def local_client(tmp_path: Path) -> Iterator[TestClient]:
    projects = ProjectSessionService(ttl_seconds=3600, default_display_scale=0.001)
    app.dependency_overrides[get_project_service] = lambda: projects
    app.dependency_overrides[get_settings] = lambda: Settings(x3d_backend="local", mcp_base_url="http://127.0.0.1:1")
    recipes = RecipeStore(tmp_path / "recipes.sqlite3")
    app.dependency_overrides[get_recipe_store] = lambda: recipes
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def test_local_scene_commit_preview_exports_and_import_without_mcp(local_client: TestClient) -> None:
    client = local_client
    project = client.post("/api/projects").json()
    project_id = project["projectId"]
    plan = {"intent": "create_model", "operations": [
        {"op": "set_scene", "background": "#edf2f7"},
        {"op": "create_object", "id": "body", "name": "Body", "kind": "box",
         "dimensions": {"width": 100, "height": 20, "depth": 80},
         "position": [0, 10, 0], "color": "#336699"},
        {"op": "create_object", "id": "ball", "name": "Ball", "kind": "sphere",
         "dimensions": {"radius": 10}, "position": [100, 10, 0], "color": "#aabbcc"},
        {"op": "scale_object", "target": "ball", "factor": [2, 1, 1]},
        {"op": "set_material", "target": "ball", "transparency": 0.3},
    ]}
    response = client.post(f"/api/projects/{project_id}/plans", json={"expectedRevision": 0, "plan": plan})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["validation"]["schemaValid"] and payload["validation"]["semanticValid"]
    assert "x3d_scene_build" in payload["timings"]
    assert "mcp_connect" not in payload["timings"]
    x3d = client.get(f"/api/projects/{project_id}/artifacts/x3d?revision=1")
    assert x3d.status_code == 200
    root = ET.fromstring(x3d.content)
    assert root.find(".//Box").get("size") == "0.1 0.02 0.08"
    assert root.find(".//Transform[@DEF='obj_ball']").get("scale") == "2 1 1"
    assert root.find(".//Transform[@DEF='obj_ball']//Material").get("transparency") == "0.3"
    html = client.get(payload["preview"]["url"])
    assert html.status_code == 200 and "<box" in html.text and "</box>" in html.text
    vrml = client.get(f"/api/projects/{project_id}/artifacts/x3dv?revision=1")
    assert vrml.status_code == 200 and vrml.text.startswith("#X3D")
    manifest = client.get(f"/api/projects/{project_id}/artifacts/manifest?revision=1").json()
    imported = client.post(f"/api/projects/{project_id}/import?expectedRevision=1", json=manifest)
    assert imported.status_code == 200 and imported.json()["revision"] == 2
    assert client.get(f"/api/projects/{project_id}/artifacts/x3d?revision=1").status_code == 404


@pytest.mark.anyio
async def test_local_validator_rejects_schema_and_semantic_errors() -> None:
    backend = LocalX3DBackend()
    invalid_schema = await validate_scene_content(backend, '<X3D profile="Immersive" version="4.0"><Scene><Box size="broken"/></Scene></X3D>')
    assert not invalid_schema.valid
    invalid_semantics = await validate_scene_content(backend, '<X3D profile="Immersive" version="4.0"><Scene><Transform DEF="a"/><Transform DEF="b"/><ROUTE fromNode="a" fromField="unknown" toNode="b" toField="translation"/></Scene></X3D>')
    assert invalid_semantics.schema_valid and not invalid_semantics.semantic_valid


def test_industrial_scene_preserves_visual_joints_and_warns_without_repair_loops(local_client: TestClient) -> None:
    plan = json.loads((Path(__file__).parents[3] / "tests/fixtures/x3d_industrial_cell.json").read_text())
    project_id = local_client.post("/api/projects").json()["projectId"]
    endpoint = f"/api/projects/{project_id}/plans"
    strict = local_client.post(endpoint, json={"expectedRevision": 0, "plan": plan, "overlapPolicy": "strict"})
    assert strict.status_code == 422
    report = strict.json()["details"][0]
    assert report["overlapCount"] > 10
    assert report["truncated"] is False
    assert len(report["pairs"]) == report["overlapCount"]
    assert local_client.get(f"/api/projects/{project_id}").json()["revision"] == 0

    result = local_client.post(endpoint, json={"expectedRevision": 0, "plan": plan})
    assert result.status_code == 200, result.text
    scene = result.json()
    assert scene["validation"]["schemaValid"] and scene["validation"]["semanticValid"]
    assert len(scene["modelSpec"]["objects"]) == 59
    assert scene["validation"]["warnings"][0]["check"] == "layout_bounds"
    assert scene["validation"]["autofixes"] == []
    positions = {operation["id"]: operation["position"] for operation in plan["operations"] if operation["op"] == "create_object"}
    assert {obj["id"]: obj["transform"]["position"] for obj in scene["modelSpec"]["objects"]} == positions

    changed = local_client.post(endpoint, json={"expectedRevision": 1, "plan": {"intent": "modify_model", "operations": [
        {"op": "set_material", "target": "robo_braco", "color": "#2469b2"},
    ]}})
    assert changed.status_code == 200, changed.text
    assert {obj["id"]: obj["transform"]["position"] for obj in changed.json()["modelSpec"]["objects"]} == positions
    assert local_client.get(f"/api/projects/{project_id}/state").json()["validation"]["warnings"]
    artifact = local_client.get(f"/api/projects/{project_id}/artifacts/x3d?revision=2")
    assert artifact.status_code == 200
    root = ET.fromstring(artifact.content)
    assert len(root.findall(".//Transform[@DEF]")) == 59


def test_engine_health_reports_local_x3d_and_cad(local_client: TestClient) -> None:
    response = local_client.get("/api/health/engines")
    assert response.status_code == 200
    assert response.json()["x3d"] == {"available": True, "backend": "local", "detail": None}
    assert response.json()["cad"]["available"]


@pytest.mark.parametrize("prompt,objects", [("quero uma mesa", 9), ("crie uma cozinha completa", 65)])
def test_local_backend_validates_composed_recipes(local_client: TestClient, prompt: str, objects: int) -> None:
    recipe = local_client.get("/api/recipes/match", params={"q": prompt}).json()
    assert recipe is not None
    project = local_client.post("/api/projects").json()
    response = local_client.post(f'/api/projects/{project["projectId"]}/plans', json={
        "expectedRevision": 0, "plan": recipe["plan"],
    })
    assert response.status_code == 200, response.text
    assert len(response.json()["modelSpec"]["objects"]) == objects
    assert response.json()["validation"]["schemaValid"]
    assert response.json()["validation"]["semanticValid"]
