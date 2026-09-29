import copy
from collections.abc import Iterator

import cadquery as cq
import pytest
from fastapi.testclient import TestClient

from api.cad_projects import CadProjectStore
from api.main import app
from api.routes.cad_projects import get_cad_project_store


@pytest.fixture(autouse=True)
def _reset_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.clear()


SPEC = {
    "schemaVersion": "3.0", "units": "mm", "partId": "bearing_mount",
    "steps": [
        {"id": "foot", "op": "base", "shape": "box", "position": {"x": 0, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0}, "width": 80, "depth": 50, "height": 10},
        {"id": "boss", "op": "union", "shape": "cylinder", "position": {"x": 0, "y": 0, "z": 8}, "rotation": {"x": 0, "y": 0, "z": 0}, "diameter": 30, "height": 10},
        {"id": "bore", "op": "cut", "shape": "cylinder", "position": {"x": 0, "y": 0, "z": 8}, "rotation": {"x": 0, "y": 0, "z": 0}, "diameter": 12, "height": 40},
    ],
}


def test_program_creates_mesh_and_editable_step_project(tmp_path) -> None:
    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(tmp_path / "cad.sqlite3")
    client = TestClient(app)
    inspected = client.post("/api/cad/programs/inspect", json=SPEC)
    mesh = client.post("/api/cad/programs/mesh", json=SPEC)
    created = client.post("/api/cad/projects", json={"spec": SPEC})
    assert inspected.status_code == mesh.status_code == 200
    assert created.status_code == 201, created.text
    assert inspected.json()["boundsMm"] == pytest.approx([80, 50, 18])
    assert len(mesh.json()["triangles"]) > 100
    assert created.json()["spec"]["schemaVersion"] == "3.0"
    project_id = created.json()["projectId"]
    step = client.get(f"/api/cad/projects/{project_id}/revisions/0/step")
    assert step.status_code == 200
    path = tmp_path / "part.step"
    path.write_bytes(step.content)
    solid = cq.importers.importStep(str(path)).solids().vals()[0]
    assert solid.isValid()
    assert solid.Volume() == pytest.approx(inspected.json()["volumeMm3"])

    revised = copy.deepcopy(SPEC)
    revised["steps"][0]["width"] = 90
    saved = client.post(f"/api/cad/projects/{project_id}/spec", json={"expectedRevision": 0, "spec": revised})
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 1
    assert client.get(f"/api/cad/projects/{project_id}").json()["spec"]["steps"][0]["width"] == 90
    assert client.get(f"/api/cad/projects/{project_id}/revisions/0").json()["spec"]["steps"][0]["width"] == 80


def test_program_rejects_disconnected_and_noop_operations(tmp_path) -> None:
    client = TestClient(app)
    disconnected = copy.deepcopy(SPEC)
    disconnected["steps"][1]["position"]["x"] = 100
    floating = client.post("/api/cad/programs/inspect", json=disconnected)
    assert floating.status_code == 422
    assert "CAD step boss (union) leaves 2 separate solids" in floating.text
    zero = {"x": 0, "y": 0, "z": 0}
    split = {"schemaVersion": "3.0", "units": "mm", "partId": "bar", "steps": [
        {"id": "bar", "op": "base", "shape": "box", "position": zero, "rotation": zero, "width": 100, "depth": 10, "height": 10},
        {"id": "slots", "op": "cut", "shape": "box", "position": {"x": -20, "y": 0, "z": 0}, "rotation": zero,
         "width": 4, "depth": 20, "height": 20, "pattern": {"kind": "linear", "count": 2, "offset": {"x": 40, "y": 0, "z": 0}}},
    ]}
    severed = client.post("/api/cad/programs/inspect", json=split)
    assert severed.status_code == 422
    assert "CAD step slots instance 1 (cut) leaves 2 separate solids" in severed.text
    noop = copy.deepcopy(SPEC)
    noop["steps"][2]["position"]["x"] = 100
    assert client.post("/api/cad/programs/inspect", json=noop).status_code == 422
    invalid = copy.deepcopy(SPEC)
    invalid["steps"][1]["id"] = "foot"
    assert client.post("/api/cad/projects", json={"spec": invalid}).status_code == 400


def test_polygon_profile_supports_custom_outline_and_rotated_cut() -> None:
    client = TestClient(app)
    custom = {
        "schemaVersion": "3.0", "units": "mm", "partId": "custom_profile",
        "steps": [
            {"id": "outline", "op": "base", "shape": "polygon_prism", "position": {"x": 0, "y": 0, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0},
             "points": [{"x": -30, "y": -20}, {"x": 30, "y": -20}, {"x": 30, "y": -10}, {"x": -10, "y": -10}, {"x": -10, "y": 20}, {"x": -30, "y": 20}], "height": 12},
            {"id": "cross_hole", "op": "cut", "shape": "cylinder", "position": {"x": -20, "y": 0, "z": 0}, "rotation": {"x": 90, "y": 0, "z": 0}, "diameter": 6, "height": 60},
        ],
    }
    response = client.post("/api/cad/programs/inspect", json=custom)
    assert response.status_code == 200, response.text
    assert response.json()["boundsMm"] == pytest.approx([60, 40, 12])


def test_patterns_reuse_primitives_for_repeated_teeth_and_holes() -> None:
    client = TestClient(app)
    patterned = {
        "schemaVersion": "3.0", "units": "mm", "partId": "patterned_wheel",
        "steps": [
            {"id": "wheel", "op": "base", "shape": "cylinder", "position": {"x": 0, "y": 0, "z": 0},
             "rotation": {"x": 0, "y": 0, "z": 0}, "diameter": 60, "height": 10},
            {"id": "repeated_teeth", "op": "union", "shape": "box", "position": {"x": 30.8, "y": 0, "z": 0},
             "rotation": {"x": 0, "y": 0, "z": 0}, "width": 6, "depth": 5, "height": 10,
             "pattern": {"kind": "circular", "count": 20, "axis": "z"}},
            {"id": "bore", "op": "cut", "shape": "cylinder", "position": {"x": 0, "y": 0, "z": 0},
             "rotation": {"x": 0, "y": 0, "z": 0}, "diameter": 10, "height": 20},
        ],
    }
    inspected = client.post("/api/cad/programs/inspect", json=patterned)
    assert inspected.status_code == 200, inspected.text
    assert inspected.json()["boundsMm"][0] > 60
    mesh = client.post("/api/cad/programs/mesh", json=patterned)
    assert mesh.status_code == 200, mesh.text
    assert len(mesh.json()["triangles"]) > 100

    linear = copy.deepcopy(SPEC)
    linear["steps"] = [linear["steps"][0], {
        "id": "hole_row", "op": "cut", "shape": "cylinder", "position": {"x": -30, "y": 0, "z": 0},
        "rotation": {"x": 0, "y": 0, "z": 0}, "diameter": 5, "height": 20,
        "pattern": {"kind": "linear", "count": 4, "offset": {"x": 20, "y": 0, "z": 0}},
    }]
    assert client.post("/api/cad/programs/inspect", json=linear).status_code == 200


def test_patterns_reject_zero_spacing_and_base_repetition() -> None:
    client = TestClient(app)
    invalid = copy.deepcopy(SPEC)
    invalid["steps"][1]["pattern"] = {"kind": "linear", "count": 4, "offset": {"x": 0, "y": 0, "z": 0}}
    assert client.post("/api/cad/programs/inspect", json=invalid).status_code == 400
    invalid = copy.deepcopy(SPEC)
    invalid["steps"][0]["pattern"] = {"kind": "circular", "count": 8}
    assert client.post("/api/cad/programs/inspect", json=invalid).status_code == 400
