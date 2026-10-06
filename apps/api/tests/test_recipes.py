from collections.abc import Iterator
from pathlib import Path

import pytest
from domain.model_plan import ModelPlan
from fastapi.testclient import TestClient
from pydantic import AnyHttpUrl

from api.config import Settings, get_settings
from api.main import app
from api.mutation import apply_plan
from api.overlap import find_unintended_overlaps
from api.projects import ProjectSessionService, get_project_service
from api.recipes import RecipeStore
from api.routes.recipes import get_recipe_store


@pytest.fixture
def recipe_client(tmp_path: Path) -> Iterator[tuple[TestClient, ProjectSessionService, RecipeStore]]:
    projects = ProjectSessionService(ttl_seconds=3600)
    store = RecipeStore(tmp_path / "recipes.sqlite3")
    app.dependency_overrides[get_project_service] = lambda: projects
    app.dependency_overrides[get_recipe_store] = lambda: store
    yield TestClient(app), projects, store
    app.dependency_overrides.clear()


def test_seeded_table_is_searchable_and_replayable(recipe_client: tuple[TestClient, ProjectSessionService, RecipeStore]) -> None:
    client, projects, store = recipe_client
    found = client.get("/api/recipes/match", params={"q": "Quero uma mesa"})
    assert found.status_code == 200
    assert found.json()["id"] == "builtin_table"
    assert len(found.json()["plan"]["operations"]) == 10
    assert client.get("/api/recipes", params={"q": "MESA"}).json()[0]["id"] == "builtin_table"
    assert client.get("/api/recipes/match", params={"q": "mesa com um furo de 20 mm"}).json() is None
    assert RecipeStore(store.path).get("builtin_table") is not None

    project = projects.create_project()
    candidate = apply_plan(project.model_spec, ModelPlan.model_validate(found.json()["plan"]))
    assert len(candidate.objects) == 9
    assert {obj.name for obj in candidate.objects} >= {"Tampo", "Perna dianteira esquerda"}


def test_generic_kitchen_request_reuses_a_detailed_nonoverlapping_recipe(
    recipe_client: tuple[TestClient, ProjectSessionService, RecipeStore],
) -> None:
    client, projects, store = recipe_client
    request = (
        "quero que crie para mim uma cozinha completa. tenha cuidado para nao sobrepor nenhum movel "
        "ou objeto, e de atencao ao detalhe dos itens, quero puxadores, torneiras, lustres e etc"
    )
    found = client.get("/api/recipes/match", params={"q": request})
    assert found.status_code == 200, found.text
    assert found.json()["id"] == "builtin_kitchen"
    recipe = store.get("builtin_kitchen")
    assert recipe is not None
    project = projects.create_project()
    candidate = apply_plan(project.model_spec, recipe.plan)
    assert len(candidate.objects) == recipe.objectCount >= 60
    assert find_unintended_overlaps(candidate, recipe.plan) == []
    ids = {obj.id for obj in candidate.objects}
    assert {"fridge_lower_handle", "fridge_upper_handle", "basin_floor", "basin_left", "basin_right",
            "faucet_spout", "hood_canopy", "cooktop", "burner_front_left", "pendant_left_shade",
            "pendant_right_shade", "island_top"} <= ids
    parts = {obj.id: obj for obj in candidate.objects}
    assert parts["basin_floor"].transform.position[1] < parts["counter_sink_front"].transform.position[1]
    assert parts["fridge_lower_handle"].transform.position[2] > parts["fridge_lower_door"].transform.position[2]
    assert parts["hood_canopy"].transform.position[0] == parts["cooktop"].transform.position[0]
    assert parts["hood_canopy"].transform.position[1] > parts["cooktop"].transform.position[1]
    assert parts["pendant_left_shade"].transform.position[2] == parts["island_top"].transform.position[2]
    assert parts["pendant_right_shade"].transform.position[2] == parts["island_top"].transform.position[2]
    assert client.get("/api/recipes/match", params={"q": "cozinha sem ilha"}).json() is None
    assert client.get("/api/recipes/match", params={"q": "cozinha com lava-loucas"}).json() is None
    assert client.get("/api/recipes/match", params={"q": "cozinha azul com bancada de 2400 mm"}).json() is None


def test_seeded_kitchen_passes_real_mcp_validation(
    recipe_client: tuple[TestClient, ProjectSessionService, RecipeStore], x3d_mcp_server: str,
) -> None:
    client, projects, store = recipe_client
    app.dependency_overrides[get_settings] = lambda: Settings(x3d_backend="mcp", mcp_base_url=AnyHttpUrl(x3d_mcp_server))
    project = projects.create_project()
    recipe = store.get("builtin_kitchen")
    assert recipe is not None
    response = client.post(
        f"/api/projects/{project.project_id}/plans",
        json={"expectedRevision": 0, "plan": recipe.plan.model_dump(mode="json")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["validation"]["semanticValid"] is True
    assert response.json()["revision"] == 1


def test_validated_model_can_be_saved_and_reused_after_store_restart(recipe_client: tuple[TestClient, ProjectSessionService, RecipeStore]) -> None:
    client, projects, store = recipe_client
    project = projects.create_project()
    plan = ModelPlan.model_validate({"intent": "create", "operations": [
        {"op": "create_object", "id": "part", "name": "Part", "kind": "box", "dimensions": {"width": 10, "height": 20, "depth": 30}, "color": "#abcdef"},
        {"op": "scale_object", "target": "part", "factor": [2, 1, 1]},
        {"op": "set_material", "target": "part", "transparency": 0.25},
    ]})
    candidate = apply_plan(project.model_spec, plan)
    projects.commit_revision(project.project_id, 0, candidate, "<X3D/>")

    saved = client.post("/api/recipes", json={"projectId": project.project_id, "expectedRevision": 1, "name": "Custom part"})
    assert saved.status_code == 201
    loaded = RecipeStore(store.path).get(saved.json()["id"])
    assert loaded is not None
    replay = apply_plan(projects.create_project().model_spec, loaded.plan)
    assert replay.objects[0].dimensions == candidate.objects[0].dimensions
    assert replay.objects[0].transform == candidate.objects[0].transform
    assert replay.objects[0].material == candidate.objects[0].material


def test_unvalidated_revision_cannot_be_saved(recipe_client: tuple[TestClient, ProjectSessionService, RecipeStore]) -> None:
    client, projects, _ = recipe_client
    project = projects.create_project()
    project.model_spec = project.model_spec.model_copy(update={"revision": 1})
    response = client.post("/api/recipes", json={"projectId": project.project_id, "expectedRevision": 1, "name": "Unsafe"})
    assert response.status_code == 422
    assert response.json()["code"] == "RECIPE_REQUIRES_VALIDATED_MODEL"


def test_seeded_table_passes_real_mcp_validation(
    recipe_client: tuple[TestClient, ProjectSessionService, RecipeStore], x3d_mcp_server: str
) -> None:
    client, projects, store = recipe_client
    app.dependency_overrides[get_settings] = lambda: Settings(x3d_backend="mcp", mcp_base_url=AnyHttpUrl(x3d_mcp_server))
    project = projects.create_project()
    recipe = store.get("builtin_table")
    assert recipe is not None
    response = client.post(
        f"/api/projects/{project.project_id}/plans",
        json={"expectedRevision": 0, "plan": recipe.plan.model_dump(mode="json")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["validation"]["schemaValid"] is True
    assert response.json()["validation"]["semanticValid"] is True
    assert response.json()["revision"] == 1
