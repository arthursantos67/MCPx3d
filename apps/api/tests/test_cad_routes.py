import copy
import json
import math
from collections.abc import Iterator
from pathlib import Path

import cadquery as cq
import pytest
from fastapi.testclient import TestClient

from api.config import Settings, get_settings
from api.main import app

_PLATE = {
    "schemaVersion": "2.0",
    "units": "mm",
    "partId": "bracket_plate",
    "base": {"kind": "extruded_rectangle", "width": 100, "depth": 80, "thickness": 10},
    "features": [{"kind": "through_hole", "x": 10, "y": 5, "diameter": 12}],
}
_MOUNTING_PLATE = json.loads((Path(__file__).resolve().parents[3] / "packages/domain/fixtures/cad-part/valid-mounting-plate.json").read_text(encoding="utf-8"))
_L_BRACKET = json.loads((Path(__file__).resolve().parents[3] / "packages/domain/fixtures/cad-part/valid-l-bracket.json").read_text(encoding="utf-8"))
_ROUNDED_PLATE = json.loads((Path(__file__).resolve().parents[3] / "packages/domain/fixtures/cad-part/valid-rounded-plate.json").read_text(encoding="utf-8"))
_ROUND_FLANGE = json.loads((Path(__file__).resolve().parents[3] / "packages/domain/fixtures/cad-part/valid-round-flange.json").read_text(encoding="utf-8"))
_COMPOSITE = json.loads((Path(__file__).resolve().parents[3] / "packages/domain/fixtures/cad-part/valid-composite-part.json").read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def _reset_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.clear()


def test_inspect_and_export_roundtrip_a_real_step_solid(tmp_path) -> None:
    client = TestClient(app)

    inspected = client.post("/api/cad/parts/inspect", json=_PLATE)
    exported = client.post("/api/cad/parts/step", json=_PLATE)

    assert inspected.status_code == 200
    assert inspected.json()["solidCount"] == 1
    assert inspected.json()["boundsMm"] == [100, 80, 10]
    expected_volume = (100 * 80 - math.pi * 6**2) * 10
    assert inspected.json()["volumeMm3"] == pytest.approx(expected_volume)
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("application/step")
    assert exported.headers["content-disposition"] == 'attachment; filename="bracket_plate.step"'
    assert len(exported.content) == inspected.json()["stepBytes"]
    path = tmp_path / "bracket_plate.step"
    path.write_bytes(exported.content)
    solids = cq.importers.importStep(str(path)).solids().vals()
    assert len(solids) == 1
    assert solids[0].isValid()
    assert solids[0].Volume() == pytest.approx(expected_volume)
    holes = [face for face in solids[0].Faces() if face.geomType() == "CYLINDER"]
    assert len(holes) == 1
    assert holes[0].Center().x == pytest.approx(10)
    assert holes[0].Center().y == pytest.approx(5)
    assert holes[0].Area() == pytest.approx(math.pi * 12 * 10)


def test_mounting_plate_step_has_four_holes_and_corner_chamfers(tmp_path) -> None:
    client = TestClient(app)
    inspected = client.post("/api/cad/parts/inspect", json=_MOUNTING_PLATE)
    exported = client.post("/api/cad/parts/step", json=_MOUNTING_PLATE)

    expected_volume = (120 * 80 - 2 * 4**2 - 4 * math.pi * 4**2) * 10
    assert inspected.status_code == 200, inspected.text
    assert inspected.json()["volumeMm3"] == pytest.approx(expected_volume)
    assert inspected.json()["boundsMm"] == [120, 80, 10]
    assert exported.status_code == 200, exported.text
    path = tmp_path / "mounting_plate.step"
    path.write_bytes(exported.content)
    solids = cq.importers.importStep(str(path)).solids().vals()
    assert len(solids) == 1
    solid = solids[0]
    assert solid.isValid()
    assert solid.Volume() == pytest.approx(expected_volume)
    holes = [face for face in solid.Faces() if face.geomType() == "CYLINDER"]
    assert len(holes) == 4
    assert {(round(face.Center().x), round(face.Center().y)) for face in holes} == {
        (-40, -25), (40, -25), (-40, 25), (40, 25),
    }
    chamfers = [
        face for face in solid.Faces()
        if face.geomType() == "PLANE"
        and face.Area() == pytest.approx(4 * math.sqrt(2) * 10)
    ]
    assert len(chamfers) == 4


def test_l_bracket_step_is_one_valid_fused_solid_with_both_hole_directions(tmp_path) -> None:
    client = TestClient(app)
    inspected = client.post("/api/cad/parts/inspect", json=_L_BRACKET)
    exported = client.post("/api/cad/parts/step", json=_L_BRACKET)
    assert inspected.status_code == 200, inspected.text
    assert exported.status_code == 200, exported.text
    assert inspected.json()["boundsMm"] == [120, 80, 70]
    expected_volume = 120 * 80 * 8 - 2 * math.pi * 4**2 * 8 + 120 * 8 * (70 - 8) - 2 * math.pi * 5**2 * 8
    assert inspected.json()["volumeMm3"] == pytest.approx(expected_volume)
    path = tmp_path / "bracket.step"
    path.write_bytes(exported.content)
    solids = cq.importers.importStep(str(path)).solids().vals()
    assert len(solids) == 1
    assert solids[0].isValid()
    assert solids[0].Volume() == pytest.approx(expected_volume)
    cylinders = [face for face in solids[0].Faces() if face.geomType() == "CYLINDER"]
    assert len(cylinders) == 4
    assert sorted(round(face.Area()) for face in cylinders) == sorted([
        round(math.pi * 8 * 8), round(math.pi * 8 * 8),
        round(math.pi * 10 * 8), round(math.pi * 10 * 8),
    ])


@pytest.mark.parametrize("spec,outer_faces,expected_area", [
    (_ROUNDED_PLATE, 4, 120 * 80 - (4 - math.pi) * 12**2),
    (_ROUND_FLANGE, 1, math.pi * 50**2),
])
def test_curved_parts_roundtrip_as_real_step_solids(tmp_path, spec, outer_faces, expected_area) -> None:
    client = TestClient(app)
    inspected = client.post("/api/cad/parts/inspect", json=spec)
    exported = client.post("/api/cad/parts/step", json=spec)
    assert inspected.status_code == 200, inspected.text
    assert exported.status_code == 200, exported.text
    expected_volume = (expected_area - sum(math.pi * (hole["diameter"] / 2) ** 2 for hole in spec["features"])) * spec["base"]["thickness"]
    assert inspected.json()["volumeMm3"] == pytest.approx(expected_volume)
    path = tmp_path / "curved.step"
    path.write_bytes(exported.content)
    solids = cq.importers.importStep(str(path)).solids().vals()
    assert len(solids) == 1
    assert solids[0].isValid()
    assert solids[0].Volume() == pytest.approx(expected_volume)
    cylinders = [face for face in solids[0].Faces() if face.geomType() == "CYLINDER"]
    assert len(cylinders) == len(spec["features"]) + outer_faces


def test_composite_roundtrip_has_fused_boss_and_full_depth_bore(tmp_path) -> None:
    client = TestClient(app)
    response = client.post("/api/cad/parts/step", json=_COMPOSITE)
    assert response.status_code == 200, response.text
    path = tmp_path / "composite.step"
    path.write_bytes(response.content)
    solids = cq.importers.importStep(str(path)).solids().vals()
    assert len(solids) == 1 and solids[0].isValid()
    assert solids[0].BoundingBox().zlen == pytest.approx(30)
    cylinders = [face for face in solids[0].Faces() if face.geomType() == "CYLINDER"]
    assert len(cylinders) == 10  # four curved corners, one fused boss and five through holes
    center_bore = [face for face in cylinders if face._geomAdaptor().Cylinder().Radius() == pytest.approx(5)]
    assert len(center_bore) == 1
    assert center_bore[0].Area() == pytest.approx(math.pi * 10 * 30)


def test_composite_can_join_a_circular_base_and_two_separate_bosses() -> None:
    spec = copy.deepcopy(_COMPOSITE)
    spec["base"].update({"kind": "extruded_disc", "depth": 120})
    spec["cornerRadius"] = 0
    spec["bosses"].append({"kind": "cylindrical_boss", "id": "boss_2", "x": 40, "y": 0, "diameter": 16, "height": 12})
    response = TestClient(app).post("/api/cad/parts/inspect", json=spec)
    assert response.status_code == 200, response.text
    assert response.json()["solidCount"] == 1
    assert response.json()["boundsMm"] == [120, 120, 30]


@pytest.mark.parametrize(
    "changes",
    [
        {"units": "cm"},
        {"schemaVersion": "1.0"},
        {"extra": "unexpected"},
        {"base": {"kind": "extruded_rectangle", "width": -1, "depth": 80, "thickness": 10}},
        {"features": [{"kind": "through_hole", "x": 45, "y": 0, "diameter": 12}]},
        {"features": []},
    ],
)
def test_invalid_cad_parts_are_rejected(changes: dict[str, object]) -> None:
    response = TestClient(app).post("/api/cad/parts/step", json={**_PLATE, **changes})

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_CAD_PART"


def test_oversized_step_is_not_exposed() -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(max_artifact_bytes=100)

    response = TestClient(app).post("/api/cad/parts/step", json=_PLATE)

    assert response.status_code == 413
    assert response.json()["code"] == "COMPLEXITY_LIMIT"


def test_missing_cad_engine_returns_actionable_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def unavailable(_name: str) -> None:
        raise ImportError("cadquery")

    monkeypatch.setattr("api.cad_adapter.import_module", unavailable)

    response = TestClient(app).post("/api/cad/parts/step", json=_PLATE)

    assert response.status_code == 503
    assert response.json()["code"] == "CAD_ENGINE_UNAVAILABLE"
