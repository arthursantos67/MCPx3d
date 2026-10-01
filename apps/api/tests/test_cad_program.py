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
    stl = client.get(f"/api/cad/projects/{project_id}/revisions/0/stl")
    assert stl.status_code == 200, stl.text
    assert stl.headers["content-type"].startswith("model/stl")
    assert f'{SPEC["partId"]}-r0.stl' in stl.headers["content-disposition"]
    triangle_count = int.from_bytes(stl.content[80:84], "little")
    assert triangle_count > 100
    assert len(stl.content) == 84 + triangle_count * 50
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
    old_stl = client.get(f"/api/cad/projects/{project_id}/revisions/0/stl")
    new_stl = client.get(f"/api/cad/projects/{project_id}/revisions/1/stl")
    assert old_stl.content == stl.content
    assert new_stl.status_code == 200 and new_stl.content != stl.content


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
    assert "current solid bounds:" in severed.text
    assert "tool bounds:" in severed.text
    assert "preserve a material bridge" in severed.text

    split["steps"][1]["depth"] = 8
    assert client.post("/api/cad/programs/inspect", json=split).status_code == 200
    noop = copy.deepcopy(SPEC)
    noop["steps"][2]["position"]["x"] = 100
    no_change = client.post("/api/cad/programs/inspect", json=noop)
    assert no_change.status_code == 422
    assert "CAD step bore instance 1 does not change the solid" in no_change.text
    assert "current solid bounds:" in no_change.text
    assert "tool bounds:" in no_change.text

    contained = copy.deepcopy(SPEC)
    contained["steps"] = [contained["steps"][0], {
        "id": "buried_boss", "op": "union", "shape": "cylinder", "position": zero, "rotation": zero,
        "diameter": 10, "height": 4,
    }]
    redundant = client.post("/api/cad/programs/inspect", json=contained)
    assert redundant.status_code == 422
    assert "CAD step buried_boss instance 1 does not change the solid" in redundant.text
    invalid = copy.deepcopy(SPEC)
    invalid["steps"][1]["id"] = "foot"
    assert client.post("/api/cad/projects", json={"spec": invalid}).status_code == 400


def test_motor_housing_foot_inside_bore_needs_material_overlap() -> None:
    client = TestClient(app)
    zero = {"x": 0, "y": 0, "z": 0}
    turn = {"x": 90, "y": 0, "z": 0}
    housing = {"schemaVersion": "3.0", "units": "mm", "partId": "housing", "steps": [
        {"id": "outer_shell", "op": "base", "shape": "cylinder", "position": zero,
         "rotation": turn, "diameter": 100, "height": 90},
        {"id": "interior", "op": "cut", "shape": "cylinder", "position": zero,
         "rotation": turn, "diameter": 90, "height": 100},
        {"id": "mounting_base", "op": "union", "shape": "box", "position": {"x": 0, "y": -42, "z": 0},
         "rotation": zero, "width": 80, "depth": 20, "height": 20},
    ]}
    failure = client.post("/api/cad/programs/inspect", json=housing)
    assert failure.status_code == 422
    assert "bounding boxes overlap" in failure.text
    assert "nearest solid point:" in failure.text

    housing["steps"][2]["position"] = {"x": -4.63, "y": -42, "z": 1.15}
    repaired = client.post("/api/cad/programs/inspect", json=housing)
    assert repaired.status_code == 200, repaired.text
    assert repaired.json()["solidCount"] == 1


def test_circular_fins_must_each_add_material() -> None:
    client = TestClient(app)
    zero = {"x": 0, "y": 0, "z": 0}
    housing = {"schemaVersion": "3.0", "units": "mm", "partId": "motor_housing", "steps": [
        {"id": "outer", "op": "base", "shape": "cylinder", "position": zero,
         "rotation": {"x": 90, "y": 0, "z": 0}, "diameter": 80, "height": 100},
        {"id": "foot", "op": "union", "shape": "box", "position": {"x": 0, "y": -53, "z": -25},
         "rotation": zero, "width": 50, "depth": 44, "height": 20},
        {"id": "cooling_fin", "op": "union", "shape": "box", "position": {"x": 0, "y": 42, "z": 0},
         "rotation": zero, "width": 4, "depth": 8, "height": 80,
         "pattern": {"kind": "circular", "count": 12, "axis": "y", "center": zero, "sweepAngle": 360}},
    ]}
    duplicate = client.post("/api/cad/programs/inspect", json=housing)
    assert duplicate.status_code == 422
    assert "cooling_fin instance 7 does not change the solid" in duplicate.text
    assert "duplicates pattern instance 1" in duplicate.text

    housing["steps"][2]["position"]["z"] = 40
    housing["steps"][2]["height"] = 20
    repaired = client.post("/api/cad/programs/inspect", json=housing)
    assert repaired.status_code == 200, repaired.text
    assert repaired.json()["solidCount"] == 1


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


def test_invalid_base_profiles_identify_self_intersections_and_duplicate_closure() -> None:
    client = TestClient(app)
    zero = {"x": 0, "y": 0, "z": 0}
    crossing = [{"x": 0, "y": 0}, {"x": 6, "y": 0}, {"x": 6, "y": 6},
                {"x": 0, "y": 6}, {"x": 4, "y": -2}]
    program = {"schemaVersion": "3.0", "units": "mm", "partId": "profile", "steps": [
        {"id": "c_frame", "op": "base", "shape": "polygon_prism", "position": zero,
         "rotation": zero, "points": crossing, "height": 8},
    ]}
    crossed = client.post("/api/cad/programs/inspect", json=program)
    assert crossed.status_code == 422
    assert "CAD step c_frame (base) polygon_prism profile self-intersects between edges" in crossed.text

    program["steps"][0]["points"] = [{"x": 0, "y": 0}, {"x": 6, "y": 0},
                                      {"x": 6, "y": 6}, {"x": 0, "y": 6},
                                      {"x": 0, "y": 0}]
    repeated = client.post("/api/cad/programs/inspect", json=program)
    assert repeated.status_code == 422
    assert "profile has a zero-length edge" in repeated.text

    program["steps"][0]["points"].pop()
    corrected = client.post("/api/cad/programs/inspect", json=program)
    assert corrected.status_code == 200, corrected.text


def test_transverse_bore_must_cross_the_walls() -> None:
    client = TestClient(app)
    zero = {"x": 0, "y": 0, "z": 0}
    program = {"schemaVersion": "3.0", "units": "mm", "partId": "wall_mount", "steps": [
        {"id": "base", "op": "base", "shape": "box", "position": zero, "rotation": zero,
         "width": 160, "depth": 110, "height": 12},
        {"id": "pedestal", "op": "union", "shape": "box", "position": {"x": 0, "y": 0, "z": 15},
         "rotation": zero, "width": 80, "depth": 55, "height": 18},
        {"id": "left_wall", "op": "union", "shape": "box", "position": {"x": 0, "y": -24, "z": 61},
         "rotation": zero, "width": 55, "depth": 12, "height": 75},
        {"id": "right_wall", "op": "union", "shape": "box", "position": {"x": 0, "y": 24, "z": 61},
         "rotation": zero, "width": 55, "depth": 12, "height": 75},
        {"id": "transverse_bore", "op": "cut", "shape": "cylinder", "position": {"x": 0, "y": 0, "z": 150},
         "rotation": {"x": 90, "y": 0, "z": 0}, "diameter": 24, "height": 70},
    ]}
    missed = client.post("/api/cad/programs/inspect", json=program)
    assert missed.status_code == 422
    assert "CAD step transverse_bore instance 1 does not change the solid" in missed.text
    assert "tool bounds:" in missed.text

    program["steps"][-1]["position"]["z"] = 79
    corrected = client.post("/api/cad/programs/inspect", json=program)
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["solidCount"] == 1


def test_rear_cover_vent_slots_must_cross_its_thickness() -> None:
    client = TestClient(app)
    zero = {"x": 0, "y": 0, "z": 0}
    program = {"schemaVersion": "3.0", "units": "mm", "partId": "rear_cover", "steps": [
        {"id": "cover", "op": "base", "shape": "box", "position": zero, "rotation": zero,
         "width": 100, "depth": 10, "height": 100},
        {"id": "vent_slot", "op": "cut", "shape": "box",
         "position": {"x": 0, "y": 35, "z": 0}, "rotation": zero,
         "width": 15, "depth": 40, "height": 20,
         "pattern": {"kind": "linear", "count": 3, "offset": {"x": 20, "y": 0, "z": 0}}},
    ]}
    missed = client.post("/api/cad/programs/inspect", json=program)
    assert missed.status_code == 422
    assert "CAD step vent_slot instance 1 does not change the solid" in missed.text

    program["steps"][1]["position"]["y"] = 0
    corrected = client.post("/api/cad/programs/inspect", json=program)
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["solidCount"] == 1


def test_spindle_union_reports_disconnection_and_prior_clearance_cut() -> None:
    client = TestClient(app)
    zero = {"x": 0, "y": 0, "z": 0}
    frame = {"id": "top_beam", "op": "base", "shape": "box", "position": {"x": 0, "y": 0, "z": 160},
             "rotation": zero, "width": 100, "depth": 60, "height": 20}
    spindle = {"id": "spindle", "op": "union", "shape": "cylinder", "position": {"x": 150, "y": 0, "z": 135},
               "rotation": zero, "diameter": 18, "height": 120}
    program = {"schemaVersion": "3.0", "units": "mm", "partId": "press", "steps": [frame, spindle]}

    misplaced = client.post("/api/cad/programs/inspect", json=program)
    assert misplaced.status_code == 422
    assert "CAD step spindle (union) leaves 2 separate solids" in misplaced.text
    assert "current solid bounds:" in misplaced.text
    assert "tool bounds:" in misplaced.text
    assert "bounding boxes do not overlap" in misplaced.text

    spindle["position"]["x"] = 0
    connected = client.post("/api/cad/programs/inspect", json=program)
    assert connected.status_code == 200, connected.text

    guide = {"id": "guide_clearance", "op": "cut", "shape": "cylinder", "position": {"x": 0, "y": 0, "z": 160},
             "rotation": zero, "diameter": 20, "height": 30}
    program["steps"] = [frame, guide, spindle]
    isolated = client.post("/api/cad/programs/inspect", json=program)
    assert isolated.status_code == 422
    assert "CAD step spindle (union) leaves 2 separate solids" in isolated.text
    assert "bounding boxes overlap, but the solids may be separated" in isolated.text
    assert "nearest solid point:" in isolated.text
    assert "nearest tool point:" in isolated.text


def test_handle_bar_gap_can_be_closed_without_changing_its_dimensions() -> None:
    client = TestClient(app)
    zero = {"x": 0, "y": 0, "z": 0}
    program = {"schemaVersion": "3.0", "units": "mm", "partId": "press_handle", "steps": [
        {"id": "body", "op": "base", "shape": "box", "position": {"x": 65, "y": 0, "z": 0},
         "rotation": zero, "width": 130, "depth": 60, "height": 10},
        {"id": "handle_bar", "op": "union", "shape": "box", "position": {"x": 67.5, "y": 120, "z": 0},
         "rotation": zero, "width": 8, "depth": 100, "height": 8},
    ]}
    separated = client.post("/api/cad/programs/inspect", json=program)
    assert separated.status_code == 422
    assert "CAD step handle_bar (union) leaves 2 separate solids" in separated.text
    assert "tool bounds: x=[63.50, 71.50], y=[70.00, 170.00]" in separated.text

    program["steps"][1]["position"]["y"] = 75
    joined = client.post("/api/cad/programs/inspect", json=program)
    assert joined.status_code == 200, joined.text
    assert joined.json()["solidCount"] == 1

    program["steps"].append({"id": "upright", "op": "union", "shape": "box",
                             "position": {"x": 67.5, "y": 0, "z": 54}, "rotation": zero,
                             "width": 8, "depth": 8, "height": 100})
    extended = client.post("/api/cad/programs/inspect", json=program)
    assert extended.status_code == 200, extended.text
    assert extended.json()["solidCount"] == 1


def test_disconnected_handle_ball_reports_nearest_material_not_just_global_bounds() -> None:
    client = TestClient(app)
    zero = {"x": 0, "y": 0, "z": 0}
    program = {"schemaVersion": "3.0", "units": "mm", "partId": "press_handle", "steps": [
        {"id": "base", "op": "base", "shape": "box", "position": {"x": 35, "y": 25, "z": -25},
         "rotation": zero, "width": 130, "depth": 120, "height": 10},
        {"id": "upright", "op": "union", "shape": "box", "position": {"x": 35, "y": 25, "z": 50},
         "rotation": zero, "width": 10, "depth": 10, "height": 150},
        {"id": "handle_bar", "op": "union", "shape": "box", "position": {"x": 35, "y": 50, "z": 75},
         "rotation": zero, "width": 8, "depth": 70, "height": 8},
        {"id": "handle_ball_left", "op": "union", "shape": "sphere", "position": {"x": 35, "y": -50, "z": 75},
         "rotation": zero, "diameter": 14},
    ]}
    separated = client.post("/api/cad/programs/inspect", json=program)
    assert separated.status_code == 422
    assert "current solid bounds: x=[-30.00, 100.00], y=[-35.00, 85.00], z=[-30.00, 125.00]" in separated.text
    assert "tool bounds: x=[28.00, 42.00], y=[-57.00, -43.00], z=[68.00, 82.00]" in separated.text
    assert "nearest solid point:" in separated.text
    assert "nearest tool point:" in separated.text

    program["steps"][-1]["position"]["y"] = 9
    joined = client.post("/api/cad/programs/inspect", json=program)
    assert joined.status_code == 200, joined.text
    assert joined.json()["solidCount"] == 1


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
