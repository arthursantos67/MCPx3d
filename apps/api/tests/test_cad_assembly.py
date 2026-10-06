from __future__ import annotations

import json
import re
from collections.abc import Iterator
from pathlib import Path

import cadquery as cq
import pytest
from fastapi.testclient import TestClient

from api.cad_projects import CadProjectStore
from api.main import app
from api.routes.cad_projects import get_cad_project_store

ZERO = {"x": 0, "y": 0, "z": 0}


def test_motor_reports_all_collisions_and_accepts_accumulated_placement_repairs(tmp_path) -> None:
    from domain.cad_diagnostics import CadAssemblyDiagnostics

    motor = json.loads((Path(__file__).parents[3] / "tests/fixtures/cad_motor_overlap.json").read_text())
    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(tmp_path / "motor.sqlite3")
    client = TestClient(app)

    def inspect_collisions() -> list[dict]:
        response = client.post("/api/cad/assemblies/inspect", json=motor)
        assert response.status_code == 422, response.text
        report = response.json()["details"][0]
        CadAssemblyDiagnostics.model_validate_json(json.dumps(report))
        return report["collisions"]

    collisions = inspect_collisions()
    assert len(collisions) == 12
    assert {tuple(item["components"]) for item in collisions} == {("housing", "front_cover"), ("housing", "rear_cover")}
    first = collisions[0]
    assert first["overlapVolumeMm3"] == pytest.approx(13910.97, abs=0.01)
    assert first["overlapBoundsMm"]["z"] == pytest.approx([57, 60])
    assert first["componentBoundsMm"][0]["z"] == pytest.approx([-60, 60])
    assert first["componentBoundsMm"][1]["z"] == pytest.approx([57, 65])

    motor["components"][1]["position"]["z"] = 64.5
    remaining = inspect_collisions()
    assert len(remaining) == 6
    assert all(item["components"] == ["housing", "rear_cover"] for item in remaining)
    motor["components"][2]["position"]["z"] = -64.5
    response = client.post("/api/cad/projects", json={"spec": motor})
    assert response.status_code == 201, response.text
    assert response.json()["inspection"]["solidCount"] == 4


def box(id: str, op: str, width: float, depth: float, height: float, x=0, y=0, z=0) -> dict:
    return {"id": id, "op": op, "shape": "box", "width": width, "depth": depth, "height": height,
            "position": {"x": x, "y": y, "z": z}, "rotation": ZERO}


def cylinder(id: str, op: str, diameter: float, height: float, x=0, y=0, z=0) -> dict:
    return {"id": id, "op": op, "shape": "cylinder", "diameter": diameter, "height": height,
            "position": {"x": x, "y": y, "z": z}, "rotation": ZERO}


PRESS = {"schemaVersion": "4.0", "units": "mm", "partId": "manual_press", "components": [
    {"id": "frame", "position": ZERO, "steps": [
        box("base", "base", 120, 70, 12),
        box("left_column", "union", 12, 70, 90, x=-50, z=45),
        box("right_column", "union", 12, 70, 90, x=50, z=45),
        box("crossbeam", "union", 112, 70, 12, z=90),
        cylinder("thread_clearance", "cut", 12, 24, z=90),
    ]},
    {"id": "spindle", "position": {"x": 0, "y": 0, "z": 67}, "motion": {
        "kind": "screw", "axis": "z", "minimum": -2, "maximum": 8, "value": 0, "pitch": 4, "group": "press"},
     "steps": [cylinder("shaft", "base", 10, 76),
               {**cylinder("handle", "union", 7, 70, z=37), "rotation": {"x": 0, "y": 90, "z": 0}}]},
    {"id": "platen", "position": {"x": 0, "y": 0, "z": 24}, "motion": {
        "kind": "slider", "axis": "z", "minimum": -2, "maximum": 8, "value": 0, "group": "press"},
     "steps": [box("plate", "base", 60, 40, 10)]},
]}


@pytest.fixture(autouse=True)
def _reset_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.clear()


def test_manual_press_is_saved_as_three_independent_solid_bodies(tmp_path) -> None:
    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(tmp_path / "cad.sqlite3")
    client = TestClient(app)
    inspected = client.post("/api/cad/assemblies/inspect", json=PRESS)
    assert inspected.status_code == 200, inspected.text
    assert inspected.json()["solidCount"] == 3
    mesh = client.post("/api/cad/assemblies/mesh", json=PRESS)
    assert mesh.status_code == 200, mesh.text
    assert len(mesh.json()["components"]) == 3
    saved = client.post("/api/cad/projects", json={"spec": PRESS})
    assert saved.status_code == 201, saved.text
    project_id = saved.json()["projectId"]
    assert saved.json()["inspection"]["solidCount"] == 3
    step = client.get(f"/api/cad/projects/{project_id}/revisions/0/step")
    assert step.status_code == 200
    path = tmp_path / "press.step"
    path.write_bytes(step.content)
    assert len(cq.importers.importStep(str(path)).solids().vals()) == 3
    stl = client.get(f"/api/cad/projects/{project_id}/revisions/0/stl")
    assert stl.status_code == 200, stl.text
    assert int.from_bytes(stl.content[80:84], "little") > 100
    spindle_stl = client.get(f"/api/cad/projects/{project_id}/revisions/0/components/spindle/stl")
    assert spindle_stl.status_code == 200, spindle_stl.text
    assert spindle_stl.content != stl.content
    assert int.from_bytes(spindle_stl.content[80:84], "little") > 20
    assert len(spindle_stl.content) == 84 + 50 * int.from_bytes(spindle_stl.content[80:84], "little")
    spindle_step = client.get(f"/api/cad/projects/{project_id}/revisions/0/components/spindle/step")
    assert spindle_step.status_code == 200
    path.write_bytes(spindle_step.content)
    component = cq.importers.importStep(str(path)).solids().vals()
    assert len(component) == 1 and component[0].isValid()
    assert component[0].BoundingBox().zmin == pytest.approx(29)
    assert component[0].Volume() == pytest.approx(mesh.json()["components"][1]["volumeMm3"], rel=1e-5)


def test_motion_validation_builds_each_component_once(monkeypatch) -> None:
    from domain.cad_assembly import CadAssemblySpec

    from api import cad_assembly_adapter as adapter

    original = adapter.build_program_solid
    calls = []

    def tracked(spec, engine):
        calls.append(spec.partId)
        return original(spec, engine)

    monkeypatch.setattr(adapter, "build_program_solid", tracked)
    artifact = adapter.build_assembly_step(CadAssemblySpec.model_validate(PRESS), 10_000_000)
    assert artifact.solid_count == 3
    assert calls == ["frame", "spindle", "platen"]


def test_inspection_and_save_reuse_the_same_validated_step(tmp_path, monkeypatch) -> None:
    from api import cad_service

    original = cad_service.build_assembly_step
    calls = []

    def tracked(spec, limit):
        calls.append(spec.partId)
        return original(spec, limit)

    monkeypatch.setattr(cad_service, "build_assembly_step", tracked)
    app.dependency_overrides[get_cad_project_store] = lambda: CadProjectStore(tmp_path / "cache-test.sqlite3")
    client = TestClient(app)
    assert client.post("/api/cad/assemblies/inspect", json=PRESS).status_code == 200
    assert client.post("/api/cad/projects", json={"spec": PRESS}).status_code == 201
    assert calls == ["manual_press"]


def test_press_motion_moves_spindle_and_platen_and_rejects_mismatched_group() -> None:
    from copy import deepcopy

    client = TestClient(app)
    raised = deepcopy(PRESS)
    raised["components"][1]["motion"]["value"] = 8
    raised["components"][2]["motion"]["value"] = 8
    at_zero = client.post("/api/cad/assemblies/mesh", json=PRESS).json()
    at_eight = client.post("/api/cad/assemblies/mesh", json=raised).json()
    assert at_zero["vertices"] != at_eight["vertices"]
    invalid = deepcopy(raised)
    invalid["components"][2]["motion"]["value"] = 0
    assert client.post("/api/cad/assemblies/inspect", json=invalid).status_code == 400

    collision = deepcopy(PRESS)
    for component in collision["components"][1:]:
        component["motion"]["minimum"] = -10
    blocked = client.post("/api/cad/assemblies/inspect", json=collision)
    assert blocked.status_code == 422
    assert "intersect at curso mínimo" in blocked.text


def test_assembly_rejects_collision_between_motion_endpoints() -> None:
    client = TestClient(app)
    mechanism = {"schemaVersion": "4.0", "units": "mm", "partId": "crossing_slider", "components": [
        {"id": "obstacle", "position": ZERO, "steps": [box("body", "base", 5, 5, 5)]},
        {"id": "slider", "position": ZERO, "steps": [box("body", "base", 5, 5, 5)], "motion": {
            "kind": "slider", "axis": "x", "minimum": -20, "maximum": 20, "value": -20}},
    ]}

    response = client.post("/api/cad/assemblies/inspect", json=mechanism)

    assert response.status_code == 422
    assert "intersect at meio do curso" in response.text


def test_motor_with_radial_fins_and_separate_rotor_is_valid() -> None:
    client = TestClient(app)
    along_y = {"x": 90, "y": 0, "z": 0}
    motor = {"schemaVersion": "4.0", "units": "mm", "partId": "motor", "components": [
        {"id": "housing", "position": ZERO, "steps": [
            {**cylinder("outer", "base", 80, 100), "rotation": along_y},
            {**cylinder("interior", "cut", 70, 102), "rotation": along_y},
            box("mounting_base", "union", 50, 44, 20, y=-53, z=-42),
            {**box("cooling_fin", "union", 4, 8, 20, y=42, z=40),
             "pattern": {"kind": "circular", "count": 12, "axis": "y", "center": ZERO, "sweepAngle": 360}},
        ]},
        {"id": "rotor", "position": ZERO, "motion": {
            "kind": "rotary", "axis": "y", "minimum": 0, "maximum": 360, "value": 0},
         "steps": [
             {**cylinder("core", "base", 60, 70), "rotation": along_y},
             {**cylinder("shaft", "union", 12, 120), "rotation": along_y},
         ]},
    ]}

    inspected = client.post("/api/cad/assemblies/inspect", json=motor)
    assert inspected.status_code == 200, inspected.text
    assert inspected.json()["solidCount"] == 2
    mesh = client.post("/api/cad/assemblies/mesh", json=motor)
    assert mesh.status_code == 200, mesh.text
    assert len(mesh.json()["components"]) == 2


def test_contained_stator_collision_reports_volume_and_accepts_housing_clearance() -> None:
    client = TestClient(app)
    motor = {"schemaVersion": "4.0", "units": "mm", "partId": "motor", "components": [
        {"id": "carcaca", "position": ZERO, "steps": [box("body", "base", 100, 100, 100)]},
        {"id": "estator", "position": ZERO, "steps": [cylinder("core", "base", 80, 80)]},
    ]}
    blocked = client.post("/api/cad/assemblies/inspect", json=motor)
    assert blocked.status_code == 422
    assert "components carcaca and estator intersect" in blocked.text
    assert "overlap fractions: carcaca=" in blocked.text
    assert "estator=1.0000" in blocked.text

    motor["components"][0]["steps"].append(cylinder("stator_clearance", "cut", 82, 102))
    cleared = client.post("/api/cad/assemblies/inspect", json=motor)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["solidCount"] == 2


def test_undersized_existing_bore_reports_small_overlap_and_accepts_enlargement() -> None:
    client = TestClient(app)
    motor = {"schemaVersion": "4.0", "units": "mm", "partId": "motor", "components": [
        {"id": "carcaca", "position": ZERO, "steps": [
            cylinder("shell", "base", 100, 100),
            cylinder("bore", "cut", 77, 102),
        ]},
        {"id": "estator", "position": ZERO, "steps": [cylinder("core", "base", 80, 80)]},
    ]}
    blocked = client.post("/api/cad/assemblies/inspect", json=motor)
    assert blocked.status_code == 422
    assert "components carcaca and estator intersect" in blocked.text
    assert "overlap bounds: x=[-40.00, 40.00]" in blocked.text
    assert "overlap fractions: carcaca=" in blocked.text

    motor["components"][0]["steps"][1]["diameter"] = 83
    cleared = client.post("/api/cad/assemblies/inspect", json=motor)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["solidCount"] == 2


def test_wide_thin_overlap_can_be_cleared_with_a_local_box_cut() -> None:
    client = TestClient(app)
    assembly = {"schemaVersion": "4.0", "units": "mm", "partId": "mechanism", "components": [
        {"id": "carcaca", "position": ZERO, "steps": [
            cylinder("shell", "base", 100, 100),
            cylinder("bore", "cut", 70, 102),
        ]},
        {"id": "estator", "position": ZERO, "steps": [
            box("core", "base", 90, 40, 10, y=-25),
        ]},
    ]}
    blocked = client.post("/api/cad/assemblies/inspect", json=assembly)
    assert blocked.status_code == 422
    message = blocked.json()["message"]
    assert "components carcaca and estator intersect" in message
    match = re.search(
        r"overlap bounds: x=\[([\d.-]+), ([\d.-]+)\], y=\[([\d.-]+), ([\d.-]+)\], "
        r"z=\[([\d.-]+), ([\d.-]+)\]", message)
    assert match is not None
    edges = [(float(match.group(index)), float(match.group(index + 1))) for index in (1, 3, 5)]
    assert edges[2][1] - edges[2][0] == 10
    assembly["components"][0]["steps"].append(box(
        "assembly_relief_1", "cut", *(maximum - minimum + 2 for minimum, maximum in edges),
        *(round((minimum + maximum) / 2, 2) for minimum, maximum in edges)))
    cleared = client.post("/api/cad/assemblies/inspect", json=assembly)
    assert cleared.status_code == 200, cleared.text


def test_endbell_overlap_reports_component_bounds_and_accepts_axial_seating() -> None:
    client = TestClient(app)
    assembly = {"schemaVersion": "4.0", "units": "mm", "partId": "motor", "components": [
        {"id": "housing", "position": {"x": 0, "y": 0, "z": 75}, "steps": [
            cylinder("shell", "base", 100, 150),
            cylinder("interior", "cut", 90, 152),
        ]},
        {"id": "front_endbell", "position": {"x": 0, "y": 0, "z": 151.5}, "steps": [
            cylinder("cover", "base", 99.8, 12),
        ]},
    ]}
    blocked = client.post("/api/cad/assemblies/inspect", json=assembly)
    assert blocked.status_code == 422
    message = blocked.json()["message"]
    assert "components housing and front_endbell intersect" in message
    assert "component bounds: housing x=[-50.00, 50.00]" in message
    assert "z=[0.00, 150.00]; front_endbell" in message
    assert "z=[145.50, 157.50]" in message

    assembly["components"][1]["position"]["z"] = 156.5
    seated = client.post("/api/cad/assemblies/inspect", json=assembly)
    assert seated.status_code == 200, seated.text
