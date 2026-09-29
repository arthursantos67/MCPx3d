import json
import math
from collections.abc import Iterator
from pathlib import Path

import cadquery as cq
import pytest
from fastapi.testclient import TestClient

from api.cad_projects import CadProjectStore
from api.config import Settings, get_settings
from api.main import app
from api.routes.cad_projects import get_cad_project_store

_SPEC = {
    "schemaVersion": "2.0",
    "units": "mm",
    "partId": "saved_plate",
    "base": {"kind": "extruded_rectangle", "width": 100, "depth": 80, "thickness": 10},
    "features": [{"kind": "through_hole", "x": 10, "y": 5, "diameter": 12}],
}
_BRACKET = json.loads((Path(__file__).resolve().parents[3] / "packages/domain/fixtures/cad-part/valid-l-bracket.json").read_text(encoding="utf-8"))
_ROUNDED_PLATE = json.loads((Path(__file__).resolve().parents[3] / "packages/domain/fixtures/cad-part/valid-rounded-plate.json").read_text(encoding="utf-8"))
_ROUND_FLANGE = json.loads((Path(__file__).resolve().parents[3] / "packages/domain/fixtures/cad-part/valid-round-flange.json").read_text(encoding="utf-8"))
_COMPOSITE = json.loads((Path(__file__).resolve().parents[3] / "packages/domain/fixtures/cad-part/valid-composite-part.json").read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def _reset_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.clear()


def test_cad_project_persists_validated_revisions_and_exact_step(tmp_path) -> None:
    path = tmp_path / "cad.sqlite3"
    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(path)
    client = TestClient(app)

    created = client.post("/api/cad/projects", json={"spec": _SPEC})
    assert created.status_code == 201
    project_id = created.json()["projectId"]
    assert created.json()["revision"] == 0
    step0 = client.get(f"/api/cad/projects/{project_id}/revisions/0/step")
    assert step0.status_code == 200

    changed = client.post(f"/api/cad/projects/{project_id}/plans", json={
        "expectedRevision": 0,
        "plan": {"schemaVersion": "1.0", "operations": [
            {"op": "set_parameter", "parameter": "width", "value": 120},
            {"op": "set_parameter", "parameter": "hole_x", "value": 20},
        ]},
    })
    assert changed.status_code == 200
    assert changed.json()["revision"] == 1
    assert changed.json()["spec"]["base"]["width"] == 120
    assert changed.json()["spec"]["features"][0]["x"] == 20
    stale = client.post(f"/api/cad/projects/{project_id}/plans", json={
        "expectedRevision": 0,
        "plan": {"schemaVersion": "1.0", "operations": [
            {"op": "set_parameter", "parameter": "depth", "value": 90},
        ]},
    })
    assert stale.status_code == 409

    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(path)
    resumed = client.get(f"/api/cad/projects/{project_id}")
    old = client.get(f"/api/cad/projects/{project_id}/revisions/0")
    step1 = client.get(f"/api/cad/projects/{project_id}/revisions/1/step")
    assert resumed.status_code == 200
    assert resumed.json()["revision"] == 1
    assert old.json()["spec"]["base"]["width"] == 100
    assert client.get(f"/api/cad/projects/{project_id}/revisions/0/step").content == step0.content
    assert step1.status_code == 200
    assert step1.content != step0.content
    file = tmp_path / "part.step"
    file.write_bytes(step1.content)
    solid = cq.importers.importStep(str(file)).solids().vals()[0]
    assert solid.isValid()
    assert solid.BoundingBox().xlen == pytest.approx(120)
    assert solid.Volume() == pytest.approx((120 * 80 - math.pi * 6**2) * 10)


def test_invalid_or_stale_edit_keeps_last_valid_cad_revision(tmp_path) -> None:
    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(tmp_path / "cad.sqlite3")
    client = TestClient(app)
    created = client.post("/api/cad/projects", json={"spec": _SPEC})
    project_id = created.json()["projectId"]
    endpoint = f"/api/cad/projects/{project_id}/plans"

    invalid = client.post(endpoint, json={"expectedRevision": 0, "plan": {
        "schemaVersion": "1.0", "operations": [
            {"op": "set_parameter", "parameter": "hole_diameter", "value": 90},
        ],
    }})
    stale = client.post(endpoint, json={"expectedRevision": 1, "plan": {
        "schemaVersion": "1.0", "operations": [
            {"op": "set_parameter", "parameter": "width", "value": 120},
        ],
    }})

    assert invalid.status_code == 422
    assert invalid.json()["code"] == "CAD_GEOMETRY_INVALID"
    assert stale.status_code == 409
    assert stale.json()["code"] == "REVISION_CONFLICT"
    assert client.get(f"/api/cad/projects/{project_id}").json()["revision"] == 0
    assert client.get(f"/api/cad/projects/{project_id}/revisions/1/step").status_code == 404


def test_unknown_cad_project_has_standard_error(tmp_path) -> None:
    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(tmp_path / "cad.sqlite3")
    response = TestClient(app).get("/api/cad/projects/cad_missing")
    assert response.status_code == 404
    assert response.json()["code"] == "CAD_PROJECT_NOT_FOUND"


def test_failed_step_build_does_not_commit_cad_edit(tmp_path) -> None:
    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(tmp_path / "cad.sqlite3")
    client = TestClient(app)
    project_id = client.post("/api/cad/projects", json={"spec": _SPEC}).json()["projectId"]
    app.dependency_overrides[get_settings] = lambda: Settings(max_artifact_bytes=100)

    failed = client.post(f"/api/cad/projects/{project_id}/plans", json={
        "expectedRevision": 0,
        "plan": {"schemaVersion": "1.0", "operations": [
            {"op": "set_parameter", "parameter": "width", "value": 120},
        ]},
    })

    assert failed.status_code == 413
    assert client.get(f"/api/cad/projects/{project_id}").json()["revision"] == 0
    assert client.get(f"/api/cad/projects/{project_id}/revisions/0/step").status_code == 200


def test_legacy_project_upgrades_to_mounting_plate_without_changing_old_revision(tmp_path) -> None:
    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(tmp_path / "cad.sqlite3")
    client = TestClient(app)
    project_id = client.post("/api/cad/projects", json={"spec": _SPEC}).json()["projectId"]
    endpoint = f"/api/cad/projects/{project_id}/plans"
    changed = client.post(endpoint, json={"expectedRevision": 0, "plan": {
        "schemaVersion": "2.0", "operations": [
            {"op": "set_corner_chamfer", "value": 4},
            {"op": "upsert_hole", "holeId": "hole_2", "x": -25, "y": -20, "diameter": 8},
        ],
    }})
    assert changed.status_code == 200, changed.text
    assert changed.json()["spec"]["schemaVersion"] == "2.1"
    assert changed.json()["spec"]["features"][0]["id"] == "hole_1"
    assert len(changed.json()["spec"]["features"]) == 2
    assert client.get(f"/api/cad/projects/{project_id}/revisions/0").json()["spec"]["schemaVersion"] == "2.0"

    rejected = client.post(endpoint, json={"expectedRevision": 1, "plan": {
        "schemaVersion": "2.0", "operations": [{"op": "remove_hole", "holeId": "hole_1"}],
    }})
    assert rejected.status_code == 422
    assert client.get(f"/api/cad/projects/{project_id}").json()["revision"] == 1


def test_bracket_project_supports_typed_wall_edits_and_validated_spec_revisions(tmp_path) -> None:
    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(tmp_path / "bracket.sqlite3")
    client = TestClient(app)
    created = client.post("/api/cad/projects", json={"spec": _BRACKET})
    assert created.status_code == 201, created.text
    project_id = created.json()["projectId"]
    edited = client.post(f"/api/cad/projects/{project_id}/plans", json={
        "expectedRevision": 0,
        "plan": {"schemaVersion": "3.0", "operations": [
            {"op": "set_upright_parameter", "parameter": "height", "value": 90},
            {"op": "upsert_upright_hole", "holeId": "wall_hole_1", "x": -40, "z": 55, "diameter": 10},
        ]},
    })
    assert edited.status_code == 200, edited.text
    assert edited.json()["revision"] == 1
    assert edited.json()["spec"]["upright"]["height"] == 90
    assert edited.json()["inspection"]["boundsMm"] == [120, 80, 90]

    next_spec = edited.json()["spec"]
    next_spec["upright"]["thickness"] = 10
    replaced = client.post(f"/api/cad/projects/{project_id}/spec", json={
        "expectedRevision": 1, "spec": next_spec,
    })
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["revision"] == 2
    assert replaced.json()["spec"]["upright"]["thickness"] == 10
    stale = client.post(f"/api/cad/projects/{project_id}/spec", json={"expectedRevision": 1, "spec": next_spec})
    assert stale.status_code == 409

    invalid = replaced.json()["spec"]
    invalid["upright"]["holes"][0]["z"] = 5
    rejected = client.post(f"/api/cad/projects/{project_id}/spec", json={
        "expectedRevision": 2, "spec": invalid,
    })
    assert rejected.status_code == 400
    assert client.get(f"/api/cad/projects/{project_id}").json()["revision"] == 2
    step = client.get(f"/api/cad/projects/{project_id}/revisions/2/step")
    assert step.status_code == 200
    path = tmp_path / "revision2.step"
    path.write_bytes(step.content)
    solid = cq.importers.importStep(str(path)).solids().vals()[0]
    assert solid.isValid()
    assert solid.BoundingBox().zlen == pytest.approx(90)


@pytest.mark.parametrize("spec,operation,expected", [
    (_ROUNDED_PLATE, {"op": "set_corner_radius", "value": 16}, ("cornerRadius", 16)),
    (_ROUND_FLANGE, {"op": "set_disc_diameter", "value": 120}, ("base", 120)),
])
def test_curved_projects_support_typed_profile_edits(tmp_path, spec, operation, expected) -> None:
    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(tmp_path / "curved.sqlite3")
    client = TestClient(app)
    created = client.post("/api/cad/projects", json={"spec": spec})
    assert created.status_code == 201, created.text
    project_id = created.json()["projectId"]
    edited = client.post(f"/api/cad/projects/{project_id}/plans", json={
        "expectedRevision": 0, "plan": {"schemaVersion": "4.0", "operations": [operation]},
    })
    assert edited.status_code == 200, edited.text
    assert edited.json()["revision"] == 1
    if expected[0] == "base":
        assert edited.json()["spec"]["base"]["width"] == expected[1]
        assert edited.json()["spec"]["base"]["depth"] == expected[1]
    else:
        assert edited.json()["spec"][expected[0]] == expected[1]
    step = client.get(f"/api/cad/projects/{project_id}/revisions/1/step")
    assert step.status_code == 200
    path = tmp_path / "curved.step"
    path.write_bytes(step.content)
    assert cq.importers.importStep(str(path)).solids().vals()[0].isValid()


def test_composite_project_saves_fused_boss_edit_and_rejects_partial_cut(tmp_path) -> None:
    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(tmp_path / "composite.sqlite3")
    client = TestClient(app)
    created = client.post("/api/cad/projects", json={"spec": _COMPOSITE})
    assert created.status_code == 201, created.text
    project_id = created.json()["projectId"]
    edited = client.post(f"/api/cad/projects/{project_id}/plans", json={
        "expectedRevision": 0, "plan": {"schemaVersion": "5.0", "operations": [
            {"op": "upsert_boss", "bossId": "boss_1", "x": 0, "y": 0, "diameter": 44, "height": 25},
        ]},
    })
    assert edited.status_code == 200, edited.text
    assert edited.json()["revision"] == 1
    assert edited.json()["inspection"]["boundsMm"] == [120, 80, 35]
    invalid = client.post(f"/api/cad/projects/{project_id}/plans", json={
        "expectedRevision": 1, "plan": {"schemaVersion": "5.0", "operations": [
            {"op": "upsert_hole", "holeId": "hole_1", "x": 20, "y": 0, "diameter": 10},
        ]},
    })
    assert invalid.status_code == 422
    assert client.get(f"/api/cad/projects/{project_id}").json()["revision"] == 1
